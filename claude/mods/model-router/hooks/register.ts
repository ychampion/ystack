import type { EngineInterface, PluginOptions, Register } from 'claude-code'

import { DEFAULT_KEYWORDS, EFFORTS, classify, decide, type Classified, type Config, type Decision, type Effort, type Request, type Tier } from './route.ts'

function list(v: unknown, d = ''): string[] {
  const raw = Array.isArray(v) ? v.join(',') : typeof v === 'string' ? v : d
  return raw
    .split(/[,\n]/)
    .map(s => s.trim())
    .filter(Boolean)
}

const effortOf = (v: unknown, d: Effort): Effort => ((EFFORTS as readonly unknown[]).includes(v) ? (v as Effort) : d)
const str = (v: unknown, d: string) => (typeof v === 'string' && v.trim() ? v.trim() : d)

function configFrom(o: PluginOptions): Config {
  return {
    strongModel: str(o.strongModel, ''),
    fastModel: str(o.fastModel, 'haiku'),
    highEffort: effortOf(o.highEffort, 'high'),
    mediumEffort: effortOf(o.mediumEffort, 'medium'),
    keywords: {
      high: [...DEFAULT_KEYWORDS.high, ...list(o.highKeywords)],
      medium: [...DEFAULT_KEYWORDS.medium, ...list(o.mediumKeywords)],
      fast: [...DEFAULT_KEYWORDS.fast, ...list(o.fastKeywords)],
    },
    unmatched: o.unmatched === 'leave' ? 'leave' : 'medium',
    bannedModels: list(o.bannedModels),
    fallbackModels: list(o.fallbackModels, 'opus, sonnet, haiku'),
    genericTypes: list(o.genericTypes, 'general-purpose'),
    enforce: o.enforce === true,
    classifier: o.classifier === 'haiku' ? 'haiku' : 'off',
  }
}

/** The values the Agent tool's `model` parameter accepts in this engine build (its input schema). */
const AGENT_TOOL_MODELS = ['sonnet', 'opus', 'haiku', 'fable'] as const

type Logged ={ task: string; model: string; effort: string; why: string }

// Per session. `pending` carries the decision made at the Agent tool call to the spawn it starts.
let log: Logged[] = []
let pending = new Map<string, Decision>()

const keyOf = (description: string, prompt: string) => `${description}\u0000${prompt}`

function remember(task: string, d: Decision) {
  log.push({ task: task.slice(0, 60) || '(no description)', model: d.model ?? 'as asked', effort: d.effort ?? 'as asked', why: d.why })
  if (log.length > 20) log = log.slice(-20)
}

/** Keyword rules, then (only when set to `haiku`) one small-model call for a task no rule matched. */
async function classifyTask($: EngineInterface, req: Request, cfg: Config): Promise<Classified> {
  const c = classify(req.description, req.prompt, req.subagentType, cfg.keywords)
  if (c.tier || cfg.classifier === 'off') return c
  try {
    const text = `Task: ${req.description}\n\n${req.prompt.slice(0, 2000)}`
    const label = await $.model.classify(text, ['high', 'medium', 'fast'], { model: cfg.fastModel })
    if (label === 'high' || label === 'medium' || label === 'fast') return { tier: label as Tier, why: 'the classifier model picked it' }
  } catch {
    // A failed classifier call leaves the task unmatched.
  }
  return c
}

async function noteMain($: EngineInterface, text: string) {
  try {
    await $.session.append({ message: { type: 'user', content: [{ type: 'text', text }] } } as never)
  } catch {
    // The note is a courtesy: the decision log still has it.
  }
}

const strongText = (cfg: Config) => cfg.strongModel || "the session's model"

