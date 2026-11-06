// Which standing requirements a subagent brief lacks, by the kind of agent it goes to.

export type AgentKind = 'skip' | 'locator' | 'reviewer' | 'builder'

export function kindOf(subagentType: string): AgentKind {
  const t = subagentType.toLowerCase()
  if (t === 'fork' || t.startsWith('claude-security:') || t === 'codex:codex-rescue' || t === 'statusline-setup') return 'skip'
  if (t === 'haiku-max' || t === 'explore' || t === 'claude-code-guide' || t.endsWith(':explore')) return 'locator'
  if (/review|analy[sz]er|sentinel|oracle|guardian|hunter|validator|strategist|specialist|critic|verif|^plan$|code-explorer|code-architect|researcher/.test(t))
    return 'reviewer'
  return 'builder'
}

export type Requirement = { id: string; text: string }

const VERIFY: Requirement = {
  id: 'verify',
  text: 'Verify your work with a real check (build, tests, or a real run) and report what it showed; never claim success without one.',
}
const OUTPUT: Requirement = {
  id: 'output',
  text: 'Write long output (logs, full reports) to a file and return its path plus a short summary.',
}
const ASSUMPTIONS: Requirement = {
  id: 'assumptions',
  text: "End your report with a section titled 'Assumptions I made' (one bullet each; 'None' if none).",
}
const LOOP_CAP: Requirement = {
  id: 'loop-cap',
  text: 'If the same failure repeats after two fix attempts, stop and report what you tried instead of looping.',
}
const INBOX: Requirement = {
  id: 'inbox',
  text: "Settle technical choices yourself. If you hit a product, business, pricing, naming or scope call that is the owner's to make, don't stop: call mcp__decision-inbox__ask (it returns at once) with plain-words context for someone who doesn't read code, take your recommended default, note it, and continue.",
}

export function missing(prompt: string, kind: AgentKind, hasInbox: boolean): Requirement[] {
  if (kind === 'skip') return []
  const out: Requirement[] = []
  const has = (re: RegExp) => re.test(prompt)
  if (!has(/write [^.\n]*(output|report|log)s?[^.\n]* to a file|return (its|the) path/i)) out.push(OUTPUT)
  if (kind === 'locator') return out
  if (!has(/assumptions i made/i)) out.push(ASSUMPTIONS)
  if (kind === 'builder') {
    if (!has(/\bverif(y|ication)\b|run the tests|bun (run )?test|\btsc\b|cargo (test|check)|pytest|playwright|real check/i)) out.push(VERIFY)
    if (!has(/stop after|at most \d|iteration cap|fix (cycles|attempts)|stop and report/i)) out.push(LOOP_CAP)
    if (hasInbox && !has(/decision-inbox/i)) out.push(INBOX)
  }
  return out
}

export function footer(reqs: readonly Requirement[]): string {
  return `\n\n---\nStanding requirements:\n${reqs.map(r => `- ${r.text}`).join('\n')}`
}
