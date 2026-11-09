// Classifies a subagent task from its description and prompt, and decides its model and effort. Pure: no `$`.

export type Tier = 'high' | 'medium' | 'fast'
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
export type Effort = (typeof EFFORTS)[number]

export type Config = {
  /** Model for the high and medium tiers; empty leaves the model to the session (only effort is set). */
  strongModel: string
  fastModel: string
  highEffort: Effort
  mediumEffort: Effort
  keywords: Record<Tier, string[]>
  /** What a task no rule matches gets: the medium tier, or left as asked. */
  unmatched: 'medium' | 'leave'
  bannedModels: string[]
  /** Tried in order when a banned model must be replaced and strongModel is unset or banned too. */
  fallbackModels: string[]
  /** Agent types the router may route; any other named type counts as an explicit choice. */
  genericTypes: string[]
  enforce: boolean
  classifier: 'off' | 'haiku'
}

/**
 * Keywords match whole words; a trailing `*` lets the word go on (`verif*` matches verify, verification).
 * The words of a phrase may be separated by any spaces or hyphens.
 */
export const DEFAULT_KEYWORDS: Record<Tier, string[]> = {
  high: [
    'verif*',
    'review*',
    'audit*',
    'security',
    'exploit*',
    'threat model*',
    'pentest*',
    'root cause',
    'investigat*',
    'diagnos*',
    'debug*',
    'concurren*',
    'thread safe*',
    'mutex*',
    'parser*',
    'parsing',
    'edge case*',
    'strateg*',
  ],
  medium: [
    'build*',
    'implement*',
    'feature*',
    'refactor*',
    'test',
    'tests',
    'testing',
    'docs',
    'document*',
    'readme*',
    'research*',
    'fix',
    'fixes',
    'fixing',
    'migrat*',
    'scaffold*',
    'port',
    'porting',
    'write',
    'writing',
    'add',
    'create',
    'update',
    'rename',
    'cleanup',
    'clean up',
  ],
  fast: [
    'locate',
    'find where',
    'find file*',
    'find the file*',
    'where is',
    'where are',
    'grep*',
    'search for',
    'list files',
    'log triage',
    'triage',
    'ci log*',
    'extract error*',
    'classif*',
    'categoriz*',
    'label*',
    'reshape*',
    'convert json',
    'to csv',
    'json to',
    'poll*',
    'is ci green',
    'check if ci',
    'deploy done',
  ],
}

/**
 * Always the high tier, whatever else the task says (a lookup, a build, a fix round): security work,
 * crashes, races, flaky tests, and bugs whose cause is not known. Not a setting.
 */
export const ALWAYS_HIGH = [
  'secret*',
  'credential*',
  'token leak*',
  'leaked token*',
  'injection*',
  'sqli',
  'xss',
  'csrf',
  'ssrf',
  'auth',
  'authn',
  'authz',
  'authenticat*',
  'authoriz*',
  'oauth*',
  'permission*',
  'vuln*',
  'cve',
  'cves',
  'sanitiz*',
  'sanitis*',
  'crypto*',
  'crash*',
  'race',
  'races',
  'racy',
  'race condition*',
  'deadlock*',
  'flaky',
  'flakiness',
  'regression triage',
  'unknown cause',
  'cause unknown',
  'cause is unknown',
  'still unknown',
  'not sure why',
  'unsure why',
  'no idea why',
  "don't know why",
  'do not know why',
  'unclear why',
  'intermittent*',
]

/** Fix rounds go to the medium tier even though they mention a review, unless an ALWAYS_HIGH term is present. */
const FIX_ROUND = ['fix round*', 'review findings', 'findings list', 'address review*', 'apply review*', 'apply the review', 'address the review', 'known cause', 'cause is known', 'fix the findings']

const PROMPT_CHARS = 600

const patterns = new Map<string, RegExp | undefined>()
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The keyword as a whole word or phrase: no letter or digit right before it, nor after it unless it ends in `*`. */
function hit(text: string, kw: string): boolean {
  if (!patterns.has(kw)) {
    const k = kw.trim().toLowerCase()
    const open = k.endsWith('*')
    const words = (open ? k.slice(0, -1) : k).trim().split(/\s+/).filter(Boolean)
    patterns.set(kw, words.length === 0 ? undefined : new RegExp(`(?<![a-z0-9])${words.map(escapeRe).join('[\\s-]+')}${open ? '' : '(?![a-z0-9])'}`))
  }
  const re = patterns.get(kw)
  return re !== undefined && re.test(text)
}

export type Classified = { tier?: Tier; why: string }

const label = (kw: string) => kw.trim().replace(/\s*\*$/, '')

