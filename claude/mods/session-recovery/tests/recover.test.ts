import { expect, test } from 'claude-code/testing'

import { type Rec, candidates, wtArgv } from '../hooks/recover.ts'

const NOW = 1_000_000_000_000
const BOOT = NOW - 30 * 60_000
const rec = (id: string, lastBeatAgoMin: number, extra: Partial<Rec> = {}): Rec => ({
  id,
  cwd: `C:/p/${id}`,
  title: `task ${id}`,
  startedAt: 0,
  lastBeat: NOW - lastBeatAgoMin * 60_000,
  ended: false,
  isInteractive: true,
  ...extra,
})

test('only dead, unclean, interactive sessions; boot victims first', async () => {
  const list = candidates(
    [rec('alive', 1), rec('killed', 45), rec('closed', 50, { ended: true }), rec('old', 60 * 24 * 9), rec('headless', 45, { isInteractive: false }), rec('crashed', 10), rec('self', 45)],
    NOW,
    BOOT,
    'self',
  )
  expect(list.map(c => c.id)).toEqual(['killed', 'crashed'])
  expect(list[0]?.isFromBeforeBoot).toBe(true)
  expect(list[1]?.isFromBeforeBoot).toBe(false)
})

test('one wt call opens a tab per session', async () => {
  expect(wtArgv([rec('a', 40, { title: 'fix; the thing' }), rec('b', 40)])).toEqual([
    'wt', '-w', '0',
    'new-tab', '-d', 'C:/p/a', '--title', 'fix the thing', 'claude', '--resume', 'a',
    ';',
    'new-tab', '-d', 'C:/p/b', '--title', 'task b', 'claude', '--resume', 'b',
  ])
})
