import { expect, test } from 'claude-code/testing'

import { pickPanel } from '../hooks/panel.ts'

test('panel follows the diff', async () => {
  expect(pickPanel(['README.md'])).toEqual(['pr-review-toolkit:code-reviewer', 'pr-review-toolkit:silent-failure-hunter'])
  const ts = pickPanel(['src/App.tsx', 'src/auth/session.ts', 'src/App.test.tsx'])
  expect(ts).toContain('pr-review-toolkit:pr-test-analyzer')
  expect(ts).toContain('compound-engineering:review:kieran-typescript-reviewer')
  expect(ts).toContain('compound-engineering:review:julik-frontend-races-reviewer')
  expect(ts).toContain('compound-engineering:review:security-sentinel')
  expect(pickPanel(['db/migrations/001.sql'])).toContain('compound-engineering:review:data-integrity-guardian')
})
