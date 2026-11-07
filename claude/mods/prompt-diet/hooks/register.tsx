import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { DietView } from '../types'
import {
  CORE_TOOLS,
  FIND_SKILL,
  type Plan,
  type Row,
  type SkillEntry,
  type Usage,
  compactListing,
  estimateTokens,
  findSkills,
  formatFound,
  freezePlan,
  isProtectedAttachment,
  k,
  labelOf,
  parseListing,
  rank,
  shouldAutoDefer,
} from './diet.ts'

const PANE = 'diet'
const KEEP_SESSIONS = 60
const CACHE_NOTE = 'Applies from your next message. That one message re-sends Claude’s instructions without the prompt cache, so it costs more once.'

const view = atom(
  { plugin: 'prompt-diet', key: 'view' } as const,
  { rows: [], totalTokens: 0, restCount: 0, restTokens: 0, deferredCount: 0, used: [], changes: [], unused: [] } as DietView,
  { shape: 'view-1' },
)

let autoDefer = false
let unusedSessions = 20
let compactSkills = false

// What each request carries, as the hooks saw it (refilled after a reload: the engine asks again).
const rows = new Map<string, Row>()
const tools = new Map<string, { providerPlugin: string; isDeferred: boolean; chars: number }>()
let catalog: SkillEntry[] = []

const put = (r: Row) => rows.set(`${r.kind}:${r.name}`, r)

// The session's frozen plan and its own usage, kept in $.store so a reload answers exactly as before.
let planP: Promise<Plan> | undefined
let usageP: Promise<{ key: string; u: Usage }> | undefined

async function loadPlan($: EngineInterface): Promise<Plan> {
  const sid = await $.session.id()
  const key = `plan:${sid}`
  const stored = (await $.store.get(key)) as Plan | undefined
  if (stored && Array.isArray(stored.recentTools)) return stored
  const keys = await $.store.keys()
  const history: (Usage & { id: string })[] = []
  for (const kk of keys) {
    if (!kk.startsWith('usage:')) continue
    const u = (await $.store.get(kk)) as Usage | undefined
    if (u && typeof u.at === 'number') history.push({ ...u, id: kk.slice(6) })
  }
  const plan = freezePlan(history, sid, unusedSessions, await $.clock.now())
  await $.store.set(key, plan)
  // Keep the store small: the newest sessions' usage and plans only.
  const old = history.sort((a, b) => b.at - a.at).slice(KEEP_SESSIONS)
  for (const h of old) {
    await $.store.delete(`usage:${h.id}`)
    await $.store.delete(`plan:${h.id}`)
  }
  return plan
}

async function plan($: EngineInterface): Promise<Plan> {
  if (!planP) planP = loadPlan($).catch(err => ((planP = undefined), Promise.reject(err)))
  return planP
}

async function savePlan($: EngineInterface, next: Plan) {
  planP = Promise.resolve(next)
  await $.store.set(`plan:${await $.session.id()}`, next)
}

async function loadUsage($: EngineInterface): Promise<{ key: string; u: Usage }> {
  const key = `usage:${await $.session.id()}`
  const u = (await $.store.get(key)) as Usage | undefined
  return { key, u: u && typeof u.at === 'number' ? u : { at: await $.clock.now(), tools: {}, skills: {} } }
}

async function noteUse($: EngineInterface, tool: string, skill: string | undefined) {
  if (!usageP) usageP = loadUsage($).catch(err => ((usageP = undefined), Promise.reject(err)))
  const { key, u } = await usageP
  u.tools[tool] = (u.tools[tool] ?? 0) + 1
  if (skill) u.skills[skill] = (u.skills[skill] ?? 0) + 1
  await $.store.set(key, u)
}

async function isDeferredByPlan($: EngineInterface, tool: string, providerPlugin: string, isDeferred: boolean): Promise<boolean> {
  if (CORE_TOOLS.has(tool) || tool === FIND_SKILL) return false
  const p = await plan($)
  if (p.defer.includes(tool)) return true
  return autoDefer && shouldAutoDefer({ tool, providerPlugin, isDeferred }, p, unusedSessions)
}

