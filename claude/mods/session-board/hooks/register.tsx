import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Board, BoardRow } from '../types'
import { completeRows, dayKey, dayStart, emptyScan, folderName, idle, isHandoffDue, oneLine, pruneDays, scanRows, sortRows, tokens, totals } from './parse.ts'
import type { Scan } from './parse.ts'

const PANE = 'session-board'
const board = atom({ plugin: 'session-board', key: 'board' } as const, { rows: [], at: 0, note: '' } as Board, { shape: 'board-2' })

let HOURS = 24
let HANDOFF_AT = 250_000

// A transcript under 4 MiB is read whole on first sight ($.fs.read, no process). A bigger one is read from the end
// in byte ranges, back to the start of today. After that only the bytes a file gained are read, every grown file's
// in one helper process per refresh.
const READ_WHOLE = 4_000_000 // $.fs.read refuses files over 4 MiB
const CHUNK = 3_000_000 // base64 of this stays under the 4 MiB a process's output may carry
const MAX_BACK = 6 // chunks read backwards on first sight, to reach back to the start of today
const MAX_ENV = 30_000 // the request list travels in one environment variable; Windows caps one at 32767
const SUBAGENT_WINDOW = 60 * 60_000
const HANDOFF_MIN = 100_000 // below this context a hand-off is not worth asking for
const FRESH_MS = 2 * 60_000 // with no process check, a registry entry updated this recently counts as running

type FileState = {
  size: number
  mtimeMs: number
  offset: number
  aligned: boolean
  scan: Scan
  /** The tail read never reached back past the start of today. */
  isMissingStart: boolean
  /** The last read failed, or the file grew by more than one chunk and the rest waits for the next refresh. */
  isBehind: boolean
}
const files = new Map<string, FileState>()
let timer: Timer | undefined
let running: Promise<void> | undefined

let cfgDir = ''
async function configDir($: EngineInterface): Promise<string> {
  if (cfgDir) return cfgDir
  const own = await $.env.get('CLAUDE_CONFIG_DIR')
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? ''
  cfgDir = (own && own.trim() ? own.trim() : `${home}/.claude`).replace(/\\/g, '/').replace(/\/+$/, '')
  return cfgDir
}

/** A drive path or a UNC share (either slash). */
const isWindowsPath = (p: string) => /^[A-Za-z]:[\\/]/.test(p) || /^(?:\\\\|\/\/)[^\\/]/.test(p)

// The helpers: PowerShell on Windows, sh elsewhere. Paths and ranges travel as environment variables, never in the
// script text (which also carries no double quotes: it is one argument on the Windows command line).
// SB_REQS: one request per line, path<TAB>from<TAB>len; one line of base64 back per request, or "-" when unreadable.
const PS_READ =
  '$ErrorActionPreference=\'Stop\'; foreach ($q in ($env:SB_REQS -split [char]10)) { if (-not $q) { continue }; $a=$q -split [char]9; ' +
  "try { $f=[IO.File]::Open($a[0],'Open','Read','ReadWrite, Delete'); try { [void]$f.Seek([int64]$a[1],0); $b=New-Object byte[] ([int]$a[2]); $t=0; " +
  'while ($t -lt $b.Length) { $r=$f.Read($b,$t,$b.Length-$t); if ($r -le 0) { break }; $t+=$r }; ' +
  "[Console]::Out.WriteLine([Convert]::ToBase64String($b,0,$t)) } finally { $f.Close() } } catch { [Console]::Out.WriteLine('-') } }"
const SH_READ =
  'printf \'%s\\n\' "$SB_REQS" | while IFS="$(printf \'\\t\')" read -r p from len; do [ -n "$p" ] || continue; ' +
  'if [ -r "$p" ]; then tail -c +"$((from+1))" "$p" | head -c "$len" | base64 | tr -d \'\\n\'; echo; else echo -; fi; done'
// SB_PIDS: process ids, space separated; back one line per live one, "pid start" (start 0 when not known).
const PS_ALIVE =
  "$ErrorActionPreference='SilentlyContinue'; foreach ($i in ($env:SB_PIDS -split ' ')) { if (-not $i) { continue }; " +
  "$p=Get-Process -Id ([int]$i); if ($p) { $t=$p.StartTime; $s=0; if ($t) { $s=$t.ToFileTimeUtc() }; [Console]::Out.WriteLine([string]$p.Id + ' ' + [string]$s) } }; exit 0"
