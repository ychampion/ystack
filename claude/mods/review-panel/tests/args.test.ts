import { expect, test } from 'claude-code/testing'

// Nothing in a test answers process.run, so a call that reached git would come back as "git diff ... failed".
test('an option-shaped argument never reaches git', async $ => {
  type Input = Parameters<typeof $.command.run>[0]
  const r = await $.command.run({ command: 'review-panel', args: '--output=/tmp/x' } as Input)
  expect(r.text).toContain('is not a ref or range')
})
