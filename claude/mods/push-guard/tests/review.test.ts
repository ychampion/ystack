import { expect, test, type TestBody } from 'claude-code/testing'
import type { On } from 'claude-code'

import { kindsIn, isEnvFile, scanDiff } from '../hooks/secrets.ts'

// Repros from an independent review, each asserting the fixed behaviour.
// The session runs in C:/work/session; HOME is Git Bash style, as Git for Windows sets it.

const AWS = 'AKIA' + 'Q7'.repeat(8)
const SESSION = 'C:/work/session'
const HOME = '/c/Users/u'

type Git = (args: string[], cwd?: string) => { code?: number; out?: string } | undefined
type Call = { argv: string[]; cwd?: string }

function host(on: On, handler: Git, gh?: (args: string[], cwd?: string) => string | undefined): Call[] {
  const calls: Call[] = []
  on('session.cwd', async () => ({ value: SESSION }))
  on('env.get', async ($, e) => ({ value: e.name === 'HOME' ? HOME : undefined }))
  on('process.run', async ($, e) => {
    const argv = [...e.argv]
    calls.push({ argv, ...(e.init?.cwd !== undefined ? { cwd: e.init.cwd } : {}) })
    // A real spawn with an MSYS or ~ cwd fails ENOENT on Windows.
    if (e.init?.cwd && /^(~|\/[a-z]\/)/.test(e.init.cwd)) throw new Error(`spawn git ENOENT (cwd ${e.init.cwd})`)
    let r: { code?: number; out?: string } | undefined
    if (argv[0] === 'git') r = handler(gitArgs(argv), e.init?.cwd)
    if (argv[0] === 'gh' && gh) {
      const out = gh(argv.slice(1), e.init?.cwd)
      r = out === undefined ? undefined : { out }
    }
    return { value: { exitCode: r?.code ?? (r ? 0 : 1), stdout: r?.out ?? '', stderr: r ? '' : 'fatal', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  return calls
}
/** git's argv after the safe `-c key=value` pairs push-guard adds. */
function gitArgs(argv: string[]): string[] {
  const out: string[] = []
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === '-c') {
      i++
      continue
    }
    out.push(argv[i] as string)
  }
  return out
}
function shell(on: On): string[] {
  const seen: string[] = []
  on('tool.call', async ($, e) => {
    if (e.tool === 'Bash' || e.tool === 'PowerShell') seen.push(e.command)
    return { result: 'ok' }
  })
  return seen
}
const has = (args: string[], ...want: string[]) => want.every(w => args.includes(w))
const refusal = (r: { deny?: string; text?: string; isError?: true }) => r.deny ?? (r.isError ? r.text : undefined)
type RunArg = Parameters<Parameters<TestBody>[0]['command']['run']>[0]
const typed = (args: string) => ({ command: 'push-guard', args, origin: { kind: 'composer' } }) as unknown as RunArg
const pushLog = (commit: string, file: string, line: string) =>
  `\u0001pg-commit ${commit}\ndiff --git a/${file} b/${file}\nnew file mode 100644\n--- /dev/null\n+++ b/${file}\n@@ -0,0 +1 @@\n+${line}\n`
/** rev-parse answers: the current branch and its upstream. */
const branches = (current: string, upstream?: string): Git => args => {
  if (has(args, 'rev-parse', '--symbolic-full-name')) return upstream ? { out: `refs/remotes/origin/${upstream}\n` } : undefined
  if (has(args, 'rev-parse', '--abbrev-ref')) return { out: `${current}\n` }
  if (has(args, 'log')) return { out: '' }
  return undefined
}

test('R1 cd ~/repo, cd /c/..., cd sub: the scan runs in the folder the command runs in', async ($, on) => {
  const calls = host(on, args => (has(args, 'log') ? { out: pushLog('abc1234', 'cfg.ts', `k='${AWS}'`) } : has(args, 'diff', '--cached') ? { out: '' } : undefined))
  const seen = shell(on)
  expect(refusal(await $.tool.call({ tool: 'Bash', command: 'cd ~/repo && git push origin feature' }))).toContain('AWS access key ID')
  expect(calls.find(c => has(c.argv, 'log'))?.cwd).toBe('C:/Users/u/repo')
  expect(refusal(await $.tool.call({ tool: 'Bash', command: 'cd $HOME/repo && git push origin feature' }))).toContain('AWS access key ID')
  await $.tool.call({ tool: 'Bash', command: 'cd /c/Users/u/proj && git commit -m x' })
  expect(calls.at(-1)?.cwd).toBe('C:/Users/u/proj')
  await $.tool.call({ tool: 'Bash', command: 'cd sub && git commit -m x' })
  expect(calls.at(-1)?.cwd).toBe('C:/work/session/sub')
  expect(seen).toEqual(['cd /c/Users/u/proj && git commit -m x', 'cd sub && git commit -m x'])
})

test('R3 cd $REPO && git push -f: refused, never checked in the session repo instead', async ($, on) => {
  const calls = host(on, branches('feature'))
  const seen = shell(on)
  for (const cmd of ['cd "$REPO" && git push -f', 'cd $(mktemp -d) && git commit -m x', 'cd - && git push']) {
    expect(refusal(await $.tool.call({ tool: 'Bash', command: cmd }))).toContain("couldn't tell which repo this runs in; run it from that folder or with git -C <path>")
  }
  expect(calls).toEqual([])
  expect(seen).toEqual([])
  // An absolute -C names the repo, whatever the cd did.
  await $.tool.call({ tool: 'Bash', command: 'cd "$REPO" && git -C /c/Users/u/repo push -f' })
  expect(seen).toHaveLength(1)
})

test('R4 force-push to main via $(...), $VAR, @, or a timeout/sudo/nice/env/nohup/command wrapper is stopped', async ($, on) => {
  host(on, branches('main', 'main'))
  const seen = shell(on)
  for (const cmd of [
    'git push -f origin "$(git branch --show-current)"',
    'git push -f origin $(git branch --show-current)',
    'git push -f origin `git rev-parse --abbrev-ref HEAD`',
    'BR=main; git push --force origin $BR',
    'git push -f origin @',
    'git push -f origin HEAD',
    'timeout 60 git push -f origin main',
    'timeout -s KILL 5m git push -f origin main',
    'sudo -u bob git push -f origin main',
    'nice -n 5 git push -f origin main',
    'env -i GIT_TRACE=1 git push -f origin main',
    'nohup command git push -f origin main',
  ]) expect([cmd, refusal(await $.tool.call({ tool: 'Bash', command: cmd })) ?? 'ran']).toEqual([cmd, expect.stringContaining('protected branch')])
  expect(seen).toEqual([])
})

test('R4 an unreadable force-push target counts as protected; a readable feature branch runs', async ($, on) => {
  host(on, branches('feature', 'feature'))
  const seen = shell(on)
  expect(refusal(await $.tool.call({ tool: 'Bash', command: 'git push -f origin $BR' }))).toContain("couldn't tell which branch")
  await $.tool.call({ tool: 'Bash', command: 'git push -f origin "$(git branch --show-current)"' })
  await $.tool.call({ tool: 'Bash', command: 'timeout 60 git push -f origin feature' })
  expect(seen).toHaveLength(2)
})

test('R5 cd ~/repo && git push -f on a feature branch runs; its upstream on main is stopped', async ($, on) => {
  host(on, branches('feature', 'feature'))
  const seen = shell(on)
  await $.tool.call({ tool: 'Bash', command: 'cd ~/repo && git push -f' })
  expect(seen).toEqual(['cd ~/repo && git push -f'])
})

test('R5b a feature branch tracking main is stopped on a bare force-push', async ($, on) => {
  host(on, branches('feature', 'main'))
  expect(refusal(await $.tool.call({ tool: 'Bash', command: 'git push -f' }))).toContain('protected branch: main')
})

test('R2 gh api repos/{owner}/{repo}: resolved with gh repo view; a protected repo is refused; an allow is never keyed on a placeholder', { options: { protectedRepos: 'acme/secret' } }, async ($, on) => {
  const calls = host(on, () => undefined, args => (has(args, 'repo', 'view') ? 'acme/secret\n' : undefined))
  const seen = shell(on)
  const cmd = 'cd ~/secret && gh api -X PATCH repos/{owner}/{repo} -f private=false'
  expect(refusal(await $.tool.call({ tool: 'Bash', command: cmd }))).toContain('acme/secret public, and it is on push-guard')
  expect(calls.find(c => c.argv[0] === 'gh')?.cwd).toBe('C:/Users/u/secret')
  expect((await $.command.run(typed('allow public {owner}/{repo}'))).text).toContain("can't be allowed")
  expect((await $.command.run(typed('allow public $R'))).text).toContain("can't be allowed")
  expect(seen).toEqual([])
})

test('R2 an unresolved placeholder or variable repo counts as protected when protectedRepos is set', { options: { protectedRepos: 'acme/secret' } }, async ($, on) => {
  host(on, () => undefined)
  const seen = shell(on)
  expect(refusal(await $.tool.call({ tool: 'Bash', command: 'gh api -X PATCH repos/{owner}/{repo} -f private=false' }))).toContain('protected list')
  expect(refusal(await $.tool.call({ tool: 'Bash', command: 'R=acme/secret; gh repo edit $R --visibility public' }))).toContain('protected list')
  expect(seen).toEqual([])
})

test('R2 with no protected list, a placeholder resolves to the real name, and the allow uses it', async ($, on) => {
  host(on, () => undefined, args => (has(args, 'repo', 'view') ? 'acme/tool\n' : undefined))
  const seen = shell(on)
  const cmd = 'gh api -X PATCH repos/{owner}/{repo} -f private=false'
  expect(refusal(await $.tool.call({ tool: 'Bash', command: cmd }))).toContain('/push-guard allow public acme/tool')
  await $.command.run(typed('allow public acme/tool'))
  await $.tool.call({ tool: 'Bash', command: cmd })
  expect(seen).toEqual([cmd])
})

test('a repos/ PATCH whose body cannot be read is refused once, until /push-guard allow api', async ($, on) => {
  host(on, () => undefined)
  const seen = shell(on)
  const cmds: [string, 'Bash' | 'PowerShell'][] = [
    ['gh api -X PATCH repos/o/r --input body.json', 'Bash'],
    [`echo '{"private":false}' | gh api -X PATCH repos/o/r --input -`, 'Bash'],
    ['curl -X PATCH https://api.github.com/repos/o/r -d @body.json', 'Bash'],
    ['Invoke-RestMethod -Method Patch -Uri https://api.github.com/repos/o/r -Body (@{private=$false} | ConvertTo-Json)', 'PowerShell'],
    ['Invoke-RestMethod -Method Patch -Uri https://api.github.com/repos/o/r -Body $json', 'PowerShell'],
  ]
  for (const [command, tool] of cmds) {
    expect(refusal(await $.tool.call({ tool, command }))).toContain("couldn't read the request body; if it doesn't make the repo public, /push-guard allow api o/r")
  }
  expect(seen).toEqual([])
  await $.command.run(typed('allow api o/r'))
  for (const [command, tool] of cmds) await $.tool.call({ tool, command })
  expect(seen).toHaveLength(cmds.length)
  // A readable body that keeps the repo private needs no allow.
  await $.tool.call({ tool: 'Bash', command: 'gh api -X PATCH repos/x/y -f description=hi' })
  expect(seen).toHaveLength(cmds.length + 1)
})

test('files skipped or cut short are named in the note', async ($, on) => {
  host(on, args => {
    if (has(args, 'diff', '--cached')) return { out: '' }
    if (has(args, 'rev-parse', 'HEAD')) return { out: 'abc\n' }
    if (has(args, 'diff', 'HEAD')) return { out: '' }
    if (has(args, 'ls-files', '--others')) return { out: 'big.bin\0long.txt\0ok.txt\0' }
    return undefined
  })
  on('fs.read', (_, e) => {
    const p = (e as unknown as { path: string }).path.replace(/\\/g, '/')
    if (p.endsWith('/big.bin')) throw new Error('EFBIG: over 4 MiB')
    if (p.endsWith('/long.txt')) return { value: 'x'.repeat(1_000_100) as never }
    return { value: 'fine' as never }
  })
  shell(on)
  const r = await $.tool.call({ tool: 'Bash', command: 'git add . && git commit -m all' })
  const note = r.context?.join('\n') ?? ''
  expect(note).toContain('big.bin')
  expect(note).toContain('long.txt')
  expect(note).not.toContain('ok.txt')
})

test('an internal error refuses the command instead of letting it run unchecked', async ($, on) => {
  on('session.cwd', async () => {
    throw new Error('boom')
  })
  const seen = shell(on)
  const r = await $.tool.call({ tool: 'Bash', command: 'git push origin main' })
  expect(refusal(r)).toContain('push-guard hit an internal error')
  expect(seen).toEqual([])
  // Commands with nothing push-guard checks still run.
  await $.tool.call({ tool: 'Bash', command: 'ls -la' })
  expect(seen).toEqual(['ls -la'])
})

test('git runs with safe config: no fsmonitor, hooks, signatures, external diff, pager or odd prefixes', async ($, on) => {
  const calls = host(on, args => (has(args, 'diff', '--cached') ? { out: '' } : undefined))
  shell(on)
  await $.tool.call({ tool: 'Bash', command: 'git commit -m x' })
  const argv = calls[0]?.argv.join(' ') ?? ''
  for (const c of ['-c core.fsmonitor=', '-c core.hooksPath=', '-c log.showSignature=false', '-c diff.external=', '-c core.pager=cat', '-c diff.mnemonicPrefix=false', '-c diff.noprefix=false', '--no-ext-diff', '--no-textconv']) expect(argv).toContain(c)
})

test('the OpenAI-style pattern is linear: 200 KB adversarial lines scan well under a second', async () => {
  for (const line of ['sk-'.repeat(70_000), 'sk-' + 'T3BlbkFJ'.repeat(25_000), 'sk-proj-' + 'a'.repeat(200_000) + '!', 'xoxb-' + '-'.repeat(200_000)]) {
    const t = performance.now()
    kindsIn(line)
    expect(performance.now() - t).toBeLessThan(500)
  }
  // A key far into a long minified line is still found.
  expect(kindsIn('x'.repeat(150_000) + ` k="${AWS}" ` + 'y'.repeat(50_000))).toEqual(['AWS access key ID'])
})

test('false positives: the documented AWS example key, example and test env files, any diff prefix, ++ lines', async () => {
  expect(kindsIn('aws_access_key_id = AKIAIOSFODNN7EXAMPLE')).toEqual([])
  expect(kindsIn('aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY')).toEqual([])
  for (const f of ['.env.example', '.env.sample', '.env.template', '.env.test', '.env.development', 'app/.env.development']) expect([f, isEnvFile(f)]).toEqual([f, false])
  expect(isEnvFile('.env.production')).toBe(true)
  const envDiff = (file: string, line: string) => `diff --git a/${file} b/${file}\nnew file mode 100644\n--- /dev/null\n+++ b/${file}\n@@ -0,0 +1 @@\n+${line}\n`
  expect(scanDiff(envDiff('.env.development', 'VITE_API_URL=http://localhost:3000'), [])).toEqual([])
  expect(scanDiff(envDiff('.env.example', `AWS_KEY=${AWS}`), []).map(f => f.kind)).toEqual(['AWS access key ID'])
  // Mnemonic (c/ i/ w/) and no-prefix diffs still match allowPaths.
  const mnem = `diff --git c/tests/fixtures/k.txt i/tests/fixtures/k.txt\nnew file mode 100644\n--- /dev/null\n+++ i/tests/fixtures/k.txt\n@@ -0,0 +1 @@\n+${AWS}\n`
  expect(scanDiff(mnem, ['tests/fixtures/**'])).toEqual([])
  const nopre = `diff --git tests/fixtures/k.txt tests/fixtures/k.txt\nnew file mode 100644\n--- /dev/null\n+++ tests/fixtures/k.txt\n@@ -0,0 +1 @@\n+${AWS}\n`
  expect(scanDiff(nopre, ['tests/fixtures/**'])).toEqual([])
  // An added line whose text starts with "++ " is content, not a file header.
  const tricky = `diff --git a/notes.md b/notes.md\n--- a/notes.md\n+++ b/notes.md\n@@ -1,0 +1,2 @@\n+++ tests/fixtures/x\n+key ${AWS}\n`
  expect(scanDiff(tricky, ['tests/**'])).toEqual([{ file: 'notes.md', line: 2, kind: 'AWS access key ID' }])
})

// Repros from the post-commit security review: words the shell rewrites, aliases and launchers.

test('S1 brace or glob expansion, a variable subcommand, an inline alias and launchers are refused', async ($, on) => {
  host(on, branches('feature', 'feature'))
  const seen = shell(on)
  for (const cmd of [
    'git push -f origin {main,}',
    'git push {-f,} origin main',
    'git {push,} -f origin main',
    'git $CMD -f origin main',
    'git push -f origin ma?n',
    'git push -f origin +[m]ain',
    'git push origin :{main,}',
    'git -c alias.p=push p -f origin main',
    'echo main | xargs git push -f origin',
    'find . -maxdepth 0 -exec git push -f origin main \;',
    'watch -n 60 git push -f origin main',
    'parallel gh repo edit {} --visibility public ::: acme/x',
  ]) expect([cmd, refusal(await $.tool.call({ tool: 'Bash', command: cmd })) ?? 'ran']).toEqual([cmd, expect.stringMatching(/push-guard/)])
  expect(seen).toEqual([])
})

test('S2 a git config alias is checked as what it stands for; shell aliases are refused; builtins need no lookup', async ($, on) => {
  const calls = host(on, args => {
    if (has(args, 'config', '--get', 'alias.fp')) return { out: 'push -f origin main\n' }
    if (has(args, 'config', '--get', 'alias.sh')) return { out: '!git push -f origin main\n' }
    if (has(args, 'config', '--get', 'alias.lg')) return { out: 'log --oneline\n' }
    if (has(args, 'config', '--get')) return { code: 1 }
    return branches('feature', 'feature')(args)
  })
  const seen = shell(on)
  expect(refusal(await $.tool.call({ tool: 'Bash', command: 'git fp' }))).toContain('protected branch: main')
  expect(refusal(await $.tool.call({ tool: 'Bash', command: 'git sh' }))).toContain('is a git alias for')
  await $.tool.call({ tool: 'Bash', command: 'git lg -5' })
  await $.tool.call({ tool: 'Bash', command: 'git frobnicate' })
  const before = calls.length
  await $.tool.call({ tool: 'Bash', command: 'git log --oneline {a,b}' })
  await $.tool.call({ tool: 'Bash', command: 'echo git push -f origin main' })
  expect(calls.length).toBe(before)
  expect(seen).toEqual(['git lg -5', 'git frobnicate', 'git log --oneline {a,b}', 'echo git push -f origin main'])
})
