import { type TestBody, expect, mock, test } from 'claude-code/testing'

import { dayKey, emptyScan, scanRows, tokens } from '../hooks/parse.ts'

type $T = Parameters<TestBody>[0]
type OnT = Parameters<TestBody>[1]

const NOW = new Date(2026, 10, 9, 12, 0, 0).getTime()
const H = 3_600_000
const CFG = '/home/t/.claude'
const A = `${CFG}/projects/-work-shop/sess-a.jsonl`
const B = `${CFG}/projects/-work-blog/sess-b.jsonl`
const OLD = `${CFG}/projects/-work-old/sess-old.jsonl`
const key = (p: string) => p.replace(/\\/g, '/').replace(/^[a-z]:/i, '')
const iso = (ms: number) => new Date(ms).toISOString()
const PANE = {
  plugin: 'session-board',
  component: 'Pane',
  requestId: 'session-board',
  surface: 'terminal',
  props: { title: 'Sessions', isFocused: true, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const
const HANDOFF_TEXT =
  '[ystack handoff request] The user pressed "Ask it to hand off" on the session board in another session. ' +
  "Finish the step you're on and don't drop the user's task. If the context-meter mod is installed it hands this session off " +
  'when this turn ends; otherwise, end your reply by asking the user to run /handoff.'

const reply = (id: string, at: number, usage: object, text: string, cwd: string) =>
  JSON.stringify({ type: 'assistant', timestamp: iso(at), cwd, message: { id, model: 'm', usage, content: [{ type: 'text', text }] } })

/** A 5 MB transcript: 1 MB from yesterday, then 4 MB from today, every row 100 KB so a chunk edge cuts through one. */
function bigTranscript(): string {
  const pad = 'x'.repeat(100_000)
  const rows: string[] = []
  for (let i = 0; i < 10; i++) rows.push(reply(`y${i}`, NOW - 30 * H + i * 1000, { input_tokens: 7 }, `old ${pad}`, '/work/shop'))
  for (let i = 0; i < 40; i++) rows.push(reply(`t${i}`, NOW - 2 * H + i * 1000, { input_tokens: 1000, cache_read_input_tokens: i === 39 ? 329_000 : 0 }, `step ${i} ${pad}`, '/work/shop'))
  return `${rows.join('\n')}\n`
}

type F = { text: string; mtimeMs: number }
type Read = { path: string; from: number; len: number }
type HostOpts = { sendReason?: string; alive?: Record<number, string> | 'fails'; failFrom?: number; files?: Record<string, F> }
type Host = { files: Map<string, F>; reads: Read[]; batches: Read[][]; wholeReads: string[]; copied: string[]; sent: { to: unknown; text: string }[]; toasts: string[] }

const reg = (pid: number, sessionId: string, cwd: string, status: string, updatedAt = NOW - 10 * 60_000) =>
  JSON.stringify({ pid, sessionId, cwd, status, procStart: '0', updatedAt })

function baseFiles(): Record<string, F> {
  return {
    [A]: { text: bigTranscript(), mtimeMs: NOW - 2 * H + 40_000 },
    [B]: { text: `${reply('b1', NOW - 2 * H, { input_tokens: 500, output_tokens: 10 }, 'Drafted the post.\nSecond line.', '/work/blog')}\n`, mtimeMs: NOW - 2 * H },
    [OLD]: { text: `${reply('o1', NOW - 30 * H, { input_tokens: 99 }, 'old', '/work/old')}\n`, mtimeMs: NOW - 30 * H },
    [`${CFG}/projects/-work-shop/sess-a/subagents/agent-1.jsonl`]: { text: `${reply('s1', NOW - 600_000, { input_tokens: 2000 }, 'sub', '/work/shop')}\n`, mtimeMs: NOW - 600_000 },
    [`${CFG}/projects/-work-shop/sess-a/subagents/agent-2.jsonl`]: { text: `${reply('s2', NOW - 3 * H, { input_tokens: 3000 }, 'sub', '/work/shop')}\n`, mtimeMs: NOW - 3 * H },
    [`${CFG}/sessions/111.json`]: { text: reg(111, 'sess-a', '/work/shop', 'busy'), mtimeMs: NOW },
  }
}

function fakeHost(on: OnT, opts: HostOpts = {}): Host {
  mock.store(on)
  mock.clock(on, { now: NOW })
  const files = new Map<string, F>(Object.entries(opts.files ?? baseFiles()))
  const host: Host = { files, reads: [], batches: [], wholeReads: [], copied: [], sent: [], toasts: [] }
  const alive = opts.alive ?? { 111: '0' }
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? '/home/t' : undefined }) as never)
  on('session.id', () => ({ value: 'me' }) as never)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: undefined }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('ui.toast', (_, e) => {
    host.toasts.push(e.text)
    return { value: undefined } as never
  })
  on('ui.copy', (_, e) => {
    host.copied.push(e.text)
    return { value: { isCopied: true } } as never
  })
  on('session.send', (_, e) => {
    host.sent.push({ to: e.to, text: e.text })
    return (opts.sendReason ? { isDelivered: false, reason: opts.sendReason } : { isDelivered: true }) as never
  })
  on('fs.list', (_, e) => {
    const dir = key(e.path)
    const out = new Map<string, { name: string; kind: 'file' | 'dir'; size: number; mtimeMs: number; isLink: boolean }>()
    for (const [p, f] of files) {
      if (!p.startsWith(`${dir}/`)) continue
      const rest = p.slice(dir.length + 1)
      const name = rest.split('/')[0] ?? ''
      out.set(name, rest.includes('/') ? { name, kind: 'dir', size: 0, mtimeMs: 0, isLink: false } : { name, kind: 'file', size: f.text.length, mtimeMs: f.mtimeMs, isLink: false })
    }
    if (out.size === 0) throw new Error('ENOENT')
    return { value: [...out.values()] } as never
  })
  on('fs.read', (_, e) => {
    const p = key(e.path)
    const f = files.get(p)
    if (!f) throw new Error('ENOENT')
    if (p.endsWith('.jsonl')) host.wholeReads.push(p)
    return { value: f.text } as never
  })
  // Stands for the two helper processes (sh or PowerShell): the batched range reader and the live-process check.
  on('process.run', (_, e) => {
    const env = e.init?.env ?? {}
    if (env.SB_PIDS !== undefined) {
      if (alive === 'fails') return { value: { exitCode: 127, stdout: '', stderr: 'not found' } } as never
      const out = env.SB_PIDS.split(/[ ,]/).filter(p => alive[Number(p)] !== undefined).map(p => `${p} ${alive[Number(p)]}`)
      return { value: { exitCode: 0, stdout: out.join('\n'), stderr: '' } } as never
    }
    const reqs = (env.SB_REQS ?? '').split('\n').filter(Boolean).map(l => {
      const [path = '', from = '0', len = '0'] = l.split('\t')
      return { path, from: Number(from), len: Number(len) }
    })
    host.batches.push(reqs)
    const lines = reqs.map(q => {
      host.reads.push(q)
      const f = files.get(key(q.path))
      if (!f || q.from === opts.failFrom) return '-'
      return btoa(f.text.slice(q.from, q.from + q.len))
    })
    return { value: { exitCode: 0, stdout: `${lines.join('\n')}\n`, stderr: '' } } as never
  })
  return host
}