const SH_ALIVE = 'for p in $SB_PIDS; do kill -0 "$p" 2>/dev/null && echo "$p 0"; done; exit 0'

function decode(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

type Req = { path: string; from: number; len: number }
/** Reads byte ranges, as few helper processes as fit: at most one chunk of bytes per process. */
async function readRanges($: EngineInterface, reqs: Req[]): Promise<(Uint8Array | undefined)[]> {
  const out: (Uint8Array | undefined)[] = reqs.map(() => undefined)
  let i = 0
  while (i < reqs.length) {
    const group: number[] = []
    let bytes = 0
    let env = ''
    for (; i < reqs.length; i++) {
      const q = reqs[i] as Req
      const line = `${q.path}\t${q.from}\t${q.len}`
      if (group.length > 0 && (bytes + q.len > CHUNK || env.length + line.length + 1 > MAX_ENV)) break
      group.push(i)
      bytes += q.len
      env = env ? `${env}\n${line}` : line
    }
    const first = reqs[group[0] ?? 0] as Req
    const argv = isWindowsPath(first.path) ? ['powershell', '-NoProfile', '-NonInteractive', '-Command', PS_READ] : ['sh', '-c', SH_READ]
    const r = await $.process.run(argv, { env: { SB_REQS: env }, timeoutMs: 60_000 }).catch(() => undefined)
    if (!r || r.exitCode !== 0) continue
    const lines = r.stdout.split('\n').map(l => l.trim())
    group.forEach((k, j) => {
      const l = lines[j]
      if (l !== undefined && l !== '-') {
        try {
          out[k] = decode(l)
        } catch {
          // not base64: leave it unread
        }
      }
    })
  }
  return out
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length)
  out.set(a, 0)
  out.set(b, a.length)
  return out
}

type Job = { path: string; size: number; mtimeMs: number; isMain: boolean }

/** First sight of a file under 4 MiB: the whole of it, through $.fs.read. */
async function readWhole($: EngineInterface, job: Job): Promise<void> {
  const text = await $.fs.read(job.path).catch(() => undefined)
  if (typeof text !== 'string') return
  const bytes = new TextEncoder().encode(text)
  const rows = completeRows(bytes, true)
  const done = rows.used >= job.size
  files.set(job.path, {
    size: done ? job.size : rows.used,
    mtimeMs: done ? job.mtimeMs : 0,
    offset: rows.used,
    aligned: true,
    scan: scanRows(emptyScan(), rows.text, job.isMain),
    isMissingStart: false,
    isBehind: false,
  })
}

/** First sight of a big file: read back from the end until a row from before today shows up. */
async function readBack($: EngineInterface, job: Job, now: number): Promise<void> {
  const today = dayStart(now)
  const scan = emptyScan()
  let end = job.size
  let carry: Uint8Array = new Uint8Array(0)
  let offset = -1
  let aligned = true
  let n = 0
  while (n < MAX_BACK && end > 0) {
    const from = Math.max(0, end - CHUNK)
    const [bytes] = await readRanges($, [{ path: job.path, from, len: end - from }])
    if (!bytes) break
    const joined = concat(bytes, carry)
    const rows = completeRows(joined, from === 0)
    if (offset < 0) {
      offset = rows.used > 0 ? from + rows.used : from + bytes.length
      aligned = rows.used > 0
    }
    scanRows(scan, rows.text, job.isMain)
    carry = joined.subarray(0, rows.skipped)
    end = from
    n++
    if (scan.firstAt > 0 && scan.firstAt < today) break
  }
  if (offset < 0) return
  const done = offset >= job.size
  files.set(job.path, {
    size: done ? job.size : offset,
    mtimeMs: done ? job.mtimeMs : 0,
    offset,
    aligned,
    scan,
    isMissingStart: end > 0 && !(scan.firstAt > 0 && scan.firstAt < today),
    isBehind: false,
  })
}

