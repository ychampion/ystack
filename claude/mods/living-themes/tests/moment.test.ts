import { type TestBody, expect, mock, test } from 'claude-code/testing'

import {
  Coalescer,
  FLASH_MS,
  SUCCESS_WORDS,
  activityOf,
  decodeScene,
  localTime,
  newTracker,
  onAgents,
  onFlash,
  onPromptSubmit,
  onToolEnd,
  onToolStart,
  onTurnComplete,
  parseOffset,
  phaseOf,
  seasonOf,
} from '../hooks/moment'
import type { CoalescerIo } from '../hooks/moment'
import { GAP_MS } from '../hooks/register'

type $T = Parameters<TestBody>[0]
type OnT = Parameters<TestBody>[1]

// ---- The moment, pure ----

test('a turn goes thinking, working while any tool runs, thinking again, then idle', () => {
  let t = onPromptSubmit(newTracker())
  expect(activityOf(t, 0, false).activity).toBe('thinking')
  t = onToolStart(t)
  t = onToolStart(t)
  expect(activityOf(t, 0, false).activity).toBe('working')
  t = onToolEnd(t)
  expect(activityOf(t, 0, false).activity).toBe('working')
  t = onToolEnd(t)
  expect(activityOf(t, 0, false).activity).toBe('thinking')
  t = onToolEnd(t)
  expect(t.toolsInFlight).toBe(0)
  t = onTurnComplete(t)
  expect(activityOf(t, 0, false)).toEqual({ activity: 'idle', agents: 0 })
})

test('subagents win over tools, capped at five; a flash wins over both while it lasts; calm is always idle', () => {
  let t = onToolStart(onPromptSubmit(newTracker()))
  t = onAgents(t, 9)
  expect(activityOf(t, 0, false)).toEqual({ activity: 'agents', agents: 5 })
  t = onFlash(t, 'error', 1000)
  expect(activityOf(t, 1000 + FLASH_MS - 1, false).activity).toBe('error')
  expect(activityOf(t, 1000 + FLASH_MS, false).activity).toBe('agents')
  expect(activityOf(t, 0, true)).toEqual({ activity: 'idle', agents: 0 })
})

test('the success words', () => {
  for (const said of ['Merged into main.', 'All tests pass.', 'all tests passed', 'All the tests passed', 'Pushed to origin/main'])
    expect(SUCCESS_WORDS.test(said)).toBe(true)
  for (const said of ['I will merge it later', 'tests failed', 'pushed back on it', 'unmerged']) expect(SUCCESS_WORDS.test(said)).toBe(false)
})

test('offsets as people type them', () => {
  expect(parseOffset('+5:30')).toBe(330)
  expect(parseOffset('-8')).toBe(-480)
  expect(parseOffset('5.5')).toBe(330)
  expect(parseOffset('UTC+1')).toBe(60)
  expect(parseOffset('+0545')).toBe(345)
  expect(parseOffset('')).toBeUndefined()
  expect(parseOffset('soon')).toBeUndefined()
  expect(parseOffset('+20')).toBeUndefined()
  expect(parseOffset(undefined)).toBeUndefined()
})

test('the hour and month by an offset, the phases and the seasons', () => {
  const noonUtc = Date.UTC(2026, 0, 31, 12, 0)
  expect(localTime(noonUtc, 0)).toEqual({ hour: 12, month: 0 })
  expect(localTime(noonUtc, 330)).toEqual({ hour: 17, month: 0 })
  expect(localTime(Date.UTC(2026, 0, 31, 23, 0), 120)).toEqual({ hour: 1, month: 1 })
  expect([4, 5, 7, 8, 16, 17, 19, 20, 23, 0].map(phaseOf)).toEqual(['night', 'dawn', 'dawn', 'day', 'day', 'dusk', 'dusk', 'night', 'night', 'night'])
  expect([0, 2, 5, 8, 11].map(m => seasonOf(m, 'north'))).toEqual(['winter', 'spring', 'summer', 'autumn', 'winter'])
  expect([0, 2, 5, 8, 11].map(m => seasonOf(m, 'south'))).toEqual(['summer', 'autumn', 'winter', 'spring', 'summer'])
})

// ---- The coalescer on a hand clock ----

function handClock() {
  let now = 0
  const waits: { at: number; fn: () => void; cancelled: boolean }[] = []
  const applied: string[] = []
  const io: CoalescerIo = {
    now: () => now,
    after: (ms, fn) => {
      const wait = { at: now + ms, fn, cancelled: false }
      waits.push(wait)
      return { cancel: () => void (wait.cancelled = true) }
    },
    apply: async name => void applied.push(name),
  }
  const settle = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve()
  }
  const advance = async (ms: number) => {
    now += ms
    for (const wait of waits.filter(w => !w.cancelled && w.at <= now)) {
      wait.cancelled = true
      wait.fn()
    }
    await settle()
  }
  return { io, applied, advance, settle }
}

