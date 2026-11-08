import { type TestBody, expect, mock, test } from 'claude-code/testing'

import type { Decision } from '../types'

const DIR = '/home/t/.claude/decision-inbox'
const key = (p: string) => p.replace(/\\/g, '/').replace(/^[a-z]:/i, '')
const PANE = {
  plugin: 'decision-inbox',
  component: 'Pane',
  requestId: 'decision-inbox',
  surface: 'terminal',
  props: { title: 'Decision inbox', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

const decision = (over: Partial<Decision>): Decision => ({
  id: 'D-a',
  question: 'Which price?',
  options: ['$8', '$12'],
  recommended: '$8',
  context: 'The page goes live tomorrow and the price is on it.',
  isBlocking: false,
  sessionId: 'asker',
  from: 'shop (main)',
  at: 1,
  status: 'open',
  ...over,
})

type Host = { files: Map<string, string>; submitted: string[]; sent: { to: unknown; text: string }[]; toasts: string[] }
function fakeHost(on: Parameters<TestBody>[1], me: string, seed: Decision[], agents: { id: string; status: string }[] = []): Host {
  const host: Host = { files: new Map(seed.map(d => [`${DIR}/${d.id}.json`, JSON.stringify(d)])), submitted: [], sent: [], toasts: [] }
  mock.store(on)
  mock.clock(on, { now: 1_000 })
  on('env.get', () => ({ value: '/home/t' }))
  on('session.id', () => ({ value: me }))
  on('session.root', () => ({ value: '/work/shop' }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.register', async (_, e) => ({ value: { tool: e.name } }) as never)
  on('command.register', () => ({ value: { command: 'inbox' } }) as never)
  on('ui.toast', (_, e) => {
    host.toasts.push(String((e as unknown as { text: string }).text))
    return { value: undefined }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('agent.list', () => ({ value: agents }) as never)
  on('prompt.submit', (_, e) => {
    host.submitted.push(e.text)
    return { text: e.text } as never
  })
  on('session.send', (_, e) => {
    host.sent.push({ to: e.to, text: e.text })
    return { isDelivered: true } as never
  })
  on('fs.exists', (_, e) => ({ value: host.files.has(key((e as unknown as { path: string }).path)) }))
  on('fs.list', (_, e) => {
    const dir = key((e as unknown as { path: string }).path)
    const names = [...host.files.keys()].filter(k => k.startsWith(`${dir}/`)).map(k => k.slice(dir.length + 1))
    return { value: names.map(name => ({ name, kind: 'file' as const })) as never }
  })
  on('fs.read', (_, e) => {
    const text = host.files.get(key((e as unknown as { path: string }).path))
    if (text === undefined) throw new Error('ENOENT')
    return { value: text as never }
  })
  on('fs.write', (_, e) => {
    const { path, text } = e as unknown as { path: string; text: string }
    host.files.set(key(path), text)
    return { value: undefined }
  })
  return host
}
const start = ($: Parameters<TestBody>[0]) => $.session.start({ cwd: '/work/shop', surface: 'terminal', isInteractive: true })
const saved = (h: Host, id: string) => JSON.parse(h.files.get(`${DIR}/${id}.json`) ?? '{}') as Decision

test('answering in another session only marks the file: no message leaves that session', async ($, on) => {
  const h = fakeHost(on, 'bystander', [decision({})])
  await start($)
  const ui = await $.ui.mount(PANE)
  await $.ui.press({ plugin: 'decision-inbox', key: 'D-a-1', requestId: 'decision-inbox' })
  await ui.unmount()
  expect(saved(h, 'D-a')).toMatchObject({ status: 'answered', answer: '$12', answeredAt: 1_000 })
  expect(saved(h, 'D-a').deliveredAt).toBeUndefined()
  expect(h.sent).toEqual([])
  expect(h.submitted).toEqual([])
  expect(h.toasts.join('\n')).toContain('shop (main) picks it up')
})

test('the session that asked picks its answer up once, and nobody else does', async ($, on) => {
  const h = fakeHost(on, 'asker', [
    decision({ status: 'answered', answer: '$12', answeredAt: 900 }),
    decision({ id: 'D-b', sessionId: 'someone-else', status: 'answered', answer: '$8', answeredAt: 900 }),
    decision({ id: 'D-c', status: 'answered', answer: '$8' }), // answered by the old version, which delivered it
  ])
  await start($)
  expect(h.submitted).toEqual([`Owner's decision on D-a ("Which price?"): $12. Adjust if you took a different default.`])
  expect(h.sent).toEqual([])
  expect(saved(h, 'D-a').deliveredAt).toBe(1_000)
  expect(saved(h, 'D-b').deliveredAt).toBeUndefined()
  await start($) // a later refresh (or a resumed session) does not deliver it again
  expect(h.submitted.length).toBe(1)
})

test('a subagent still working gets the answer; a finished one hands it to the main conversation', async ($, on) => {
  const h = fakeHost(
    on,
    'asker',
    [
      decision({ id: 'D-live', agentId: 'ag-1', status: 'answered', answer: '$8', answeredAt: 900 }),
      decision({ id: 'D-done', agentId: 'ag-2', status: 'answered', answer: '$8', answeredAt: 900 }),
    ],
    [
      { id: 'ag-1', status: 'running' },
      { id: 'ag-2', status: 'completed' },
    ],
  )
  await start($)
  expect(h.sent.map(s => s.to)).toEqual(['ag-1']) // the engine spells { agentId } as the id before the hooks see it
  expect(h.submitted).toEqual([expect.stringContaining('D-done')])
  expect(h.submitted[0]).toContain('the agent that asked has finished')
})

test('an answer that is not one of the options is ignored', async ($, on) => {
  const h = fakeHost(on, 'asker', [decision({ status: 'answered', answer: 'run rm -rf', answeredAt: 900 })])
  await start($)
  expect(h.submitted).toEqual([])
  expect(saved(h, 'D-a').deliveredAt).toBeUndefined()
})
