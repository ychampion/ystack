import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { InstallSource, Progress, Report } from '../types'
import { DAY, type Entry, HOUR, LineFeeder, buildReport, fitsWindow, newEntry, reportLines, shareText } from './core.ts'

// /ystack-stats: re-prices the user's own logged API calls under ystack's rules, and compares real usage before and
// after ystack was installed. Everything is read from ~/.claude/projects on this machine; no log text goes anywhere.

const PANE = 'ystack-stats'
const progress = atom({ plugin: 'ystack-stats', key: 'progress' } as const, { phase: 'idle', done: 0, total: 0, read: 0, skipped: 0, note: '' } as Progress, {
  shape: 'progress-1',
})
const report = atom({ plugin: 'ystack-stats', key: 'report' } as const, null as Report | null, { shape: 'report-1' })

let DAYS = 14
/** `$.fs.read` takes files up to 4 MiB; larger ones stream through a child process. */
const READ_LIMIT = 4 * 1024 * 1024 - 64 * 1024
/** Keep the file cache well under the store's 4 MiB. */
const CACHE_LIMIT = 3_000_000
const CACHE_KEY = 'files-1'
let running = false

type FileRef = { path: string; kind: 'main' | 'sub'; session: string; size: number; mtime: number }
type Reader = { argv: (path: string, offset: number) => string[] } | null

const slash = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '')

async function configDir($: EngineInterface): Promise<string> {
  const own = await $.env.get('CLAUDE_CONFIG_DIR')
  if (own) return slash(own)
  return `${slash((await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '')}/.claude`
}

/** How a large file is read from a byte offset: curl's file:// ranges on Windows (shipped since 2018), tail elsewhere. */
async function reader($: EngineInterface): Promise<Reader> {
  const root = (await $.env.get('SystemRoot')) ?? (await $.env.get('SYSTEMROOT'))
  if (root) {
    const curl = `${slash(root)}/System32/curl.exe`
    if (!(await $.fs.exists(curl).catch(() => false))) return null
    const url = (p: string) => `file:///${slash(p).split('/').map((s, i) => (i === 0 && /^[A-Za-z]:$/.test(s) ? s : encodeURIComponent(s))).join('/')}`
    return { argv: (p, offset) => [curl, '-s', '-f', '-r', `${offset}-`, url(p)] }
  }
  return { argv: (p, offset) => ['tail', '-c', `+${offset + 1}`, p] }
}

async function listFiles($: EngineInterface, projects: string, from: number): Promise<FileRef[]> {
  const out: FileRef[] = []
  for (const dir of await $.fs.list(projects).catch(() => [])) {
    if (dir.kind !== 'dir') continue
    const base = `${projects}/${dir.name}`
    const items = await $.fs.list(base).catch(() => [])
    const mains = new Map(items.filter(f => f.kind === 'file' && f.name.endsWith('.jsonl')).map(f => [f.name.slice(0, -6), f]))
    for (const [session, f] of mains) if (f.mtimeMs >= from) out.push({ path: `${base}/${f.name}`, kind: 'main', session, size: f.size, mtime: f.mtimeMs })
    for (const d of items) {
      if (d.kind !== 'dir') continue
      const main = mains.get(d.name)
      if (main && main.mtimeMs < from - DAY) continue // its subagents reported back before the main log's last write
      for (const f of await $.fs.list(`${base}/${d.name}/subagents`).catch(() => [])) {
        if (f.kind === 'file' && f.name.endsWith('.jsonl') && f.mtimeMs >= from)
          out.push({ path: `${base}/${d.name}/subagents/${f.name}`, kind: 'sub', session: d.name, size: f.size, mtime: f.mtimeMs })
      }
    }
  }
  return out
}

async function agentType($: EngineInterface, path: string): Promise<string> {
  try {
    const meta = JSON.parse(await $.fs.read(`${path.slice(0, -6)}.meta.json`)) as { agentType?: unknown }
    return typeof meta.agentType === 'string' ? meta.agentType : ''
  } catch {
    return ''
  }
}

/** Streams a file from `offset` into the feeder; false when it could not be read. */
async function stream($: EngineInterface, argv: string[], feed: (text: string) => void): Promise<boolean> {
  try {
    const s = $.process.spawn({ argv })
    for await (const c of s) if (c.stream === 'stdout') feed(c.text)
    const r = await s.result
    return r.code === 0
  } catch {
    return false
  }
}

