// The moment: what the agent is doing, the time of day and the season, worked out from events and the clock. Pure: every
// function here takes the time it needs, so the tests drive it with a clock of their own.
import type { Activity, Phase, SceneCtx, Season } from './scenes/contract'

export const ACTIVITIES: readonly Activity[] = ['idle', 'thinking', 'working', 'agents', 'error', 'success']
export const PHASES: readonly Phase[] = ['dawn', 'day', 'dusk', 'night']
export const SEASONS: readonly Season[] = ['spring', 'summer', 'autumn', 'winter']
export const MAX_AGENTS = 5
/** How long an error or a success shows. */
export const FLASH_MS = 8000

/** What the model said that counts as a success: a merge, a passing test run, a push. */
export const SUCCESS_WORDS = /\bmerged\b|\ball (?:the )?tests? pass(?:ed|es|ing)?\b|\bpushed to\b/i

/** The live counters behind the activity. */
export type Tracker = {
  /** A prompt was sent and its turn has not completed. */
  isTurnRunning: boolean
  /** Main-loop tool calls running now. */
  toolsInFlight: number
  /** Subagents running now, as the engine lists them. */
  agents: number
  /** A short flash and when it ends. */
  flash?: { kind: 'error' | 'success'; until: number }
}

export function newTracker(): Tracker {
  return { isTurnRunning: false, toolsInFlight: 0, agents: 0 }
}

export const onPromptSubmit = (t: Tracker): Tracker => ({ ...t, isTurnRunning: true, toolsInFlight: 0 })
export const onToolStart = (t: Tracker): Tracker => ({ ...t, isTurnRunning: true, toolsInFlight: t.toolsInFlight + 1 })
export const onToolEnd = (t: Tracker): Tracker => ({ ...t, toolsInFlight: Math.max(0, t.toolsInFlight - 1) })
export const onTurnComplete = (t: Tracker): Tracker => ({ ...t, isTurnRunning: false, toolsInFlight: 0 })
export const onAgents = (t: Tracker, running: number): Tracker => ({ ...t, agents: Math.max(0, Math.floor(running)) })
export const onFlash = (t: Tracker, kind: 'error' | 'success', now: number): Tracker => ({ ...t, flash: { kind, until: now + FLASH_MS } })

/**
 * What the agent is doing at `now`. A flash wins while it lasts, then subagents, then running tools, then a turn in
 * progress; otherwise idle. `calm` ignores the agent entirely.
 */
export function activityOf(t: Tracker, now: number, calm: boolean): { activity: Activity; agents: number } {
  if (calm) return { activity: 'idle', agents: 0 }
  if (t.flash !== undefined && now < t.flash.until) return { activity: t.flash.kind, agents: 0 }
  if (t.agents > 0) return { activity: 'agents', agents: Math.min(MAX_AGENTS, t.agents) }
  if (t.toolsInFlight > 0) return { activity: 'working', agents: 0 }
  if (t.isTurnRunning) return { activity: 'thinking', agents: 0 }
  return { activity: 'idle', agents: 0 }
}

/**
 * A UTC offset as a person types it, in minutes east of UTC: "+5:30", "-8", "+0545", "5.5", "UTC+1". Empty or
 * unreadable: undefined (the system clock's own offset is used).
 */
export function parseOffset(text: unknown): number | undefined {
  if (typeof text !== 'string') return undefined
  const m = /^\s*(?:utc|gmt)?\s*([+-−])?\s*(\d{1,2})(?:(?::|\.|h)?(\d{1,2}))?\s*$/i.exec(text)
  if (m === null) return undefined
  const sign = m[1] === '-' || m[1] === '−' ? -1 : 1
  const hours = Number(m[2])
  let minutes = m[3] === undefined ? 0 : Number(m[3])
  // "5.5" means five and a half hours, "5:30" thirty minutes.
  if (text.includes('.') && m[3] !== undefined) minutes = Math.round(Number(`0.${m[3]}`) * 60)
  if (hours > 14 || minutes >= 60) return undefined
  return sign * (hours * 60 + minutes)
}

/** The local hour and month (0-11) at `now`: by the given offset, else by the system clock. */
export function localTime(now: number, offsetMinutes: number | undefined): { hour: number; month: number } {
  if (offsetMinutes === undefined) {
    const d = new Date(now)
    return { hour: d.getHours(), month: d.getMonth() }
  }
  const d = new Date(now + offsetMinutes * 60_000)
  return { hour: d.getUTCHours(), month: d.getUTCMonth() }
}

