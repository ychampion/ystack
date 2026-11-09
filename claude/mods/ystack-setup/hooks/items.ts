// The recommended settings, as data. Add an item by adding one entry to ITEMS.
// Nothing here touches a file: it reads a Ctx and says what is in place and what Apply would write.

export type Settings = Record<string, unknown>

export type Ctx = {
  /** The user settings file, parsed; {} when there is none. */
  settings: Settings
  /** Agent files by name (`opus-medium`), their text, undefined when absent. */
  agents: Record<string, string | undefined>
  /** The main loop's model id (`claude-...`), undefined when it could not be told. */
  mainModel?: string
  haikuModel?: string
}

export type State = 'done' | 'missing' | 'partial' | 'differs' | 'unknown' | 'info'
export type Status = { state: State; note: string }

/** What the user picked beyond the ticks: the subagent model, and which differing agent files to replace. */
export type Choice = { pick: string; replace: string[] }

export type Change =
  | { kind: 'setting'; path: string[]; value: unknown }
  | { kind: 'agent'; name: string; text: string }

export type Item = {
  id: string
  title: string
  what: (ctx: Ctx) => string
  why: string
  gain?: string
  /** `info` items show something to copy and are never ticked. */
  kind: 'apply' | 'info'
  status: (ctx: Ctx) => Status
  /** What Apply writes for this item; empty when nothing is needed or it cannot be done. */
  changes: (ctx: Ctx, choice: Choice) => Change[]
  /** Extra lines the pane and the check report show (a diff, a command). */
  details?: (ctx: Ctx) => string[]
}

export const SUBAGENT_MODELS = ['opus', 'opus[1m]', 'sonnet'] as const
/** The pick that leaves an existing CLAUDE_CODE_SUBAGENT_MODEL as it is. */
export const KEEP = 'keep'
export const DOCS = 'https://github.com/ychampion/ystack/blob/main/claude/README.md'

/** The pick in force: the user's, else "keep current" when a value exists, else opus. */
export const effectivePick = (ctx: Ctx, pick: string): string => (pick !== '' ? pick : get(ctx.settings, ['env', 'CLAUDE_CODE_SUBAGENT_MODEL']) !== undefined ? KEEP : 'opus')

export const get = (o: unknown, path: string[]): unknown => path.reduce<unknown>((v, k) => (v !== null && typeof v === 'object' ? (v as Record<string, unknown>)[k] : undefined), o)

const settingStatus = (ctx: Ctx, path: string[], want: unknown): Status => {
  const have = get(ctx.settings, path)
  if (have === want) return { state: 'done', note: 'in place' }
  if (have === undefined) return { state: 'missing', note: 'not set' }
  return { state: 'partial', note: `set to ${JSON.stringify(have)}` }
}

const compactItem = (id: string, title: string, model: (c: Ctx) => string | undefined, size: number, why: string, gain?: string): Item => ({
  id,
  title,
  what: c => `modelSettings.${model(c) ?? '<model id>'}.autoCompactWindow: ${size} in your user settings`,
  why,
  gain,
  kind: 'apply',
  status: c => {
    const m = model(c)
    if (m === undefined) {
      return id === 'main-compact' && c.mainModel !== undefined
        ? { state: 'info', note: `skipped: your main model is a Haiku model (${c.mainModel}); the Haiku item covers it` }
        : { state: 'unknown', note: "couldn't tell the model id" }
    }
    const s = settingStatus(c, ['modelSettings', m, 'autoCompactWindow'], size)
    return { ...s, note: `${s.note} (${m})` }
  },
  changes: c => {
    const m = model(c)
    if (m === undefined) return []
    return settingStatus(c, ['modelSettings', m, 'autoCompactWindow'], size).state === 'done' ? [] : [{ kind: 'setting', path: ['modelSettings', m, 'autoCompactWindow'], value: size }]
  },
})

// ---- agent files ----

