export type RecoverRow = { id: string; cwd: string; title: string; lastBeat: number; isFromBeforeBoot: boolean }

declare module 'claude-code' {
  interface PluginState {
    'session-recovery': { rows: Shaped<RecoverRow[]> }
  }
}
