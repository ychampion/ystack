export type LiveChoice = {
  /**
   * This session's own theme, by id; null where the session chose none. Absent, the session follows the default every
   * session shares (kept in the store).
   */
  session?: string | null
  /** A theme shown for a look only, until it is applied or the look ends. */
  preview?: string
  /** The card shows above the prompt: the surface draws no placed rows yet. */
  cardInBand?: boolean
  /** The placed card was put away: the hook that draws it passes until the command shows it again. */
  cardAway?: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'living-themes': { choice: Shaped<LiveChoice> }
  }
}
