import { type TestBody, expect, mock, test } from 'claude-code/testing'

import { DAY, HOUR, LineFeeder, beforeAfter, beforeAfterLines, newEntry } from '../hooks/core.ts'
import type { Report } from '../types'

type $T = Parameters<TestBody>[0]
type OnT = Parameters<TestBody>[1]

const NOW = Date.parse('2026-06-15T12:00:00Z')
const HOME = '/home/t'
const PROJ = `${HOME}/.claude/projects`
const key = (p: string) => p.replace(/\\/g, '/').replace(/^[a-z]:/i, '')

type U = { fresh?: number; write?: number; read?: number; out?: number; w1h?: number }
const line = (id: string, minsAgo: number, u: U, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    timestamp: new Date(NOW - minsAgo * 60_000).toISOString(),
    cwd: '/work/secret-project',
    ...extra,
    message: {
      id,
      usage: {
        input_tokens: u.fresh ?? 0,
        cache_creation_input_tokens: u.write ?? 0,
        cache_read_input_tokens: u.read ?? 0,
        output_tokens: u.out ?? 0,
        cache_creation: { ephemeral_1h_input_tokens: u.w1h ?? 0 },
      },
    },
  })

// A main session: a cold first call, growth, a crossing of the 250k handoff mark, then a real compaction's drop
// (a cold call at 50k). Row 2 is logged twice (two content blocks of one call) and a sidechain row is skipped.
const MAIN = [
  line('m1', 60, { write: 100_000, out: 1000 }),
  line('m2', 50, { write: 100_000, read: 100_000, out: 1000 }),
  line('m2', 50, { write: 100_000, read: 100_000, out: 1000 }),
  line('side', 45, { write: 999_999 }, { isSidechain: true }),
  JSON.stringify({ type: 'user', message: { content: 'no usage here' } }),
  line('m3', 40, { write: 60_000, read: 200_000, out: 1000 }),
  line('m4', 30, { write: 50_000, out: 1000 }),
].join('\n')
// Logged: 130,000 + 140,000 + 100,000 + 67,500. Replayed: 130,000 + 140,000 + handoff (26,000 + 20,000 + 70,000)
// + 48,750 + a cold rewrite of the simulated 35k, 48,750.
const MAIN_LOGGED = 437_500
const MAIN_SIM = 483_500

// A subagent: a cold 240k call, then a 1-hour-cache write that takes it past 250k, so it compacts to 85k.
const SUB = [line('s1', 30, { write: 240_000 }), line('s2', 20, { write: 20_000, w1h: 20_000, read: 240_000 })].join('\n')
const SUB_LOGGED = 364_000 // 300,000 + 2 x 20,000 + 0.1 x 240,000
const SUB_SIM = 346_500 // 300,000 + 2 x 20,000 + 0.1 x 65,000

type File = { text: string; size?: number; mtime?: number }
type Host = { files: Map<string, File>; reads: string[]; spawns: string[][]; store: Map<string, unknown>; clock: ReturnType<typeof mock.clock> }

