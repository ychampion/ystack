import { expect, mock, test } from 'claude-code/testing'

// Nothing in a test answers process.run, so a call that reached git would come back as "git diff ... failed".
test('an option-shaped argument never reaches git', async $ => {
  type Input = Parameters<typeof $.command.run>[0]
  const r = await $.command.run({ command: 'review-panel', args: '--output=/tmp/x' } as Input)
  expect(r.text).toContain('is not a ref or range')
})

// The engine refuses a submit made inside the command (it would wait under the command's own turn), so the
// command must answer first and queue the panel prompt for right after.
test('the command answers, then the panel prompt is submitted once it has returned', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 })
  const prompts: string[] = []
  on('process.run', (_, e) => ({ value: { exitCode: 0, stdout: e.argv.includes('ls-files') ? '' : 'src/a.ts\n', stderr: '' } }) as never)
  on('prompt.submit', (_, e) => {
    prompts.push(e.text)
    return { text: e.text } as never
  })
  type Input = Parameters<typeof $.command.run>[0]
  const r = await $.command.run({ command: 'review-panel', args: '' } as Input)
  expect(r.text).toContain('reviewers queued')
  expect(prompts.length).toBe(0)
  await clock.settle()
  expect(prompts.length).toBe(1)
  expect(prompts[0]).toContain('src/a.ts')
})
