/** One session as the board shows it. */
export type BoardRow = {
  sessionId: string
  /** The last part of the session's working folder. */
  folder: string
  /** Its registry entry names a process that is alive on this machine now. */
  isRunning: boolean
  /** A registry entry is there but its process is gone (a crash or a kill left it behind). */
  isLeftOver: boolean
  /** busy or idle, as the running session reports it; '' when not running. */
  status: string
  /** Context size at its last reply, in tokens. */
  context: number
  /** Usage today in input-token equivalents, its subagents included. */
  usageToday: number
  /** Some of today's transcript could not be read yet, so usageToday is low. */
  isPartial: boolean
  /** When its transcript last changed (ms since epoch). */
  lastActiveAt: number
  /** Subagents running or finished in the last hour. */
  subagents: number
  /** Its last reply's text, on one line. */
  lastText: string
}

export type Board = {
  rows: BoardRow[]
  /** When the board was last read (ms since epoch); 0 before the first read. */
  at: number
  /** Why the last read found nothing, if it did. */
  note: string
}

declare module 'claude-code' {
  interface PluginState {
    'session-board': { board: Shaped<Board> }
  }
}
