export type Trim = { at: number; command: string; fromLines: number; toLines: number; savedChars: number; path: string }
export type Stats = { trims: number; savedChars: number; recent: Trim[] }
export type Mode = 'default' | 'on' | 'off'

declare module 'claude-code' {
  interface PluginState {
    'output-diet': {
      stats: Shaped<Stats>
      mode: Mode
    }
  }
}