async function open($: $T, on: OnT, opts: HostOpts = {}) {
  const h = fakeHost(on, opts)
  await $.session.start({ cwd: '/work/shop', surface: 'terminal', isInteractive: true })
  const r = await $.command.run({ command: 'sessions' } as never)
  return { h, r }
}

test('lists the last day\'s sessions costliest first, with context, handoff mark, usage, idle, subagents and last line', async ($, on) => {
  const { h, r } = await open($, on)
  expect(r.text).toBe('Session board opened: 2 sessions.')
  const ui = await $.ui.mount(PANE)
  const heads = (await ui.findAll({ type: 'Text', text: /running/ })).map(t => t.text)
  expect(heads).toEqual(['shop · running (busy)', 'blog · not running'])
  // The big transcript's today usage matches a full read of it, though only its tail was read.
  const full = scanRows(emptyScan(), h.files.get(A)?.text ?? '').byDay[dayKey(NOW)] ?? 0
  const subs = 2000 + 3000
  expect(full).toBe(40 * 1000 + 32_900) // every row from today, the one the chunk edge cuts through included
  const shopLine = (await ui.find({ type: 'Text', text: /HANDOFF DUE/ }))?.text ?? ''
  expect(shopLine).toBe(`ctx 330k HANDOFF DUE · today 78k · idle 1h 59m · 1 subagent (last hour)`)
  expect((await ui.find({ type: 'Text', text: /^ctx 510/ }))?.text).toBe('ctx 510 · today 550 · idle 2h')
  expect((await ui.find({ type: 'Text', text: /^Drafted/ }))?.text).toBe('Drafted the post. Second line.')
  expect((await ui.find({ type: 'Text', text: /^Today:/ }))?.text).toBe(`Today: ${tokens(full + subs + 550)} across 2 sessions · top session 99%`)
  expect(await ui.find({ type: 'Text', text: /old/ })).toBeUndefined() // 30 hours old: outside the window
  await ui.unmount()
})

