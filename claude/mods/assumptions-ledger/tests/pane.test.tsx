import { type TestBody, expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'assumptions-ledger',
  component: 'Pane',
  requestId: 'assumptions',
  surface: 'terminal',
  props: { title: 'Assumptions', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

async function withTwo($: Parameters<TestBody>[0], on: Parameters<TestBody>[1]) {
  const submitted: string[] = []
  mock.clock(on, { now: 1_000 })
  on('command.register', () => ({ value: { command: 'assumptions' } }) as never)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.complete', (_, e) => ({ text: e.answer }) as never)
  on('prompt.submit', (_, e) => {
    submitted.push(e.text)
    return { text: e.text } as never
  })
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await $.turn.complete({ agentId: 'ag', turnId: 't1', answer: 'Done.\n\n## Assumptions I made\n- The API is v2\n- Prices are in USD' } as never)
  return submitted
}

test('✕ hides an assumption and sends nothing', async ($, on) => {
  const submitted = await withTwo($, on)
  const ui = await $.ui.mount(PANE)
  await $.ui.press({ plugin: 'assumptions-ledger', key: 'ag-t1-0-x', requestId: 'assumptions' })
  expect(await ui.find({ type: 'Text', text: /The API is v2/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Prices are in USD/ })).toBeDefined()
  await ui.unmount()
  expect(submitted).toEqual([])
})

test('Wrong hides it and tells the main conversation', async ($, on) => {
  const submitted = await withTwo($, on)
  const ui = await $.ui.mount(PANE)
  await $.ui.press({ plugin: 'assumptions-ledger', key: 'ag-t1-1-wrong', requestId: 'assumptions' })
  await ui.unmount()
  expect(submitted).toEqual([expect.stringContaining('marked this assumption wrong (from the agent "ag"): "Prices are in USD"')])
})
