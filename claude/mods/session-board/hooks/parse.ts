// Pure parts of the board: reading transcript rows, costing usage, sorting and wording. No engine calls here.

/** What one transcript has told us so far. Built up chunk by chunk; never holds the transcript itself. */
export type Scan = {
  /** Context size at the last reply: input + cache read + cache write + output, in tokens. */
  context: number
  /** The last reply's text, one line. */
  lastText: string
  /** Timestamps (ms) of the rows the context and the text came from, so an older chunk read later never wins. */
  contextAt: number
  textAt: number
  /** The newest row timestamp seen (ms), 0 if none. */
  lastAt: number
  /** The oldest row timestamp seen (ms), 0 if none: tells whether a tail read reached back far enough. */
  firstAt: number
  /** The session's working folder, from the rows' own cwd field. */
  cwd: string
  /** Usage in input-token equivalents per local day (YYYY-MM-DD). */
  byDay: Record<string, number>
  /** Usage already counted per API message id, so a reply split over several rows is counted once. */
  seen: Record<string, { day: string; units: number }>
}

export const emptyScan = (): Scan => ({ context: 0, lastText: '', contextAt: 0, textAt: 0, lastAt: 0, firstAt: 0, cwd: '', byDay: {}, seen: {} })

type Usage = {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
  cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number }
}

const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0)

/**
 * One API call's usage in input-token equivalents: input 1, cache read 0.1, cache write 1.25 (5-minute) or
 * 2 (1-hour), output 5. A write with no 5m/1h split counts at 1.25.
 */
export function units(u: Usage): number {
  const write5 = n(u.cache_creation?.ephemeral_5m_input_tokens)
  const write1h = n(u.cache_creation?.ephemeral_1h_input_tokens)
  const split = write5 + write1h
  const writeOther = Math.max(0, n(u.cache_creation_input_tokens) - split)
  return n(u.input_tokens) + 0.1 * n(u.cache_read_input_tokens) + 1.25 * (write5 + writeOther) + 2 * write1h + 5 * n(u.output_tokens)
}

export const contextOf = (u: Usage) => n(u.input_tokens) + n(u.cache_read_input_tokens) + n(u.cache_creation_input_tokens) + n(u.output_tokens)