test('files under 4 MiB are read whole without a process; a big one from the tail, back only to the start of today', async ($, on) => {
  const { h } = await open($, on)
  const size = h.files.get(A)?.text.length ?? 0
  expect(h.files.get(A)?.text[size - 3_000_000 - 1]).not.toBe('\n') // the chunk edge falls inside a row
  expect(h.reads).toEqual([
    { path: A, from: size - 3_000_000, len: 3_000_000 },
    { path: A, from: 0, len: size - 3_000_000 },
  ])
  expect(h.wholeReads.sort()).toEqual([B, `${CFG}/projects/-work-shop/sess-a/subagents/agent-1.jsonl`, `${CFG}/projects/-work-shop/sess-a/subagents/agent-2.jsonl`].sort())
  await $.command.run({ command: 'sessions' } as never) // nothing changed: nothing read
  expect(h.reads.length).toBe(2)
  expect(h.wholeReads.length).toBe(3)
})

test('grown files read only their new bytes, all of them in one process per refresh', async ($, on) => {
  const { h } = await open($, on)
  const a = h.files.get(A)
  const b = h.files.get(B)
  if (!a || !b) throw new Error('missing')
  const aSize = a.text.length
  const bSize = b.text.length
  a.text += `${reply('t-new', NOW - 60_000, { input_tokens: 4000, cache_read_input_tokens: 100_000 }, 'Merged it.', '/work/shop')}\n`
  a.mtimeMs = NOW - 60_000
  b.text += `${reply('b2', NOW - 30_000, { input_tokens: 100, output_tokens: 0 }, 'Posted.', '/work/blog')}\n`
  b.mtimeMs = NOW - 30_000
  const before = h.batches.length
  await $.command.run({ command: 'sessions' } as never)
  expect(h.batches.slice(before)).toEqual([
    [
      { path: B, from: bSize, len: b.text.length - bSize },
      { path: A, from: aSize, len: a.text.length - aSize },
    ].sort((x, y) => x.path.localeCompare(y.path)),
  ])
  expect(h.wholeReads.filter(p => p === B).length).toBe(1) // the small file was not read whole again
  const ui = await $.ui.mount(PANE)
  expect((await ui.find({ type: 'Text', text: /^ctx 104k/ }))?.text).toMatch(/· idle 1m · 1 subagent/)
  expect(await ui.find({ type: 'Text', text: 'Merged it.' })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /^ctx 100 /}))?.text).toBe('ctx 100 · today 650 · idle 30s')
  await ui.unmount()
})

test('a read that fails marks today\'s usage partial', async ($, on) => {
  await open($, on, { failFrom: 0 }) // the second, older chunk of the big transcript cannot be read
  const ui = await $.ui.mount(PANE)
  expect((await ui.find({ type: 'Text', text: /HANDOFF DUE/ }))?.text).toMatch(/· today \d+k \(partial\) ·/)
  await ui.unmount()
})

test('copy gives the resume command; hand-off asks a running session with a large context, in the agreed words', async ($, on) => {
  const { h } = await open($, on)
  const ui = await $.ui.mount(PANE)
  await $.ui.press({ plugin: 'session-board', key: 'sess-b-resume', requestId: 'session-board' })
  expect(h.copied).toEqual(['claude --resume sess-b'])
  expect(h.toasts.at(-1)).toBe('Copied. Run it in the blog folder.')
  expect(await ui.find({ type: 'Button', key: 'sess-b-handoff' })).toBeUndefined() // not running: nothing to ask
  await $.ui.press({ plugin: 'session-board', key: 'sess-a-handoff', requestId: 'session-board' })
  expect(h.sent.length).toBe(1)
  expect(JSON.stringify(h.sent[0]?.to)).toContain('sess-a')
  expect(h.sent[0]?.text).toBe(HANDOFF_TEXT)
  expect(h.toasts.at(-1)).toBe('Asked shop to hand off.')
  await ui.unmount()
})