function fakeHost(on: OnT, files: Record<string, File>, env: Record<string, string> = {}): Host {
  const clock = mock.clock(on, { now: NOW })
  const host: Host = { files: new Map(Object.entries(files).map(([p, f]) => [key(p), f])), reads: [], spawns: [], store: new Map(), clock }
  on('store.get', (_, e) => ({ value: structuredClone(host.store.get((e as unknown as { key: string }).key)) }) as never)
  on('store.set', (_, e) => {
    const { key: k, value } = e as unknown as { key: string; value: unknown }
    host.store.set(k, structuredClone(value))
    return { value: undefined } as never
  })
  on('store.keys', () => ({ value: [...host.store.keys()] }) as never)
  on('store.delete', (_, e) => {
    host.store.delete((e as unknown as { key: string }).key)
    return { value: undefined } as never
  })
  on('env.get', (_, e) => ({ value: { HOME, ...env }[(e as unknown as { name: string }).name] }) as never)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: undefined }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('fs.exists', (_, e) => ({ value: host.files.has(key((e as unknown as { path: string }).path)) }) as never)
  on('fs.list', (_, e) => {
    const dir = key((e as unknown as { path: string }).path)
    const kids = new Map<string, { name: string; kind: 'file' | 'dir'; size: number; mtimeMs: number; isLink: boolean }>()
    for (const [p, f] of host.files) {
      if (!p.startsWith(`${dir}/`)) continue
      const [name = '', ...more] = p.slice(dir.length + 1).split('/')
      kids.set(name, more.length ? { name, kind: 'dir', size: 0, mtimeMs: 0, isLink: false } : { name, kind: 'file', size: f.size ?? f.text.length, mtimeMs: f.mtime ?? NOW - HOUR, isLink: false })
    }
    if (kids.size === 0) throw new Error('ENOENT')
    return { value: [...kids.values()] } as never
  })
  on('fs.read', (_, e) => {
    const p = key((e as unknown as { path: string }).path)
    const f = host.files.get(p)
    if (!f) throw new Error('ENOENT')
    if (p.endsWith('.jsonl')) host.reads.push(p)
    return { value: f.text } as never
  })
  on('process.spawn', async function* (_, e) {
    const argv = [...(e as unknown as { argv: string[] }).argv]
    host.spawns.push(argv)
    const target = argv.at(-1) ?? ''
    const f = host.files.get(key(target.startsWith('file:///') ? decodeURIComponent(target.slice(8)) : target))
    const from = argv[0] === 'tail' ? Number((argv[2] ?? '').slice(1)) - 1 : Number((argv[4] ?? '').slice(0, -1)) // tail -c +N, or curl -r N-
    if (f) yield { stream: 'stdout' as const, text: f.text.slice(from) }
    return { value: { code: f ? 0 : 1, signal: null } } as never
  })
  return host
}

const tree = (extra: Record<string, File> = {}): Record<string, File> => ({
  [`${PROJ}/-work-secret-project/sess-a.jsonl`]: { text: MAIN },
  [`${PROJ}/-work-secret-project/sess-a/subagents/agent-1.jsonl`]: { text: SUB },
  [`${PROJ}/-work-secret-project/sess-a/subagents/agent-1.meta.json`]: { text: JSON.stringify({ agentType: 'builder' }) },
  ...extra,
})
const start = ($: $T) => $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
/** Runs /ystack-stats and lets the count it starts finish; answers the report it saved. */
async function count($: $T, h: Host): Promise<Report | undefined> {
  h.store.delete('report')
  await $.command.run({ command: 'ystack-stats', args: '' } as never)
  await h.clock.settle()
  return h.store.get('report') as Report | undefined
}

test('the replay re-prices calls with a cold rewrite, a handoff and a compaction drop, and dedupes message ids', async ($, on) => {
  const h = fakeHost(on, tree())
  await start($)
  const r = await count($, h)
  expect(r?.replay).toEqual({ loggedMain: MAIN_LOGGED, simMain: MAIN_SIM, loggedSub: SUB_LOGGED, simSub: SUB_SIM, handoffs: 1, compactions: 1, callsMain: 4, callsSub: 2 })
  expect(r?.byType.map(t => t.type)).toEqual(['main sessions', 'subagent: builder'])
  expect(r?.ctx.before).toEqual({ median: 260_000, low: 260_000, high: 260_000, n: 1 })
  expect(r?.ctx.after?.median).toBe(50_000)
  expect(r?.ctx.fresh?.median).toBe(100_000)
  expect(r?.top).toEqual([{ folder: 'secret-project', weight: MAIN_LOGGED + SUB_LOGGED, share: 1, hours: 0.5, peak: 260_000 }])
})

