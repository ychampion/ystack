// The maths of ystack-stats, free of any engine call so a test (or a plain script) can drive it.
//
// One Entry per log file: fed line by line, it keeps what the report needs and nothing of the text. Costs are in
// input-token equivalents: a fresh input token 1, cache read 0.1, cache write 1.25 (5-minute cache) or 2 (1-hour
// cache), output 5.

import type { BeforeAfter, InstallSource, Report, Spread } from '../types'

export type { BeforeAfter, InstallSource, Report, Spread }

export const HOUR = 3_600_000
export const DAY = 86_400_000

export type Params = {
  /** Main sessions hand off here (instead of compacting late)... */
  handoffAt: number
  /** ...down to about this much context... */
  afterHandoff: number
  /** ...paying for a checkpoint turn that writes this many output tokens. */
  checkpointOut: number
  /** Subagents compact here... */
  subAt: number
  /** ...down to about this much. */
  subAfter: number
}
export const RULES: Params = { handoffAt: 250_000, afterHandoff: 35_000, checkpointOut: 4_000, subAt: 250_000, subAfter: 85_000 }

export type Replay = { sim: number | null; prev: number | null; total: number; events: number }

export type Entry = {
  v: 1
  kind: 'main' | 'sub'
  /** The main session this file belongs to (a subagent's parent). */
  session: string
  agentType?: string
  /** Last part of the session's working folder, never a full path. */
  folder: string
  size: number
  mtime: number
  /** The window start the cut-dependent fields below were counted from. */
  cut: number
  /** Bytes consumed up to the last full line; a grown file is read on from here. */
  offset: number
  /** Last message ids seen (only kept for files read in pieces), so a resumed read does not count a call twice. */
  tail?: string[]
  /** Lines over MAX_LINE, skipped unparsed. */
  longLines?: number
  // Every call, whatever the window: logged cost per hour since the epoch, and the earliest call.
  hours: Record<string, number>
  firstAll: number
  // Calls at or after `cut` only.
  dropped: number
  n: number
  real: number
  firstT: number
  lastT: number
  peak: number
  firstCtx: number
  prevCtx: number
  pairs: [number, number][]
  replay: Replay
}

export function newEntry(meta: { kind: 'main' | 'sub'; session: string; agentType?: string; size: number; mtime: number }, cut: number): Entry {
  return {
    v: 1,
    ...meta,
    folder: '',
    cut,
    offset: 0,
    hours: {},
    firstAll: 0,
    dropped: 0,
    n: 0,
    real: 0,
    firstT: 0,
    lastT: 0,
    peak: 0,
    firstCtx: 0,
    prevCtx: 0,
    pairs: [],
    replay: { sim: null, prev: null, total: 0, events: 0 },
  }
}

/** True when a stored entry's window-dependent numbers hold for this window too. */
export function fitsWindow(e: Entry, cut: number): boolean {
  return e.cut === cut || (e.dropped === 0 && (e.n === 0 || e.firstT >= cut))
}

type Usage = {
  input_tokens?: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
  output_tokens?: number
  cache_creation?: { ephemeral_1h_input_tokens?: number }
}
type Line = { message?: { id?: string; usage?: Usage }; timestamp?: string; isSidechain?: boolean; cwd?: string }

const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x > 0 ? x : 0)
const lastPart = (p: string) => p.replace(/[\\/]+$/, '').replace(/^.*[\\/]/, '')

