import { expect, mock, test } from 'claude-code/testing'

test('no file means no section, silently', async ($, on) => {
  mock.env(on, { USERPROFILE: 'C:\\Users\\tester' })
  on('fs.read', () => {
    throw new Error('ENOENT')
  })
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'You are Claude Code.', scope: 'shared' as const }] }))
  on('command.register', () => ({ value: { command: 'operator' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true }) // the profile is read once per session
  const out = await $.prompt.compose({ model: 'm', promptModel: 'm', surfaces: [], tools: [], outputStyle: null, traits: [] } as Parameters<
    typeof $.prompt.compose
  >[0])
  expect(out.sections.map(s => s.id)).toEqual(['intro'])
  const r = await $.command.run({ command: 'operator', args: 'edit' } as Parameters<typeof $.command.run>[0])
  expect(r.text).toContain('C:/Users/tester/.claude/operator.md')
})
