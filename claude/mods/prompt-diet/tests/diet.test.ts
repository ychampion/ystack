import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import {
  COMPACT_NOTE,
  type Usage,
  compactListing,
  findSkills,
  freezePlan,
  isProtectedAttachment,
  parseListing,
  shouldAutoDefer,
} from '../hooks/diet.ts'

const LISTING = [
  'The following skills are available for use with the Skill tool:',
  '',
  '- browse: Drive a real browser: open a page, click through a flow. (kit)',
  '- careful',
  '- claude-api: Reference for the API.',
  'TRIGGER when the prompt names the API.',
  '- marketing:seo-audit: Audit a site for search ranking problems.',
  '- taste (design-taste): Art direction for landing pages.',
].join('\n')

test('the skill listing parses, run-on descriptions included', async () => {
  const { head, entries } = parseListing(LISTING)
  expect(head[0]).toContain('The following skills')
  expect(entries.map(e => e.id)).toEqual(['browse', 'careful', 'claude-api', 'marketing:seo-audit', 'taste'])
  expect(entries[2]?.description).toBe('Reference for the API.\nTRIGGER when the prompt names the API.')
  expect(entries[4]?.label).toBe('taste (design-taste)')
})

test('compaction keeps every skill name and full text for recent ones', async () => {
  const out = compactListing(LISTING, new Set(['claude-api']))
  for (const name of ['- browse', '- careful', '- claude-api: Reference for the API.', '- marketing:seo-audit', '- taste (design-taste)']) expect(out).toContain(name)
  expect(out).toContain('TRIGGER when the prompt names the API.')
  expect(out).not.toContain('Drive a real browser')
  expect(out).not.toContain('search ranking')
  expect(out).toContain(COMPACT_NOTE)
  expect(parseListing(out).entries.length).toBe(5)
})

test('find_skill ranks by name, then by description', async () => {
  const { entries } = parseListing(LISTING)
  expect(findSkills(entries, 'seo')[0]?.id).toBe('marketing:seo-audit')
  expect(findSkills(entries, 'landing pages')[0]?.id).toBe('taste')
  expect(findSkills(entries, 'zzz')).toEqual([])
})

const U = (id: string, at: number, tools: string[]): Usage & { id: string } => ({
  id,
  at,
  tools: Object.fromEntries(tools.map(t => [t, 1])),
  skills: {},
})

test('auto-defer: only unused plugin and MCP tools, only with enough history, never core', async () => {
  const history = [U('s1', 1, ['mcp__a__x']), U('s2', 2, ['Bash']), U('s3', 3, ['Read']), U('now', 4, ['mcp__b__y'])]
  const plan = freezePlan(history, 'now', 3, 10)
  expect(plan.historyCount).toBe(3)
  expect(plan.recentTools).toEqual(['Bash', 'Read', 'mcp__a__x'])
  const mcp = (tool: string) => ({ tool, providerPlugin: 'mcp:server', isDeferred: false })
  expect(shouldAutoDefer(mcp('mcp__a__x'), plan, 3)).toBe(false)
  expect(shouldAutoDefer(mcp('mcp__b__y'), plan, 3)).toBe(true) // used only in this session: decisions are frozen at its start
  expect(shouldAutoDefer({ tool: 'Bash', providerPlugin: 'mcp:x', isDeferred: false }, plan, 3)).toBe(false)
  expect(shouldAutoDefer({ tool: 'NotebookEdit', providerPlugin: 'engine', isDeferred: false }, plan, 3)).toBe(false)
  expect(shouldAutoDefer(mcp('mcp__b__y'), plan, 20)).toBe(false) // not enough history
  expect(shouldAutoDefer(mcp('mcp__b__y'), { ...plan, isRestored: true }, 3)).toBe(false)
})

test('reminders that make things reachable are never dropped', async () => {
  for (const t of ['skill_listing', 'deferred_tools_delta', 'agent_listing_delta', 'file', 'nested_memory', 'queued_command']) expect(isProtectedAttachment(t)).toBe(true)
  expect(isProtectedAttachment('todo_reminder')).toBe(false)
  expect(isProtectedAttachment('total_tokens_reminder')).toBe(false)
})

// An in-memory $.store, session id and clock beneath the plugin, standing for the engine.
function engine(on: On, seed: Record<string, unknown> = {}) {
  const store = new Map<string, unknown>(Object.entries(seed))
  const invalidated: string[] = []
  on('session.id', () => ({ value: 'now' }))
  on('clock.now', () => ({ value: 100 }))
  on('store.get', (_, e) => ({ value: store.get(e.key) }))
  on('store.set', (_, e) => {
    store.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  on('store.delete', (_, e) => {
    store.delete(e.key)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...store.keys()] }))
  on('ui.invalidate', (_, e) => {
    invalidated.push(String((e as { event?: unknown }).event))
    return { value: undefined }
  })
  return { store, invalidated }
}

const MCP = { plugin: 'mcp:server', tier: 'user' } as const

test('tool calls and skills are counted per session', async ($, on) => {
  const { store } = engine(on)
  on('tool.call', () => ({ result: {} }))
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await $.tool.call({ tool: 'Skill', skill: 'browse' })
  await $.tool.call({ tool: 'Skill', skill: 'browse' })
  const u = store.get('usage:now') as Usage
  expect(u.tools).toEqual({ Bash: 1, Skill: 2 })
  expect(u.skills).toEqual({ browse: 2 })
})