test('the coalescer lands the first name at once, then at most one per gap, ending on the latest', async () => {
  const { io, applied, advance } = handClock()
  const c = new Coalescer(GAP_MS)
  await c.offer('a', io)
  expect(applied).toEqual(['a'])
  await c.offer('b', io)
  await c.offer('c', io)
  await c.offer('d', io)
  expect(applied).toEqual(['a'])
  await advance(GAP_MS - 1)
  expect(applied).toEqual(['a'])
  await advance(1)
  expect(applied).toEqual(['a', 'd'])
  // The same name again lands nothing.
  await advance(GAP_MS)
  await c.offer('d', io)
  expect(applied).toEqual(['a', 'd'])
})

test('the coalescer drops a wait that came back to what stands', async () => {
  const { io, applied, advance } = handClock()
  const c = new Coalescer(GAP_MS)
  await c.offer('a', io)
  await c.offer('b', io)
  await c.offer('a', io)
  await advance(GAP_MS)
  expect(applied).toEqual(['a'])
  c.reset()
  await c.offer('a', io)
  await advance(GAP_MS)
  expect(applied).toEqual(['a', 'a'])
})

// ---- The mod, through the engine ----

const OPTIONS = { utcOffset: '+0', hemisphere: 'north', reactToAgent: true }
// 2026-10-14 10:00 UTC: day, autumn.
const START = Date.UTC(2026, 9, 14, 10, 0)

type Gate = { open: (isError?: boolean) => void }

async function setup($: $T, on: OnT, { surface = 'desktop' as 'desktop' | 'terminal' | null, theme = 'shark-shoal' as string | null } = {}) {
  const clock = mock.clock(on, { now: START })
  mock.store(on, theme === null ? {} : { default: theme })
  const sets: string[] = []
  const clears: number[] = []
  const agents: { id: string; status: string; description: string; type: string }[] = []
  const gates: Gate[] = []
  on('command.register', () => ({ value: undefined }) as never)
  on('session.start', (_, e) => ({ cwd: e.cwd }) as never)
  on('session.surfaces', () => ({ value: surface === null ? [] : [surface] }) as never)
  on('ui.log', () => ({ value: undefined }) as never)
  on('theme.set', (_, e) => {
    const backdrop = (e as { backdrop: { scene?: string; id?: string } }).backdrop
    sets.push(backdrop.scene ?? backdrop.id ?? '?')
    return { value: { isDrawn: true } } as never
  })
  on('theme.clear', () => {
    clears.push(1)
    return { value: undefined } as never
  })
  on('agent.list', () => ({ value: agents.map(a => ({ ...a })) }) as never)
  on('tool.call', () =>
    new Promise(resolve => {
      gates.push({ open: (isError = false) => resolve((isError ? { result: 'boom', text: 'boom', isError: true } : { result: 'ok', text: 'ok' }) as never) })
    }) as never,
  )
  on('turn.complete', (_, e) => ({ text: e.answer }) as never)
  on('prompt.submit', (_, e) => ({ text: e.text }) as never)
  await $.session.start({ cwd: '/w', surface, isInteractive: true } as never)
  await clock.settle()
  const activity = () => decodeScene(sets.at(-1) ?? '')?.ctx.activity
  // A tool call left running: the gate ends it.
  const startTool = async () => {
    const call = $.tool.call({ tool: 'Bash', command: 'ls' } as never)
    await clock.settle()
    return { gate: gates.at(-1)!, call }
  }
  return { clock, sets, clears, agents, activity, startTool }
}

const done = (answer: string, agentId?: string) => ({ turnId: 't1', answer, reason: 'answer', ...(agentId && { agentId }) }) as never

test('a session starts on the default theme at the local moment', { options: OPTIONS }, async ($, on) => {
  const { sets } = await setup($, on)
  expect(sets).toEqual(['shark-shoal_idle_day_autumn_0'])
})

test('a turn: thinking, working while tools run (counted), thinking, idle', { options: OPTIONS }, async ($, on) => {
  const { clock, activity, startTool } = await setup($, on)
  await $.prompt.submit({ text: 'go' } as never)
  await clock.advance(GAP_MS)
  expect(activity()).toBe('thinking')
  const one = await startTool()
  const two = await startTool()
  await clock.advance(GAP_MS)
  expect(activity()).toBe('working')
  one.gate.open()
  await one.call
  await clock.advance(GAP_MS)
  expect(activity()).toBe('working')
  two.gate.open()
  await two.call
  await clock.advance(GAP_MS)
  expect(activity()).toBe('thinking')
  await $.turn.complete(done('Done.'))
  await clock.advance(GAP_MS)
  expect(activity()).toBe('idle')
})

