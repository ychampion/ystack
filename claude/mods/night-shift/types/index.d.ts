export type NightTask = {
  id: number
  text: string
  status: 'pending' | 'running' | 'done' | 'blocked' | 'failed' | 'unclear' | 'skipped'
  summary?: string
  startedAt?: number
  endedAt?: number
  costStart?: number
  cost?: number
  wrapUpSent?: boolean
}
export type NightShift = { tasks: NightTask[]; isActive: boolean; startAt?: number; note?: string }

declare module 'claude-code' {
  interface PluginState {
    'night-shift': { shift: Shaped<NightShift> }
  }
}
