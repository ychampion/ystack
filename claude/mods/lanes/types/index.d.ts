export type LaneRow = { label: string; branch: string; worktree: string; files: string[]; isMe: boolean }
export type LanesView = { repo: string; sessions: LaneRow[] }

declare module 'claude-code' {
  interface PluginState {
    lanes: {
      view: Shaped<LanesView>
    }
  }
}