/** Feeds one log line. `seen` holds the message ids already counted in this file (a call is logged once per content block). */
export function feedLine(e: Entry, line: string, seen: Set<string>, p: Params = RULES): void {
  if (!line.includes('"usage"')) return
  let r: Line
  try {
    r = JSON.parse(line) as Line
  } catch {
    return // a half-written last line
  }
  const m = r?.message
  const u = m?.usage
  if (!u || typeof r.timestamp !== 'string' || (e.kind === 'main' && r.isSidechain)) return
  if (typeof m?.id === 'string') {
    if (seen.has(m.id)) return
    seen.add(m.id)
  }
  const t = Date.parse(r.timestamp)
  if (!Number.isFinite(t)) return
  if (!e.folder && typeof r.cwd === 'string') e.folder = lastPart(r.cwd)

  const fresh = num(u.input_tokens)
  const write = num(u.cache_creation_input_tokens)
  const read = num(u.cache_read_input_tokens)
  const out = num(u.output_tokens)
  const w1h = Math.min(write, num(u.cache_creation?.ephemeral_1h_input_tokens))
  const writeCost = 1.25 * (write - w1h) + 2 * w1h
  const mu = write > 0 ? writeCost / write : 1.25
  const cost = fresh + writeCost + 0.1 * read + 5 * out
  const ctx = fresh + write + read

  const h = String(Math.floor(t / HOUR))
  e.hours[h] = (e.hours[h] ?? 0) + cost
  e.firstAll = e.firstAll === 0 ? t : Math.min(e.firstAll, t)
  if (t < e.cut) {
    e.dropped++
    return
  }
  e.n++
  e.real += cost
  e.firstT = e.firstT === 0 ? t : Math.min(e.firstT, t)
  e.lastT = Math.max(e.lastT, t)
  e.peak = Math.max(e.peak, ctx)
  if (e.n === 1) e.firstCtx = ctx
  if (e.kind === 'main' && e.prevCtx > 200_000 && ctx < 0.6 * e.prevCtx && e.pairs.length < 500) e.pairs.push([e.prevCtx, ctx])
  e.prevCtx = ctx
  step(e.replay, { ctx, fresh, write, out, mu }, e.kind === 'main' ? p.handoffAt : p.subAt, e.kind === 'main' ? p.afterHandoff : p.subAfter, e.kind === 'main', p)
}

/**
 * One call re-priced under the rules. The simulated context grows by each call's real growth (a real compaction's
 * drop is ignored); past `at` it falls to `after`, a main session paying for its checkpoint turn. A call that
 * rewrote (nearly) its whole context had a cold cache, so it rewrites the simulated context instead.
 */
export function step(s: Replay, c: { ctx: number; fresh: number; write: number; out: number; mu: number }, at: number, after: number, handoff: boolean, p: Params = RULES): void {
  s.sim = s.sim === null ? c.ctx : s.sim + Math.max(0, c.ctx - (s.prev ?? c.ctx))
  s.prev = c.ctx
  if (s.sim >= at) {
    s.events++
    if (handoff) s.total += 0.1 * s.sim + 5 * p.checkpointOut + 2 * after
    s.sim = after
  }
  const isCold = c.write > 0.5 * c.ctx && c.ctx > 20_000
  if (isCold) s.total += c.fresh + c.mu * s.sim + 5 * c.out
  else {
    const fresh = Math.min(c.write, s.sim)
    s.total += c.fresh + c.mu * fresh + 0.1 * Math.max(0, s.sim - fresh) + 5 * c.out
  }
}

/** UTF-8 byte length of a string, to keep a file offset in bytes. */
export function utf8Length(s: string): number {
  let n = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c < 0x80) n++
    else if (c < 0x800) n += 2
    else if (c >= 0xd800 && c <= 0xdbff) {
      n += 4
      i++
    } else n += 3
  }
  return n
}

/** Usage rows are a few KB; a line longer than this (a pasted image, a huge tool result) is skipped unparsed. */
export const MAX_LINE = 2 * 1024 * 1024

/** Splits text arriving in pieces into lines; `offset` advances only past whole lines. */
export class LineFeeder {
  private pieces: string[] = []
  private restLength = 0
  /** Inside a line over MAX_LINE: its bytes so far, nothing of it kept. */
  private skipBytes = -1
  constructor(
    private e: Entry,
    private seen: Set<string>,
    private p: Params = RULES,
  ) {}
  push(text: string): void {
    let from = 0
    for (let nl = text.indexOf('\n'); nl !== -1; nl = text.indexOf('\n', from)) {
      const piece = text.slice(from, nl)
      from = nl + 1
      if (this.skipBytes >= 0) {
        this.e.offset += this.skipBytes + utf8Length(piece) + 1
        this.skipBytes = -1
        this.e.longLines = (this.e.longLines ?? 0) + 1
        continue
      }
      const line = this.pieces.length ? this.pieces.join('') + piece : piece
      this.pieces = []
      this.restLength = 0
      if (line.length > MAX_LINE) this.e.longLines = (this.e.longLines ?? 0) + 1
      else feedLine(this.e, line, this.seen, this.p)
      this.e.offset += utf8Length(line) + 1
    }
    const tail = text.slice(from)
    if (!tail) return
    if (this.skipBytes >= 0) {
      this.skipBytes += utf8Length(tail)
      return
    }
    this.pieces.push(tail)
    this.restLength += tail.length
    if (this.restLength > MAX_LINE) {
      this.skipBytes = this.pieces.reduce((n, s) => n + utf8Length(s), 0)
      this.pieces = []
      this.restLength = 0
    }
  }
  /** The file ended: a last line without its newline is counted, but the offset stays before it. */
  end(): void {
    if (this.skipBytes >= 0) this.e.longLines = (this.e.longLines ?? 0) + 1
    else if (this.pieces.length) feedLine(this.e, this.pieces.join(''), this.seen, this.p)
    this.pieces = []
    this.restLength = 0
    this.skipBytes = -1
  }
}

