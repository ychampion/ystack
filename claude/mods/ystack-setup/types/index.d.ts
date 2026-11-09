/** One settings key an Apply set: what it wrote, and the raw text it replaced (absent when the key was new). */
export type SettingEdit = { path: string[]; after: string; before?: string; createdAt?: number }
/** One agent file an Apply wrote: what it wrote, and what was there before (absent when Apply created it). */
export type AgentEdit = { file: string; after: string; before?: string }
/** One Apply, kept in $.store so Undo survives a restart. */
export type ApplyRecord = { at: number; settingsFile: string; settings: SettingEdit[]; agents: AgentEdit[]; backups: string[] }

declare module 'claude-code' {
  interface PluginState {
    'ystack-setup': {
      ticks: Shaped<string[]>
      pick: Shaped<string>
      message: Shaped<string>
      /** How many Applies Undo can still revert; mirrors the store so the pane redraws. */
      undoable: Shaped<number>
    }
  }
}
