export type Decision = {
  id: string
  question: string
  options: string[]
  recommended: string
  context: string
  isBlocking: boolean
  sessionId: string
  agentId?: string
  from: string
  at: number
  /** dismissed: the owner kept the default with ✕; nothing is ever sent for it. */
  status: 'open' | 'answered' | 'dismissed'
  answer?: string
  /** When the owner answered; the asking session delivers entries that have it and no deliveredAt. */
  answeredAt?: number
  /** When the asking session handed the answer to itself or its subagent. */
  deliveredAt?: number
}

/** What this session asked, kept in its own state: the answer's message is built from it, not from the shared file. */
export type Asked = { question: string; options: string[]; agentId?: string }

declare module 'claude-code' {
  interface PluginState {
    'decision-inbox': { list: Shaped<Decision[]>; asked: Shaped<Record<string, Asked>> }
  }
}
