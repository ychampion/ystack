import { expect, test } from 'claude-code/testing'

import {
  IDLE_MS,
  type SessionRecord,
  claim,
  classifyGit,
  decideGit,
  liveClaims,
  normPath,
  relPath,
  repoHash,
  sessionLabel,
  whoHas,
} from '../hooks/lanes.ts'

const NOW = 1_700_000_000_000
const rec = (over: Partial<SessionRecord>): SessionRecord => ({
  sessionId: 's',
  label: 'app',
  repoId: 'r1',
  worktree: 'c:/work/app',
  branch: 'main',
  lastActive: NOW,
  files: {},
  ...over,
})

test('paths, repo ids and labels', async () => {
  const bs = String.fromCharCode(92)
  expect(normPath(`C:${bs}Work${bs}App${bs}`)).toBe('c:/work/app')
  expect(relPath(`C:${bs}Work${bs}App${bs}src${bs}a.ts`, 'c:/work/app')).toBe('src/a.ts')
  expect(relPath('c:/work/other/a.ts', 'c:/work/app')).toBeUndefined()
  expect(repoHash('C:/work/app/.git')).toBe(repoHash(`c:${bs}work${bs}app${bs}.git${bs}`))
  expect(sessionLabel('app', 'fix the login page so it loads fast on phones')).toBe('app: fix the login page so it...')
  expect(sessionLabel('app')).toBe('app')
})

test('claims: keep their start time, expire after 30 idle minutes, vanish when the session ends', async () => {
  let r = claim(rec({}), 'src/a.ts', NOW - 10 * 60_000)
  r = claim(r, 'src/a.ts', NOW)
  expect(r.files['src/a.ts']).toEqual({ since: NOW - 10 * 60_000, at: NOW })
  expect(liveClaims(r, NOW + IDLE_MS - 1)).toEqual(['src/a.ts'])
  expect(liveClaims(r, NOW + IDLE_MS + 1)).toEqual([]) // idle: the session is no longer live
  const older = claim(claim(rec({}), 'old.ts', NOW - IDLE_MS - 5), 'new.ts', NOW)
  expect(liveClaims(older, NOW)).toEqual(['new.ts'])
  expect(liveClaims({ ...r, isEnded: true }, NOW)).toEqual([])
})

test('same folder is a claim; another worktree is a predicted conflict', async () => {
  const sameFolder = claim(rec({ sessionId: 'b', label: 'app: tidy styles' }), 'src/a.ts', NOW - 5 * 60_000)
  const otherTree = claim(rec({ sessionId: 'c', worktree: 'c:/work/app-feature', branch: 'feature' }), 'src/a.ts', NOW - 60_000)
  const stale = claim(rec({ sessionId: 'd', lastActive: NOW - IDLE_MS - 1 }), 'src/a.ts', NOW - IDLE_MS - 1)
  const hit = whoHas([sameFolder, otherTree, stale, rec({ sessionId: 'me' })], { sessionId: 'me', worktree: 'C:/Work/App' }, 'src/a.ts', NOW)
  expect(hit.sameTree?.sessionId).toBe('b')
  expect(hit.otherTrees.map(r => r.sessionId)).toEqual(['c'])
  expect(whoHas([sameFolder], { sessionId: 'me', worktree: 'c:/work/app' }, 'src/other.ts', NOW).sameTree).toBeUndefined()
})

