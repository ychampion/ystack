import { expect, test } from 'claude-code/testing'
import type { AgentSpawnInput, On } from 'claude-code'

// Wiring tests. One stand-in beneath the plugin plays the Agent tool and records the input it got
// (model and effort as the plugin left them); another plays the engine's spawn for $.agent.spawn
// calls (workflow agents, other plugins). Every model call is recorded.

type Seen = { tool: { model?: string; effort?: string; subagent_type?: string }[]; spawns: AgentSpawnInput[]; modelCalls: string[] }

function host(on: On, classifyAnswer?: string): Seen {
  const seen: Seen = { tool: [], spawns: [], modelCalls: [] }
  on('tool.call', async ($, e) => {
    if (e.tool === 'Agent') seen.tool.push({ model: e.model, effort: e.effort, subagent_type: e.subagent_type })
    return { result: 'started' }
  })
  on('agent.spawn', async ($, e) => {
    seen.spawns.push({ ...e })
    return { model: e.model ?? 'parent-model', agentId: `a${seen.spawns.length}` }
  })
  on('model.classify', async () => {
    seen.modelCalls.push('classify')
    return { value: classifyAnswer as never }
  })
  on('model.complete', async () => {
    seen.modelCalls.push('complete')
    return { value: { isAnswered: true, text: 'medium', usage: {} } as never }
  })
  on('model.fork', async () => {
    seen.modelCalls.push('fork')
    return { value: { isAnswered: true, text: 'medium', usage: {} } as never }
  })
  return seen
}

const agent = (description: string, prompt: string, extra: object = {}) => ({ tool: 'Agent', description, prompt, ...extra }) as never
const show = async ($: { command: { run: (a: never) => Promise<{ text?: string }> } }) => (await $.command.run({ command: 'model-router', args: '' } as never)).text ?? ''

test('by default the model is left to the session: a review gets high effort, a build medium; a lookup the fast model', async ($, on) => {
  const seen = host(on)
  await $.tool.call(agent('Review the payment diff', 'Look for bugs.'))
  await $.tool.call(agent('Implement CSV export', 'Add an export button.'))
  await $.tool.call(agent('Locate the token refresh code', 'Return paths only.'))
  expect(seen.tool).toEqual([
    { model: undefined, effort: 'high', subagent_type: undefined },
    { model: undefined, effort: 'medium', subagent_type: undefined },
    { model: 'haiku', effort: undefined, subagent_type: undefined },
  ])
})

test('a banned model is replaced with the first allowed fallback and the dispatcher gets a note naming it', { options: { bannedModels: 'sonnet' } }, async ($, on) => {
  const seen = host(on)
  const r = await $.tool.call(agent('Locate config files', 'Paths only.', { model: 'sonnet' }))
  expect(seen.tool[0]?.model).toBe('opus')
  expect(r.context?.join('\n')).toContain('sonnet is banned')
})

test('an explicit model and effort that are allowed are kept', async ($, on) => {
  const seen = host(on)
  await $.tool.call(agent('Review the auth diff', 'Careful.', { model: 'haiku', effort: 'low' }))
  expect(seen.tool[0]).toMatchObject({ model: 'haiku', effort: 'low' })
  // A named, non-generic agent type keeps its own model and effort.
  await $.tool.call(agent('Locate files', 'Paths.', { subagent_type: 'my-team:helper' }))
  expect(seen.tool[1]).toEqual({ model: undefined, effort: undefined, subagent_type: 'my-team:helper' })
  // general-purpose is routed.
  await $.tool.call(agent('Locate files', 'Paths.', { subagent_type: 'general-purpose' }))
  expect(seen.tool[2]?.model).toBe('haiku')
})

test('enforce: the table wins over explicit choices', { options: { enforce: true, strongModel: 'opus' } }, async ($, on) => {
  const seen = host(on)
  await $.tool.call(agent('Review the auth diff', 'Careful.', { model: 'haiku', effort: 'low' }))
  expect(seen.tool[0]).toMatchObject({ model: 'opus', effort: 'high' })
  await $.tool.call(agent('Locate files', 'Paths.', { subagent_type: 'my-team:helper' }))
  expect(seen.tool[1]?.model).toBe('haiku')
})

