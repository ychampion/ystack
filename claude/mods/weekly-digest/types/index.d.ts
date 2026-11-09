/** The last digest this session wrote, as the pane shows it. */
export type Shown = {
  /** Where it was saved; '' when saving failed. */
  path: string
  markdown: string
  /** The model-written update, when polish is on and the call answered. */
  polished: string
  /** Why the polish was not added, when it was asked for. */
  polishNote: string
  /** The model the digest's text went to for the polish; '' when nothing was sent. */
  sentTo: string
}

declare module 'claude-code' {
  interface PluginState {
    'weekly-digest': { shown: Shaped<Shown> }
  }
}
