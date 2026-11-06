import { expect, test } from 'claude-code/testing'

import { CLAIM, DOC_FILE, failureLines, planRun, relatedTests, resolved, stemOf, suggestCheck } from '../hooks/detect.ts'

const ROOT = 'C:/repo'
const TRACKED = ['src/auth.ts', 'src/auth.test.ts', 'src/user.ts', 'tests/test_billing.py', 'billing.py', 'e2e/login.spec.ts']

test('stems and related tests', async () => {
  expect(stemOf('src/auth.service.ts')).toBe('auth.service')
  expect(stemOf('tests/test_billing.py')).toBe('billing')
  expect(relatedTests(['C:\\repo\\src\\auth.ts'], TRACKED, ROOT)).toEqual(['src/auth.test.ts'])
  expect(relatedTests(['C:/repo/src/user.ts'], TRACKED, ROOT)).toEqual([])
  expect(relatedTests(['C:/repo/billing.py'], TRACKED, ROOT)).toEqual(['tests/test_billing.py'])
})

test('plans only related work', async () => {
  const bun = planRun({ manifest: 'package.json', packageJson: '{}', edited: ['C:/repo/src/auth.ts'], tracked: TRACKED, root: ROOT })
  expect(bun?.argv).toEqual(['bun', 'test', './src/auth.test.ts'])
  expect(planRun({ manifest: 'package.json', packageJson: '{}', edited: ['C:/repo/src/user.ts'], tracked: TRACKED, root: ROOT })).toBeUndefined()
  const vt = planRun({ manifest: 'package.json', packageJson: '{"devDependencies":{"vitest":"^3"}}', edited: ['C:/repo/src/user.ts'], tracked: TRACKED, root: ROOT })
  expect(vt?.argv.slice(0, 4)).toEqual(['bun', 'x', 'vitest', 'related'])
  const py = planRun({ manifest: 'pyproject.toml', edited: ['C:/repo/billing.py'], tracked: TRACKED, root: ROOT })
  expect(py?.argv.at(-1)).toBe('tests/test_billing.py')
  const go = planRun({ manifest: 'go.mod', edited: ['C:/repo/pkg/a/x.go', 'C:/repo/pkg/a/y.go'], tracked: [], root: ROOT })
  expect(go?.argv).toEqual(['go', 'test', './pkg/a'])
})

test('docs are not edits that need a check', async () => {
  expect(DOC_FILE.test('C:/Users/me/.claude/plans/app-handoff.md')).toBe(true)
  expect(DOC_FILE.test('src/register.ts')).toBe(false)
})

test('claims, failure lines, hints', async () => {
  expect(CLAIM.test('All tests pass now.')).toBe(true)
  expect(CLAIM.test('I changed the parser.')).toBe(false)
  expect(failureLines('ok 1\n(fail) parses x\nerror: expected 2 got 3\nok 2')).toEqual(['(fail) parses x', 'error: expected 2 got 3'])
  expect(suggestCheck('package.json', '{"scripts":{"test":"bun test","typecheck":"tsc"}}')).toBe('bun run typecheck && bun run test')
})

test('paths are resolved before the session-folder check', async () => {
  expect(resolved('C:\\Work\\app\\')).toBe('c:/work/app')
  expect(resolved('C:/work/app/../other/./x')).toBe('c:/work/other/x')
  expect(resolved('/home/me/app/../../../etc')).toBe('/etc')
  expect(resolved('C:/work/app/sub/..').startsWith('c:/work/app')).toBe(true)
})
