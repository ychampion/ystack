import { expect, test } from 'claude-code/testing'

import { activeHours, digestMarkdown, emptyUsage, parseDays, plainSubject, scanUsage, uncovered } from '../hooks/core.ts'
import type { RepoReport } from '../hooks/core.ts'

const NOW = new Date(2026, 10, 9, 12, 0, 0).getTime()
const row = (id: string, at: number, cwd: string, usage: object) => JSON.stringify({ type: 'assistant', timestamp: new Date(at).toISOString(), cwd, message: { id, model: 'm', usage } })

test('days: a whole number from 1 to 90, else 7', () => {
  expect([parseDays(''), parseDays('3'), parseDays(' 30 '), parseDays('0'), parseDays('400'), parseDays('week')]).toEqual([7, 3, 30, 7, 7, 7])
})

test('usage keeps only replies inside the window, counts a reply once, and groups by working folder', () => {
  const since = NOW - 7 * 86_400_000
  const text = [
    row('a', NOW - 3_600_000, '/work/shop', { input_tokens: 100, output_tokens: 10 }),
    row('a', NOW - 3_600_000 + 5, '/work/shop', { input_tokens: 100, output_tokens: 10 }), // same reply, second row
    row('b', NOW - 3_000_000, '/work/shop', { cache_read_input_tokens: 1000, output_tokens: 0 }),
    row('c', NOW - 2_000_000, '/home/t', { input_tokens: 7, output_tokens: 1 }),
    row('old', since - 1, '/work/shop', { input_tokens: 999, output_tokens: 1 }),
    '{"type":"assistant","output_tokens": broken',
  ].join('\n')
  const s = scanUsage(emptyUsage(), text, since, NOW)
  expect(s.byCwd['/work/shop']?.units).toBe(150 + 100)
  expect(s.byCwd['/work/shop']?.slots.length).toBe(2) // two separate 10-minute slots
  expect(s.byCwd['/home/t']?.units).toBe(12)
})

test('active hours round to the half hour; commit subjects read plainly', () => {
  expect(activeHours([])).toBe(0)
  expect(activeHours([1])).toBe(0.5)
  expect(activeHours([1, 2, 3])).toBe(0.5)
  expect(activeHours([1, 1, 2, 3, 4, 5, 6, 7, 8, 9])).toBe(1.5)
  expect(plainSubject('feat(api): add rate limits')).toBe('Add rate limits')
  expect(plainSubject('fix!: stop the crash')).toBe('Stop the crash')
  expect(plainSubject('Update README')).toBe('Update README')
})

test('commits a merged PR covers are not listed twice', () => {
  const commits = [
    { hash: '1', email: 'a', subject: 'Add checkout (#12)' },
    { hash: '2', email: 'a', subject: 'New pricing page' },
    { hash: '3', email: 'a', subject: 'Fix tax rounding' },
    { hash: '4', email: 'a', subject: 'Other thing (#99)' },
  ]
  expect(uncovered(commits, [{ number: 12, title: 'Add checkout' }, { number: 13, title: 'New pricing page' }]).map(c => c.hash)).toEqual(['3', '4'])
})

const repo = (over: Partial<RepoReport>): RepoReport => ({
  name: 'r',
  path: '/w/r',
  commits: [],
  hasRemote: true,
  merged: [],
  open: [],
  branches: [],
  uncommitted: 0,
  decisions: [],
  usage: { units: 0, slots: [] },
  prNote: '',
  ...over,
})

test('the digest groups by repo, costliest first, and caps long lists', () => {
  const many = Array.from({ length: 15 }, (_, i) => ({ hash: `${i}`, email: 'a', subject: `chore: step ${i}` }))
  const md = digestMarkdown({
    since: NOW - 7 * 86_400_000,
    now: NOW,
    days: 7,
    repos: [repo({ name: 'small', usage: { units: 100, slots: [1] } }), repo({ name: 'big', commits: many, usage: { units: 900, slots: [1, 2, 3] } })],
    outside: { units: 0, slots: [] },
    otherDecisions: [],
    notes: [],
  })
  expect(md.startsWith('# Digest: 2 Nov 2026 to 9 Nov 2026 (7 days)\n')).toBe(true)
  expect(md.indexOf('## big')).toBeLessThan(md.indexOf('## small'))
  expect(md).toContain('- 0 merged PRs, 15 pushed commits.')
  expect(md).toContain('- Step 11\n- and 3 more')
  expect(md).toContain('- About 0.5 active hours, 900 input-token equivalents (90% of the total).')
  expect(md).toContain('## small\n\nFolder: /w/r\n\n**Shipped**\n\n- Nothing shipped.')
  expect(md).not.toContain('**In flight**')
  expect(md).not.toContain('**Needs you**')
})

test('no repos says so', () => {
  const md = digestMarkdown({ since: NOW - 86_400_000, now: NOW, days: 1, repos: [], outside: { units: 0, slots: [] }, otherDecisions: [], notes: [] })
  expect(md).toContain('(1 day)')
  expect(md).toContain('No repos were touched in this period.')
})