// ---- The report ----

function spread(xs: number[]): Spread {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  const at = (i: number) => s[i] ?? 0
  const mid = s.length % 2 ? at((s.length - 1) / 2) : (at(s.length / 2 - 1) + at(s.length / 2)) / 2
  return { median: mid, low: at(Math.floor(s.length / 4)), high: at(Math.floor((3 * s.length) / 4)), n: s.length }
}

export type ReportOptions = { days: number; now: number; install?: { at: number; source: InstallSource } }

export function buildReport(entries: Entry[], o: ReportOptions): Report {
  const rp = { loggedMain: 0, simMain: 0, loggedSub: 0, simSub: 0, handoffs: 0, compactions: 0, callsMain: 0, callsSub: 0 }
  const kinds = new Map<string, { calls: number; weight: number }>()
  const sessions = new Map<string, { folder: string; weight: number; first: number; last: number; peak: number }>()
  const fresh: number[] = []
  const before: number[] = []
  const after: number[] = []
  for (const e of entries) {
    if (e.n === 0) continue
    const kind = e.kind === 'main' ? 'main sessions' : `subagent: ${e.agentType || 'unknown'}`
    const k = kinds.get(kind) ?? { calls: 0, weight: 0 }
    k.calls += e.n
    k.weight += e.real
    kinds.set(kind, k)
    const s = sessions.get(e.session) ?? { folder: '', weight: 0, first: 0, last: 0, peak: 0 }
    s.weight += e.real
    if (e.kind === 'main') {
      rp.loggedMain += e.real
      rp.simMain += e.replay.total
      rp.handoffs += e.replay.events
      rp.callsMain += e.n
      s.folder = e.folder || s.folder
      s.first = s.first === 0 ? e.firstT : Math.min(s.first, e.firstT)
      s.last = Math.max(s.last, e.lastT)
      s.peak = Math.max(s.peak, e.peak)
      if (e.n >= 3) fresh.push(e.firstCtx)
      for (const [a, b] of e.pairs) {
        before.push(a)
        after.push(b)
      }
    } else {
      rp.loggedSub += e.real
      rp.simSub += e.replay.total
      rp.compactions += e.replay.events
      rp.callsSub += e.n
      if (!s.folder) s.folder = e.folder
    }
    sessions.set(e.session, s)
  }
  const total = rp.loggedMain + rp.loggedSub || 1
  const top = [...sessions.values()]
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 5)
    .map(s => ({ folder: s.folder || '(unknown)', weight: s.weight, share: s.weight / total, hours: s.last > s.first ? (s.last - s.first) / HOUR : 0, peak: s.peak }))
  const byType = [...kinds.entries()].map(([type, v]) => ({ type, ...v })).sort((a, b) => b.weight - a.weight)
  return {
    days: o.days,
    at: o.now,
    files: entries.length,
    longLines: entries.reduce((n, e) => n + (e.longLines ?? 0), 0),
    replay: rp,
    byType,
    top,
    ctx: { fresh: spread(fresh), before: spread(before), after: spread(after) },
    beforeAfter: o.install ? beforeAfter(entries, o.install, o.days, o.now) : null,
  }
}

/** Fewer active hours than this on either side, and no split is shown. */
export const MIN_ACTIVE_HOURS = 50