/** Brings every listed transcript's scan up to date. Unchanged size and mtime: nothing is read. */
async function updateFiles($: EngineInterface, jobs: Job[], now: number): Promise<void> {
  const whole: Job[] = []
  const back: Job[] = []
  const grown: { job: Job; st: FileState; len: number }[] = []
  for (const job of jobs) {
    const old = files.get(job.path)
    if (old && old.size === job.size && old.mtimeMs === job.mtimeMs) continue
    if (!old || job.size < old.offset) (job.size <= READ_WHOLE ? whole : back).push(job)
    else if (job.size === old.offset) {
      old.size = job.size
      old.mtimeMs = job.mtimeMs
    } else grown.push({ job, st: old, len: Math.min(CHUNK, job.size - old.offset) })
  }
  for (let i = 0; i < whole.length; i += 8) await Promise.all(whole.slice(i, i + 8).map(job => readWhole($, job)))
  for (const job of back) await readBack($, job, now)
  grown.sort((a, b) => a.job.path.localeCompare(b.job.path))
  const got = await readRanges(
    $,
    grown.map(g => ({ path: g.job.path, from: g.st.offset, len: g.len })),
  )
  grown.forEach(({ job, st, len }, k) => {
    const bytes = got[k]
    if (!bytes) {
      st.isBehind = true // size and mtime stay as they were, so the next refresh tries again
      return
    }
    const rows = completeRows(bytes, st.aligned)
    scanRows(st.scan, rows.text, job.isMain)
    if (rows.used > 0) {
      st.offset += rows.used
      st.aligned = true
    } else if (bytes.length === CHUNK) {
      st.offset += bytes.length // one row longer than a chunk: skip past it
      st.aligned = false
    }
    const done = st.offset >= job.size
    st.size = done ? job.size : st.offset
    st.mtimeMs = done ? job.mtimeMs : 0
    st.isBehind = !done && len === CHUNK
    pruneDays(st.scan, now)
  })
  // Only what this refresh listed stays cached.
  const listed = new Set(jobs.map(j => j.path))
  for (const p of [...files.keys()]) if (!listed.has(p)) files.delete(p)
}

type Registered = { status: string; cwd: string; pid: number; procStart: string; updatedAt: number }
async function registry($: EngineInterface, cfg: string): Promise<Map<string, Registered>> {
  const out = new Map<string, Registered>()
  for (const f of await $.fs.list(`${cfg}/sessions`).catch(() => [])) {
    if (f.kind !== 'file' || !f.name.endsWith('.json')) continue
    const text = await $.fs.read(`${cfg}/sessions/${f.name}`).catch(() => undefined)
    try {
      const s = JSON.parse(String(text)) as { sessionId?: string; cwd?: string; status?: string; pid?: number; procStart?: string; updatedAt?: number }
      if (typeof s.sessionId !== 'string') continue
      out.set(s.sessionId, {
        status: String(s.status ?? ''),
        cwd: String(s.cwd ?? ''),
        pid: typeof s.pid === 'number' ? s.pid : Number.NaN,
        procStart: typeof s.procStart === 'string' ? s.procStart : '',
        updatedAt: typeof s.updatedAt === 'number' ? s.updatedAt : f.mtimeMs,
      })
    } catch {
      // a half-written entry: skip it this time
    }
  }
  return out
}

/** Live process ids and their start times ('0' when not known), or undefined when they could not be checked. */
async function liveProcesses($: EngineInterface, cfg: string, reg: Map<string, Registered>): Promise<Map<number, string> | undefined> {
  const pids = [...new Set([...reg.values()].map(r => r.pid).filter(p => Number.isInteger(p) && p > 0))]
  if (pids.length === 0) return new Map()
  const argv = isWindowsPath(cfg) ? ['powershell', '-NoProfile', '-NonInteractive', '-Command', PS_ALIVE] : ['sh', '-c', SH_ALIVE]
  const r = await $.process.run(argv, { env: { SB_PIDS: pids.join(' ') }, timeoutMs: 15_000 }).catch(() => undefined)
  if (!r || r.exitCode !== 0) return undefined
  const out = new Map<number, string>()
  for (const l of r.stdout.split('\n')) {
    const [pid = '', start = '0'] = l.trim().split(' ')
    if (/^\d+$/.test(pid)) out.set(Number(pid), start)
  }
  return out
}

/** Whether a registry entry's session is running: its process is alive (and started when the entry says), else a recent update. */
function isLive(r: Registered, live: Map<number, string> | undefined, now: number): boolean {
  if (!live || !Number.isInteger(r.pid)) return now - r.updatedAt < FRESH_MS
  const start = live.get(r.pid)
  if (start === undefined) return false
  // A reused process id: the live process started at another time than the session's did.
  return start === '0' || !/^\d+$/.test(r.procStart) || r.procStart === '0' || start === r.procStart
}

