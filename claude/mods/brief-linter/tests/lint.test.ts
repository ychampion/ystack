import { expect, test } from 'claude-code/testing'

import { footer, kindOf, missing } from '../hooks/lint.ts'

test('agent kinds', async () => {
  expect(kindOf('opus-medium')).toBe('builder')
  expect(kindOf('haiku-max')).toBe('locator')
  expect(kindOf('pr-review-toolkit:code-reviewer')).toBe('reviewer')
  expect(kindOf('pr-review-toolkit:silent-failure-hunter')).toBe('reviewer')
  expect(kindOf('fork')).toBe('skip')
  expect(kindOf('claude-security:scan-researcher')).toBe('skip')
})

test('only the missing parts are added', async () => {
  const full =
    'Build X. Verify with bun test. Write the full log to a file and return its path. Stop after 2 fix cycles. End with Assumptions I made.'
  expect(missing(full, 'builder', false)).toEqual([])
  expect(missing('Build X.', 'builder', true).map(r => r.id)).toEqual(['output', 'assumptions', 'verify', 'loop-cap', 'inbox'])
  expect(missing('Find foo.ts', 'locator', true).map(r => r.id)).toEqual(['output'])
  expect(missing('Review the diff', 'reviewer', true).map(r => r.id)).toEqual(['output', 'assumptions'])
  expect(footer(missing('x', 'locator', false))).toContain('Standing requirements:')
})
