// Pure logic for prompt-diet: measuring, deciding what to defer, compacting the skill listing. No engine calls.

/** Tools that stay in front whatever the history says. */
export const CORE_TOOLS = new Set([
  'Bash', 'PowerShell', 'Read', 'Edit', 'Write', 'Grep', 'Glob', 'Agent', 'Skill', 'ToolSearch',
  'AskUserQuestion', 'TaskStop', 'Monitor', 'WebFetch', 'WebSearch',
])
export const FIND_SKILL = 'mcp__prompt-diet__find_skill'

/** Reminders that make something reachable or carry content Claude asked for: never dropped. */
const PROTECTED_TYPES = new Set(['skill_listing', 'deferred_tools_delta', 'agent_listing_delta', 'mcp_instructions_delta', 'file', 'edited_text_file', 'queued_command', 'nested_memory', 'instructions', 'compact_file_reference', 'directory'])
export const isProtectedAttachment = (type: string) => PROTECTED_TYPES.has(type) || /listing|delta|file|memory|instruction|command|mention/i.test(type)

export const estimateTokens = (chars: number) => Math.round(chars / 4)
export const k = (tokens: number) => (tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : String(tokens))

/** One session's use, as stored under `usage:<sessionId>`. */
export type Usage = { at: number; tools: Record<string, number>; skills: Record<string, number> }

/** What this session decided, frozen when it first needed it, stored under `plan:<sessionId>`. */
export type Plan = {
  at: number
  /** How many earlier sessions the history held (at most `unusedSessions`). */
  historyCount: number
  recentTools: string[]
  recentSkills: string[]
  /** Tools put behind ToolSearch with /diet defer. */
  defer: string[]
  /** Reminder types left out with /diet drop. */
  drop: string[]
  /** /diet restore: automatic deferral and skill compaction off for this session. */
  isRestored: boolean
}

/** Freezes the recent-use sets from the last `n` earlier sessions. */
export function freezePlan(history: readonly (Usage & { id: string })[], sessionId: string, n: number, now: number): Plan {
  const last = history
    .filter(h => h.id !== sessionId)
    .sort((a, b) => b.at - a.at)
    .slice(0, n)
  const tools = new Set<string>()
  const skills = new Set<string>()
  for (const h of last) {
    for (const t of Object.keys(h.tools)) tools.add(t)
    for (const s of Object.keys(h.skills)) skills.add(s)
  }
  return { at: now, historyCount: last.length, recentTools: [...tools].sort(), recentSkills: [...skills].sort(), defer: [], drop: [], isRestored: false }
}

export type ToolFacts = { tool: string; providerPlugin: string; isDeferred: boolean }

/** Auto-defer: an MCP or plugin tool, not core, unused in each of the last `n` sessions, once `n` sessions of history exist. */
export function shouldAutoDefer(t: ToolFacts, plan: Plan, n: number): boolean {
  if (t.isDeferred || CORE_TOOLS.has(t.tool) || t.tool === FIND_SKILL) return false
  if (t.providerPlugin === 'engine') return false
  if (plan.isRestored || plan.historyCount < n) return false
  return !plan.recentTools.includes(t.tool)
}

export type SkillEntry = { id: string; label: string; description: string }
export type Listing = { head: string[]; entries: SkillEntry[] }

/** Reads the skill listing reminder: a header, then `- name: description` entries (descriptions may run on). */
export function parseListing(text: string): Listing {
  const head: string[] = []
  const entries: SkillEntry[] = []
  for (const line of text.split('\n')) {
    const m = /^- (.+?)(?:: (.*))?$/.exec(line)
    if (m) {
      const label = (m[1] ?? '').trim()
      entries.push({ id: label.split(' ')[0] ?? label, label, description: (m[2] ?? '').trim() })
      continue
    }
    const last = entries[entries.length - 1]
    if (last && line.trim() !== '') last.description = `${last.description}\n${line}`.trim()
    else if (!last) head.push(line)
  }
  return { head, entries }
}

export const COMPACT_NOTE =
  `Skills listed by name only work exactly the same with the Skill tool. To read what one does, call ${FIND_SKILL} with a few words (or the name).`

/** Keeps full entries for recently used skills; the rest become name-only. Nothing is removed. */
export function compactListing(text: string, keep: ReadonlySet<string>): string {
  const { head, entries } = parseListing(text)
  if (entries.length === 0) return text
  const body = entries.map(e => (e.description && !keep.has(e.id) ? `- ${e.label}` : `- ${e.label}${e.description ? `: ${e.description}` : ''}`))
  return [...head, ...body, '', COMPACT_NOTE].join('\n')
}

/** Ranks skills for a query: name matches first, then description matches. */
export function findSkills(entries: readonly SkillEntry[], query: string, limit = 10): SkillEntry[] {
  const words = query.toLowerCase().split(/[^a-z0-9:_-]+/).filter(w => w.length > 1)
  if (words.length === 0) return entries.slice(0, limit)
  const scored = entries
    .map(e => {
      const id = e.id.toLowerCase()
      const d = e.description.toLowerCase()
      let score = 0
      for (const w of words) {
        if (id === w) score += 10
        else if (id.includes(w)) score += 4
        if (d.includes(w)) score += 1
      }
      return { e, score }
    })
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score || a.e.id.localeCompare(b.e.id))
  return scored.slice(0, limit).map(s => s.e)
}

export function formatFound(found: readonly SkillEntry[], query: string): string {
  if (found.length === 0) return `No skill matches "${query}". Try other words; every skill in the listing can still be called by name with the Skill tool.`
  return found.map(e => `- ${e.id}: ${e.description || '(this session’s listing gave no description; call it with the Skill tool to read it)'}`).join('\n')
}

export type Row = { kind: 'section' | 'context' | 'reminder' | 'tool' | 'skill'; name: string; chars: number; count: number }

const KIND_LABEL: Record<Row['kind'], string> = {
  section: 'system prompt',
  context: 'context',
  reminder: 'reminder',
  tool: 'tool description',
  skill: 'skill entry',
}
export const labelOf = (r: Row) => `${r.name} (${KIND_LABEL[r.kind]}${r.count > 1 ? ` ×${r.count}` : ''})`

/** Largest first; returns the top rows and what the rest add up to. */
export function rank(rows: readonly Row[], top: number): { shown: Row[]; restCount: number; restChars: number; totalChars: number } {
  const counted = rows.filter(r => r.kind !== 'skill') // skill entries are inside the listing's reminder row
  const sorted = [...rows].filter(r => r.chars > 0).sort((a, b) => b.chars - a.chars)
  const shown = sorted.slice(0, top)
  const rest = sorted.slice(top).filter(r => r.kind !== 'skill')
  return {
    shown,
    restCount: rest.length,
    restChars: rest.reduce((n, r) => n + r.chars, 0),
    totalChars: counted.reduce((n, r) => n + r.chars, 0),
  }
}
