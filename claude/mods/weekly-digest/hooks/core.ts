// Pure parts of the digest: the window, usage from transcript rows, and the markdown. No engine calls here.

export const DAY = 86_400_000
const BUCKET = 10 * 60_000 // active time is counted in 10-minute slots that had a reply

/** `/digest [days]`: a whole number from 1 to 90, else 7. */
export function parseDays(args: string): number {
  const v = Number.parseInt(args.trim(), 10)
  return Number.isFinite(v) && v >= 1 && v <= 90 ? v : 7
}

const pad = (v: number) => String(v).padStart(2, '0')
/** Local calendar date, YYYY-MM-DD. */
export function isoDay(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const human = (ms: number) => {
  const d = new Date(ms)
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

/** Usage and active time for one working folder. */
export type Usage = { units: number; slots: number[] }
/** Usage per working folder, plus the API message ids already counted (a reply's rows repeat its usage). */
export type UsageScan = { byCwd: Record<string, Usage>; seen: Set<string> }
export const emptyUsage = (): UsageScan => ({ byCwd: {}, seen: new Set() })

type RawUsage = {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
  cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number }
}
const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0)

/** Input-token equivalents: input 1, cache read 0.1, cache write 1.25 (5-minute) or 2 (1-hour), output 5. */
export function units(u: RawUsage): number {
  const w5 = n(u.cache_creation?.ephemeral_5m_input_tokens)
  const w1h = n(u.cache_creation?.ephemeral_1h_input_tokens)
  const other = Math.max(0, n(u.cache_creation_input_tokens) - w5 - w1h)
  return n(u.input_tokens) + 0.1 * n(u.cache_read_input_tokens) + 1.25 * (w5 + other) + 2 * w1h + 5 * n(u.output_tokens)
}

/** Folds transcript rows into the scan, keeping only replies inside [since, until). Unparseable rows are skipped. */
export function scanUsage(scan: UsageScan, text: string, since: number, until: number): UsageScan {
  for (const line of text.split('\n')) {
    if (!line.includes('"output_tokens"')) continue
    let row: { type?: string; timestamp?: string; cwd?: string; message?: { id?: string; model?: string; usage?: RawUsage } }
    try {
      row = JSON.parse(line) as typeof row
    } catch {
      continue
    }
    const msg = row.message
    if (row.type !== 'assistant' || !msg?.usage || msg.model === '<synthetic>' || typeof row.cwd !== 'string') continue
    const at = Date.parse(String(row.timestamp))
    if (!Number.isFinite(at) || at < since || at >= until) continue
    if (typeof msg.id === 'string') {
      if (scan.seen.has(msg.id)) continue
      scan.seen.add(msg.id)
    }
    const u = (scan.byCwd[row.cwd] ??= { units: 0, slots: [] })
    u.units += units(msg.usage)
    const slot = Math.floor(at / BUCKET)
    if (!u.slots.includes(slot)) u.slots.push(slot)
  }
  return scan
}

/** Hours of activity in a set of 10-minute slots, to the nearest half hour; any activity shows as at least half an hour. */
export const activeHours = (slots: number[]) => {
  const k = new Set(slots).size
  return k === 0 ? 0 : Math.max(0.5, Math.round((k * BUCKET) / 1_800_000) / 2)
}

/** "feat(api): add rate limits" -> "Add rate limits". */
export function plainSubject(s: string): string {
  const t = s.replace(/^(?:\w+)(?:\([^)]*\))?!?:\s+/, '').trim()
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : s.trim()
}

export const tokens = (v: number) => (v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v >= 1000 ? `${Math.round(v / 1000)}k` : String(Math.round(v)))

export type Commit = { hash: string; email: string; subject: string }
export type PullRequest = { number: number; title: string; isDraft?: boolean }
export type Branch = { name: string; ahead: number }
export type Decision = { id: string; question: string; recommended: string; sessionId: string; from: string; status: string }

export type RepoReport = {
  name: string
  path: string
  /** Commits on a remote (pushed), or on local branches when the repo has no remote. */
  commits: Commit[]
  hasRemote: boolean
  merged: PullRequest[]
  open: PullRequest[]
  branches: Branch[]
  uncommitted: number
  decisions: Decision[]
  usage: Usage
  /** Why GitHub PRs are missing for this repo, if they are. */
  prNote: string
}

