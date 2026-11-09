import { expect, test } from 'claude-code/testing'

import { completeRows, dayKey, emptyScan, idle, isHandoffDue, maskSecrets, scanRows, sortRows, totals, units } from '../hooks/parse.ts'

const NOW = new Date(2026, 10, 9, 12, 0, 0).getTime()
const iso = (ms: number) => new Date(ms).toISOString()
const reply = (id: string, at: number, usage: object, text = '', extra: object = {}) =>
  JSON.stringify({ type: 'assistant', timestamp: iso(at), cwd: '/work/shop', message: { id, model: 'm', usage, content: text ? [{ type: 'text', text }] : [{ type: 'tool_use' }] }, ...extra })

test('usage is costed in input-token equivalents: read 0.1, write 1.25 or 2, output 5', () => {
  expect(units({ input_tokens: 100, cache_read_input_tokens: 1000, cache_creation_input_tokens: 300, cache_creation: { ephemeral_5m_input_tokens: 200, ephemeral_1h_input_tokens: 100 }, output_tokens: 10 })).toBe(700)
  expect(units({ cache_creation_input_tokens: 400 })).toBe(500) // no split: 1.25
})

test('a transcript tail gives context size, usage per day, the last text and the folder', () => {
  const u1 = { input_tokens: 10, cache_read_input_tokens: 100_000, output_tokens: 20 }
  const u2 = { input_tokens: 5, cache_read_input_tokens: 200_000, cache_creation_input_tokens: 1000, output_tokens: 50 }
  const text = [
    reply('m1', NOW - 30 * 3_600_000, u1, 'yesterday'),
    reply('m2', NOW - 3_600_000, u2, 'Pushed the fix.'),
    reply('m2', NOW - 3_600_000 + 5, u2), // the same reply's tool-use row repeats its usage: counted once
    JSON.stringify({ type: 'assistant', timestamp: iso(NOW - 60_000), isSidechain: true, message: { id: 'side', model: 'm', usage: u1, content: [{ type: 'text', text: 'side' }] } }),
    JSON.stringify({ type: 'assistant', timestamp: iso(NOW - 30_000), message: { id: 'syn', model: '<synthetic>', usage: u1, content: [{ type: 'text', text: 'No response requested.' }] } }),
    '{"type":"user","timestamp":"broken',
  ].join('\n')
  const s = scanRows(emptyScan(), text)
  expect(s.context).toBe(5 + 200_000 + 1000 + 50)
  expect(s.lastText).toBe('Pushed the fix.')
  expect(s.cwd).toBe('/work/shop')
  expect(s.byDay[dayKey(NOW)]).toBe(units(u2) + units(u1)) // the sidechain row's usage still costs
  expect(s.byDay[dayKey(NOW - 30 * 3_600_000)]).toBe(units(u1))
})

test('an older chunk read later never replaces the newer context or text', () => {
  const s = scanRows(emptyScan(), reply('new', NOW - 60_000, { input_tokens: 500 }, 'newest words'))
  scanRows(s, reply('old', NOW - 7_200_000, { input_tokens: 9 }, 'older words'))
  expect(s.lastText).toBe('newest words')
  expect(s.context).toBe(500)
})

test('a subagent transcript adds usage but not the session context or text', () => {
  const s = scanRows(emptyScan(), reply('a', NOW, { input_tokens: 40 }, 'agent text'), false)
  expect(s.context).toBe(0)
  expect(s.lastText).toBe('')
  expect(s.byDay[dayKey(NOW)]).toBe(40)
})

test('only complete rows are taken from a byte range; a mid-file start drops the partial first line', () => {
  const bytes = new TextEncoder().encode('tail of a row}\n{"a":1}\n{"b":2}\n{"c":')
  expect(completeRows(bytes, false)).toEqual({ text: '{"a":1}\n{"b":2}\n', skipped: 15, used: 31 })
  expect(completeRows(bytes, true).text.startsWith('tail of a row}')).toBe(true)
  expect(completeRows(new TextEncoder().encode('no newline'), false)).toEqual({ text: '', skipped: 0, used: 0 })
})

test('costliest first, ties to the most recent; totals give the top share', () => {
  const rows = [
    { id: 'a', usageToday: 100, lastActiveAt: 5 },
    { id: 'b', usageToday: 300, lastActiveAt: 1 },
    { id: 'c', usageToday: 100, lastActiveAt: 9 },
  ]
  expect(sortRows(rows).map(r => r.id)).toEqual(['b', 'c', 'a'])
  expect(totals(rows)).toEqual({ total: 500, topShare: 60 })
  expect(totals([])).toEqual({ total: 0, topShare: 0 })
})

test('the handoff mark is at or above the setting; idle time reads plainly', () => {
  expect(isHandoffDue(250_000, 250_000)).toBe(true)
  expect(isHandoffDue(249_999, 250_000)).toBe(false)
  expect([idle(40_000), idle(12 * 60_000), idle(185 * 60_000), idle(50 * 3_600_000)]).toEqual(['40s', '12m', '3h 5m', '2d'])
})

test('key-like strings are hidden; ordinary words are not', () => {
  const keys = ['sk-ant-api03-abcdefgh', 'ghp_abcdefgh1234', 'gho_abcdefgh1234', 'github_pat_11ABCDEFG_xyz', 'AKIAIOSFODNN7EXAMPLE', 'xoxb-1234-5678', 'xoxp-abcd-efgh']
  for (const k of keys) expect(maskSecrets(`key ${k} end`)).toBe('key [hidden] end')
  expect(maskSecrets('auth: Bearer abc.def.ghi done')).toBe('auth: Bearer [hidden] done')
  expect(maskSecrets('here -----BEGIN OPENSSH PRIVATE KEY----- abc')).toBe('here [hidden]')
  expect(maskSecrets('the task-runner and desk-top stay')).toBe('the task-runner and desk-top stay')
})