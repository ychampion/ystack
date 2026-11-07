import { expect, mock, test } from 'claude-code/testing'

import { cleanCaption, emptyTrack, firstCommand, fold, isAway, missing, ruleCaption, signalOf, stageOf, suggestionFor } from '../hooks/caption.ts'

test('rules caption common commands and tools in plain words', async () => {
  expect(ruleCaption('Bash', { command: 'bun test tests/payment.test.ts' })).toBe('running the payment tests')
  expect(ruleCaption('Bash', { command: 'cd app && bun test' })).toBe('running the tests')
  expect(ruleCaption('Bash', { command: 'git push origin main' })).toBe('sending the changes to the shared copy on GitHub')
  expect(ruleCaption('PowerShell', { command: 'Remove-Item -Recurse -Force dist' })).toBe('deleting the dist folder')
  expect(ruleCaption('Bash', { command: 'rm -rf ./old-build' })).toBe('deleting the old-build folder')
  expect(ruleCaption('Bash', { command: 'gh pr create --fill' })).toBe('opening a pull request for review')
  expect(ruleCaption('Edit', { file_path: 'C:\\app\\src\\checkout.ts' })).toBe('changing checkout.ts')
  expect(ruleCaption('Grep', { pattern: 'TODO' })).toBe('searching the code for "TODO"')
  expect(ruleCaption('Bash', { command: 'weird-tool --x', description: 'Rebuild the search index.' })).toBe('rebuild the search index')
  expect(ruleCaption('Bash', { command: 'weird-tool --x' })).toBeUndefined()
  expect(ruleCaption('mcp__foo__bar', {})).toBeUndefined()
  expect(firstCommand('FOO=1 cd x && npm run build')).toBe('npm run build')
})

test('model captions are tidied to one short line', async () => {
  expect(cleanCaption('"Uploading the report."\nmore')).toBe('uploading the report')
  expect(cleanCaption('   ')).toBeUndefined()
})

test('stage and what is missing follow the activity', async () => {
  let t = emptyTrack()
  for (let i = 0; i < 4; i++) t = fold(t, signalOf('Read', { file_path: 'a.ts' }))
  expect(stageOf(t)).toBe('Plan')
  t = fold(t, signalOf('Edit', { file_path: 'src/pages/Checkout.tsx', new_string: 'x' }))
  expect(stageOf(t)).toBe('Build')
  expect(missing(t.needs)).toEqual([
    'a security review (login, payment or secret code changed)',
    'the tests run since the last change',
    'a look at the page in a browser',
  ])
  expect(suggestionFor(t.needs, true)).toBe('/review-panel')
  t = fold(t, signalOf('Agent', { subagent_type: 'security-sentinel', description: 'security review' }))
  expect(stageOf(t)).toBe('Review')
  t = fold(t, signalOf('Bash', { command: 'bun test' }))
  expect(stageOf(t)).toBe('Test')
  expect(suggestionFor(t.needs, false)).toBe('check the page in a browser and take a screenshot')
  t = fold(t, signalOf('Skill', { skill: 'browse' }))
  expect(missing(t.needs)).toEqual([])
  t = fold(t, signalOf('Edit', { file_path: 'README.md' }))
  expect(missing(t.needs)).toEqual([])
  t = fold(t, signalOf('Bash', { command: 'git push' }))
  expect(stageOf(t)).toBe('Ship')
  expect({ ...t, recent: [] }).toEqual({ ...emptyTrack(), recent: [] })
})

test('away means idle past the setting', async () => {
  expect(isAway(1_000, 1_000 + 46 * 60_000, 45)).toBe(true)
  expect(isAway(1_000, 1_000 + 10 * 60_000, 45)).toBe(false)
  expect(isAway(0, 99_999_999, 45)).toBe(false)
})

const TOOL_ROW = {
  plugin: 'owner-view',
  component: 'ToolUse',
  requestId: 'tu-1',
  surface: 'terminal',
  props: { tool_use_id: 'tu-1', tool: 'Bash', input: { command: 'bun test tests/payment.test.ts' }, isRunning: false, isErrored: false, isInterrupted: false },
} as const