test('calls older than the window, and files not touched in it, are left out', async ($, on) => {
  const old = Array.from({ length: 2 }, (_, i) => line(`o${i}`, 20 * 24 * 60, { write: 500_000 })).join('\n')
  const h = fakeHost(on, tree({ [`${PROJ}/-x/old.jsonl`]: { text: old, mtime: NOW - 20 * DAY }, [`${PROJ}/-x/mixed.jsonl`]: { text: `${old}\n${line('n1', 10, { write: 30_000 })}` } }))
  await start($)
  const r = await count($, h)
  expect(h.reads).not.toContain(`${PROJ}/-x/old.jsonl`)
  expect(r?.replay.callsMain).toBe(5) // 4 + the one recent call of mixed.jsonl
})

test('a second count reads nothing that did not change, and a changed file again', async ($, on) => {
  const h = fakeHost(on, tree())
  await start($)
  await count($, h)
  expect(h.reads.length).toBe(2)
  h.reads.length = 0
  const again = await count($, h)
  expect(h.reads).toEqual([])
  expect(again?.replay.loggedMain).toBe(MAIN_LOGGED)
  const p = key(`${PROJ}/-work-secret-project/sess-a.jsonl`)
  h.files.set(p, { text: `${MAIN}\n${line('m5', 5, { read: 50_000 })}` })
  const third = await count($, h)
  expect(h.reads).toEqual([p])
  expect(third?.replay.callsMain).toBe(5)
})

test('a log too big to read at once streams through a child, and a grown one is read on from where it stopped', async ($, on) => {
  const BIG = 5 * 1024 * 1024
  const p = `${PROJ}/-work-secret-project/sess-a.jsonl`
  const h = fakeHost(on, tree({ [p]: { text: `${MAIN}\n`, size: BIG } }))
  await start($)
  const r = await count($, h)
  expect(h.spawns).toEqual([['tail', '-c', '+1', p]])
  expect(r?.replay.simMain).toBe(MAIN_SIM)
  h.files.set(key(p), { text: `${MAIN}\n${line('m5', 5, { read: 50_000 })}\n`, size: BIG + 500 })
  const r2 = await count($, h)
  expect(h.spawns[1]).toEqual(['tail', '-c', `+${MAIN.length + 1}`, p]) // from the newline before the new line
  expect(r2?.replay.callsMain).toBe(5)
  expect(r2?.replay.loggedMain).toBe(MAIN_LOGGED + 5_000)
})

test('on Windows a big log is read with curl, and a missing curl counts the file as unread', async ($, on) => {
  const p = `${PROJ}/-work-secret-project/sess-a.jsonl`
  const h = fakeHost(on, tree({ [p]: { text: MAIN, size: 5 * 1024 * 1024 } }), { SystemRoot: 'C:\\Windows' })
  await start($)
  const r = await count($, h)
  expect(h.spawns).toEqual([])
  expect(r?.replay.callsMain).toBe(0)
  const ui = await $.ui.mount(PANE)
  expect((await ui.find({ type: 'Text', text: /could not be read/ }))?.text).toContain('1 could not be read')
  await ui.unmount()
})

test('on Windows curl reads a big log by a file URL', async ($, on) => {
  const p = 'C:/Users/t/.claude/projects/-w/my session.jsonl'
  const h = fakeHost(on, { [p]: { text: MAIN, size: 5 * 1024 * 1024 }, 'C:/Windows/System32/curl.exe': { text: '' } }, { SystemRoot: 'C:\\Windows', USERPROFILE: 'C:\\Users\\t' })
  await start($)
  const r = await count($, h)
  expect(h.spawns).toEqual([['C:/Windows/System32/curl.exe', '-s', '-f', '-r', '0-', 'file:///C:/Users/t/.claude/projects/-w/my%20session.jsonl']])
  expect(r?.replay.callsMain).toBe(4)
})

test('"not enough data yet" until three days on each side of the install', async ($, on) => {
  const installed = JSON.stringify({ plugins: { 'context-meter@ystack': [{ installedAt: new Date(NOW - 2 * DAY).toISOString() }], 'other@elsewhere': [{ installedAt: '2020-01-01T00:00:00Z' }] } })
  const h = fakeHost(on, tree({ [`${HOME}/.claude/plugins/installed_plugins.json`]: { text: installed } }))
  await start($)
  const r = await count($, h)
  expect(r?.beforeAfter).toMatchObject({ source: 'installed', installAt: NOW - 2 * DAY })
  expect(r?.beforeAfter?.change).toBeUndefined()
  expect(beforeAfterLines(r?.beforeAfter ?? null)).toContain('not enough data yet: 2 days since install')
})