const pad = (v: number) => String(v).padStart(2, '0')
/** The local calendar day of a time, YYYY-MM-DD. */
export function dayKey(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
/** Local midnight at the start of the day holding `ms`. */
export function dayStart(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** Text on one line, at most `max` characters. */
export function oneLine(text: string, max = 120): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

// Key-like strings never reach the board: a pasted token in a reply would otherwise sit on screen.
const SECRETS: [RegExp, string][] = [
  [/-----BEGIN[\s\S]*/g, '[hidden]'], // a PEM block: everything from its header on
  [/\bBearer\s+[^\s"'`]+/gi, 'Bearer [hidden]'],
  [/\bsk-[A-Za-z0-9_-]{8,}/g, '[hidden]'],
  [/\bgh[po]_[A-Za-z0-9]{8,}/g, '[hidden]'],
  [/\bgithub_pat_[A-Za-z0-9_]{8,}/g, '[hidden]'],
  [/\bAKIA[0-9A-Z]{12,}/g, '[hidden]'],
  [/\bxox[abpr]-[A-Za-z0-9-]{4,}/g, '[hidden]'],
]
/** Replaces key-like strings (API keys, GitHub and Slack tokens, AWS key ids, bearer tokens, PEM blocks) with [hidden]. */
export function maskSecrets(text: string): string {
  let out = text
  for (const [re, to] of SECRETS) out = out.replace(re, to)
  return out
}

const SEEN_CAP = 4000

/**
 * Folds complete JSONL rows into the scan. `isMain` is false for a subagent's transcript, whose context and text
 * are not the session's own (only its usage counts). Rows that do not parse are skipped.
 */
export function scanRows(scan: Scan, text: string, isMain = true): Scan {
  for (const line of text.split('\n')) {
    if (!line.startsWith('{')) continue
    let row: Record<string, unknown>
    try {
      row = JSON.parse(line) as Record<string, unknown>
    } catch {
      continue
    }
    const at = typeof row.timestamp === 'string' ? Date.parse(row.timestamp) : NaN
    if (Number.isFinite(at)) {
      if (at > scan.lastAt) scan.lastAt = at
      if (scan.firstAt === 0 || at < scan.firstAt) scan.firstAt = at
    }
    if (isMain && typeof row.cwd === 'string' && row.cwd) scan.cwd = row.cwd
    if (row.type !== 'assistant') continue
    const msg = row.message as { id?: string; usage?: Usage; content?: unknown; model?: string } | undefined
    if (!msg || msg.model === '<synthetic>') continue
    if (msg.usage && Number.isFinite(at)) {
      const id = typeof msg.id === 'string' ? msg.id : `row-${String(row.uuid ?? at)}`
      const day = dayKey(at)
      const cost = units(msg.usage)
      const before = scan.seen[id]
      if (before) scan.byDay[before.day] = (scan.byDay[before.day] ?? 0) - before.units
      scan.byDay[day] = (scan.byDay[day] ?? 0) + cost
      scan.seen[id] = { day, units: cost }
      if (isMain && row.isSidechain !== true && at >= scan.contextAt) {
        scan.context = contextOf(msg.usage)
        scan.contextAt = at
      }
    }
    if (isMain && row.isSidechain !== true && Array.isArray(msg.content) && !(at < scan.textAt)) {
      const said = (msg.content as { type?: string; text?: string }[])
        .filter(b => b.type === 'text' && typeof b.text === 'string' && b.text.trim() !== '')
        .map(b => b.text as string)
        .join(' ')
      if (said) {
        scan.lastText = oneLine(maskSecrets(said))
        if (Number.isFinite(at)) scan.textAt = at
      }
    }
  }
  const ids = Object.keys(scan.seen)
  if (ids.length > SEEN_CAP) for (const id of ids.slice(0, ids.length - SEEN_CAP)) delete scan.seen[id]
  return scan
}

/** Drops days older than yesterday, so a long-running scan stays small. */
export function pruneDays(scan: Scan, now: number): void {
  const keep = new Set([dayKey(now), dayKey(dayStart(now) - 1)])
  for (const day of Object.keys(scan.byDay)) if (!keep.has(day)) delete scan.byDay[day]
}

/**
 * Splits decoded bytes into the complete rows and the byte count they take. `fromStart` false means the bytes
 * begin mid-file, so the first (likely partial) line is dropped too: `skipped` says how many bytes that was.
 */
export function completeRows(bytes: Uint8Array, fromStart: boolean): { text: string; skipped: number; used: number } {
  let start = 0
  if (!fromStart) {
    const nl = bytes.indexOf(10)
    if (nl < 0) return { text: '', skipped: 0, used: 0 }
    start = nl + 1
  }
  const end = bytes.lastIndexOf(10) + 1
  if (end <= start) return { text: '', skipped: start, used: start }
  return { text: new TextDecoder().decode(bytes.subarray(start, end)), skipped: start, used: end }
}

/** The last part of a folder path, either separator. */
export const folderName = (cwd: string) => cwd.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || cwd || '?'

/** Tokens as 812, 41k or 1.2M. */
export function tokens(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1000) return `${Math.round(v / 1000)}k`
  return String(Math.round(v))
}

/** Idle time as 40s, 12m, 3h 5m or 2d. */
export function idle(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return m % 60 ? `${h}h ${m % 60}m` : `${h}h`
  return `${Math.floor(h / 24)}d`
}

export const isHandoffDue = (context: number, handoffAt: number) => handoffAt > 0 && context >= handoffAt

/** Costliest first; ties go to the most recently active. */
export function sortRows<T extends { usageToday: number; lastActiveAt: number }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => b.usageToday - a.usageToday || b.lastActiveAt - a.lastActiveAt)
}

/** Today's total and the top session's share of it, as a whole percent (0 when nothing was used). */
export function totals(rows: { usageToday: number }[]): { total: number; topShare: number } {
  const total = rows.reduce((s, r) => s + r.usageToday, 0)
  const top = rows.reduce((m, r) => Math.max(m, r.usageToday), 0)
  return { total, topShare: total > 0 ? Math.round((top / total) * 100) : 0 }
}