test('autoDefer moves an unused MCP tool behind tool search and leaves core and used ones', { options: { autoDefer: true, unusedSessions: 2 } }, async ($, on) => {
  engine(on, { 'usage:a': { at: 1, tools: { mcp__s__used: 1 }, skills: {} }, 'usage:b': { at: 2, tools: { Read: 3 }, skills: {} } })
  on('tool.describe', (_, e) => ({ description: e.description }))
  const unused = await $.tool.describe({ tool: 'mcp__s__unused', description: 'Unused tool.', provider: MCP } as Parameters<typeof $.tool.describe>[0])
  const used = await $.tool.describe({ tool: 'mcp__s__used', description: 'Used tool.', provider: MCP } as Parameters<typeof $.tool.describe>[0])
  const core = await $.tool.describe({ tool: 'Bash', description: 'Shell.', provider: { plugin: 'engine', tier: 'core' } } as Parameters<typeof $.tool.describe>[0])
  expect(unused.isDeferred).toBe(true)
  expect(used.isDeferred).toBeUndefined()
  expect(core.isDeferred).toBeUndefined()
})

test('autoDefer is off by default', async ($, on) => {
  engine(on, { 'usage:a': { at: 1, tools: {}, skills: {} } })
  on('tool.describe', (_, e) => ({ description: e.description }))
  const r = await $.tool.describe({ tool: 'mcp__s__unused', description: 'Unused tool.', provider: MCP } as Parameters<typeof $.tool.describe>[0])
  expect(r.isDeferred).toBeUndefined()
})

test('/diet defer, refusal for core tools, and /diet restore', async ($, on) => {
  const { invalidated } = engine(on)
  on('tool.describe', (_, e) => ({ description: e.description }))
  type Cmd = Parameters<typeof $.command.run>[0]
  await $.tool.describe({ tool: 'mcp__s__big', description: 'A big tool.', provider: MCP } as Parameters<typeof $.tool.describe>[0])
  expect((await $.command.run({ command: 'diet', args: 'defer Bash' } as Cmd)).text).toContain('core tool')
  const said = (await $.command.run({ command: 'diet', args: 'defer mcp__s__big' } as Cmd)).text ?? ''
  expect(said).toContain('loads on demand')
  expect(said).toContain('without the prompt cache')
  expect(invalidated).toContain('tool.describe')
  const again = await $.tool.describe({ tool: 'mcp__s__big', description: 'A big tool.', provider: MCP } as Parameters<typeof $.tool.describe>[0])
  expect(again.isDeferred).toBe(true)
  expect((await $.command.run({ command: 'diet', args: 'restore' } as Cmd)).text).toContain('back as Claude Code built it')
  const after = await $.tool.describe({ tool: 'mcp__s__big', description: 'A big tool.', provider: MCP } as Parameters<typeof $.tool.describe>[0])
  expect(after.isDeferred).toBeUndefined()
})

test('compactSkills shortens the listing; find_skill returns the descriptions', { options: { compactSkills: true } }, async ($, on) => {
  engine(on, { 'usage:a': { at: 1, tools: { Skill: 1 }, skills: { 'claude-api': 1 } } })
  on('command.register', () => ({ value: { command: 'diet' } }))
  on('tool.register', () => ({ value: { tool: 'mcp__prompt-diet__find_skill' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.attachment', (_, e) => ({ text: e.text }))
  on('tool.call', () => ({ result: 'unanswered' }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const r = await $.prompt.attachment({ type: 'skill_listing', text: LISTING, origin: { kind: 'engine' } } as Parameters<typeof $.prompt.attachment>[0])
  expect(r.text).toContain('- claude-api: Reference for the API.')
  expect(r.text).not.toContain('Drive a real browser')
  const found = await $.tool.call({ tool: 'mcp__prompt-diet__find_skill', query: 'browser' } as unknown as Parameters<typeof $.tool.call>[0])
  expect(String(found.result)).toContain('browse: Drive a real browser')
})

test('the listing is untouched without compactSkills', async ($, on) => {
  engine(on)
  on('prompt.attachment', (_, e) => ({ text: e.text }))
  const r = await $.prompt.attachment({ type: 'skill_listing', text: LISTING, origin: { kind: 'engine' } } as Parameters<typeof $.prompt.attachment>[0])
  expect(r.text).toBe(LISTING)
})

test('/diet measures what was sent and /diet drop leaves a reminder out', async ($, on) => {
  engine(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'x'.repeat(4000), scope: 'shared' as const }] }))
  on('prompt.attachment', (_, e) => ({ text: e.text }))
  type Cmd = Parameters<typeof $.command.run>[0]
  type Att = Parameters<typeof $.prompt.attachment>[0]
  await $.prompt.compose({ model: 'm', promptModel: 'm', surfaces: [], tools: [], outputStyle: null, traits: [] } as Parameters<typeof $.prompt.compose>[0])
  await $.prompt.attachment({ type: 'todo_reminder', text: 'y'.repeat(400), origin: { kind: 'engine' } } as Att)
  expect((await $.command.run({ command: 'diet', args: '' } as Cmd)).text).toContain('About 1.1k tokens')
  expect((await $.command.run({ command: 'diet', args: 'drop skill_listing' } as Cmd)).text).toContain('never left out')
  expect((await $.command.run({ command: 'diet', args: 'drop todo_reminder' } as Cmd)).text).toContain('left out for the rest of this session')
  const r = await $.prompt.attachment({ type: 'todo_reminder', text: 'y'.repeat(400), origin: { kind: 'engine' } } as Att)
  expect(r.text).toBeNull()
})