/** One call of `w` in each of `n` consecutive hours, starting `fromDaysAgo` days before NOW. */
function activeHours(f: LineFeeder, tag: string, fromDaysAgo: number, n: number, w: number) {
  for (let i = 0; i < n; i++) f.push(`${line(`${tag}${i}`, fromDaysAgo * 24 * 60 - i * 60, { fresh: w })}\n`)
}

test('with enough days and active hours on both sides the change per active hour is shown', async () => {
  const e = newEntry({ kind: 'main', session: 's', size: 0, mtime: 0 }, 0)
  const f = new LineFeeder(e, new Set())
  activeHours(f, 'b', 10, 60, 1000) // 60 hours of 1,000 each, five days before the install
  activeHours(f, 'a', 4, 50, 500) // 50 hours of 500 since
  const b = beforeAfter([e], { at: NOW - 5 * DAY, source: 'installed' }, 14, NOW)
  expect(b.before).toEqual({ hours: 60, perHour: 1000 })
  expect(b.after).toEqual({ hours: 50, perHour: 500 })
  expect(b.change).toBe(-0.5)
  const words = beforeAfterLines(b)
  expect(words[0]).toContain('Per active hour; workload and model changes also show up here.')
  expect(words).toContain('50% less per active hour')
})

test('the split is hidden while either side has fewer than 50 active hours, even with days to spare', async () => {
  const e = newEntry({ kind: 'main', session: 's', size: 0, mtime: 0 }, 0)
  const f = new LineFeeder(e, new Set())
  activeHours(f, 'b', 10, 60, 1000)
  activeHours(f, 'a', 4, 49, 500)
  const b = beforeAfter([e], { at: NOW - 5 * DAY, source: 'installed' }, 14, NOW)
  expect(b.change).toBeUndefined()
  expect(b.before).toBeUndefined()
  expect(beforeAfterLines(b)).toContain('not enough data yet: 60 active hours before and 49 after (50 needed on each side)')
})

test('before/after splits at the later of the install and the first ystack-setup Apply', async ($, on) => {
  const installed = JSON.stringify({ plugins: { 'context-meter@ystack': [{ installedAt: new Date(NOW - 10 * DAY).toISOString() }] } })
  const h = fakeHost(
    on,
    tree({
      [`${HOME}/.claude/plugins/installed_plugins.json`]: { text: installed },
      [`${HOME}/.claude/settings.json`]: { text: '{}' },
      [`${HOME}/.claude/settings.json.bak-ystack-2026-06-11`]: { text: '{}', mtime: NOW - 4 * DAY }, // the first Apply
      [`${HOME}/.claude/settings.json.bak-ystack-2026-06-11-2`]: { text: '{}', mtime: NOW - 2 * DAY },
    }),
  )
  await start($)
  const r = await count($, h)
  expect(r?.beforeAfter).toMatchObject({ source: 'setup', installAt: NOW - 4 * DAY })
  expect(beforeAfterLines(r?.beforeAfter ?? null)[0]).toContain('when ystack-setup was applied')
  // An Apply before the install leaves the install as the split.
  h.files.set(`${HOME}/.claude/settings.json.bak-ystack-2026-06-11`, { text: '{}', mtime: NOW - 12 * DAY })
  h.files.delete(`${HOME}/.claude/settings.json.bak-ystack-2026-06-11-2`)
  const r2 = await count($, h)
  expect(r2?.beforeAfter).toMatchObject({ source: 'installed', installAt: NOW - 10 * DAY })
})

