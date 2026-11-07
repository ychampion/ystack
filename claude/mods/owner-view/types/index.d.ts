export type StripView = { stage: string; missing: string[] }
export type BriefStatus = 'idle' | 'writing' | 'ready' | 'error'
export type BriefView = { status: BriefStatus; text: string; at: number; isAway: boolean }

declare module 'claude-code' {
  interface PluginState {
    'owner-view': {
      caption: StateFamily<string>
      strip: Shaped<StripView>
      brief: Shaped<BriefView>
    }
  }
}
