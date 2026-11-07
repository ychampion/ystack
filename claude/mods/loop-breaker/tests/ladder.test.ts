import { expect, test } from 'claude-code/testing'

test('a failing command repeated: a note, then (model unknown) a stop that denies further calls', async ($, on) => {
  const written: string[] = []
  on('tool.call', () => ({ isError: true as const, result: 'Exit code 1', text: 'Exit code 1\nerror: cannot connect to db' }))
  on('env.get', () => ({ value: '/home/t' }))
  on('fs.write', (_, e) => {
    written.push((e as unknown as { path: string }).path)
    return { value: undefined }
  })
  on('session.root', () => ({ value: '/work/app' }))
  on('session.id', () => ({ value: 's1' }))
  on('clock.now', () => ({ value: 1_700_000_000_000 }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.notify', () => ({ value: { isSent: false, reason: 'no-surface' } }))

  const run = () => $.tool.call({ tool: 'Bash', command: 'bun test db', agentId: 'a1' })
  await run()
  await run()
  const third = await run()
  expect((third.context ?? []).join('\n')).toContain('Stop retrying the same thing')
  const fourth = await run()
  expect((fourth.context ?? []).join('\n')).toContain('you have been stopped')
  // the engine may hand the path on in the platform's own spelling
  expect(written.some(p => p.replace(/\\/g, '/').includes('/.claude/decision-inbox/D-'))).toBe(true)
  const fifth = await run()
  // a mod's deny reaches a direct $.tool.call as { deny }; the model reads it as an error result
  expect(fifth.deny ?? '').toContain('Do not call more tools')
})

test('the second opinion runs on the stuck loop\'s own model and effort, with no history', async ($, on) => {
  const asked: { model?: string; effort?: string; prompt?: string }[] = []
  on('tool.call', () => ({ isError: true as const, result: 'Exit code 1', text: 'Exit code 1\nerror: port 3000 in use' }))
  on('turn.step', async function* (_, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: null, usage: null } as never
  })
  on('model.complete', (_, e) => {
    asked.push(e as unknown as { model: string; effort?: string; prompt: string })
    return { value: { isAnswered: true, text: 'Likely another server is still running.', usage: { input_tokens: 1, output_tokens: 1 } } as never }
  })
  on('ui.toast', () => ({ value: undefined }))

  // the subagent's own request names its model and effort
  for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'claude-test-9', effort: 'high', messageCount: 1, agentId: 'a2' })) void _
  const run = () => $.tool.call({ tool: 'Bash', command: 'bun run dev', agentId: 'a2' })
  await run()
  await run()
  await run() // first trigger: a note
  const second = await run() // second trigger: the second opinion
  expect(asked.length).toBe(1)
  expect(asked[0]?.model).toBe('claude-test-9')
  expect(asked[0]?.effort).toBe('high')
  expect(asked[0]?.prompt ?? '').toContain('port 3000 in use')
  expect((second.context ?? []).join('\n')).toContain('SECOND OPINION')
  expect((second.context ?? []).join('\n')).toContain('Likely another server is still running.')
})

test("the owner's answer in the decision inbox lifts the stop; a background notification does not", async ($, on) => {
  on('tool.call', () => ({ isError: true as const, result: 'Exit code 1', text: 'Exit code 1\nerror: cannot connect to db' }))
  on('env.get', () => ({ value: '/home/t' }))
  on('fs.write', () => ({ value: undefined }))
  on('session.root', () => ({ value: '/work/app' }))
  on('session.id', () => ({ value: 's1' }))
  on('clock.now', () => ({ value: 1_700_000_000_000 }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.notify', () => ({ value: { isSent: false, reason: 'no-surface' } }))
  on('prompt.submit', (_, e) => ({ text: e.text }) as never)
  const submit =(origin: unknown) => $.prompt.submit({ text: 'x', origin, wait: false } as Parameters<typeof $.prompt.submit>[0])

  const run = () => $.tool.call({ tool: 'Bash', command: 'bun test db' })
  for (let i = 0; i < 4; i++) await run() // note on the third, stop on the fourth
  expect((await run()).deny ?? '').toContain('Do not call more tools')
  await submit({ kind: 'task-notification' })
  expect((await run()).deny ?? '').toContain('Do not call more tools')
  await submit({ kind: 'plugin', name: 'decision-inbox' })
  expect((await run()).deny).toBeUndefined()
})