test('a failed tool flashes error for 8 seconds on the clock', { options: OPTIONS }, async ($, on) => {
  const { clock, activity, startTool } = await setup($, on)
  await $.prompt.submit({ text: 'go' } as never)
  await clock.advance(GAP_MS)
  const { gate, call } = await startTool()
  gate.open(true)
  await call
  await clock.advance(GAP_MS)
  expect(activity()).toBe('error')
  await clock.advance(FLASH_MS - GAP_MS - 10)
  expect(activity()).toBe('error')
  await clock.advance(10 + GAP_MS)
  expect(activity()).toBe('thinking')
})

test('a reply that says merged flashes success for 8 seconds', { options: OPTIONS }, async ($, on) => {
  const { clock, activity } = await setup($, on)
  await clock.advance(GAP_MS)
  await $.session.append({ door: 'response', message: { type: 'assistant', content: [{ type: 'text', text: 'Merged into main.' }] } } as never)
  await clock.advance(GAP_MS)
  expect(activity()).toBe('success')
  await clock.advance(FLASH_MS)
  expect(activity()).toBe('idle')
})

test('running subagents show as agents with their count, and go when they end', { options: OPTIONS }, async ($, on) => {
  const { clock, sets, agents, activity } = await setup($, on)
  await $.prompt.submit({ text: 'fan out' } as never)
  agents.push(
    { id: 'a1', status: 'running', description: 'x', type: 'general-purpose' },
    { id: 'a2', status: 'running', description: 'y', type: 'general-purpose' },
    { id: 'a3', status: 'completed', description: 'z', type: 'general-purpose' },
  )
  await $.turn.complete(done('Dispatched.'))
  await clock.advance(GAP_MS)
  expect(sets.at(-1)).toBe('shark-shoal_agents_day_autumn_2')
  // A subagent's own turn end leaves the main loop alone.
  await $.turn.complete(done('report', 'a1'))
  agents[0]!.status = 'completed'
  agents[1]!.status = 'completed'
  await clock.advance(5000)
  await clock.advance(GAP_MS)
  expect(activity()).toBe('idle')
})

test('a burst of changes lands at most one backdrop per gap, ending on the latest moment', { options: OPTIONS }, async ($, on) => {
  const { clock, sets, startTool } = await setup($, on)
  await clock.advance(GAP_MS)
  const before = sets.length
  await $.prompt.submit({ text: 'go' } as never)
  for (let i = 0; i < 5; i++) {
    const { gate, call } = await startTool()
    gate.open()
    await call
  }
  await $.turn.complete(done('Done.'))
  await $.prompt.submit({ text: 'again' } as never)
  await clock.settle()
  // The first change lands at once; the rest wait out the gap and land as one.
  expect(sets.length - before).toBe(1)
  await clock.advance(GAP_MS)
  expect(sets.length - before).toBe(2)
  expect(sets.at(-1)).toBe('shark-shoal_thinking_day_autumn_0')
})

test('calm keeps the scene idle whatever Claude does', { options: OPTIONS }, async ($, on) => {
  const { clock, activity } = await setup($, on)
  const said = await $.command.run({ command: 'live-theme', args: 'calm on' } as never)
  expect(said.text).toContain('Calm')
  await $.prompt.submit({ text: 'go' } as never)
  await clock.advance(GAP_MS)
  expect(activity()).toBe('idle')
})

test('the time of day moves on the five-minute clock', { options: OPTIONS }, async ($, on) => {
  const { clock, sets } = await setup($, on)
  // 10:00 to 17:00: dusk.
  await clock.advance(7 * 60 * 60_000)
  expect(sets.at(-1)).toBe('shark-shoal_idle_dusk_autumn_0')
})

test('a headless run and a terminal draw nothing', { options: OPTIONS }, async ($, on) => {
  const { clock, sets } = await setup($, on, { surface: null })
  await $.prompt.submit({ text: 'go' } as never)
  await clock.advance(GAP_MS * 2)
  expect(sets).toEqual([])
})

test('with no theme chosen nothing is set; the command applies, lists and clears', { options: OPTIONS }, async ($, on) => {
  const { clock, sets, clears } = await setup($, on, { theme: null })
  expect(sets).toEqual([])
  const list = await $.command.run({ command: 'live-theme', args: 'list' } as never)
  expect(list.text).toContain('shark-shoal')
  const unknown = await $.command.run({ command: 'live-theme', args: 'whale song' } as never)
  expect(unknown.text).toContain('No living theme named')
  const applied = await $.command.run({ command: 'live-theme', args: 'shark shoal session' } as never)
  expect(applied.text).toContain('this session only')
  await clock.settle()
  expect(sets.at(-1)).toBe('shark-shoal_idle_day_autumn_0')
  const off = await $.command.run({ command: 'live-theme', args: 'off' } as never)
  expect(off.text).toContain('off for every session')
  expect(clears.length).toBe(1)
})