/**
 * Keyword rules over the description and agent type, and the start of the prompt. Strict priority:
 * an ALWAYS_HIGH term, then a fix round (medium), then any high keyword, then medium, then fast.
 */
export function classify(description: string, prompt: string, subagentType: string | undefined, keywords: Record<Tier, string[]>): Classified {
  const head = `${description} ${(subagentType ?? '').replace(/[-_:]/g, ' ')}`.toLowerCase()
  const body = prompt.slice(0, PROMPT_CHARS).toLowerCase()
  const first = (list: string[]): string | undefined => {
    for (const kw of list) if (hit(head, kw)) return `"${label(kw)}" in the description`
    for (const kw of list) if (hit(body, kw)) return `"${label(kw)}" in the prompt`
    return undefined
  }
  const always = first(ALWAYS_HIGH)
  if (always) return { tier: 'high', why: always }
  const fix = first(FIX_ROUND)
  if (fix) return { tier: 'medium', why: `fix round (${fix})` }
  for (const tier of ['high', 'medium', 'fast'] as const) {
    const why = first(keywords[tier])
    if (why) return { tier, why }
  }
  return { why: 'no rule matched' }
}

export function isBanned(model: string | undefined, cfg: Config): boolean {
  if (!model) return false
  const m = model.toLowerCase()
  return cfg.bannedModels.some(b => b && m.includes(b.toLowerCase()))
}

export type Request = { description: string; prompt: string; subagentType?: string; model?: string; effort?: string; fork?: boolean }

export type Decision = {
  /** The model to set, or undefined to leave the request's. */
  model?: string
  /** The effort to set, or undefined to leave the request's. */
  effort?: Effort
  tier?: Tier
  why: string
  /** A line for the loop that dispatched, when a banned model was replaced. */
  note?: string
}

/** What the router does with one spawn, given its classification. */
export function decide(req: Request, c: Classified, cfg: Config): Decision {
  if (req.fork) return { why: 'a fork always runs on its parent model' }
  const allowed = (m: string | undefined): m is string => m !== undefined && m.trim() !== '' && !isBanned(m, cfg)
  const firstFallback = cfg.fallbackModels.find(allowed)
  // Unset: undefined, the model is left to the session. Set but banned: the first allowed fallback.
  const strong = cfg.strongModel.trim() === '' ? undefined : allowed(cfg.strongModel) ? cfg.strongModel : firstFallback
  const fast = allowed(cfg.fastModel) ? cfg.fastModel : strong
  const banned = isBanned(req.model, cfg)
  // A banned request needs a model named outright: the session's own might be the banned one.
  const replacement = banned ? (strong ?? firstFallback) : undefined
  const note = banned
    ? replacement
      ? `model-router: ${req.model} is banned in its settings, so this agent runs on ${replacement} instead.`
      : `model-router: ${req.model} is banned in its settings, but every fallback model is banned too, so it was left as asked.`
    : undefined
  const named = req.subagentType !== undefined && req.subagentType !== '' && !cfg.genericTypes.some(t => t.toLowerCase() === (req.subagentType as string).toLowerCase())
  const tier = c.tier ?? (cfg.unmatched === 'medium' ? 'medium' : undefined)
  let model: string | undefined
  let effort: Effort | undefined
  if (tier === 'high') {
    model = strong
    effort = cfg.highEffort
  } else if (tier === 'medium') {
    model = strong
    effort = cfg.mediumEffort
  } else if (tier === 'fast') model = fast
  const why = c.tier ? `${tier}: ${c.why}` : tier ? `${tier}: no rule matched, unmatched tasks get medium` : 'no rule matched; left as asked'
  if (!cfg.enforce) {
    if (named) {
      // The caller picked an agent type: its definition's model and effort stand.
      return { ...(replacement ? { model: replacement } : {}), ...(tier ? { tier } : {}), why: `${req.subagentType} chosen by the caller; kept${banned ? ', banned model replaced' : ''}`, ...(note ? { note } : {}) }
    }
    if (req.model && !banned) model = undefined
    if (req.effort) effort = undefined
  }
  // A banned request always gets the replacement, whatever the tier.
  if (banned) model = replacement
  const keptParts = cfg.enforce ? [] : [req.model && !banned ? 'model' : '', req.effort ? 'effort' : ''].filter(Boolean)
  const kept = keptParts.length > 0 ? ` (kept the caller's ${keptParts.join(' and ')})` : ''
  return {
    ...(model !== undefined && model !== req.model ? { model } : {}),
    ...(effort !== undefined && effort !== req.effort ? { effort } : {}),
    ...(tier ? { tier } : {}),
    why: why + kept,
    ...(note ? { note } : {}),
  }
}
