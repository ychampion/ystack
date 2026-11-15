import type { EngineInterface, Register } from 'claude-code'

import {
  LOCK_FOR,
  MAC_SCRIPT,
  batches,
  cutoffOf,
  eligible,
  parseArgs,
  parseCompact,
  readSaved,
  resultLine,
  shouldAutoRun,
  shouldSuggest,
  statusText,
  suggestionNote,
  sumDuBytes,
  sumSize,
} from './core'
import type { Platform, RunResult, Saved, Transcript } from './core'

const TOOL = 'mcp__transcript-compress__compress'
const BATCH_MS = 600_000

let auto = false
let minAgeDays = 7
let suggestAtMB = 500

let platform: Platform | undefined
let running = false
/** A note waiting for the person's next prompt, so Claude can suggest a run at a good moment. */
let pendingNote: string | undefined

async function getSaved($: EngineInterface): Promise<Saved> {
  return readSaved(await $.store.get('state').catch(() => undefined))
}
async function putSaved($: EngineInterface, s: Saved): Promise<void> {
  await $.store.set('state', s)
}

async function platformOf($: EngineInterface): Promise<Platform> {
  if (platform) return platform
  if ((await $.env.get('OS')) === 'Windows_NT') return (platform = 'windows')
  const r = await $.process.run(['uname', '-s']).catch(() => undefined)
  return (platform = r?.stdout.trim() === 'Darwin' ? 'mac' : 'linux')
}

async function projectsDir($: EngineInterface): Promise<string> {
  const config = await $.env.get('CLAUDE_CONFIG_DIR')
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? ''
  return `${(config || `${home}/.claude`).replace(/\\/g, '/').replace(/\/+$/, '')}/projects`
}

/** Every *.jsonl under the projects folder: sessions at depth 1, their subagents a level or two below. */
async function walk($: EngineInterface, dir: string, depth = 0, out: Transcript[] = []): Promise<Transcript[]> {
  const entries = await $.fs.list(dir).catch(() => [])
  for (const e of entries) {
    const path = `${dir}/${e.name}`
    if (e.kind === 'dir' && depth < 4) await walk($, path, depth + 1, out)
    else if (e.kind === 'file' && e.name.endsWith('.jsonl')) out.push({ path, size: e.size, mtimeMs: e.mtimeMs })
  }
  return out
}

async function waiting($: EngineInterface, saved: Saved, now: number): Promise<Transcript[]> {
  const all = await walk($, await projectsDir($))
  return eligible(all, { now, minAgeDays, watermarkMs: saved.watermarkMs, sessionId: await $.session.id() })
}