type Found = { id: string; dir: string; path: string; size: number; mtimeMs: number }
async function transcripts($: EngineInterface, cfg: string, cutoff: number): Promise<Found[]> {
  const out: Found[] = []
  const base = `${cfg}/projects`
  for (const d of await $.fs.list(base).catch(() => [])) {
    if (d.kind !== 'dir') continue
    for (const f of await $.fs.list(`${base}/${d.name}`).catch(() => [])) {
      if (f.kind !== 'file' || !f.name.endsWith('.jsonl') || f.mtimeMs < cutoff) continue
      out.push({ id: f.name.slice(0, -'.jsonl'.length), dir: `${base}/${d.name}`, path: `${base}/${d.name}/${f.name}`, size: f.size, mtimeMs: f.mtimeMs })
    }
  }
  return out
}

/** A session's subagent transcripts: how many ran in the last hour, and the ones written today (for their usage). */
async function subagentFiles($: EngineInterface, t: Found, now: number): Promise<{ count: number; jobs: Job[] }> {
  const dir = `${t.dir}/${t.id}/subagents`
  const today = dayStart(now)
  let count = 0
  const jobs: Job[] = []
  for (const f of await $.fs.list(dir).catch(() => [])) {
    if (f.kind !== 'file' || !f.name.endsWith('.jsonl')) continue
    if (f.mtimeMs >= now - SUBAGENT_WINDOW) count++
    if (f.mtimeMs >= today) jobs.push({ path: `${dir}/${f.name}`, size: f.size, mtimeMs: f.mtimeMs, isMain: false })
  }
  return { count, jobs }
}

async function refreshNow($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  const cutoff = now - HOURS * 3_600_000
  const cfg = await configDir($)
  const reg = await registry($, cfg)
  const live = await liveProcesses($, cfg, reg)
  const found = await transcripts($, cfg, cutoff)
  const subs = await Promise.all(found.map(t => subagentFiles($, t, now)))
  const jobs: Job[] = [...found.map(t => ({ path: t.path, size: t.size, mtimeMs: t.mtimeMs, isMain: true })), ...subs.flatMap(s => s.jobs)]
  await updateFiles($, jobs, now)
  const day = dayKey(now)
  const rows: BoardRow[] = found.map((t, i) => {
    const st = files.get(t.path)
    const scan = st?.scan ?? emptyScan()
    const r = reg.get(t.id)
    const isRunning = r !== undefined && isLive(r, live, now)
    const own = subs[i]?.jobs ?? []
    const isPartial = [t.path, ...own.map(j => j.path)].some(p => {
      const s = files.get(p)
      return !s || s.isMissingStart || s.isBehind
    })
    return {
      sessionId: t.id,
      folder: folderName(r?.cwd || scan.cwd || t.dir),
      isRunning,
      isLeftOver: r !== undefined && !isRunning,
      status: isRunning ? (r?.status ?? '') : '',
      context: scan.context,
      usageToday: (scan.byDay[day] ?? 0) + own.reduce((s, j) => s + (files.get(j.path)?.scan.byDay[day] ?? 0), 0),
      isPartial,
      lastActiveAt: Math.max(t.mtimeMs, scan.lastAt),
      subagents: subs[i]?.count ?? 0,
      lastText: scan.lastText,
    }
  })
  // A registry entry with no transcript yet: shown while it runs, and as left over until it ages past the window.
  for (const [id, r] of reg) {
    if (rows.some(row => row.sessionId === id)) continue
    const isRunning = isLive(r, live, now)
    if (!isRunning && r.updatedAt < cutoff) continue
    rows.push({ sessionId: id, folder: folderName(r.cwd), isRunning, isLeftOver: !isRunning, status: isRunning ? r.status : '', context: 0, usageToday: 0, isPartial: false, lastActiveAt: 0, subagents: 0, lastText: '' })
  }
  const note = rows.length === 0 ? `No sessions in the last ${HOURS} hours under ${cfg}.` : ''
  await update($, board, () => ({ rows: sortRows(rows), at: now, note }))
}

/** One refresh at a time; a second caller waits for the one under way. */
async function refresh($: EngineInterface): Promise<void> {
  if (!running) running = refreshNow($).finally(() => (running = undefined))
  return running
}

function tick($: EngineInterface) {
  void refresh($)
}