async function buildView($: EngineInterface): Promise<DietView> {
  const p = await plan($)
  const { shown, restCount, restChars, totalChars } = rank([...rows.values()], 30)
  const deferredCount = [...tools.values()].filter(t => t.isDeferred).length
  const usage = usageP ? (await usageP).u : undefined
  const used = usage
    ? [
        `Tools: ${Object.entries(usage.tools).sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t} ${n}`).join(', ') || 'none yet'}`,
        `Skills: ${Object.entries(usage.skills).map(([s, n]) => `${s} ${n}`).join(', ') || 'none yet'}`,
      ]
    : ['No tools used yet this session.']
  const changes: string[] = []
  if (p.defer.length) changes.push(`Loaded on demand by you: ${p.defer.join(', ')}`)
  if (p.drop.length) changes.push(`Reminders left out: ${p.drop.join(', ')}`)
  if (p.isRestored) changes.push('Restored: automatic changes are off for this session.')
  if (autoDefer && !p.isRestored)
    changes.push(
      p.historyCount < unusedSessions
        ? `Auto-defer waits for ${unusedSessions} sessions of history (has ${p.historyCount}).`
        : 'Auto-defer is on for plugin and MCP tools unused lately.',
    )
  if (compactSkills && !p.isRestored) changes.push(`Skill listing compacted: full text kept for ${p.recentSkills.length} recently used skills; the rest by name (find_skill reads them).`)
  const unused =
    p.historyCount > 0
      ? [...tools.entries()]
          .filter(([t, f]) => f.providerPlugin !== 'engine' && !CORE_TOOLS.has(t) && t !== FIND_SKILL && !p.recentTools.includes(t) && !f.isDeferred)
          .map(([t]) => t)
          .slice(0, 15)
      : []
  return {
    rows: shown.map(r => ({ label: labelOf(r), tokens: estimateTokens(r.chars) })),
    totalTokens: estimateTokens(totalChars),
    restCount,
    restTokens: estimateTokens(restChars),
    deferredCount,
    used,
    changes,
    unused,
  }
}

async function runDiet($: EngineInterface, args: string): Promise<string> {
  const [verb = '', ...rest] = args.trim().split(/\s+/)
  const target = rest.join(' ').trim()
  const p = await plan($)

  if (verb === 'defer') {
    if (!target) return 'Say which tool: /diet defer <tool name>.'
    if (CORE_TOOLS.has(target) || target === FIND_SKILL) return `${target} is a core tool and always stays loaded.`
    const t = tools.get(target)
    if (!t) return `No tool called ${target} has been described in this session. The /diet pane lists them.`
    if (t.isDeferred) return `${target} already loads on demand.`
    await savePlan($, { ...p, defer: [...new Set([...p.defer, target])] })
    $.ui.invalidate('tool.describe')
    return `${target} now loads on demand: Claude can still find and use it through tool search. ${CACHE_NOTE}`
  }

  if (verb === 'drop') {
    if (!target) return 'Say which reminder: /diet drop <reminder type>. The /diet pane lists them.'
    if (isProtectedAttachment(target)) return `The ${target} reminder tells Claude what it can reach (or carries content it asked for), so it is never left out.`
    if (!rows.has(`reminder:${target}`)) return `No reminder of type ${target} has been sent in this session. The /diet pane lists them.`
    await savePlan($, { ...p, drop: [...new Set([...p.drop, target])] })
    $.ui.invalidate('prompt.attachment')
    return `The ${target} reminder is left out for the rest of this session. ${CACHE_NOTE}`
  }

  if (verb === 'restore') {
    const hadAuto = (autoDefer || compactSkills) && !p.isRestored
    if (!hadAuto && p.defer.length === 0 && p.drop.length === 0) return 'Nothing to restore: this session sends everything as Claude Code built it.'
    await savePlan($, { ...p, defer: [], drop: [], isRestored: true })
    $.ui.invalidate('tool.describe')
    $.ui.invalidate('prompt.attachment')
    return `Everything is back as Claude Code built it, for this session. ${CACHE_NOTE}`
  }

  if (verb !== '') return 'Use /diet to see what each turn sends, /diet defer <tool>, /diet drop <reminder type>, or /diet restore.'
  return '' // no subcommand: the caller opens the pane
}

export const register: Register = (on, options) => {
  autoDefer = options.autoDefer === true
  compactSkills = options.compactSkills === true
  unusedSessions = typeof options.unusedSessions === 'number' && options.unusedSessions >= 1 ? Math.floor(options.unusedSessions) : 20

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'diet',
      description: 'What each turn sends to Claude, largest first; `defer <tool>`, `drop <reminder>`, `restore`',
      argumentHint: '[defer <tool> | drop <reminder> | restore]',
    })
    if (compactSkills) {
      await $.tool.register({
        name: 'find_skill',
        description:
          'Find a skill by what it does. Returns matching skill names with their full descriptions, for skills the listing shows by name only. Then call the Skill tool with the name.',
        inputSchema: {
          type: 'object',
          properties: { query: { type: 'string', description: 'A few words about the task, or a skill name' } },
          required: ['query'],
        },
        isDeferred: false,
      })
    }
    try {
      await plan($) // freeze this session's decisions before the first request
    } catch {
      // the hooks below decide nothing until a plan exists
    }
    return next(e)
  })

  // Measure: system prompt sections, context blocks, reminders, tool descriptions. Observed, never changed here.
  on('prompt.compose', async ($, e, next) => {
    const r = await next(e)
    for (const s of r.sections) put({ kind: 'section', name: s.id, chars: s.text.length, count: 1 })
    return r
  }).catch(($, e, next) => next(e))

  on('prompt.context', async ($, e, next) => {
    const r = await next(e)
    for (const b of r.blocks) put({ kind: 'context', name: b.name, chars: b.text.length, count: 1 })
    return r
  }).catch(($, e, next) => next(e))

  on('prompt.attachment', async ($, e, next) => {
    const r = await next(e)
    const text = r.text ?? ''
    if (e.type === 'skill_listing' && text) {
      catalog = parseListing(text).entries
      for (const s of catalog) put({ kind: 'skill', name: s.id, chars: s.label.length + s.description.length + 4, count: 1 })
    }
    const p = await plan($)
    let out: string | null = r.text
    if (p.drop.includes(e.type) && !isProtectedAttachment(e.type)) out = null
    else if (e.type === 'skill_listing' && compactSkills && !p.isRestored && text) out = compactListing(text, new Set(p.recentSkills))
    if (e.agentId === undefined) {
      const key = `reminder:${e.type}`
      const prev = rows.get(key)
      put({ kind: 'reminder', name: e.type, chars: (prev?.chars ?? 0) + (out ?? '').length, count: (prev?.count ?? 0) + 1 })
    }
    return out === r.text ? r : { text: out }
  }).catch(($, e, next) => next(e))

  on('tool.describe', async ($, e, next) => {
    const r = await next(e)
    const wasDeferred = r.isDeferred === true || (r.isDeferred === undefined && e.isDeferred === true)
    const isDeferred = wasDeferred || (await isDeferredByPlan($, e.tool, e.provider.plugin, wasDeferred))
    tools.set(e.tool, { providerPlugin: e.provider.plugin, isDeferred, chars: r.description.length })
    put({ kind: 'tool', name: e.tool, chars: isDeferred ? 0 : r.description.length, count: 1 })
    return isDeferred && !wasDeferred ? { ...r, isDeferred: true } : r
  }).catch(($, e, next) => next(e))

  // Usage: every tool call, and the skill a Skill call names, counted per session.
  on('tool.call', async ($, e, next) => {
    try {
      await noteUse($, e.tool, e.tool === 'Skill' ? String((e as { skill?: unknown }).skill ?? '') || undefined : undefined)
    } catch {
      // counting never blocks a tool
    }
    return next(e)
  })

  on('tool.call', { tool: /^mcp__prompt-diet__find_skill$/ }, async ($, e) => {
    const query = String((e as { query?: unknown }).query ?? '').trim()
    if (catalog.length === 0) return { result: 'The skill listing has not been seen yet in this session. Call the Skill tool with the skill name.' }
    return { result: formatFound(findSkills(catalog, query), query) }
  })

  on('command.run', { command: 'diet' }, async ($, e) => {
    const said = await runDiet($, e.args)
    if (said) return { text: said }
    const v = await buildView($)
    await update($, view, () => v)
    await $.ui.open({ id: PANE, title: 'Prompt diet' })
    return { text: `About ${k(v.totalTokens)} tokens go with every turn (estimate). Details in the pane.` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const v = await read($, view)
    return (
      <Box flexDirection="column">
        <Text bold>What each turn sends: about {k(v.totalTokens)} tokens</Text>
        <Text dimColor>Estimate: characters ÷ 4. Tool rows count description text only.</Text>
        {v.rows.map(r => (
          <Text>
            {k(r.tokens).padStart(6)}  {r.label}
          </Text>
        ))}
        {v.restCount > 0 && (
          <Text dimColor>
            {k(v.restTokens).padStart(6)}  {v.restCount} smaller items
          </Text>
        )}
        <Text dimColor>{v.deferredCount} tools load on demand (only their names are sent).</Text>
        <Text bold>Used this session</Text>
        {v.used.map(u => (
          <Text>{u}</Text>
        ))}
        {v.unused.length > 0 && <Text bold>Plugin and MCP tools in front but unused lately</Text>}
        {v.unused.length > 0 && <Text>{v.unused.join(', ')}</Text>}
        {v.changes.length > 0 && <Text bold>Changes this session</Text>}
        {v.changes.map(c => (
          <Text>{c}</Text>
        ))}
        <Text dimColor>{'/diet defer <tool> · /diet drop <reminder> · /diet restore. Nothing is ever removed: deferred tools and listed skills stay usable.'}</Text>
      </Box>
    )
  })
}
