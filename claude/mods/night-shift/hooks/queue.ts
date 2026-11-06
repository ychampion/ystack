export type TaskStatus = 'pending' | 'running' | 'done' | 'blocked' | 'failed' | 'unclear' | 'skipped'
export type Task = {
  id: number
  text: string
  status: TaskStatus
  summary?: string
  startedAt?: number
  endedAt?: number
  costStart?: number
  cost?: number
  wrapUpSent?: boolean
}

export const STATUS_LINE = /NIGHT-SHIFT:\s*(done|blocked|failed)\b\s*[—–-]*\s*(.*)$/im

export function parseStatus(text: string): { status: 'done' | 'blocked' | 'failed'; summary: string } | undefined {
  const m = text.match(STATUS_LINE)
  if (!m?.[1]) return undefined
  return { status: m[1].toLowerCase() as 'done' | 'blocked' | 'failed', summary: (m[2] ?? '').trim().slice(0, 300) }
}

export function wrap(task: Task, index: number, total: number, budgetUsd: number, budgetHours: number): string {
  return [
    `Night-shift task ${index}/${total} (unattended: the owner is away).`,
    '',
    task.text,
    '',
    'How to run it:',
    '- Work as the orchestrator (delegate, verify, review) at full scope; do not shrink the task to finish faster.',
    "- Don't ask the owner. For an owner decision call mcp__decision-inbox__ask (it returns at once), take your recommended default, and continue.",
    '- Nothing outward-facing or destructive (push to main, deploy, publish, send outreach, delete data): do everything up to it, then record it in the inbox.',
    '- Changing a repo: use a branch or worktree of its own for this task.',
    `- Soft budget: about $${budgetUsd} and ${budgetHours}h. You'll get one wrap-up note if you pass it.`,
    '- When finished or truly blocked, end your final message with exactly one line:',
    '  NIGHT-SHIFT: done|blocked|failed — <one-sentence summary>',
  ].join('\n')
}

export function parseAt(arg: string, now: Date): number | undefined {
  const m = arg.match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return undefined
  const t = new Date(now)
  t.setHours(Number(m[1]), Number(m[2]), 0, 0)
  if (t.getTime() <= now.getTime()) t.setDate(t.getDate() + 1)
  return t.getTime()
}