function tableText(cfg: Config): string {
  const lines = [
    'model-router table:',
    `- high (verification, review, security, unknown-cause bugs, concurrency, parsers): ${strongText(cfg)} at ${cfg.highEffort} effort`,
    `- medium (builds, features, refactors, tests, docs, research, fix rounds): ${strongText(cfg)} at ${cfg.mediumEffort} effort`,
    `- fast (locating files, log triage, classification, reshaping data, polling): ${cfg.fastModel}`,
    `- no rule matched: ${cfg.unmatched === 'medium' ? 'medium' : 'left as asked'}`,
    `Banned models: ${cfg.bannedModels.join(', ') || 'none'} (replaced with ${cfg.strongModel || 'the first allowed of'} ${cfg.strongModel ? `or, if banned, the first allowed of ` : ''}${cfg.fallbackModels.join(', ')}). Routed agent types: ${cfg.genericTypes.join(', ') || 'none'} (others keep their own model and effort${cfg.enforce ? ', except that enforce is on' : ''}).`,
    `Explicit choices: ${cfg.enforce ? 'overridden (enforce is on)' : 'kept'}. Classifier: ${cfg.classifier === 'off' ? 'off, keyword rules only, nothing is sent anywhere' : `${cfg.fastModel}, for tasks no rule matched`}.`,
    '',
  ]
  if (log.length === 0) lines.push('No subagents routed this session yet.')
  else {
    lines.push(`Last ${log.length} decisions:`)
    for (const l of log) lines.push(`- ${l.task}: ${l.model}, effort ${l.effort} (${l.why})`)
  }
  return lines.join('\n')
}

export const register: Register = (on, options) => {
  const cfg = configFrom(options)

  on('session.start', async ($, e, next) => {
    log = []
    pending = new Map()
    await $.command.register({ name: 'model-router', description: 'Show the subagent routing table and the last 20 decisions' })
    return next(e)
  })

  on('command.run', { command: 'model-router' }, async () => ({ text: tableText(cfg) }))

  // The Agent tool call: the one place the caller's effort is visible and can be set.
  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    if (e.tool !== 'Agent') return next(e)
    const req: Request = {
      description: e.description,
      prompt: e.prompt,
      ...(e.subagent_type !== undefined ? { subagentType: e.subagent_type } : {}),
      ...(e.model !== undefined ? { model: e.model } : {}),
      ...(e.effort !== undefined ? { effort: e.effort } : {}),
      fork: e.subagent_type === 'fork',
    }
    const d = decide(req, await classifyTask($, req, cfg), cfg)
    remember(e.description, d)
    pending.set(e.tool_use_id, d)
    pending.set(keyOf(e.description, e.prompt), d)
    // The Agent tool's schema takes only these aliases; a full id is applied at agent.spawn instead.
    const toolModel = d.model && (AGENT_TOOL_MODELS as readonly string[]).includes(d.model) ? (d.model as (typeof AGENT_TOOL_MODELS)[number]) : undefined
    try {
      const ran = await next({ ...e, ...(d.effort ? { effort: d.effort } : {}), ...(toolModel ? { model: toolModel } : {}) })
      if (!d.note || ran.deny !== undefined) return ran
      return { ...ran, context: [...(ran.context ?? []), d.note] }
    } finally {
      pending.delete(e.tool_use_id)
      pending.delete(keyOf(e.description, e.prompt))
    }
  })

  // Every spawn: applies the model (any alias or full id). Spawns with no Agent tool call
  // (workflow agents, other plugins) are decided here; their effort can't be set.
  on('agent.spawn', async ($, e, next) => {
    if (e.fork || e.resume) return next(e)
    let d = pending.get(e.tool_use_id) ?? pending.get(keyOf(e.description, e.prompt))
    if (!d) {
      const req: Request = { description: e.description, prompt: e.prompt, subagentType: e.subagentType, ...(e.model !== undefined ? { model: e.model } : {}) }
      d = decide(req, await classifyTask($, req, cfg), cfg)
      const { effort: _unsettable, ...rest } = d
      d = { ...rest, why: d.effort ? `${d.why}; effort can't be set on this kind of spawn` : d.why }
      remember(e.description, d)
      if (d.note) await noteMain($, d.note)
    }
    return next(d.model && d.model !== e.model ? { ...e, model: d.model } : e)
  })
}
