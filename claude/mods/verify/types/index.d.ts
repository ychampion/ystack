export type LiveStatus = 'idle' | 'running' | 'pass' | 'fail' | 'error'
export type LiveView = { status: LiveStatus; label: string; root: string; lines: string[]; at: number }
export type GateView = { edits: number; checks: number; files: string[] }

declare module 'claude-code' {
  interface PluginState {
    verify: {
      live: Shaped<LiveView>
      gate: Shaped<GateView>
      isOff: boolean
    }
  }
}
