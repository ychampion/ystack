export type VoiceQuote = { path: string; text: string }
export type VoiceView = { request: string; quotes: VoiceQuote[]; isFeature: boolean; hasDir: boolean; at: number }

declare module 'claude-code' {
  interface PluginState {
    'user-voice': {
      last: Shaped<VoiceView>
    }
  }
}
