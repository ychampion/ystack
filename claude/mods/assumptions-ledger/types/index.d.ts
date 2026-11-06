export type Assumption = { id: string; agent: string; text: string; status: 'open' | 'ok' | 'wrong'; at: number }

declare module 'claude-code' {
  interface PluginState {
    'assumptions-ledger': { items: Shaped<Assumption[]> }
  }
}