/** Reads one file, or only what was appended since `old` when that still fits. undefined: it could not be read. */
async function readFile($: EngineInterface, f: FileRef, old: Entry | undefined, cut: number, rd: Reader): Promise<Entry | undefined> {
  const type = f.kind === 'sub' ? (old?.agentType ?? (await agentType($, f.path))) : undefined
  const meta = { kind: f.kind, session: f.session, size: f.size, mtime: f.mtime, ...(type !== undefined ? { agentType: type } : {}) }
  if (f.size <= READ_LIMIT) {
    const e = newEntry(meta, cut)
    const text = await $.fs.read(f.path).catch(() => undefined)
    if (typeof text !== 'string') return undefined
    const feeder = new LineFeeder(e, new Set())
    feeder.push(text)
    feeder.end()
    return e
  }
  if (!rd) return undefined
  // Logs only grow: carry on from the last whole line if the byte before it is still a newline.
  if (old?.tail && old.offset > 0 && f.size > old.offset && fitsWindow(old, cut)) {
    const e: Entry = { ...structuredClone(old), size: f.size, mtime: f.mtime }
    const seen = new Set(old.tail)
    const feeder = new LineFeeder(e, seen)
    let first = true
    let isAligned = true
    e.offset -= 1
    const ok = await stream($, rd.argv(f.path, old.offset - 1), text => {
      if (first) {
        first = false
        isAligned = text.startsWith('\n')
      }
      if (isAligned) feeder.push(text)
    })
    if (ok && isAligned) {
      feeder.end()
      e.tail = [...seen].slice(-50)
      return e
    }
  }
  const e = newEntry(meta, cut)
  const seen = new Set<string>()
  const feeder = new LineFeeder(e, seen)
  if (!(await stream($, rd.argv(f.path, 0), text => feeder.push(text)))) return undefined
  feeder.end()
  e.tail = [...seen].slice(-50)
  return e
}

/**
 * Where before/after splits: the later of ystack's install and the first ystack-setup Apply, since the settings
 * that save the most only take effect then. Apply leaves `settings.json.bak-ystack-<date>` beside settings.json.
 */
async function splitTime($: EngineInterface, cfg: string): Promise<{ at: number; source: InstallSource } | undefined> {
  const install = await installTime($, cfg)
  const applies = (await $.fs.list(cfg).catch(() => []))
    .filter(f => f.kind === 'file' && f.name.startsWith('settings.json.bak-ystack-'))
    .map(f => (f.mtimeMs > 0 ? f.mtimeMs : Date.parse(f.name.slice('settings.json.bak-ystack-'.length, 'settings.json.bak-ystack-'.length + 10))))
    .filter(Number.isFinite)
  const apply = applies.length > 0 ? Math.min(...applies) : undefined
  if (apply !== undefined && (install === undefined || apply > install.at)) return { at: apply, source: 'setup' }
  return install
}

/** ystack's install time: the earliest install of any mod from the ystack marketplace, else this mod's first load. */
async function installTime($: EngineInterface, cfg: string): Promise<{ at: number; source: InstallSource } | undefined> {
  try {
    const all = JSON.parse(await $.fs.read(`${cfg}/plugins/installed_plugins.json`)) as { plugins?: Record<string, { installedAt?: string }[]> }
    const times = Object.entries(all.plugins ?? {})
      .filter(([id]) => id.endsWith('@ystack'))
      .flatMap(([, list]) => (Array.isArray(list) ? list : []).map(x => Date.parse(String(x?.installedAt))))
      .filter(Number.isFinite)
    if (times.length > 0) return { at: Math.min(...times), source: 'installed' }
  } catch {
    // no record of installs: fall back to the first load
  }
  const first = await $.store.get('firstLoad')
  return typeof first === 'number' ? { at: first, source: 'first-load' } : undefined
}

async function setProgress($: EngineInterface, p: Partial<Progress>) {
  await update($, progress, old => ({ ...old, ...p }))
}

async function saveCache($: EngineInterface, cache: Record<string, Entry>) {
  let list = Object.entries(cache)
  let text = JSON.stringify(Object.fromEntries(list))
  if (text.length > CACHE_LIMIT) {
    list = list.sort((a, b) => b[1].mtime - a[1].mtime) // keep the newest; older ones are read again next time
    while (list.length > 0 && text.length > CACHE_LIMIT) {
      list = list.slice(0, Math.floor(list.length * 0.9))
      text = JSON.stringify(Object.fromEntries(list))
    }
  }
  await $.store.set(CACHE_KEY, Object.fromEntries(list)).catch(() => undefined)
}

