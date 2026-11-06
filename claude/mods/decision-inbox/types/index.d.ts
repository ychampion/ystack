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
  status: 'open' | 'answered'
  answer?: string
}

declare module 'claude-code' {
  interface PluginState {
    'decision-inbox': { list: Shaped<Decision[]> }
  }
}