/** dawn 5-8, day 8-17, dusk 17-20, night 20-5. */
export function phaseOf(hour: number): Phase {
  if (hour >= 5 && hour < 8) return 'dawn'
  if (hour >= 8 && hour < 17) return 'day'
  if (hour >= 17 && hour < 20) return 'dusk'
  return 'night'
}

/** Meteorological seasons: March to May is spring in the north and autumn in the south. */
export function seasonOf(month: number, hemisphere: 'north' | 'south'): Season {
  const north: Season = month >= 2 && month <= 4 ? 'spring' : month >= 5 && month <= 7 ? 'summer' : month >= 8 && month <= 10 ? 'autumn' : 'winter'
  if (hemisphere === 'north') return north
  return ({ spring: 'autumn', summer: 'winter', autumn: 'spring', winter: 'summer' } as const)[north]
}

// A backdrop's scene name: 1 to 64 letters, digits, `_` and `-` (the engine refuses anything else, `~` included). Theme
// ids are lower case with hyphens, so `_` separates the parts: shark-shoal_working_day_autumn_2.
const SEP = '_'
export const NAME_LIMIT = 64

export function encodeScene(id: string, ctx: SceneCtx): string {
  return [id, ctx.activity, ctx.phase, ctx.season, String(ctx.agents)].join(SEP)
}

/** A scene name back to its theme id and moment; undefined for any name this mod did not make. */
export function decodeScene(name: string): { id: string; ctx: SceneCtx } | undefined {
  const parts = name.split(SEP)
  if (parts.length !== 5) return undefined
  const [id, activity, phase, season, agents] = parts as [string, string, string, string, string]
  const n = Number(agents)
  if (
    !/^[a-z0-9-]+$/.test(id) ||
    !(ACTIVITIES as readonly string[]).includes(activity) ||
    !(PHASES as readonly string[]).includes(phase) ||
    !(SEASONS as readonly string[]).includes(season) ||
    !/^[0-5]$/.test(agents)
  ) {
    return undefined
  }
  return { id, ctx: { activity: activity as Activity, phase: phase as Phase, season: season as Season, agents: n } }
}

/** A wait on some clock: the engine's `$.clock.after`, or a test's. */
export type After = (ms: number, fn: () => void) => { cancel: () => void }

/** What a Coalescer works with: a clock, a wait on it, and what lands a name. Handed over with each offer. */
export type CoalescerIo = {
  now: () => number | Promise<number>
  after: After
  apply: (name: string) => Promise<void>
}

/**
 * Hands names on to `apply` no oftener than once per `gapMs`, and only when the name differs from the last one applied.
 * Names offered while it waits replace each other, so the last offered is the one that lands: it always ends on the
 * latest moment. The io of the latest offer serves the flush.
 */
export class Coalescer {
  private lastApplied: string | undefined
  private lastAt = Number.NEGATIVE_INFINITY
  private pending: string | undefined
  private timer: { cancel: () => void } | undefined
  private busy: Promise<void> = Promise.resolve()
  private io: CoalescerIo | undefined

  constructor(private readonly gapMs: number) {}

  /** The name last handed to `apply`. */
  get applied(): string | undefined {
    return this.lastApplied
  }

  /** Forgets what was applied, so the next offer goes through (after a clear, or another mod's backdrop). */
  reset(): void {
    this.timer?.cancel()
    this.timer = undefined
    this.pending = undefined
    this.lastApplied = undefined
  }

  async offer(name: string, io: CoalescerIo): Promise<void> {
    this.io = io
    if (this.timer === undefined && name === this.lastApplied) {
      // Back where it stands: an offer still on its way to a flush has nothing left to land.
      this.pending = undefined
      return
    }
    this.pending = name
    if (this.timer !== undefined) return
    const at = await io.now()
    // Checked again after the await: another offer may have flushed or started the wait meanwhile.
    if (this.timer !== undefined || this.pending === undefined) return
    const wait = this.lastAt + this.gapMs - at
    if (wait <= 0) {
      await this.flush(at)
      return
    }
    this.timer = io.after(wait, () => {
      void (async () => {
        const latest = this.io ?? io
        await this.flush(await latest.now())
      })().catch(() => undefined)
    })
  }

  private async flush(at: number): Promise<void> {
    this.timer = undefined
    const name = this.pending
    this.pending = undefined
    const io = this.io
    if (name === undefined || name === this.lastApplied || io === undefined) return
    // Taken before any await, so an offer that comes meanwhile waits its gap.
    this.lastApplied = name
    this.lastAt = at
    // One apply at a time, in order.
    const run = this.busy.then(() => io.apply(name))
    this.busy = run.catch(() => undefined)
    await run
  }
}
