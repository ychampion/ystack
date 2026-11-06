import { expect, test } from 'claude-code/testing'

import { isOpenBuild } from '../hooks/sharpen.ts'

test('fires on open builds only', async () => {
  expect(isOpenBuild('build a landing page for acme')).toBe(true)
  expect(isOpenBuild('Create an onboarding flow for the Acme B2B dashboard')).toBe(true)
  expect(isOpenBuild('fix the typo in the landing page')).toBe(false)
  expect(isOpenBuild('build it, no questions, go ahead')).toBe(false)
  expect(isOpenBuild('/review-panel')).toBe(false)
  expect(isOpenBuild('why is the build failing?')).toBe(false)
  expect(isOpenBuild('Build the CLI. DONE means `acme --help` lists 3 commands.')).toBe(false)
})