/** Counts the logs, reading only files that changed since the last count, and publishes the report. */
export async function count($: EngineInterface): Promise<Report | undefined> {
  if (running) return undefined
  running = true
  try {
    const now = await $.clock.now()
    const cut = Math.floor((now - DAYS * DAY) / HOUR) * HOUR // a whole hour, so the cache holds for an hour
    const cfg = await configDir($)
    const install = await splitTime($, cfg)
    const from = Math.min(cut, install ? install.at - DAYS * DAY : cut)
    await setProgress($, { phase: 'counting', done: 0, total: 0, read: 0, skipped: 0, note: 'finding your logs' })
    const files = await listFiles($, `${cfg}/projects`, from)
    const stored = await $.store.get(CACHE_KEY)
    const old: Record<string, Entry> = stored && typeof stored === 'object' ? (stored as Record<string, Entry>) : {}
    const cache: Record<string, Entry> = {}
    const rd = await reader($)
    let readCount = 0
    let skipped = 0
    let sinceSave = 0
    await setProgress($, { total: files.length, note: '' })
    for (const [i, f] of files.entries()) {
      const prev = old[f.path]
      if (prev?.v === 1 && prev.size === f.size && prev.mtime === f.mtime && fitsWindow(prev, cut)) {
        cache[f.path] = prev
      } else {
        if (f.size > 20 * 1024 * 1024) await setProgress($, { done: i, note: `reading a ${Math.round(f.size / 1048576)} MB log` })
        const e = await readFile($, f, prev, cut, rd)
        if (e) {
          cache[f.path] = e
          readCount++
          sinceSave += f.size
        } else skipped++
      }
      if (i % 25 === 0 || sinceSave > 200 * 1048576) {
        await setProgress($, { done: i + 1, read: readCount, skipped, note: '' })
        if (sinceSave > 200 * 1048576) {
          await saveCache($, { ...old, ...cache }) // an interrupted first count keeps what it read
          sinceSave = 0
        }
      }
    }
    await saveCache($, cache)
    const r = buildReport(Object.values(cache), { days: DAYS, now, ...(install ? { install } : {}) })
    await update($, report, () => r)
    await $.store.set('report', r).catch(() => undefined)
    await setProgress($, { phase: 'done', done: files.length, read: readCount, skipped, note: '' })
    return r
  } catch (err) {
    await setProgress($, { phase: 'error', note: String((err as Error)?.message ?? err).slice(0, 200) })
    return undefined
  } finally {
    running = false
  }
}

function startCount($: EngineInterface) {
  $.clock.after(0, () => count($)) // runs after the command returns, outside its time budget
}

export const register: Register = (on, options) => {
  const d = Number(options.days)
  if (Number.isFinite(d) && d >= 1) DAYS = Math.min(90, Math.floor(d))

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'ystack-stats', description: "What ystack saves you, from your own logs (add 'share' for a paste-ready summary)" })
    if ((await $.store.get('firstLoad')) === undefined) await $.store.set('firstLoad', await $.clock.now())
    const last = await $.store.get('report')
    if (last && typeof last === 'object' && (await read($, report)) === null) await update($, report, () => last as Report)
    return next(e)
  })

  on('command.run', { command: 'ystack-stats' }, async ($, e) => {
    const r = await read($, report)
    if (e.args.trim().toLowerCase() === 'share') {
      const now = await $.clock.now()
      if (r && r.days === DAYS && now - r.at < HOUR) return { text: shareText(r) }
      startCount($)
      await $.ui.open({ id: PANE, title: 'ystack stats' })
      return { text: 'Counting your logs now. Run /ystack-stats share again when the pane says done.' }
    }
    startCount($)
    await $.ui.open({ id: PANE, title: 'ystack stats' })
    return { text: 'ystack stats opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const p = await read($, progress)
    const r = await read($, report)
    const status =
      p.phase === 'counting'
        ? `Counting your logs: ${p.done} of ${p.total || '?'} files${p.note ? `, ${p.note}` : ''}. Files already counted are not read again.`
        : p.phase === 'error'
          ? `The count stopped: ${p.note}`
          : p.phase === 'done'
            ? `Done: ${p.total} log files, ${p.read} read now, the rest from the last count.${p.skipped ? ` ${p.skipped} could not be read.` : ''}`
            : ''
    return (
      <Box flexDirection="column">
        {status !== '' && <Text dimColor={p.phase !== 'error'}>{status}</Text>}
        {!r && p.phase !== 'counting' && <Text>No count yet. Press the button or run /ystack-stats.</Text>}
        {r &&
          reportLines(r).map(l =>
            l.heading ? (
              <Box flexDirection="column">
                <Text bold>{l.heading}</Text>
                {l.text !== '' && <Text>{l.text}</Text>}
              </Box>
            ) : (
              <Text dimColor={l.dim === true}>{l.text}</Text>
            ),
          )}
        {p.phase !== 'counting' && <Button key="recount" label="Count again" onPress={() => startCount($)} />}
      </Box>
    )
  })
}