/** Logged cost per active hour (an hour with at least one call), up to `days` days on each side of the split. */
export function beforeAfter(entries: Entry[], install: { at: number; source: InstallSource }, days: number, now: number): BeforeAfter {
  const hours = new Map<number, number>()
  let earliest = 0
  for (const e of entries) {
    for (const [h, w] of Object.entries(e.hours)) hours.set(Number(h), (hours.get(Number(h)) ?? 0) + w)
    if (e.firstAll > 0) earliest = earliest === 0 ? e.firstAll : Math.min(earliest, e.firstAll)
  }
  const span = days * DAY
  const beforeFrom = install.at - span
  const afterFrom = Math.max(install.at, now - span)
  const side = (from: number, to: number) => {
    let n = 0
    let w = 0
    for (const [h, v] of hours) {
      const t = h * HOUR
      if (t >= from && t < to) {
        n++
        w += v
      }
    }
    return { hours: n, perHour: n ? w / n : 0 }
  }
  const daysSince = Math.max(0, (now - install.at) / DAY)
  const daysBefore = earliest === 0 || earliest >= install.at ? 0 : Math.min(days, (install.at - Math.max(earliest, beforeFrom)) / DAY)
  const out: BeforeAfter = { installAt: install.at, source: install.source, daysSince, daysBefore }
  if (daysSince < 3 || daysBefore < 3) return out
  const before = side(beforeFrom, install.at)
  const after = side(afterFrom, now + HOUR)
  out.activeBefore = before.hours
  out.activeAfter = after.hours
  if (before.hours < MIN_ACTIVE_HOURS || after.hours < MIN_ACTIVE_HOURS) return out
  out.before = before
  out.after = after
  if (before.perHour > 0) out.change = after.perHour / before.perHour - 1
  return out
}

// ---- Words ----

const M = (x: number) => (x >= 10e6 ? `${Math.round(x / 1e6).toLocaleString('en-US')}M` : `${(x / 1e6).toFixed(1)}M`)
const k = (x: number) => `${Math.round(x / 1000)}k`
const pct = (x: number) => `${Math.round(x * 100)}%`
export const saved = (logged: number, sim: number) => (logged > 0 ? 1 - sim / logged : 0)
/** "28% less", or "4% more" when the rules would have cost more. */
export const lessOrMore = (x: number) => (x >= 0 ? `${pct(x)} less` : `${pct(-x)} more`)
export const spreadText = (s: Spread) => (s ? `median ${k(s.median)} (middle half ${k(s.low)}-${k(s.high)}, ${s.n} seen)` : 'none seen')
const date = (t: number) => new Date(t).toISOString().slice(0, 10)

/** What "with ystack" stands for, said wherever the number is. */
export const ASSUMES = [
  `Main sessions: context-meter hands off at every crossing of its mark (${k(RULES.handoffAt)}, its default). That is the upper end: real handoffs wait for a boundary.`,
  `Subagents compact at ${k(RULES.subAt)}, which holds only for agent types set up that way (ystack-setup's opus-medium and opus-high).`,
  'Prices are input-token equivalents of the same model; a model switch is not counted.',
]
export const NOT_MODELLED =
  'Not modelled: work a session redoes after a handoff, any change in what the model writes, the cost of a compaction summary call, and calls ystack would have avoided altogether.'
export const UNITS = 'Units: input-token equivalents (fresh input 1, cache read 0.1, cache write 1.25 or 2, output 5). Read from your own logs; nothing leaves your machine.'

const SPLIT_WORD: Record<InstallSource, string> = { installed: 'ystack was installed', setup: 'ystack-setup was applied', 'first-load': 'ystack was first loaded' }

export function beforeAfterLines(b: BeforeAfter | null): string[] {
  if (!b) return ['No install date yet.']
  const head = `Split at ${date(b.installAt)}, when ${SPLIT_WORD[b.source]}. Per active hour; workload and model changes also show up here.`
  if (b.daysSince < 3 || b.daysBefore < 3) {
    const extra = b.daysSince >= 3 ? ` (and ${Math.floor(b.daysBefore)} days of logs before it)` : ''
    return [head, `not enough data yet: ${Math.floor(b.daysSince)} days since install${extra}`]
  }
  if (!b.before || !b.after)
    return [head, `not enough data yet: ${b.activeBefore ?? 0} active hours before and ${b.activeAfter ?? 0} after (${MIN_ACTIVE_HOURS} needed on each side)`]
  const change = b.change === undefined ? 'no change to show' : `${lessOrMore(-b.change)} per active hour`
  return [
    head,
    `before: ${M(b.before.perHour)} per active hour (${b.before.hours} active hours)`,
    `after:  ${M(b.after.perHour)} per active hour (${b.after.hours} active hours)`,
    change,
  ]
}