const native = (p: Platform, path: string) => (p === 'windows' ? path.replace(/\//g, '\\') : path)

/** Compresses one batch in place; returns how many were newly compressed, how many failed, and bytes freed. */
async function squeeze($: EngineInterface, p: Platform, files: string[]): Promise<{ files: number; failed: number; saved: number | undefined }> {
  const paths = files.map(f => native(p, f))
  if (p === 'windows') {
    const r = await $.process.run(['compact.exe', '/c', '/exe:lzx', '/q', '/i', ...paths], { timeoutMs: BATCH_MS })
    const sum = parseCompact(r.stdout)
    if (!sum) return { files: 0, failed: r.exitCode === 0 ? 0 : paths.length, saved: undefined }
    return { files: sum.files, failed: 0, saved: Math.max(0, sum.before - sum.after) }
  }
  const before = sumDuBytes((await $.process.run(['du', '-k', ...paths], { timeoutMs: BATCH_MS })).stdout)
  const r =
    p === 'mac'
      ? await $.process.run(['/bin/sh', '-c', MAC_SCRIPT, 'sh', ...paths], { timeoutMs: BATCH_MS })
      : await $.process.run(['gzip', '--', ...paths], { timeoutMs: BATCH_MS })
  const failed = p === 'mac' ? (r.stderr.match(/^failed: /gm) ?? []).length : r.exitCode === 0 ? 0 : r.stderr.split('\n').filter(l => l.trim()).length
  const done = p === 'mac' ? paths : paths.map(f => `${f}.gz`)
  const after = sumDuBytes((await $.process.run(['du', '-k', ...done], { timeoutMs: BATCH_MS })).stdout)
  return { files: Math.max(0, paths.length - failed), failed, saved: Math.max(0, before - after) }
}

/** One whole run. Holds a lock in the store so two sessions never squeeze the same files at once. */
async function run($: EngineInterface): Promise<RunResult | string> {
  if (running) return 'transcript-compress: a run is already going in this session.'
  const now = await $.clock.now()
  const saved = await getSaved($)
  if (saved.lockUntil > now) return 'transcript-compress: another session is compressing right now; try again in a few minutes.'
  running = true
  try {
    await putSaved($, { ...saved, lockUntil: now + LOCK_FOR })
    const p = await platformOf($)
    const todo = await waiting($, saved, now)
    const result: RunResult = { checked: todo.length, files: 0, failed: 0, savedBytes: 0, scannedBytes: sumSize(todo), platform: p }
    for (const group of batches(todo.map(t => t.path))) {
      const one = await squeeze($, p, group).catch(() => ({ files: 0, failed: group.length, saved: undefined }))
      result.files += one.files
      result.failed += one.failed
      result.savedBytes = one.saved === undefined || result.savedBytes === undefined ? undefined : result.savedBytes + one.saved
      await putSaved($, { ...(await getSaved($)), lockUntil: (await $.clock.now()) + LOCK_FOR })
    }
    const after = await getSaved($)
    await putSaved($, {
      ...after,
      watermarkMs: Math.max(after.watermarkMs, cutoffOf(now, minAgeDays)),
      lastRunAt: await $.clock.now(),
      files: after.files + result.files,
      savedBytes: after.savedBytes + (result.savedBytes ?? 0),
      lockUntil: 0,
    })
    pendingNote = undefined
    return result
  } catch (err) {
    await putSaved($, { ...(await getSaved($)), lockUntil: 0 }).catch(() => undefined)
    return `transcript-compress: the run stopped: ${String((err as Error)?.message ?? err).slice(0, 200)}`
  } finally {
    running = false
  }
}

const say = (r: RunResult | string) => (typeof r === 'string' ? r : resultLine(r))

/** Linux only: un-gzips one session's transcripts so /resume finds them again. */
async function restore($: EngineInterface, id: string): Promise<string> {
  if ((await platformOf($)) !== 'linux') return 'transcript-compress: nothing to restore here; on this system compressed transcripts stay readable as they are.'
  const found: string[] = []
  const look = async (dir: string, depth: number): Promise<void> => {
    for (const e of await $.fs.list(dir).catch(() => [])) {
      const path = `${dir}/${e.name}`
      if (e.kind === 'dir' && depth < 4) await look(path, depth + 1)
      else if (e.kind === 'file' && e.name.endsWith('.jsonl.gz') && (e.name === `${id}.jsonl.gz` || path.includes(`/${id}/`))) found.push(path)
    }
  }
  await look(await projectsDir($), 0)
  if (found.length === 0) return `transcript-compress: no compressed transcript for session ${id}.`
  const r = await $.process.run(['gzip', '-d', '--', ...found], { timeoutMs: BATCH_MS })
  return r.exitCode === 0 ? `transcript-compress: restored ${found.length} file(s) for session ${id}; claude --resume ${id} works again.` : `transcript-compress: gzip could not restore every file: ${r.stderr.trim().slice(0, 300)}`
}

export const register: Register = (on, options) => {
  auto = options.autoCompress === true
  if (typeof options.minAgeDays === 'number' && options.minAgeDays >= 1) minAgeDays = Math.floor(options.minAgeDays)
  if (typeof options.suggestAtMB === 'number' && options.suggestAtMB >= 0) suggestAtMB = options.suggestAtMB

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: 'compress-transcripts',
      description: 'Compress old Claude transcripts to free disk space (lossless). status | restore <session-id>',
      argumentHint: '[status | restore <session-id>]',
    })
    await $.tool.register({
      name: 'compress',
      description:
        'Compress Claude transcripts older than the set age, in place and lossless, to free disk space. Only call this after the person said yes to it. ' +
        'Takes a minute or two on a large history; returns how many files were compressed and how much space was freed.',
      inputSchema: { type: 'object', properties: {} },
    })
    // Look a little after start so the session opens at full speed.
    $.clock.after(8_000, () => {
      void (async () => {
        const now = await $.clock.now()
        const saved = await getSaved($)
        const todo = await waiting($, saved, now)
        if (shouldAutoRun({ auto, waitingCount: todo.length, now, lastRunAt: saved.lastRunAt, lockUntil: saved.lockUntil })) {
          const r = await run($)
          if (typeof r === 'string' || r.files > 0 || r.failed > 0) $.ui.toast(say(r), { timeoutMs: 8_000 })
          return
        }
        const bytes = sumSize(todo)
        if (shouldSuggest({ auto, suggestAtMB, waitingBytes: bytes, now, lastSuggestedAt: saved.lastSuggestedAt })) {
          pendingNote = suggestionNote({ count: todo.length, bytes, platform: await platformOf($), minAgeDays })
        }
      })().catch(() => undefined)
    })
    return started
  })

  // Hand the suggestion to Claude with the person's next prompt; Claude picks the moment to raise it.
  on('prompt.submit', async ($, e, next) => {
    const isPerson = e.origin.kind === 'composer' || e.origin.kind === 'bridge'
    if (!pendingNote || !isPerson || e.command !== undefined || e.isMeta) return next(e)
    const note = pendingNote
    pendingNote = undefined
    await putSaved($, { ...(await getSaved($)), lastSuggestedAt: await $.clock.now() }).catch(() => undefined)
    return next({ ...e, context: [...(e.context ?? []), note] })
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: TOOL }, async $ => ({ result: say(await run($)) })).catch(() => ({ result: 'transcript-compress: the run failed before it started; nothing was changed.' }))

  on('command.run', { command: 'compress-transcripts' }, async ($, e) => {
    const want = parseArgs(e.args)
    if (want.kind === 'help') return { text: 'Usage: /compress-transcripts [status | restore <session-id>]' }
    if (want.kind === 'restore') return { text: await restore($, want.id) }
    if (want.kind === 'status') {
      const now = await $.clock.now()
      const saved = await getSaved($)
      const todo = await waiting($, saved, now)
      return { text: statusText({ saved, waitingCount: todo.length, waitingBytes: sumSize(todo), platform: await platformOf($), auto, minAgeDays, now, running }) }
    }
    if (running) return { text: 'transcript-compress: a run is already going.' }
    // Run in the background so the prompt stays free; the result comes back as a toast and a log line.
    $.clock.after(0, () => {
      void run($).then(r => {
        $.ui.toast(say(r), { timeoutMs: 10_000 })
        $.ui.log(say(r))
      })
    })
    return { text: `transcript-compress: compressing transcripts older than ${minAgeDays} days in the background; you will see the result here when it is done.` }
  })
}
