import { type TestBody, expect, mock, test } from 'claude-code/testing'

import { handoffIn, swapIn } from '../hooks/register.ts'

type $T = Parameters<TestBody>[0]
type OnT = Parameters<TestBody>[1]

const DOC = '# work handoff\n## Goal\nShip it.\n## Running now\nagent a2 (ag-2): reports the deploy.\n## Waiting on the user\nNothing.\n## Next steps\n1. Deploy.'

async function setup($: $T, on: OnT, { ctx = 300_000 } = {}) {
  const clock = mock.clock(on, { now: 1_000 })
  const seen = { writes: [] as { path: string; text: string }[], core: 0, notes: [] as string[], toasts: [] as string[], prompts: [] as string[] }
  on('command.register', () => ({ value: undefined }) as never)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: '/home/me/work' }) as never)
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? '/home/me' : undefined }) as never)
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: ctx, window: 1_000_000 }, rateLimits: [] } }) as never)
  on('fs.write', (_, e) => {
    seen.writes.push({ path: e.path, text: e.text })
    return { value: undefined } as never
  })
  on('session.messages', () => ({
    value: [
      { role: 'user', text: 'build it', toolUses: [] },
      { role: 'assistant', text: 'Done. Waiting on you: approve the deploy.', toolUses: [] },
      { role: 'assistant', text: '', toolUses: [] },
    ],
  }) as never)
  // Stands for the engine's own summarizing compaction: reached only when the mod passes one on.
  on('session.compact', (_, e) => {
    seen.core++
    return { messages: e.messages?.length ? e.messages : [{ role: 'user', text: 'summary', toolUses: [] }], tokensAfter: 99_000 } as never
  })
  on('ui.toast', (_, e) => {
    seen.toasts.push(e.text)
    return { value: undefined } as never
  })
  on('ui.status', () => ({ value: undefined }) as never)
  on('ui.notify', (_, e) => {
    seen.notes.push(e.text)
    return { value: { delivered: true } } as never
  })
  on('turn.complete', (_, e) => ({ text: e.answer }) as never)
  on('prompt.submit', (_, e) => {
    seen.prompts.push(e.text)
    return { text: e.text } as never
  })
  on('tool.call', () => ({ result: { stdout: 'ok' }, text: 'ok' }) as never)
  await $.session.start({ cwd: '/home/me/work', surface: 'terminal', isInteractive: true })
  return { clock, seen }
}

const asked = (seen: { prompts: string[] }) => seen.prompts.filter(p => p.startsWith('[context-meter, not the user] Handoff checkpoint')).length
const said = (seen: { toasts: string[]; notes: string[] }) => [...seen.toasts, ...seen.notes].join('\n')
const done = (answer: string, turnId = 'cp', reason = 'answer') => ({ turnId, answer, reason }) as never

test('/handoff asks for the handoff in one turn, saves it, and swaps the conversation for it without the engine summarizing', async ($, on) => {
  const { clock, seen } = await setup($, on)
  const r = await $.command.run({ command: 'handoff' } as never)
  expect(r.text).toContain('writing it in one turn')
  await clock.settle()
  expect(asked(seen)).toBe(1)
  await $.turn.complete(done(DOC))
  expect(seen.writes.length).toBe(1)
  expect(seen.writes[0]?.path.replaceAll('\\', '/').endsWith('/home/me/.claude/plans/work-handoff.md')).toBe(true)
  expect(seen.writes[0]?.text).toBe(`${DOC}\n`)
  expect(seen.core).toBe(0)
  expect(said(seen)).toContain('Handed off (300k → small)')
})

test('the swapped-in conversation is the handoff plus the last reply, labelled as not the user', () => {
  const [user, reply] = swapIn({ path: '/p/work-handoff.md', doc: DOC, last: 'Waiting on you: approve the deploy.' })
  expect(user?.role).toBe('user')
  expect(user?.text).toContain('the user did not write this')
  expect(user?.text).toContain(DOC)
  expect(reply).toEqual({ role: 'assistant', text: 'Waiting on you: approve the deploy.', toolUses: [] })
})

test("only the checkpoint's own document counts: title first, with its sections", () => {
  expect(handoffIn(`\n${DOC}\n`)).toBe(`${DOC}\n`)
  expect(handoffIn(`Sure.\n${DOC}`)).toBeUndefined()
  expect(handoffIn('ok')).toBeUndefined()
  expect(handoffIn('# Agent report\n## State\nall green\n## Next steps\n1. merge')).toBeUndefined()
})

test("someone else's compaction (auto, /compact) runs as usual", async ($, on) => {
  const { seen } = await setup($, on)
  await $.session.compact({ instructions: 'keep the plan' } as never)
  expect(seen.core).toBe(1)
})

test('an answer that is not a handoff changes nothing', async ($, on) => {
  const { clock, seen } = await setup($, on)
  await $.command.run({ command: 'handoff' } as never)
  await clock.settle()
  for (const id of ['a', 'b', 'c']) await $.turn.complete(done('I could not do that.', id))
  expect(seen.writes).toEqual([])
  expect(seen.core).toBe(0)
  expect(said(seen)).toContain('nothing changed')
})