test('model ids and efforts come from settings; a full id is applied at the spawn', { options: { strongModel: 'some-strong-model-1', fastModel: 'some-fast-model-1', mediumEffort: 'high' } }, async ($, on) => {
  const seen = host(on)
  await $.tool.call(agent('Refactor the cart', 'Keep behaviour.'))
  // A full id is not one of the Agent tool's aliases: the tool input keeps no model, the spawn gets it.
  expect(seen.tool[0]).toMatchObject({ model: undefined, effort: 'high' })
  await $.agent.spawn({ prompt: 'Yes or no.', description: 'Poll the deploy' } as never)
  await $.agent.spawn({ prompt: 'x', description: 'Refactor the cart' } as never)
  expect(seen.spawns.map(s => s.model)).toEqual(['some-fast-model-1', 'some-strong-model-1'])
})

test('classifier off: nothing is sent to any model, even for a task no rule matches', async ($, on) => {
  const seen = host(on)
  await $.tool.call(agent('Summarize the meeting', 'Notes attached.'))
  await $.agent.spawn({ prompt: 'Notes attached.', description: 'Summarize the meeting' } as never)
  expect(seen.modelCalls).toEqual([])
  expect(seen.tool[0]).toMatchObject({ model: undefined, effort: 'medium' })
})

test('classifier off with unmatched=leave: an unmatched task is left alone', { options: { unmatched: 'leave' } }, async ($, on) => {
  const seen = host(on)
  await $.tool.call(agent('Summarize the meeting', 'Notes attached.'))
  expect(seen.tool[0]).toMatchObject({ model: undefined, effort: undefined })
  expect(seen.modelCalls).toEqual([])
})

test('classifier haiku: asked only for a task no rule matches', { options: { classifier: 'haiku' } }, async ($, on) => {
  const seen = host(on, 'fast')
  await $.tool.call(agent('Review the diff', 'x'))
  expect(seen.modelCalls).toEqual([])
  await $.tool.call(agent('Summarize the meeting', 'Notes attached.'))
  expect(seen.modelCalls).toEqual(['classify'])
  expect(seen.tool[1]?.model).toBe('haiku')
})

test('a spawn with no Agent tool call (a workflow or another plugin) still gets its model', { options: { bannedModels: 'sonnet' } }, async ($, on) => {
  const seen = host(on)
  await $.agent.spawn({ prompt: 'Check every handler.', description: 'Security audit', model: 'sonnet' } as never)
  expect(seen.spawns[0]?.model).toBe('opus')
  expect(await show($ as never)).toContain("effort can't be set on this kind of spawn")
})

test('/model-router shows the table and the last 20 decisions', async ($, on) => {
  host(on)
  const empty = await show($ as never)
  expect(empty).toContain('high (verification, review')
  expect(empty).toContain('No subagents routed this session yet.')
  for (let i = 0; i < 22; i++) await $.tool.call(agent(`Implement step ${i}`, 'x'))
  const text = await show($ as never)
  expect(text).toContain('Last 20 decisions:')
  expect(text).toContain('Implement step 21: as asked, effort medium (medium: "implement" in the description)')
  expect(text).not.toContain('Implement step 1:')
})

test('review: a banned strongModel falls back, at the tool call and at the spawn', { options: { strongModel: 'opus', bannedModels: 'opus', fallbackModels: 'opus, sonnet' } }, async ($, on) => {
  const seen = host(on)
  const r = await $.tool.call(agent('Implement X', 'Build it.', { model: 'opus' }))
  expect(seen.tool[0]).toMatchObject({ model: 'sonnet', effort: 'medium' })
  expect(r.context?.join('\n')).toContain('runs on sonnet instead')
  await $.agent.spawn({ prompt: 'x', description: 'Review the diff' } as never)
  expect(seen.spawns.at(-1)?.model).toBe('sonnet')
})
