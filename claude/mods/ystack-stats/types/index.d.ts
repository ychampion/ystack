export type Spread = { median: number; low: number; high: number; n: number } | null
export type Session = { folder: string; weight: number; share: number; hours: number; peak: number }
/** What the before/after split stands on: a ystack install, the first ystack-setup Apply, or this mod's first load. */
export type InstallSource = 'installed' | 'setup' | 'first-load'
export type BeforeAfter = {
  installAt: number
  source: InstallSource
  daysSince: number
  daysBefore: number
  activeBefore?: number
  activeAfter?: number
  before?: { hours: number; perHour: number }
  after?: { hours: number; perHour: number }
  change?: number
}
export type Report = {
  days: number
  at: number
  files: number
  /** Log lines over 2 MB, skipped unparsed. */
  longLines?: number
  replay: { loggedMain: number; simMain: number; loggedSub: number; simSub: number; handoffs: number; compactions: number; callsMain: number; callsSub: number }
  byType: { type: string; calls: number; weight: number }[]
  top: Session[]
  ctx: { fresh: Spread; before: Spread; after: Spread }
  beforeAfter: BeforeAfter | null
}

export type Progress = {
  phase: 'idle' | 'counting' | 'done' | 'error'
  done: number
  total: number
  /** Files read this time (the rest came from the cache). */
  read: number
  /** Large files that could not be read on this machine (no streaming reader). */
  skipped: number
  note: string
}

declare module 'claude-code' {
  interface PluginState {
    'ystack-stats': { progress: Shaped<Progress>; report: Shaped<Report | null> }
  }
}