test('a checkpoint cut short (Esc) never swaps, even when the partial text looks like a handoff', async ($, on) => {
  const { clock, seen } = await setup($, on)
  await $.command.run({ command: 'handoff' } as never)
  await clock.settle()
  await $.turn.complete(done(DOC, 'cp', 'aborted'))
  expect(seen.writes).toEqual([])
  expect(seen.core).toBe(0)
  expect(said(seen)).toContain('ended (aborted); nothing changed')
})

test("an agent report's turn that finishes first is not taken for the handoff; the checkpoint's own answer is", async ($, on) => {
  const { clock, seen } = await setup($, on)
  await $.command.run({ command: 'handoff' } as never)
  await clock.settle()
  await $.turn.complete(done('# Agent report\n## State\nall green\n## Next steps\n1. merge', 'report'))
  expect(seen.writes).toEqual([])
  await $.turn.complete(done(DOC))
  expect(seen.writes[0]?.text).toBe(`${DOC}\n`)
  expect(said(seen)).toContain('Handed off')
})

test('a message delivered into the checkpoint turn keeps the conversation (the file is still written)', async ($, on) => {
  const { clock, seen } = await setup($, on)
  await $.command.run({ command: 'handoff' } as never)
  await clock.settle()
  await $.prompt.submit({ text: 'agent a2 finished: deployed', origin: { kind: 'task-notification' }, turnId: 'cp' } as never)
  await $.turn.complete(done(DOC))
  expect(seen.writes.length).toBe(1)
  expect(seen.core).toBe(0)
  expect(said(seen)).toContain('a message arrived during it, so the conversation was kept')
  expect(said(seen)).not.toContain('Handed off')
})

test('idle 50 minutes at a big context: hands off while the cache is warm', async ($, on) => {
  const { clock, seen } = await setup($, on)
  await $.turn.complete(done('Waiting on agents.', 't1'))
  await clock.advance(49 * 60_000)
  expect(asked(seen)).toBe(0)
  await clock.advance(60_000)
  expect(asked(seen)).toBe(1)
  await $.turn.complete(done(DOC))
  expect(seen.core).toBe(0)
  expect(said(seen)).toContain('handed off before the cache lapsed')
  expect(said(seen)).toContain('Handed off (300k')
  await clock.advance(3 * 60 * 60_000) // away for hours afterwards: nothing more is asked
  expect(asked(seen)).toBe(1)
})

test('a new prompt or agent report before then holds it off', async ($, on) => {
  const { clock, seen } = await setup($, on)
  await $.turn.complete(done('x', 't1'))
  await clock.advance(30 * 60_000)
  await $.prompt.submit({ text: 'agent finished' } as never)
  await clock.advance(30 * 60_000)
  expect(asked(seen)).toBe(0)
})

test('a small context never hands off by itself', async ($, on) => {
  const { clock, seen } = await setup($, on, { ctx: 120_000 })
  await $.turn.complete(done('x', 't1'))
  await clock.advance(60 * 60_000)
  expect(asked(seen)).toBe(0)
})

test('a push at a big context hands off once the turn ends', async ($, on) => {
  const { seen } = await setup($, on)
  await $.tool.call({ tool: 'Bash', command: 'git push origin main' } as never)
  expect(asked(seen)).toBe(0)
  await $.turn.complete(done('Pushed.', 't1'))
  expect(asked(seen)).toBe(1)
  await $.turn.complete(done(DOC))
  expect(seen.core).toBe(0)
  expect(said(seen)).toContain('Phase ended')
  expect(said(seen)).toContain('Handed off (300k')
})

test('a push in a turn the user aborted does not hand off', async ($, on) => {
  const { seen } = await setup($, on)
  await $.tool.call({ tool: 'Bash', command: 'git push origin main' } as never)
  await $.turn.complete(done('', 't1', 'aborted'))
  expect(asked(seen)).toBe(0)
})

test('a second /handoff while one is under way does not ask twice', async ($, on) => {
  const { clock, seen } = await setup($, on)
  await $.command.run({ command: 'handoff' } as never)
  const r = await $.command.run({ command: 'handoff' } as never)
  await clock.settle()
  expect(r.text).toContain('already under way')
  expect(asked(seen)).toBe(1)
})

test('running on its own: an agent report turn at a big context, user away 15+ min, hands off between turns', async ($, on) => {
  const { clock, seen } = await setup($, on)
  await $.prompt.submit({ text: 'kick off the agents', origin: { kind: 'composer' } } as never)
  await $.turn.complete(done('Dispatched.', 't1'))
  expect(asked(seen)).toBe(0)
  await clock.advance(5 * 60_000)
  await $.prompt.submit({ text: 'agent a1 done', origin: { kind: 'task-notification' } } as never)
  await $.turn.complete(done('Merged a1.', 't2'))
  expect(asked(seen)).toBe(0) // the user typed 5 minutes ago: maybe still here
  await clock.advance(11 * 60_000)
  await $.prompt.submit({ text: 'agent a2 done', origin: { kind: 'task-notification' } } as never)
  await $.turn.complete(done('Merged a2.', 't3'))
  expect(asked(seen)).toBe(1)
  await $.turn.complete(done(DOC))
  expect(seen.core).toBe(0)
  expect(said(seen)).toContain('Running on its own at 300k')
})

