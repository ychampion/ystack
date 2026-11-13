// Pure logic: which shell commands made a commit, how a /why argument reads, and how a thread is shown.

/** What is kept for one commit Claude made: enough to explain it without the transcript. */
export type Thread = {
  sha: string
  repo: string
  subject: string
  at: number
  sessionId: string
  agentId?: string
  cwd: string
  prompts: string[]
  reasoning: string[]
  files: string[]
}

// `git commit`, also with options before the subcommand (`git -c x=y commit`, `git -C dir commit`).
const COMMIT = /\bgit\b((?:\s+-[cC]\s+(?:"[^"]*"|'[^']*'|\S+))*)\s+commit(?=\s|$)/

/** The repo folder a commit command ran in, if the command made a commit: `-C dir` wins over the session's folder. */
export function commitDir(command: string, cwd: string): string | undefined {
  const m = COMMIT.exec(command)
  if (!m) return undefined
  if (/\bcommit\b[^|;&]*--dry-run\b/.test(command)) return undefined
  const dir = /-C\s+("([^"]*)"|'([^']*)'|(\S+))/.exec(m[1] ?? '')
  const d = dir ? (dir[2] ?? dir[3] ?? dir[4] ?? '') : ''
  if (!d) return cwd
  if (/^([A-Za-z]:)?[\\/]/.test(d)) return d
  return `${cwd.replace(/[\\/]$/, '')}/${d}`
}

/** `src/a.ts:42`, `src/a.ts#L42`, `src/a.ts 42` or a bare path (whole file). */
export function parseTarget(arg: string): { file: string; line?: number } | undefined {
  const s = arg.trim().replace(/^["']|["']$/g, '')
  if (!s) return undefined
  const m = /^(.*?)(?:[:#]L?|\s+)(\d+)$/.exec(s)
  if (m && m[1]) return { file: m[1], line: Number(m[2]) }
  return { file: s }
}

const clip = (s: string, n: number) => {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

/** The last few things the person asked, newest last; empty and slash-command-only prompts left out. */
export function keepPrompts(prompts: readonly string[], text: string, max = 3): string[] {
  const t = text.trim()
  if (!t || /^\/\S+$/.test(t)) return [...prompts]
  return [...prompts, clip(t, 600)].slice(-max)
}

/** Claude's own words just before the commit: the last few non-empty assistant messages, newest last. */
export function lastReasoning(messages: readonly { role: string; text: string }[], max = 3, budget = 1800): string[] {
  const out: string[] = []
  let left = budget
  for (let i = messages.length - 1; i >= 0 && out.length < max && left > 80; i--) {
    const m = messages[i]
    if (!m || m.role !== 'assistant' || !m.text.trim()) continue
    const t = clip(m.text, Math.min(900, left))
    out.unshift(t)
    left -= t.length
  }
  return out
}

/** `git log -L` / blame output to commit ids, newest first, without repeats. */
export function shasIn(log: string): string[] {
  const seen = new Set<string>()
  for (const m of log.matchAll(/^([0-9a-f]{40})\b/gm)) {
    const sha = m[1] as string
    if (!/^0+$/.test(sha)) seen.add(sha)
  }
  return [...seen]
}

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10)

/** One commit, with its thread when Claude made it. */
export function show(c: { sha: string; subject: string; at: number; author: string }, t: Thread | undefined): string {
  const head = `${c.sha.slice(0, 8)}  ${day(c.at)}  ${c.author}  ${c.subject}`
  if (!t) return `${head}\n  (no thread: not made in a Claude session on this machine)`
  const lines = [head, `  thread: session ${t.sessionId}${t.agentId ? ` (subagent ${t.agentId})` : ''} in ${t.cwd}`]
  for (const p of t.prompts) lines.push(`  asked: ${p}`)
  for (const r of t.reasoning) lines.push(`  reasoning: ${r}`)
  lines.push(`  reopen: cd "${t.cwd}" then claude --resume ${t.sessionId}`)
  return lines.join('\n')
}