/** Commits a merged PR already covers: a squash or merge subject that names it, or the same words as its title. */
export function uncovered(commits: Commit[], merged: PullRequest[]): Commit[] {
  const nums = new Set(merged.map(p => p.number))
  const titles = new Set(merged.map(p => p.title.trim().toLowerCase()))
  return commits.filter(c => {
    const ref = /\(#(\d+)\)\s*$/.exec(c.subject)
    if (ref && nums.has(Number(ref[1]))) return false
    return !titles.has(c.subject.trim().toLowerCase())
  })
}

const plural = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`
const MAX_LINES = 12

export type DigestInput = {
  since: number
  now: number
  days: number
  repos: RepoReport[]
  /** Usage in folders that are not git repos. */
  outside: Usage
  /** Open decisions no repo could be matched to. */
  otherDecisions: Decision[]
  notes: string[]
}

/** The digest as markdown, grouped by repo, costliest first. */
export function digestMarkdown(d: DigestInput): string {
  const repos = [...d.repos].sort((a, b) => b.usage.units - a.usage.units || b.commits.length - a.commits.length || a.name.localeCompare(b.name))
  const total = repos.reduce((s, r) => s + r.usage.units, 0) + d.outside.units
  const hours = activeHours([...repos.flatMap(r => r.usage.slots), ...d.outside.slots])
  const merged = repos.reduce((s, r) => s + r.merged.length, 0)
  const commits = repos.reduce((s, r) => s + r.commits.length, 0)
  const open = repos.reduce((s, r) => s + r.open.length, 0)
  const waiting = repos.reduce((s, r) => s + r.decisions.length, 0) + d.otherDecisions.length
  const share = (v: number) => (total > 0 ? `${Math.round((v / total) * 100)}%` : '0%')
  const out: string[] = [`# Digest: ${human(d.since)} to ${human(d.now)} (${plural(d.days, 'day')})`, '']
  if (repos.length === 0) out.push('No repos were touched in this period.', '')
  else
    out.push(
      `Across ${plural(repos.length, 'repo')}: ${plural(merged, 'merged PR')}, ${plural(commits, 'commit')}, ${plural(open, 'open PR')}, ` +
        `${plural(waiting, 'decision')} waiting on you. Usage: ${tokens(total)} input-token equivalents over about ${hours} active hours.`,
      '',
    )
  for (const r of repos) {
    out.push(`## ${r.name}`, '', `Folder: ${r.path}`, '')
    const rest = uncovered(r.commits, r.merged)
    out.push('**Shipped**', '')
    if (r.merged.length === 0 && r.commits.length === 0) out.push('- Nothing shipped.')
    else {
      out.push(`- ${plural(r.merged.length, 'merged PR')}, ${plural(r.commits.length, r.hasRemote ? 'pushed commit' : 'commit (no remote set up)', r.hasRemote ? 'pushed commits' : 'commits (no remote set up)')}.`)
      const lines = [...r.merged.map(p => `${plainSubject(p.title)} (#${p.number})`), ...rest.map(c => plainSubject(c.subject))]
      out.push(...lines.slice(0, MAX_LINES).map(l => `- ${l}`))
      if (lines.length > MAX_LINES) out.push(`- and ${lines.length - MAX_LINES} more`)
    }
    out.push('')
    const flight = [
      ...r.open.map(p => `Open PR #${p.number}: ${p.title}${p.isDraft ? ' (draft)' : ''}`),
      ...r.branches.map(b => `Branch ${b.name}: ${plural(b.ahead, 'commit')} not pushed`),
      ...(r.uncommitted > 0 ? [`${plural(r.uncommitted, 'file')} changed, not committed`] : []),
    ]
    if (flight.length > 0) out.push('**In flight**', '', ...flight.map(l => `- ${l}`), '')
    if (r.decisions.length > 0) out.push('**Needs you**', '', ...r.decisions.map(x => `- ${x.id}: ${x.question} (default: ${x.recommended})`), '')
    out.push('**Time and usage**', '', `- About ${activeHours(r.usage.slots)} active hours, ${tokens(r.usage.units)} input-token equivalents (${share(r.usage.units)} of the total).`, '')
    if (r.prNote) out.push(`_${r.prNote}_`, '')
  }
  if (d.outside.units > 0) out.push('## Outside any repo', '', `- About ${activeHours(d.outside.slots)} active hours, ${tokens(d.outside.units)} input-token equivalents (${share(d.outside.units)} of the total).`, '')
  if (d.otherDecisions.length > 0) out.push('## Other decisions waiting on you', '', ...d.otherDecisions.map(x => `- ${x.id}: ${x.question} (default: ${x.recommended}; from ${x.from})`), '')
  if (d.notes.length > 0) out.push('## Notes', '', ...d.notes.map(x => `- ${x}`), '')
  return `${out.join('\n').trimEnd()}\n`
}

/** The prompt for the optional polished update. The digest is data; the model writes only from it. */
export function polishPrompt(markdown: string): string {
  return (
    'Rewrite the work digest below as a short update for a team or investors: at most 10 lines, plain English, no jargon, ' +
    'most important outcomes first, no headings, no invented facts or numbers. Use only what the digest says.\n\n' +
    `<digest>\n${markdown}\n</digest>`
  )
}
