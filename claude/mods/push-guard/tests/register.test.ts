import { expect, test, type TestBody } from 'claude-code/testing'
import type { On } from 'claude-code'

// Wiring tests. A stand-in beneath the plugin plays git ($.process.run) from a small handler,
// another plays the shell and records which commands reached it. Nothing runs for real.

const AWS = 'AKIA' + 'Q7'.repeat(8)
const ANT = 'sk-ant-' + 'api03-' + 'x9'.repeat(20)

type Git = (args: string[], cwd?: string) => { code?: number; out?: string } | undefined

function gitHost(on: On, handler: Git): string[][] {
  const calls: string[][] = []
  on('session.cwd', async () => ({ value: 'C:/work' }))
  on('env.get', async () => ({ value: 'C:/Users/u' as never }))
  on('process.run', async ($, e) => {
    // Without push-guard's safe `-c key=value` pairs, which the review tests check on their own.
    const argv = [...e.argv].filter((a, i, all) => a !== '-c' && all[i - 1] !== '-c')
    calls.push(argv)
    const r = argv[0] === 'git' ? handler(argv.slice(1), e.init?.cwd) : undefined
    return { value: { exitCode: r?.code ?? (r ? 0 : 1), stdout: r?.out ?? '', stderr: r ? '' : 'fatal: not a git repository', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  return calls
}

function shell(on: On): string[] {
  const seen: string[] = []
  on('tool.call', async ($, e) => {
    if (e.tool === 'Bash' || e.tool === 'PowerShell') seen.push(e.command)
    return { result: 'ok' }
  })
  return seen
}

const newFile = (file: string, lines: string[]) =>
  [`diff --git a/${file} b/${file}`, 'new file mode 100644', '--- /dev/null', `+++ b/${file}`, `@@ -0,0 +1,${lines.length} @@`, ...lines.map(l => `+${l}`)].join('\n') + '\n'

const has = (args: string[], ...want: string[]) => want.every(w => args.includes(w))
const refusal = (r: { deny?: string; text?: string; isError?: true }) => r.deny ?? (r.isError ? r.text : undefined)

type RunArg = Parameters<Parameters<TestBody>[0]['command']['run']>[0]
const typed = (args: string, kind = 'composer') => ({ command: 'push-guard', args, origin: { kind } }) as unknown as RunArg

test('a staged key stops the commit: file, line and kind are named, the value is not', async ($, on) => {
  gitHost(on, args => (has(args, 'diff', '--cached') ? { out: newFile('src/client.ts', ['const a = 1', `const key = '${AWS}'`]) } : undefined))
  const seen = shell(on)
  const r = await $.tool.call({ tool: 'Bash', command: 'git commit -m "add client"' })
  const why = refusal(r) ?? ''
  expect(why).toContain('src/client.ts line 2: AWS access key ID')
  expect(why).toContain('git restore --staged')
  expect(why).not.toContain(AWS)
  expect(seen).toEqual([])
})

test('a clean commit runs, and the scan reads the staged diff in the right folder', async ($, on) => {
  const calls = gitHost(on, args => (has(args, 'diff', '--cached') ? { out: newFile('README.md', ['hello']) } : undefined))
  const seen = shell(on)
  await $.tool.call({ tool: 'Bash', command: 'cd app && git -C pkg commit -m "docs"' })
  expect(seen).toEqual(['cd app && git -C pkg commit -m "docs"'])
  expect(calls[0]?.slice(0, 5)).toEqual(['git', '-C', 'pkg', 'diff', '--cached'])
})

test('git add . && git commit: unstaged changes and new files are scanned too', async ($, on) => {
  const calls = gitHost(on, args => {
    if (has(args, 'diff', '--cached')) return { out: '' }
    if (has(args, 'rev-parse', 'HEAD')) return { out: 'abc\n' }
    if (has(args, 'diff', 'HEAD')) return { out: '' }
    if (has(args, 'ls-files', '--others')) return { out: 'notes.txt\0config/secrets.json\0' }
    return undefined
  })
  on('fs.read', (_, e) => {
    const files: Record<string, string> = { 'notes.txt': 'nothing here', 'config/secrets.json': `{\n  "anthropic": "${ANT}"\n}` }
    const p = (e as unknown as { path: string }).path.replace(/\\/g, '/')
    const text = Object.entries(files).find(([k]) => p.endsWith(`/${k}`))?.[1]
    if (text === undefined) throw new Error('ENOENT ' + (e as unknown as { path: string }).path)
    return { value: text as never }
  })
  const seen = shell(on)
  const r = await $.tool.call({ tool: 'Bash', command: 'git add . && git commit -m "all"' })
  expect(refusal(r)).toContain('config/secrets.json line 2: Anthropic API key')
  expect(refusal(r)).not.toContain(ANT)
  expect(calls.some(c => has(c, 'diff', 'HEAD'))).toBe(true)
  expect(seen).toEqual([])
})

test('a staged .env file stops the commit', async ($, on) => {
  gitHost(on, args => (has(args, 'diff', '--cached') ? { out: newFile('.env', ['DEBUG=1']) } : undefined))
  const seen = shell(on)
  expect(refusal(await $.tool.call({ tool: 'PowerShell', command: 'git commit -m env' }))).toContain('- .env: .env file')
  expect(seen).toEqual([])
})

test('allowPaths lets a fixture with a fake key through', { options: { allowPaths: 'tests/fixtures/**' } }, async ($, on) => {
  gitHost(on, args => (has(args, 'diff', '--cached') ? { out: newFile('tests/fixtures/keys.txt', [AWS]) } : undefined))
  const seen = shell(on)
  await $.tool.call({ tool: 'Bash', command: 'git commit -m fixtures' })
  expect(seen).toEqual(['git commit -m fixtures'])
})

test('a push whose new commits hold a key is stopped, naming the commit', async ($, on) => {
  const calls = gitHost(on, args => (args[0] === 'log' ? { out: `\u0001pg-commit 1a2b3c4\n\n${newFile('deploy.sh', [`export AWS_KEY=${AWS}`])}` } : undefined))
  const seen = shell(on)
  const r = await $.tool.call({ tool: 'Bash', command: 'git push -u origin feature' })
  expect(refusal(r)).toContain('deploy.sh line 1 (commit 1a2b3c4): AWS access key ID')
  expect(refusal(r)).not.toContain(AWS)
  const log = calls.find(c => c[1] === 'log') ?? []
  expect(log.slice(-5)).toEqual(['--not', '--remotes', '--not', '--end-of-options', 'feature'])
  expect(seen).toEqual([])
})

test('a refspec that looks like an option never reaches git as an option', async ($, on) => {
  const calls = gitHost(on, args => (args[0] === 'log' ? { out: '' } : undefined))
  shell(on)
  await $.tool.call({ tool: 'Bash', command: 'git push origin -- --output=/tmp/x -oevil main' })
  await $.tool.call({ tool: 'Bash', command: "git push origin '--output=/tmp/y:main'" })
  const logs = calls.filter(c => c[1] === 'log')
  expect(logs.length).toBeGreaterThan(0)
  for (const c of logs) {
    const end = c.indexOf('--end-of-options')
    expect(end).toBeGreaterThan(0)
    // Nothing from the command comes before --end-of-options, and nothing after it starts with '-'.
    expect(c.some(a => a.includes('/tmp/'))).toBe(false)
    expect(c.slice(end + 1).every(a => !a.startsWith('-'))).toBe(true)
  }
})

test('a clean push runs', async ($, on) => {
  gitHost(on, args => (args[0] === 'log' ? { out: `\u0001pg-commit 1a2b3c4\n\n${newFile('a.ts', ['x'])}` } : undefined))
  const seen = shell(on)
  await $.tool.call({ tool: 'Bash', command: 'git push origin feature' })
  expect(seen).toEqual(['git push origin feature'])
})

test('force-push to main is stopped with a new-branch suggestion; to a feature branch it runs', async ($, on) => {
  gitHost(on, args => (args[0] === 'log' ? { out: '' } : has(args, 'rev-parse', '--abbrev-ref') ? { out: 'main\n' } : undefined))
  const seen = shell(on)
  const r = await $.tool.call({ tool: 'Bash', command: 'git push --force origin main' })
  expect(refusal(r)).toContain('protected branch: main')
  expect(refusal(r)).toContain('git push -u origin HEAD:<new-branch>')
  expect(refusal(await $.tool.call({ tool: 'Bash', command: 'git push origin +master' }))).toContain('protected branch: master')
  // No refspec: the current branch, read from git, is main.
  expect(refusal(await $.tool.call({ tool: 'Bash', command: 'git push --force-with-lease' }))).toContain('protected branch: main')
  await $.tool.call({ tool: 'Bash', command: 'git push --force-with-lease origin my-feature' })
  await $.tool.call({ tool: 'Bash', command: 'git push origin main' })
  expect(seen).toEqual(['git push --force-with-lease origin my-feature', 'git push origin main'])
})

test('protectedBranches from settings, with globs', { options: { protectedBranches: 'release/*, prod' } }, async ($, on) => {
  gitHost(on, args => (args[0] === 'log' ? { out: '' } : undefined))
  const seen = shell(on)
  expect(refusal(await $.tool.call({ tool: 'Bash', command: 'git push -f origin release/2.0' }))).toContain('release/2.0')
  await $.tool.call({ tool: 'Bash', command: 'git push -f origin main' })
  expect(seen).toEqual(['git push -f origin main'])
})

test('making a repo public is stopped until the user allows it; a plugin cannot allow it', async ($, on) => {
  gitHost(on, () => undefined)
  const seen = shell(on)
  const cmd = 'gh repo edit acme/tool --visibility public --accept-visibility-change-consequences'
  expect(refusal(await $.tool.call({ tool: 'Bash', command: cmd }))).toContain('/push-guard allow public acme/tool')
  expect((await $.command.run(typed('allow public acme/tool', 'plugin'))).text).toContain('Only the user')
  expect(refusal(await $.tool.call({ tool: 'Bash', command: cmd }))).toContain('public')
  const ok = await $.command.run(typed('allow public acme/tool'))
  expect(ok.text).toContain('Allowed for this session')
  await $.tool.call({ tool: 'Bash', command: cmd })
  // The allow covers that repo only.
  expect(refusal(await $.tool.call({ tool: 'Bash', command: 'gh repo edit acme/other --visibility public' }))).toContain('acme/other')
  expect(seen).toEqual([cmd])
})

test('gh repo edit with no repo named reads it from the origin remote', async ($, on) => {
  gitHost(on, args => (has(args, 'remote', 'get-url') ? { out: 'git@github.com:acme/site.git\n' } : undefined))
  shell(on)
  expect(refusal(await $.tool.call({ tool: 'Bash', command: 'gh repo edit --visibility=public' }))).toContain('/push-guard allow public acme/site')
})

test('protected repos are always refused, even after an allow', { options: { protectedRepos: 'acme/secret-sauce' } }, async ($, on) => {
  gitHost(on, () => undefined)
  const seen = shell(on)
  const allow = await $.command.run(typed('allow public acme/secret-sauce'))
  expect(allow.text).toContain('protected repos list')
  const r = await $.tool.call({ tool: 'Bash', command: `gh api -X PATCH repos/acme/secret-sauce -F private=false` })
  expect(refusal(r)).toContain("on push-guard's protected list")
  expect(refusal(await $.tool.call({ tool: 'Bash', command: 'gh repo create secret-sauce --public' }))).toContain('protected list')
  expect(seen).toEqual([])
})

test('protectedRepos * covers every repo', { options: { protectedRepos: '*' } }, async ($, on) => {
  gitHost(on, () => undefined)
  shell(on)
  expect(refusal(await $.tool.call({ tool: 'Bash', command: 'gh repo create anything --public' }))).toContain('protected list')
})

test('deleting a remote branch or repo is stopped until /push-guard allow delete', async ($, on) => {
  gitHost(on, () => undefined)
  const seen = shell(on)
  expect(refusal(await $.tool.call({ tool: 'Bash', command: 'git push origin --delete old-ui' }))).toContain('/push-guard allow delete origin/old-ui')
  expect(refusal(await $.tool.call({ tool: 'Bash', command: 'gh repo delete acme/tool --yes' }))).toContain('/push-guard allow delete acme/tool')
  await $.command.run(typed('allow delete origin/old-ui'))
  await $.tool.call({ tool: 'Bash', command: 'git push origin --delete old-ui' })
  expect(refusal(await $.tool.call({ tool: 'Bash', command: 'git push origin :other' }))).toContain('origin/other')
  expect(seen).toEqual(['git push origin --delete old-ui'])
})

test('subagent calls are guarded the same way', async ($, on) => {
  gitHost(on, args => (has(args, 'diff', '--cached') ? { out: newFile('k.pem', ['-----BEGIN ' + 'OPENSSH PRIVATE KEY-----']) } : undefined))
  const seen = shell(on)
  const r = await $.tool.call({ tool: 'Bash', command: 'git commit -m key', agentId: 'sub-1' } as never)
  expect(refusal(r)).toContain('k.pem line 1: private key block')
  expect(refusal(await $.tool.call({ tool: 'Bash', command: 'git push -f origin main', agentId: 'sub-1' } as never))).toContain('protected branch')
  expect(seen).toEqual([])
})

test('when git cannot be read, the commit goes ahead with a note saying it was not checked', async ($, on) => {
  gitHost(on, () => undefined)
  const seen = shell(on)
  const r = await $.tool.call({ tool: 'Bash', command: 'git commit -m x' })
  expect(seen).toEqual(['git commit -m x'])
  expect(r.context?.join('\n')).toContain("couldn't read the staged changes")
})

test('commands with no git or GitHub action pass without any git calls', async ($, on) => {
  const calls = gitHost(on, () => undefined)
  const seen = shell(on)
  await $.tool.call({ tool: 'Bash', command: 'git status && bun test' })
  expect(seen).toEqual(['git status && bun test'])
  expect(calls).toEqual([])
})

test('/push-guard shows the settings and the session allows', async ($, on) => {
  gitHost(on, () => undefined)
  const before = await $.command.run(typed(''))
  expect(before.text).toContain('Protected branches (no force-push): main, master')
  expect(before.text).toContain('Nothing allowed this session.')
  await $.command.run(typed('allow delete origin/x'))
  expect((await $.command.run(typed(''))).text).toContain('Allowed this session: delete origin/x')
  expect((await $.command.run(typed('allow everything'))).text).toContain('Usage')
})
