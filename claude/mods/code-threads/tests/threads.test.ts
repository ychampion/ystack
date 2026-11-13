import { expect, test } from 'claude-code/testing'

import { commitDir, keepPrompts, lastReasoning, parseTarget, shasIn, show } from '../hooks/threads'

test('a commit command is recognised, with -C and -c before it; other git commands are not', async () => {
  expect(commitDir('git commit -m "x"', '/r')).toBe('/r')
  expect(commitDir('git add -A && git -c user.name=a commit -F m.txt', '/r')).toBe('/r')
  expect(commitDir('git -C sub commit -m x', '/r')).toBe('/r/sub')
  expect(commitDir('git -C "C:/w/repo" commit -m x', '/r')).toBe('C:/w/repo')
  expect(commitDir('git commit --dry-run', '/r')).toBeUndefined()
  expect(commitDir('git log --oneline', '/r')).toBeUndefined()
  expect(commitDir('echo git commit-tree', '/r')).toBeUndefined()
})

test('/why targets: file:line, #L, a space, or a whole file', async () => {
  expect(parseTarget('src/a.ts:42')).toEqual({ file: 'src/a.ts', line: 42 })
  expect(parseTarget('src/a.ts#L7')).toEqual({ file: 'src/a.ts', line: 7 })
  expect(parseTarget('src/a.ts 9')).toEqual({ file: 'src/a.ts', line: 9 })
  expect(parseTarget('C:/w/a.ts:3')).toEqual({ file: 'C:/w/a.ts', line: 3 })
  expect(parseTarget('README.md')).toEqual({ file: 'README.md' })
  expect(parseTarget('  ')).toBeUndefined()
})

test('prompts: the last three, slash commands left out', async () => {
  let p: string[] = []
  for (const t of ['one', '/ctx', 'two', 'three', 'four']) p = keepPrompts(p, t)
  expect(p).toEqual(['two', 'three', 'four'])
})

test('reasoning: the last assistant words before the commit, newest last', async () => {
  const r = lastReasoning([
    { role: 'assistant', text: 'old' },
    { role: 'user', text: 'do it' },
    { role: 'assistant', text: 'Using a map because lookups are hot.' },
    { role: 'assistant', text: '' },
  ])
  expect(r).toEqual(['old', 'Using a map because lookups are hot.'])
})

test('commit ids from git log output, uncommitted lines dropped', async () => {
  const a = 'a'.repeat(40)
  const b = 'b'.repeat(40)
  expect(shasIn(`${a}\n\n${b}\n${a}\n${'0'.repeat(40)}\n`)).toEqual([a, b])
})

test('a commit with a thread shows what was asked, why, and how to reopen it', async () => {
  const c = { sha: 'c'.repeat(40), subject: 'Add cache', at: Date.UTC(2026, 10, 14), author: 'ychampion' }
  expect(show(c, undefined)).toContain('no thread')
  const out = show(c, { sha: c.sha, repo: '/r', subject: 'Add cache', at: c.at, sessionId: 's-1', cwd: '/r', prompts: ['make it faster'], reasoning: ['A map, because lookups are hot.'], files: ['a.ts'] })
  expect(out).toContain('asked: make it faster')
  expect(out).toContain('reasoning: A map, because lookups are hot.')
  expect(out).toContain('claude --resume s-1')
})
