import { expect, test } from 'claude-code/testing'

import {
  addGitIdentity,
  isNestedCmdDelete,
  messageFiles,
  rewriteNpm,
  stripAttribution,
  stripInlineAttribution,
} from '../hooks/rules.ts'

test('npm maps to bun only in command position', async () => {
  expect(rewriteNpm('npm install')).toBe('bun install')
  expect(rewriteNpm('npm ci')).toBe('bun install')
  expect(rewriteNpm('npm i -D vitest')).toBe('bun add -d vitest')
  expect(rewriteNpm('cd app && npm run build')).toBe('cd app && bun run build')
  expect(rewriteNpm('npm test')).toBe('bun run test')
  expect(rewriteNpm('npx tsc -p .')).toBe('bunx tsc -p .')
  expect(rewriteNpm('npm uninstall left-pad')).toBe('bun remove left-pad')
  expect(rewriteNpm('npm publish')).toBe('npm publish')
  expect(rewriteNpm('echo "use npm install"')).toBe('echo "use npm install"')
  expect(rewriteNpm('pnpm install')).toBe('pnpm install')
})

test('git commit gets the identity once, -C kept', async () => {
  const add = (c: string) => addGitIdentity(c, 'octocat', '1+octocat@users.noreply.github.com')
  const id = '-c user.name=octocat -c user.email=1+octocat@users.noreply.github.com'
  expect(add('git commit -m "x"')).toBe(`git ${id} commit -m "x"`)
  expect(add('git -C repo commit -F msg.txt')).toBe(`git -C repo ${id} commit -F msg.txt`)
  expect(add('git status && git merge main')).toBe(`git status && git ${id} merge main`)
  expect(add(`git ${id} commit -m x`)).toBe(`git ${id} commit -m x`)
  expect(add('git log --oneline')).toBe('git log --oneline')
  expect(addGitIdentity('git commit -m x', 'Ada Lovelace', 'ada@example.com')).toBe(
    'git -c user.name="Ada Lovelace" -c user.email=ada@example.com commit -m x',
  )
})

test('attribution leaves the command intact', async () => {
  const cmd = 'git commit -m "Fix it" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"'
  expect(stripInlineAttribution(cmd)).toBe('git commit -m "Fix it" -m ""')
  const pr = 'gh pr create --title t --body "Body\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)"'
  expect(stripInlineAttribution(pr)).toBe('gh pr create --title t --body "Body\n\n"')
  const file = 'Subject\n\nBody line\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\n'
  expect(stripAttribution(file)).toBe('Subject\n\nBody line\n')
  expect(stripAttribution('Keep me\n')).toBe('Keep me\n')
})

test('message files and nested deletes are found', async () => {
  expect(messageFiles('git commit -F /tmp/m.txt')).toEqual(['/tmp/m.txt'])
  expect(messageFiles('gh pr create --body-file "C:/x/body.md"')).toEqual(['C:/x/body.md'])
  expect(isNestedCmdDelete('cmd /c rmdir /s /q build')).toBe(true)
  expect(isNestedCmdDelete("Remove-Item -LiteralPath 'build' -Recurse")).toBe(false)
})