test('a caption is drawn under the row, and the row stays', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>Bash(bun test)</Text>
  })
  const ui = await $.ui.mount(TOOL_ROW)
  expect((await ui.find({ type: 'Text', text: /Bash\(bun test\)/ }))?.text).toBe('Bash(bun test)')
  expect((await ui.find({ type: 'Text', text: /payment tests/ }))?.text).toContain('running the payment tests')
  await ui.unmount()
})

test('captions can be turned off', { options: { captions: false } }, async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>Bash(bun test)</Text>
  })
  const ui = await $.ui.mount(TOOL_ROW)
  expect(await ui.find({ type: 'Text', text: /payment tests/ })).toBeUndefined()
  await ui.unmount()
})

const BAND = {
  plugin: 'owner-view',
  component: 'AbovePrompt',
  requestId: 'above-prompt',
  surface: 'terminal',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80, scroll: { offset: 0, bodyRows: 9 }, view: {} },
} as const

test('the stage strip shows only when something is missing', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  on('tool.call', () => ({ result: {} }))
  const quiet = await $.ui.mount(BAND)
  expect(await quiet.find({ type: 'Text', text: /Before it ships/ })).toBeUndefined()
  await quiet.unmount()

  await $.tool.call({ tool: 'Edit', file_path: 'src/Home.tsx', old_string: 'a', new_string: 'b' } as Parameters<typeof $.tool.call>[0])
  const ui = await $.ui.mount(BAND)
  expect((await ui.find({ type: 'Text', text: /Before it ships/ }))?.text).toContain('the tests run since the last change')
  expect((await ui.find({ type: 'Text', text: /Build/ }))?.text).toContain('Build')
  await ui.unmount()
})

test('/owner-view quiet is remembered', async ($, on) => {
  mock.store(on)
  on('command.register', () => ({ value: { command: 'x' } }) as never)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  const r = await $.command.run({ command: 'owner-view', args: 'quiet' } as Parameters<typeof $.command.run>[0])
  expect(r.text).toContain('off (remembered)')
  // A new session reads it back from the store.
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const status = await $.command.run({ command: 'owner-view', args: '' } as Parameters<typeof $.command.run>[0])
  expect(status.text).toContain('suggestions quiet')
})

