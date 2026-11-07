export type LoopFlag = { loop: string; who: string; what: string; count: number }

declare module 'claude-code' {
  interface PluginState {
    'loop-breaker': {
      flags: Shaped<LoopFlag[]>
    }
  }
}