test('git commands are classified', async () => {
  expect(classifyGit('git stash')).toEqual([{ kind: 'stash' }])
  expect(classifyGit('git stash pop && bun test')).toEqual([{ kind: 'stash' }])
  expect(classifyGit('git stash list')).toEqual([])
  expect(classifyGit('git -C ../x switch feature')).toEqual([{ kind: 'checkout', target: 'feature' }])
  expect(classifyGit('git checkout -b new-thing')).toEqual([])
  expect(classifyGit('git checkout -- src/a.ts')).toEqual([])
  expect(classifyGit('git reset --hard HEAD~1')).toEqual([{ kind: 'reset-hard' }])
  expect(classifyGit('git reset HEAD a.ts')).toEqual([])
  expect(classifyGit('git clean -fdx')).toEqual([{ kind: 'clean' }])
  expect(classifyGit('git clean -n')).toEqual([])
  expect(classifyGit('git gc --aggressive; git worktree prune')).toEqual([{ kind: 'gc' }, { kind: 'prune' }])
  expect(classifyGit('git worktree remove ../app-feature')).toEqual([{ kind: 'worktree-remove', target: '../app-feature' }])
  expect(classifyGit('git status && git log --oneline')).toEqual([])
  expect(classifyGit('echo "git stash" > notes.txt')).toEqual([])
})

test('git decisions: stash refused, the rest held back once, nothing when alone', async () => {
  const other = rec({ sessionId: 'b', label: 'app: billing', worktree: 'c:/work/app-billing', branch: 'billing' })
  const warned = new Map<string, number>()
  expect(decideGit('git stash', classifyGit('git stash'), [], 'c:/work/app', warned, NOW)).toEqual({})
  expect(decideGit('git stash', classifyGit('git stash'), [other], 'c:/work/app', warned, NOW).deny).toContain('WIP')

  const sw = 'git switch billing'
  expect(decideGit(sw, classifyGit(sw), [other], 'c:/work/app', warned, NOW).deny).toContain('branch billing is checked out in another worktree')
  expect(decideGit(sw, classifyGit(sw), [other], 'c:/work/app', warned, NOW + 60_000)).toEqual({}) // asked again: goes ahead
  expect(decideGit('git switch main', classifyGit('git switch main'), [other], 'c:/work/app', warned, NOW)).toEqual({})

  const rm = 'git worktree remove ../app-billing'
  expect(decideGit(rm, classifyGit(rm), [other], 'c:/work/app', warned, NOW).deny).toContain('is where "app: billing" is working')
  const rmOther = 'git worktree remove ../app-other'
  expect(decideGit(rmOther, classifyGit(rmOther), [other], 'c:/work/app', warned, NOW)).toEqual({})
  const rm2 = 'git worktree remove C:/Work/app-billing'
  expect(decideGit(rm2, classifyGit(rm2), [other], 'c:/work/app', warned, NOW).deny).toContain('is where "app: billing" is working')

  const rh = 'git reset --hard'
  expect(decideGit(rh, classifyGit(rh), [other], 'c:/work/app', warned, NOW).deny).toContain('held back once')
  expect(decideGit(rh, classifyGit(rh), [other], 'c:/work/app', warned, NOW + 6 * 60_000).deny).toContain('held back once') // too late: warned again
  const idle = { ...other, lastActive: NOW - IDLE_MS - 1 }
  expect(decideGit('git stash', classifyGit('git stash'), [idle], 'c:/work/app', warned, NOW)).toEqual({})
})

test('git words inside quotes, heredoc bodies or other commands are not git commands', async () => {
  const verb = ['com', 'mit'].join('')
  expect(classifyGit(`git ${verb} -m "fix; git stash bug"`)).toEqual([])
  expect(classifyGit(`git ${verb} -F - <<EOF\ngit stash is shared\ngit reset --hard too\nEOF\ngit log`)).toEqual([])
  expect(classifyGit('echo "run git stash later"')).toEqual([])
  expect(classifyGit('grep -rn git stash.txt')).toEqual([])
  // real ones are still found, chained, wrapped or prefixed
  expect(classifyGit('cd app && git stash')).toEqual([{ kind: 'stash' }])
  expect(classifyGit('GIT_DIR=x sudo git -C ../b reset --hard')).toEqual([{ kind: 'reset-hard' }])
  expect(classifyGit('& "C:/Program Files/Git/cmd/git.exe" stash push')).toEqual([{ kind: 'stash' }])
  expect(classifyGit('git add -A; git stash pop')).toEqual([{ kind: 'stash' }])
})