test('a log line over 2 MB is skipped unparsed and quickly, and offsets stay right', async () => {
  const e = newEntry({ kind: 'main', session: 's', size: 0, mtime: 0 }, 0)
  const f = new LineFeeder(e, new Set())
  const huge = `{"type":"user","message":{"content":"${'é'.repeat(20 * 1024 * 1024)}"}}\n` // 40 MB in UTF-8
  const usage = `${line('u1', 5, { fresh: 10 })}\n`
  const all = `${huge}${usage}${'x'.repeat(3 * 1024 * 1024)}\n${usage}`
  const t0 = performance.now()
  for (let i = 0; i < all.length; i += 65_536) f.push(all.slice(i, i + 65_536))
  f.end()
  expect(performance.now() - t0).toBeLessThan(1500)
  expect(e.n).toBe(1) // the second usage line repeats the id
  expect(e.longLines).toBe(2)
  expect(e.offset).toBe(new TextEncoder().encode(all).length)
})

test('without an install record, the first load stands in for the install', async ($, on) => {
  const h = fakeHost(on, tree())
  await start($)
  const r = await count($, h)
  expect(r?.beforeAfter).toMatchObject({ source: 'first-load', installAt: NOW, daysSince: 0 })
})

const PANE = {
  plugin: 'ystack-stats',
  component: 'Pane',
  requestId: 'ystack-stats',
  surface: 'terminal',
  props: { title: 'ystack stats', isFocused: true, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

test('the pane shows the estimate, its labels and the top session by folder name only', async ($, on) => {
  const h = fakeHost(on, tree())
  await start($)
  const before = await $.ui.mount(PANE)
  expect(await before.find({ type: 'Text', text: /No count yet/ })).toBeDefined()
  await before.unmount()
  await count($, h)
  const ui = await $.ui.mount(PANE)
  expect((await ui.find({ type: 'Text', text: /What-if replay/ }))?.text).toContain('an estimate')
  expect((await ui.find({ type: 'Text', text: /^with ystack/ }))?.text).toBe('with ystack   0.8M   about 4% more') // 830,000 vs 801,500: this tiny log pays for a handoff it barely uses
  expect((await ui.find({ type: 'Text', text: /^secret-project:/ }))?.text).toContain('peak context 260k')
  expect(await ui.find({ type: 'Text', text: /\/work\/secret-project/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Not modelled/ })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /^main sessions/ }))?.text).toContain('up to ')
  expect(await ui.find({ type: 'Text', text: /hands off at every crossing of its mark \(250k, its default\)\. That is the upper end/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /holds only for agent types set up that way/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /a model switch is not counted/ })).toBeDefined()
  expect(await ui.find({ type: 'Button' })).toBeDefined()
  await ui.unmount()
})

test('/ystack-stats share prints numbers only, once a fresh count exists', async ($, on) => {
  const h = fakeHost(on, tree())
  await start($)
  const first = await $.command.run({ command: 'ystack-stats', args: 'share' } as never)
  expect(first.text).toContain('Counting your logs now')
  await count($, h)
  const r = await $.command.run({ command: 'ystack-stats', args: 'share' } as never)
  expect(r.text).toContain('**ystack what-if, my last 14 days**')
  expect(r.text).toContain('(an estimate, in input-token equivalents of the same model)')
  expect(r.text).toMatch(/with ystack's rules: 0\.8M \(\*\*about 4% more\*\*\)/)
  expect(r.text).toContain('up to 11% more (handing off at every crossing of 250k; real handoffs wait for a boundary)')
  expect(r.text).toContain('compacting at 250k, for agent types set up that way')
  expect(r.text).not.toContain('per active hour') // no before/after split yet, so no claim
  expect(r.text).not.toContain('secret-project')
})

test('the days setting sets the window', { options: { days: 1 } }, async ($, on) => {
  const old = line('o1', 2 * 24 * 60, { write: 40_000 })
  const h = fakeHost(on, tree({ [`${PROJ}/-x/two-days.jsonl`]: { text: old } }))
  await start($)
  const r = await count($, h)
  expect(r?.days).toBe(1)
  expect(r?.replay.callsMain).toBe(4)
})