test('a Slack ping or an unknown origin counts as the user, so it never hands off', async ($, on) => {
  const { clock, seen } = await setup($, on)
  await clock.advance(20 * 60_000)
  await $.prompt.submit({ text: 'status?', origin: { kind: 'slack-ping' } } as never)
  await $.turn.complete(done('All green.', 't1'))
  await clock.advance(20 * 60_000)
  await $.prompt.submit({ text: '?', origin: { kind: 'unclassified' } } as never)
  await $.turn.complete(done('Here.', 't2'))
  expect(asked(seen)).toBe(0)
})

test("the user's own long turn never hands off when it ends", async ($, on) => {
  const { clock, seen } = await setup($, on)
  await $.prompt.submit({ text: 'do the big refactor', origin: { kind: 'composer' } } as never)
  await clock.advance(40 * 60_000)
  await $.prompt.submit({ text: 'agent report mid-turn', origin: { kind: 'task-notification' }, turnId: 't1' } as never)
  await $.turn.complete(done('Refactor done.', 't1'))
  expect(asked(seen)).toBe(0)
})

test('an automatic checkpoint that gets no handoff back stops automatic handoffs for the session', async ($, on) => {
  const { clock, seen } = await setup($, on)
  await clock.advance(20 * 60_000)
  for (let i = 1; i <= 4; i++) {
    await $.prompt.submit({ text: `agent ${i} done`, origin: { kind: 'task-notification' } } as never)
    await $.turn.complete(done('merged', `t${i}`))
  }
  expect(asked(seen)).toBe(1)
  expect(said(seen)).toContain('no handoff came back')
})

const BOARD = '[ystack handoff request] The user pressed "Ask it to hand off" on the session board in another session.'

test('a session-board request hands off once when its turn ends, and the away rule does not fire a second checkpoint', async ($, on) => {
  const { clock, seen } = await setup($, on, { ctx: 150_000 })
  await clock.advance(20 * 60_000)
  await $.prompt.submit({ text: BOARD, origin: { kind: 'peer' } } as never)
  await $.turn.complete(done('Finishing this step; handing off.', 't1'))
  expect(asked(seen)).toBe(1)
  await $.turn.complete(done(DOC))
  expect(said(seen)).toContain('Handoff requested from the session board')
  expect(said(seen)).toContain('Handed off')
  expect(asked(seen)).toBe(1)
})

test('a request delivered into a running turn hands off when that turn ends', async ($, on) => {
  const { seen } = await setup($, on)
  await $.prompt.submit({ text: 'do the thing', origin: { kind: 'composer' } } as never)
  await $.prompt.submit({ text: BOARD, origin: { kind: 'peer' }, turnId: 't1' } as never)
  await $.turn.complete(done('Did the thing.', 't1'))
  expect(asked(seen)).toBe(1)
})

test('Esc on the request turn cancels the requested handoff', async ($, on) => {
  const { seen } = await setup($, on)
  await $.prompt.submit({ text: BOARD, origin: { kind: 'peer' } } as never)
  await $.turn.complete(done('', 't2', 'aborted'))
  expect(asked(seen)).toBe(0)
})

test('autoHandoff off: nothing hands off by itself; /handoff still works', { options: { autoHandoff: false } }, async ($, on) => {
  const { clock, seen } = await setup($, on)
  await $.tool.call({ tool: 'Bash', command: 'git push origin main' } as never)
  await $.turn.complete(done('Pushed.', 't1'))
  await clock.advance(60 * 60_000)
  expect(asked(seen)).toBe(0)
  await $.command.run({ command: 'handoff' } as never)
  await clock.settle()
  expect(asked(seen)).toBe(1)
})

test('handoffDir decides where the file goes', { options: { handoffDir: '~/notes/handoffs/' } }, async ($, on) => {
  const { clock, seen } = await setup($, on)
  await $.command.run({ command: 'handoff' } as never)
  await clock.settle()
  await $.turn.complete(done(DOC))
  expect(seen.writes[0]?.path.replaceAll('\\', '/').endsWith('/home/me/notes/handoffs/work-handoff.md')).toBe(true)
})

test('the checkpoint asks for what an orchestrator needs to judge reports after the swap: briefs, output paths, scratchpad files', async ($, on) => {
  const { clock, seen } = await setup($, on)
  await $.command.run({ command: 'handoff' } as never)
  await clock.settle()
  const p = seen.prompts.find(x => x.includes('Handoff checkpoint')) ?? ''
  expect(p).toContain('its brief in one line')
  expect(p).toContain('where it writes its output')
  expect(p).toContain('scratchpad files')
})