// context-meter recognises this prefix and hands the session off when its turn ends.
const HANDOFF_TEXT =
  '[ystack handoff request] The user pressed "Ask it to hand off" on the session board in another session. ' +
  "Finish the step you're on and don't drop the user's task. If the context-meter mod is installed it hands this session off " +
  'when this turn ends; otherwise, end your reply by asking the user to run /handoff.'

async function askHandoff($: EngineInterface, row: BoardRow) {
  const sent = await $.session.send({ to: { sessionId: row.sessionId }, text: HANDOFF_TEXT }).catch((err: unknown) => ({ isDelivered: false as const, reason: String(err) }))
  $.ui.toast(sent.isDelivered ? `Asked ${row.folder} to hand off.` : `Could not reach ${row.folder}: ${oneLine(sent.reason, 80)}`)
}

async function copyResume($: EngineInterface, row: BoardRow, surface: Parameters<EngineInterface['ui']['copy']>[0]['surface']) {
  const cmd = `claude --resume ${row.sessionId}`
  const r = await $.ui.copy({ text: cmd, surface }).catch(() => ({ isCopied: false as const }))
  $.ui.toast(r.isCopied ? `Copied. Run it in the ${row.folder} folder.` : `Copy failed. Run in ${row.folder}: ${cmd}`, { timeoutMs: 10_000 })
}

const state = (r: BoardRow) => (r.isRunning ? `running${r.status ? ` (${r.status})` : ''}` : r.isLeftOver ? 'not running (left over)' : 'not running')

export const register: Register = (on, options) => {
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : d)
  HOURS = num(options.hours, HOURS)
  HANDOFF_AT = num(options.handoffAt, HANDOFF_AT)

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'sessions', description: 'Board of every Claude Code session on this machine today: cost, context, idle time' })
    return next(e)
  })

  on('command.run', { command: 'sessions' }, async $ => {
    await update($, board, b => ({ ...b, note: b.at === 0 ? 'Reading sessions…' : b.note }))
    await $.ui.open({ id: PANE, title: 'Sessions' })
    await refresh($)
    timer?.cancel()
    timer = $.clock.every(30_000, () => tick($))
    const { rows } = await read($, board)
    return { text: `Session board opened: ${rows.length} session${rows.length === 1 ? '' : 's'}.` }
  })

  on('ui.close', { id: PANE }, async ($, e, next) => {
    timer?.cancel()
    timer = undefined
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const b = await read($, board)
    const now = await $.clock.now()
    const here = await $.session.id()
    const { total, topShare } = totals(b.rows)
    return (
      <Box flexDirection="column">
        <Text bold>
          Today: {tokens(total)} across {b.rows.length} session{b.rows.length === 1 ? '' : 's'}
          {b.rows.length > 1 ? ` · top session ${topShare}%` : ''}
        </Text>
        <Text dimColor>Usage in input-token equivalents (cache read 0.1, write 1.25 or 2, output 5), subagents included.</Text>
        {b.note !== '' && <Text dimColor>{b.note}</Text>}
        <Button key="refresh" label="Refresh" onPress={() => tick($)} />
        {b.rows.map(r => (
          <Box flexDirection="column" key={`row-${r.sessionId}`}>
            <Text bold>
              {r.folder}
              {r.sessionId === here ? ' (this session)' : ''} · {state(r)}
            </Text>
            <Text>
              ctx {tokens(r.context)}
              {isHandoffDue(r.context, HANDOFF_AT) ? ' HANDOFF DUE' : ''} · today {tokens(r.usageToday)}
              {r.isPartial ? ' (partial)' : ''} · idle {r.lastActiveAt ? idle(now - r.lastActiveAt) : '?'}
              {r.subagents > 0 ? ` · ${r.subagents} subagent${r.subagents === 1 ? '' : 's'} (last hour)` : ''}
            </Text>
            {r.lastText !== '' && <Text dimColor>{r.lastText}</Text>}
            <Box flexDirection="row">
              {r.isRunning && r.sessionId !== here && r.context >= HANDOFF_MIN && (
                <Button key={`${r.sessionId}-handoff`} label="Ask it to hand off" onPress={() => void askHandoff($, r)} />
              )}
              <Button key={`${r.sessionId}-resume`} label="Copy resume command" onPress={press => void copyResume($, r, press.surface)} />
            </Box>
          </Box>
        ))}
      </Box>
    )
  })
}