export const AGENTS: Record<string, { effort: string; description: string; body: string }> = {
  'opus-medium': {
    effort: 'medium',
    description:
      'Default builder for delegated work (Opus at medium effort). Use for features, whole products from a spec, multi-file changes, refactors, tests, research, docs, fix rounds from a review, bugs whose cause is known, and ordinary code reviews.',
    body: 'You are a capable engineering agent working from a brief. Do the whole task at the scope asked. Read code before changing it. Verify with a real check (build, test or run) before you report. End your report with a section "Assumptions I made".',
  },
  'opus-high': {
    effort: 'high',
    description:
      'Verification and edge-case agent (Opus at high effort). Use for security, bugs whose cause is unknown, concurrency, storage and low-level code, parsers, reviews of that kind of code, and a retry after opus-medium under-delivered or a thin medium review.',
    body: 'You are a careful engineering agent for work where mistakes hide in edge cases. Reproduce a bug before fixing it, write a test that fails on the unfixed code, and check edge cases. Verify with a real check before you report. End your report with a section "Assumptions I made".',
  },
}

export const agentText = (name: string): string => {
  const a = AGENTS[name]
  if (a === undefined) throw new Error(`unknown agent ${name}`)
  return `---\nname: ${name}\ndescription: ${a.description}\nmodel: opus\neffort: ${a.effort}\nautoCompactWindow: 250000\n---\n\n${a.body}\n`
}

export const frontmatter = (text: string): Record<string, string> => {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  const out: Record<string, string> = {}
  for (const line of (m?.[1] ?? '').split(/\r?\n/)) {
    const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line)
    if (kv?.[1] !== undefined) out[kv[1]] = (kv[2] ?? '').trim().replace(/^["']|["']$/g, '')
  }
  return out
}

/** `same` (byte for byte, line endings aside), `ok` (theirs, but effort and window match), `differs`, or `missing`. */
export const agentState = (ctx: Ctx, name: string): 'same' | 'ok' | 'differs' | 'missing' => {
  const text = ctx.agents[name]
  if (text === undefined) return 'missing'
  if (text.replace(/\r\n/g, '\n').trim() === agentText(name).trim()) return 'same'
  const fm = frontmatter(text)
  return fm.effort === AGENTS[name]?.effort && fm.autoCompactWindow === '250000' ? 'ok' : 'differs'
}

/** A plain line diff (longest common subsequence), `-` for yours and `+` for ours, capped. */
export const lineDiff = (mine: string, theirs: string, cap = 30): string[] => {
  const a = mine.replace(/\r\n/g, '\n').trimEnd().split('\n')
  const b = theirs.replace(/\r\n/g, '\n').trimEnd().split('\n')
  const L: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) L[i]![j] = a[i] === b[j] ? L[i + 1]![j + 1]! + 1 : Math.max(L[i + 1]![j]!, L[i]![j + 1]!)
  const out: string[] = []
  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      i++
      j++
    } else if (j < b.length && (i >= a.length || L[i]![j + 1]! >= L[i + 1]![j]!)) out.push(`+ ${b[j++]}`)
    else out.push(`- ${a[i++]}`)
  }
  return out.length > cap ? [...out.slice(0, cap), `... ${out.length - cap} more lines`] : out
}

const agentsItem: Item = {
  id: 'agents',
  title: 'Two subagent types that compact at 250k',
  what: () => 'agents/opus-medium.md (effort medium) and agents/opus-high.md (effort high), both model opus, autoCompactWindow 250000',
  why: 'Medium is the default builder and reviewer; high is for security, concurrency, parsers and bugs whose cause is unknown. Both compact long runs early.',
  gain: `Measured on one heavy user's logs, not yours: replaying long subagent runs at 250k cut their context re-reads by 26%; compacting at 250k instead of 400k cut subagent usage ~14% over 14 days. Details: ${DOCS}`,
  kind: 'apply',
  status: c => {
    const states = Object.keys(AGENTS).map(n => [n, agentState(c, n)] as const)
    const parts = states.map(([n, s]) => `${n}: ${s === 'same' ? 'in place' : s === 'ok' ? 'yours, settings match' : s === 'differs' ? 'yours, differs' : 'missing'}`)
    const note = parts.join('; ')
    if (states.every(([, s]) => s === 'same' || s === 'ok')) return { state: 'done', note }
    if (states.some(([, s]) => s === 'differs')) return { state: 'differs', note }
    if (states.every(([, s]) => s === 'missing')) return { state: 'missing', note }
    return { state: 'partial', note }
  },
  changes: (c, choice) =>
    Object.keys(AGENTS)
      .filter(n => {
        const s = agentState(c, n)
        return s === 'missing' || (s === 'differs' && choice.replace.includes(n))
      })
      .map(n => ({ kind: 'agent', name: n, text: agentText(n) })),
  details: c =>
    Object.keys(AGENTS)
      .filter(n => agentState(c, n) === 'differs')
      .flatMap(n => [`${n}.md differs from the recommended file (- yours, + recommended). Tick "replace ${n}" to overwrite it:`, ...lineDiff(c.agents[n] ?? '', agentText(n))]),
}