/** The pane's body, as lines of text. */
export function reportLines(r: Report): { heading?: string; text: string; dim?: boolean }[] {
  const p = r.replay
  const logged = p.loggedMain + p.loggedSub
  const sim = p.simMain + p.simSub
  const L: { heading?: string; text: string; dim?: boolean }[] = []
  L.push({ heading: 'What-if replay (an estimate)', text: `Your real API calls of the last ${r.days} days, priced as logged and under ystack's rules.` })
  if (logged === 0) {
    L.push({ text: 'No API calls found in that window.' })
  } else {
    L.push({ text: `as logged     ${M(logged)}` })
    L.push({ text: `with ystack   ${M(sim)}   about ${lessOrMore(saved(logged, sim))}` })
    L.push({
      text: `main sessions ${M(p.loggedMain)} -> ${M(p.simMain)}, up to ${lessOrMore(saved(p.loggedMain, p.simMain))}, ${p.handoffs} handoffs at ${k(RULES.handoffAt)} (${p.callsMain} calls)`,
    })
    L.push({ text: `subagents     ${M(p.loggedSub)} -> ${M(p.simSub)}, ${lessOrMore(saved(p.loggedSub, p.simSub))}, ${p.compactions} compactions at ${k(RULES.subAt)} (${p.callsSub} calls)` })
    for (const a of ASSUMES) L.push({ text: a, dim: true })
    L.push({ heading: 'Who made the calls', text: '' })
    for (const t of r.byType.slice(0, 6)) L.push({ text: `${t.type}: ${M(t.weight)}, ${pct(t.weight / logged)} (${t.calls} calls)` })
    L.push({ heading: 'Top sessions (their subagents included)', text: '' })
    for (const s of r.top) L.push({ text: `${s.folder}: ${M(s.weight)}, ${pct(s.share)}, ran ${s.hours.toFixed(1)}h, peak context ${k(s.peak)}` })
    L.push({ heading: 'Context size in main sessions', text: '' })
    L.push({ text: `first call of a fresh session: ${spreadText(r.ctx.fresh)}` })
    L.push({ text: `just before a compaction: ${spreadText(r.ctx.before)}` })
    L.push({ text: `just after it: ${spreadText(r.ctx.after)}` })
  }
  L.push({ heading: 'Real before and after', text: '' })
  for (const t of beforeAfterLines(r.beforeAfter)) L.push({ text: t })
  if (r.longLines) L.push({ text: `${r.longLines} log lines over 2 MB were skipped unread (usage rows are small).`, dim: true })
  L.push({ text: NOT_MODELLED, dim: true })
  L.push({ text: UNITS, dim: true })
  return L
}

/** A short markdown summary with numbers only (no folder names), to paste anywhere. */
export function shareText(r: Report): string {
  const p = r.replay
  const logged = p.loggedMain + p.loggedSub
  const sim = p.simMain + p.simSub
  const lines = [
    `**ystack what-if, my last ${r.days} days** (an estimate, in input-token equivalents of the same model)`,
    '',
    `- As logged: ${M(logged)}; with ystack's rules: ${M(sim)} (**about ${lessOrMore(saved(logged, sim))}**)`,
    `- Main sessions: ${M(p.loggedMain)} -> ${M(p.simMain)}, up to ${lessOrMore(saved(p.loggedMain, p.simMain))} (handing off at every crossing of ${k(RULES.handoffAt)}; real handoffs wait for a boundary)`,
    `- Subagents: ${M(p.loggedSub)} -> ${M(p.simSub)} (compacting at ${k(RULES.subAt)}, for agent types set up that way)`,
    `- Context before a compaction: ${spreadText(r.ctx.before)}`,
  ]
  const b = r.beforeAfter
  if (b?.change !== undefined) lines.push(`- Usage per active hour, before vs after installing ystack (not controlled for workload): ${lessOrMore(-b.change)}`)
  return lines.join('\n')
}