test('/brief-me writes the brief from a fork into the pane', async ($, on) => {
  let forked = 0
  on('model.fork', () => {
    forked += 1
    return { value: { isAnswered: true, text: 'Done\n- checkout page built\nLeft\n- nothing\nRisky\n- nothing\nNeeds you\n- pick a price', usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } as never }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  const clock = mock.clock(on, { now: 1_000_000 })
  const r = await $.command.run({ command: 'brief-me', args: '' } as Parameters<typeof $.command.run>[0])
  expect(r.text).toContain('Writing your brief')
  await clock.advance(10)
  const pane = await $.ui.mount({
    plugin: 'owner-view',
    component: 'Pane',
    requestId: 'owner-brief',
    surface: 'terminal',
    props: { title: 'Brief', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
  })
  expect(forked).toBe(1)
  expect((await pane.find({ type: 'Text', text: /pick a price/ }))?.text).toContain('pick a price')
  expect((await pane.find({ type: 'Text', text: /^Needs you$/ }))?.text).toBe('Needs you')
  await pane.unmount()
})

test('after a long break, the next prompt opens "While you were away" with a brief written during the break', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  let forked = 0
  const opened: string[] = []
  on('model.fork', () => {
    forked += 1
    return { value: { isAnswered: true, text: 'Done\n- signup page live', usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } as never }
  })
  on('ui.open', (_, e) => {
    opened.push(`${e.id}:${e.title ?? ''}`)
    return { value: { isPlaced: true } } as never
  })
  on('turn.complete', (_, e) => ({ text: e.answer }) as never)
  on('prompt.submit', (_, e) => ({ text: e.text }) as never)
  await $.turn.complete({ answer: 'done', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer', category: null, explanation: null } as Parameters<typeof $.turn.complete>[0])
  await clock.advance(46 * 60_000) // the idle timer writes the brief while the cache is warm
  expect(forked).toBe(1)
  await $.prompt.submit({ text: 'hi, what happened?', origin: { kind: 'composer' }, wait: false } as Parameters<typeof $.prompt.submit>[0])
  expect(forked).toBe(1) // not written twice
  expect(opened).toEqual(['owner-brief:While you were away'])
})

const TURN = { answer: 'done', durationMs: 5, isAborted: false, turnId: 't', reason: 'answer', category: null, explanation: null }

test('turns that run on their own during one break (a loop, a finished background job) fork the brief once, not once per turn', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  let forked = 0
  const opened: string[] = []
  on('model.fork', () => {
    forked += 1
    return { value: { isAnswered: true, text: `Done\n- brief ${forked}`, usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } as never }
  })
  on('ui.open', (_, e) => {
    opened.push(`${e.id}:${e.title ?? ''}`)
    return { value: { isPlaced: true } } as never
  })
  on('turn.complete', (_, e) => ({ text: e.answer }) as never)
  on('prompt.submit', (_, e) => ({ text: e.text }) as never)
  type Turn = Parameters<typeof $.turn.complete>[0]
  await $.turn.complete({ ...TURN, turnId: 't1' } as unknown as Turn)
  await clock.advance(46 * 60_000)
  expect(forked).toBe(1)
  for (let i = 2; i <= 6; i++) {
    await $.turn.complete({ ...TURN, turnId: `t${i}` } as unknown as Turn) // nobody typed: a /loop or a background job's turn
    await clock.advance(50 * 60_000)
  }
  expect(forked).toBe(1)
  // The owner comes back 20 minutes after the last of those turns: still a break, so the brief opens once.
  await $.turn.complete({ ...TURN, turnId: 't7' } as unknown as Turn)
  await clock.advance(20 * 60_000)
  await $.prompt.submit({ text: 'what happened?', origin: { kind: 'composer' }, wait: false } as Parameters<typeof $.prompt.submit>[0])
  await clock.advance(10)
  expect(opened).toEqual(['owner-brief:While you were away'])
  expect(forked).toBe(2) // rewritten once, because work happened after the break's brief
  await $.prompt.submit({ text: 'thanks', origin: { kind: 'composer' }, wait: false } as Parameters<typeof $.prompt.submit>[0])
  expect(opened.length).toBe(1)
})

test('after /clear, the old conversation\'s stage and missing steps are gone', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 })
  mock.store(on)
  on('command.register', () => ({ value: { command: 'x' } }) as never)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {} }))
  on('turn.complete', (_, e) => ({ text: e.answer }) as never)
  const suggested: string[] = []
  on('prompt.suggest', (_, e) => {
    suggested.push(e.text)
    return { isShown: true } as never
  })
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  await $.tool.call({ tool: 'Edit', file_path: 'src/report.ts', old_string: 'a', new_string: 'b' } as Parameters<typeof $.tool.call>[0])
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true, source: 'clear' } as Parameters<typeof $.session.start>[0])
  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: /Before it ships/ })).toBeUndefined()
  await ui.unmount()
  await $.turn.complete({ ...TURN, turnId: 'n1' } as unknown as Parameters<typeof $.turn.complete>[0])
  await clock.advance(600)
  expect(suggested).toEqual([])
})

test('after a turn with untested code, the missing step is offered as the suggestion', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 })
  const suggested: string[] = []
  on('tool.call', () => ({ result: {} }))
  on('turn.complete', (_, e) => ({ text: e.answer }) as never)
  on('prompt.suggest', (_, e) => {
    suggested.push(e.text)
    return { isShown: true } as never
  })
  await $.tool.call({ tool: 'Edit', file_path: 'src/report.ts', old_string: 'a', new_string: 'b' } as Parameters<typeof $.tool.call>[0])
  await $.turn.complete({ answer: 'done', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer', category: null, explanation: null } as Parameters<typeof $.turn.complete>[0])
  await clock.advance(600)
  expect(suggested).toEqual(['run the tests for what you just changed and tell me what they showed'])
})
