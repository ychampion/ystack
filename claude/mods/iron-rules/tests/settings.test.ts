import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

/** Stands in for the shell beneath the plugin and records the command that reached it. */
function shell(on: On): string[] {
  const seen: string[] = []
  on('tool.call', async ($, e) => {
    if (e.tool === 'Bash') seen.push(e.command)
    return { result: 'ok' }
  })
  return seen
}

test('a fresh install changes nothing: every house rule is off until turned on', async ($, on) => {
  const seen = shell(on)
  const command = 'git commit -m "Co-Authored-By: Claude" && npm install'
  await $.tool.call({ tool: 'Bash', command })
  expect(seen).toEqual([command])
})

test('identity, bun and attribution follow the settings', { options: { gitName: 'octocat', gitEmail: 'o@example.com', useBun: true, noAttribution: true } }, async ($, on) => {
  const seen = shell(on)
  await $.tool.call({ tool: 'Bash', command: 'git commit -m "x" -m "Co-Authored-By: Claude <noreply@anthropic.com>" && npm install' })
  expect(seen).toEqual(['git -c user.name=octocat -c user.email=o@example.com commit -m "x" -m "" && bun install'])
})

test('with no identity set and the rest switched off, commands pass untouched', { options: { useBun: false, noAttribution: false } }, async ($, on) => {
  const seen = shell(on)
  const command = 'git commit -m "Co-Authored-By: Claude" && npm install'
  await $.tool.call({ tool: 'Bash', command })
  expect(seen).toEqual([command])
})
