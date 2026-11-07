export type DietRow = { label: string; tokens: number }
export type DietView = {
  rows: DietRow[]
  totalTokens: number
  restCount: number
  restTokens: number
  deferredCount: number
  used: string[]
  changes: string[]
  unused: string[]
}

declare module 'claude-code' {
  interface PluginState {
    'prompt-diet': {
      view: Shaped<DietView>
    }
  }
}