test('no hand-off button for a running session under 100k context', async ($, on) => {
  const files = baseFiles()
  files[`${CFG}/sessions/222.json`] = { text: reg(222, 'sess-b', '/work/blog', 'idle'), mtimeMs: NOW }
  await open($, on, { files, alive: { 111: '0', 222: '0' } })
  const ui = await $.ui.mount(PANE)
  expect((await ui.find({ type: 'Text', text: /^blog/ }))?.text).toBe('blog · running (idle)')
  expect(await ui.find({ type: 'Button', key: 'sess-b-handoff' })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: 'sess-a-handoff' })).toBeDefined()
  await ui.unmount()
})

test('a registry entry whose process is gone is left over, and ages out past the window', async ($, on) => {
  const files = baseFiles()
  files[`${CFG}/sessions/333.json`] = { text: reg(333, 'sess-gone', '/work/gone', 'idle', NOW - 3 * H), mtimeMs: NOW - 3 * H }
  files[`${CFG}/sessions/444.json`] = { text: reg(444, 'sess-ancient', '/work/ancient', 'idle', NOW - 50 * H), mtimeMs: NOW - 50 * H }
  const { r } = await open($, on, { files, alive: {} }) // nothing is alive, 111 included
  expect(r.text).toBe('Session board opened: 3 sessions.')
  const ui = await $.ui.mount(PANE)
  expect((await ui.find({ type: 'Text', text: /^shop/ }))?.text).toBe('shop · not running (left over)')
  expect((await ui.find({ type: 'Text', text: /^gone/ }))?.text).toBe('gone · not running (left over)')
  expect(await ui.find({ type: 'Text', text: /^ancient/ })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: 'sess-a-handoff' })).toBeUndefined()
  await ui.unmount()
})

test('with no way to check processes, a recent registry update counts as running', async ($, on) => {
  const files = baseFiles()
  files[`${CFG}/sessions/111.json`] = { text: reg(111, 'sess-a', '/work/shop', 'busy', NOW - 60_000), mtimeMs: NOW }
  files[`${CFG}/sessions/222.json`] = { text: reg(222, 'sess-b', '/work/blog', 'idle', NOW - 10 * 60_000), mtimeMs: NOW }
  await open($, on, { files, alive: 'fails' })
  const ui = await $.ui.mount(PANE)
  expect((await ui.find({ type: 'Text', text: /^shop/ }))?.text).toBe('shop · running (busy)')
  expect((await ui.find({ type: 'Text', text: /^blog/ }))?.text).toBe('blog · not running (left over)')
  await ui.unmount()
})

test('keys in the last line are hidden', async ($, on) => {
  const files = baseFiles()
  files[B] = { text: `${reply('b1', NOW - 2 * H, { input_tokens: 5 }, 'Set OPENAI to sk-proj-abcdef1234567890 and ghp_abcdefghij1234567890 then Bearer eyJhbGciOi.x', '/work/blog')}\n`, mtimeMs: NOW - 2 * H }
  await open($, on, { files })
  const ui = await $.ui.mount(PANE)
  expect((await ui.find({ type: 'Text', text: /^Set OPENAI/ }))?.text).toBe('Set OPENAI to [hidden] and [hidden] then Bearer [hidden]')
  await ui.unmount()
})

test('a failed send says why', async ($, on) => {
  const h = fakeHost(on, { sendReason: 'that session is not running' })
  await $.session.start({ cwd: '/work/shop', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'sessions' } as never)
  const ui = await $.ui.mount(PANE)
  await $.ui.press({ plugin: 'session-board', key: 'sess-a-handoff', requestId: 'session-board' })
  expect(h.toasts.at(-1)).toBe('Could not reach shop: that session is not running')
  await ui.unmount()
})

test('handoffAt and hours are settings', { options: { handoffAt: 500_000, hours: 48 } }, async ($, on) => {
  await open($, on)
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /HANDOFF DUE/ })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /^old · not running$/ }))?.text).toBe('old · not running') // 30 hours: inside 48
  await ui.unmount()
})

test('no sessions at all says so', async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: NOW })
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? '/home/t' : undefined }) as never)
  on('session.id', () => ({ value: 'me' }) as never)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: undefined }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('fs.list', () => {
    throw new Error('ENOENT')
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const r = await $.command.run({ command: 'sessions' } as never)
  expect(r.text).toBe('Session board opened: 0 sessions.')
  const ui = await $.ui.mount(PANE)
  expect((await ui.find({ type: 'Text', text: /^No sessions/ }))?.text).toBe('No sessions in the last 24 hours under /home/t/.claude.')
  await ui.unmount()
})