// ---- the list ----

export const ITEMS: Item[] = [
  compactItem(
    'main-compact',
    'Auto-compact the main model at 400k',
    c => (c.mainModel !== undefined && /haiku/i.test(c.mainModel) ? undefined : c.mainModel),
    400_000,
    'With a 1M window, Claude otherwise runs up to the limit; every call re-reads the whole context.',
  ),
  agentsItem,
  compactItem('haiku-compact', 'Haiku compacts at 100k', c => c.haikuModel, 100_000, 'Keeps Haiku prompts under its higher-price tier and cache reads cheap.'),
  {
    id: 'teams-off',
    title: 'Agent teams off',
    what: () => 'env CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=0 in your user settings',
    why: "Each teammate's idle ping re-reads the lead's whole context. Background subagents send one notification when done.",
    gain: `Measured on one heavy user's logs, not yours: 360 idle pings cost 32% of one 9-day session. Details: ${DOCS}`,
    kind: 'apply',
    status: c => settingStatus(c, ['env', 'CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS'], '0'),
    changes: c => (settingStatus(c, ['env', 'CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS'], '0').state === 'done' ? [] : [{ kind: 'setting', path: ['env', 'CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS'], value: '0' }]),
  },
  {
    id: 'subagent-model',
    title: 'Subagents default to the strong model',
    what: () => 'env CLAUDE_CODE_SUBAGENT_MODEL in your user settings, to the model you pick below',
    why: "Subagents that don't name a model use this one: a stronger model costs more per token but gets more right the first time.",
    kind: 'apply',
    status: c => {
      const have = get(c.settings, ['env', 'CLAUDE_CODE_SUBAGENT_MODEL'])
      return have === undefined ? { state: 'missing', note: 'not set (optional)' } : { state: 'done', note: `set to ${JSON.stringify(have)}` }
    },
    changes: (c, choice) => {
      const pick = effectivePick(c, choice.pick)
      return pick === KEEP || get(c.settings, ['env', 'CLAUDE_CODE_SUBAGENT_MODEL']) === pick ? [] : [{ kind: 'setting', path: ['env', 'CLAUDE_CODE_SUBAGENT_MODEL'], value: pick }]
    },
  },
  {
    id: 'companions',
    title: 'Install the companion mods',
    what: () => 'context-meter (context size, handoffs) and ystack-stats (usage numbers)',
    why: 'They show where the tokens go, so you can see these settings pay off.',
    kind: 'info',
    status: c => {
      const enabled = (get(c.settings, ['enabledPlugins']) ?? {}) as Record<string, unknown>
      const have = ['context-meter', 'ystack-stats'].filter(m => Object.entries(enabled).some(([k, v]) => k.startsWith(`${m}@`) && v === true))
      return { state: 'info', note: have.length === 0 ? 'not installed' : `installed: ${have.join(', ')}` }
    },
    changes: () => [],
    details: () => ['Copy and run:', '/plugin install context-meter --marketplace ychampion/ystack', '/plugin install ystack-stats --marketplace ychampion/ystack'],
  },
]

/** A model id from what /model shows: `claude-x[1m]` -> `claude-x`; an alias resolves through its env var. */
export const modelId = (raw: string | undefined, aliases: Record<string, string | undefined>): string | undefined => {
  if (raw === undefined) return undefined
  const s = raw.trim().replace(/\[[^\]]*\]$/, '')
  if (/^claude-[\w.-]+$/.test(s)) return s
  const via = aliases[s.toLowerCase()]?.trim().replace(/\[[^\]]*\]$/, '')
  return via !== undefined && /^claude-[\w.-]+$/.test(via) ? via : undefined
}
