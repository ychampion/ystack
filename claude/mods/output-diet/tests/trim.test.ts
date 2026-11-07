import { expect, mock, test } from 'claude-code/testing'

import { clean, hasFailureSummary, isContentCommand, isPassLine, shouldShorten, trimOutput } from '../hooks/trim.ts'
import { BUN_TEST_FAIL, INSTALL_LOG, LONG_FILE, SHORT_OUTPUT } from './fixtures.ts'

test('a bun test failure log keeps every failure and drops the passes', async () => {
  const t = trimOutput(BUN_TEST_FAIL, 150)
  expect(t).toBeDefined()
  const text = t?.text ?? ''
  for (const must of [
    '(fail) parser > handles an error in nested quotes',
    'error: expect(received).toBe(expected)',
    'Expected: "a\\"b"',
    'Received: "a"',
    'C:/repo/src/parser.test.ts:88:23',
    '(fail) billing > rounds tax to cents',
    '  - 10.05',
    '  + 10.049999',
    ' 238 pass',
    ' 2 fail',
    'Ran 240 tests across 2 files.',
  ])
    expect(text).toContain(must)
  expect(text).not.toContain('(pass) parser > parses case 50 ')
  expect((t?.toLines ?? 999) < 80).toBe(true)
})

test('an install log loses its progress bars and repeats, keeps the warning and the summary', async () => {
  const t = trimOutput(INSTALL_LOG, 150)
  expect(t).toBeDefined()
  const text = t?.text ?? ''
  expect(text).not.toContain('\x1b[')
  expect(text).not.toContain('\r')
  expect(text).toContain('warn: incorrect peer dependency "react@18.3.1"')
  expect(text).toContain('221 packages installed')
  expect(text).toMatch(/\[\.\.\. \d+ similar lines\]/)
  expect((t?.toChars ?? 1e9) < INSTALL_LOG.length / 3).toBe(true)
})

test('short output is left alone', async () => {
  expect(trimOutput(SHORT_OUTPUT, 150)).toBeUndefined()
})

test('content commands pass through', async () => {
  for (const c of [
    'cat src/big.ts',
    'type C:\\x\\a.txt',
    'Get-Content .\\log.txt',
    'head -n 400 file',
    "sed -n '1,300p' a.ts",
    'git diff HEAD~1',
    'git -C repo show abc123',
    'git log --oneline',
    'git blame src/a.ts',
    'rg -n foo src',
    'grep -r bar .',
    'Select-String -Path *.ts -Pattern x',
    "jq '.items' data.json",
    'bun test 2>&1 | tail -80',
  ])
    expect(isContentCommand(c)).toBe(true)
  for (const c of ['bun install', 'bun test', 'docker compose logs api', 'cargo build --release', 'npx tsc -p .', 'git status', 'git push'])
    expect(isContentCommand(c)).toBe(false)
})

test('helpers', async () => {
  expect(clean('a\r\nb 10%\rb 100%\n\x1b[31mred\x1b[0m')).toEqual(['a', 'b 100%', 'red'])
  expect(isPassLine('(pass) x [1ms]')).toBe(true)
  expect(isPassLine('  ✓ handles error case')).toBe(true)
  expect(isPassLine('Tests: 3 passed, 1 failed')).toBe(false)
  expect(hasFailureSummary([' 0 fail'])).toBe(false)
  expect(hasFailureSummary([' 2 fail'])).toBe(true)
})

test('the hook shortens a failing build and saves the full output', async ($, on) => {
  const writes: string[] = []
  on('env.get', () => ({ value: 'C:/Users/someone' }))
  on('session.id', () => ({ value: 'session-1' }))
  on('clock.now', () => ({ value: 1_700_000_000_000 }))
  on('fs.write', (_, e) => {
    writes.push(String((e as { path?: string }).path))
    return { value: undefined }
  })
  on('tool.call', () => ({ result: { stdout: BUN_TEST_FAIL, stderr: '', interrupted: false } }))
  const r = await $.tool.call({ tool: 'Bash', command: 'bun test' })
  const out = (r.result as { stdout: string }).stdout
  expect(out).toContain('(fail) billing > rounds tax to cents')
  expect(out).toContain('[output-diet: shortened from')
  expect(out).toContain('Read it if you need more]')
  expect(writes.length).toBe(1)
})

test('a failed command stays an error, shortened, with its failures', async ($, on) => {
  on('env.get', () => ({ value: 'C:/Users/someone' }))
  on('session.id', () => ({ value: 'session-1' }))
  on('clock.now', () => ({ value: 1_700_000_000_000 }))
  on('fs.write', () => ({ value: undefined }))
  const text = `Exit code 1\n${BUN_TEST_FAIL}`
  on('tool.call', () => ({ isError: true as const, result: text, text }))
  // A deny after the tool ran is how a hook replaces an errored result: the model reads it as the error
  // (checked in a real headless run: is_error stays true, the text is the deny's).
  const r = await $.tool.call({ tool: 'Bash', command: 'bun test' })
  const said = r.deny ?? ''
  expect(said).toContain('Exit code 1')
  expect(said).toContain('(fail) parser > handles an error in nested quotes')
  expect(said).toContain('[output-diet: shortened from')
})

test('/output-diet off stops it for the session', async ($, on) => {
  on('tool.call', () => ({ result: { stdout: BUN_TEST_FAIL, stderr: '', interrupted: false } }))
  await $.command.run({ command: 'output-diet', args: 'off' } as Parameters<typeof $.command.run>[0])
  const r = await $.tool.call({ tool: 'Bash', command: 'bun test' })
  expect((r.result as { stdout: string }).stdout).toBe(BUN_TEST_FAIL)
})

test('the hook leaves `cat` of a long file untouched', async ($, on) => {
  on('tool.call', () => ({ result: { stdout: LONG_FILE, stderr: '', interrupted: false } }))
  const r = await $.tool.call({ tool: 'Bash', command: 'cat src/values.ts' })
  expect((r.result as { stdout: string }).stdout).toBe(LONG_FILE)
})

test('a short output passes through untouched', async ($, on) => {
  on('tool.call', () => ({ result: { stdout: SHORT_OUTPUT, stderr: '', interrupted: false } }))
  const r = await $.tool.call({ tool: 'Bash', command: 'bun test' })
  expect((r.result as { stdout: string }).stdout).toBe(SHORT_OUTPUT)
})

test('the enabled setting turns it off', { options: { enabled: false } }, async ($, on) => {
  on('tool.call', () => ({ result: { stdout: BUN_TEST_FAIL, stderr: '', interrupted: false } }))
  const r = await $.tool.call({ tool: 'Bash', command: 'bun test' })
  expect((r.result as { stdout: string }).stdout).toBe(BUN_TEST_FAIL)
})

test('error and failure lines in other tools\' formats survive in the middle of a long log', async () => {
  // Distinct words per line, so no run collapses into "similar lines" and every line sits in the omitted middle.
  const letters = (n: number) => String(n).replace(/\d/g, d => 'abcdefghij'[Number(d)] ?? 'a')
  const noise = (from: number) => Array.from({ length: 200 }, (_, i) => `compiled module ${letters(from + i)}`)
  for (const line of [
    'npm ERR! code ERESOLVE',
    '  ✕ adds two numbers (5 ms)',
    ' × src/sum.test.ts > adds [2ms]',
    'bash: ./run.sh: No such file or directory',
    'Segmentation fault (core dumped)',
    'CONFLICT (content): Merge conflict in src/a.ts',
    'Killed',
    'E       assert 1 == 2',
    ' ! [rejected]        main -> main (non-fast-forward)',
    'main.c:(.text+0x1a): undefined reference to `foo`',
  ]) {
    const text = trimOutput([...noise(0), line, ...noise(1000)].join('\n'), 150)?.text ?? ''
    expect(text).toContain(line)
  }
})

test('only build, install, test and lint output is shortened; other output is content', async () => {
  for (const c of [
    'sqlite3 app.db "select id, name from users"',
    'python report.py',
    'node -e "console.log(require(\'fs\').readFileSync(\'a.txt\', \'utf8\'))"',
    'Get-Process',
    'psql -c "select * from orders"',
    'docker compose logs api',
    'npm ls --all',
    'pip list',
  ])
    expect(shouldShorten(c)).toBe(false)
  for (const c of [
    'bun test',
    'bun install',
    'npm install',
    'npm run build',
    'cargo build --release',
    'npx tsc -p .',
    'pytest -q',
    'python -m pytest tests',
    'docker build -t app .',
    'dotnet test',
    './gradlew build',
    'make -j8',
    'uv pip install -r requirements.txt',
    'cd app && bun run test',
    'claude plugin test .',
  ])
    expect(shouldShorten(c)).toBe(true)
  expect(shouldShorten('bun test 2>&1 | tail -80')).toBe(false) // content wins
})

test('a long query result passes through untouched', async ($, on) => {
  const rows = Array.from({ length: 300 }, (_, i) => `${i}|user ${i}|${i * 3}`).join('\n')
  // Everything saving needs, so a pass-through is the hook's choice and not a failure to save.
  on('env.get', () => ({ value: 'C:/Users/someone' }))
  on('session.id', () => ({ value: 'session-1' }))
  on('clock.now', () => ({ value: 1_700_000_000_000 }))
  on('fs.write', () => ({ value: undefined }))
  on('tool.call', () => ({ result: { stdout: rows, stderr: '', interrupted: false } }))
  const r = await $.tool.call({ tool: 'Bash', command: 'sqlite3 app.db "select * from users"' })
  expect((r.result as { stdout: string }).stdout).toBe(rows)
})

test('saved outputs older than 7 days are deleted at session start; newer ones stay', async ($, on) => {
  const DAY = 86_400_000
  const now = 100 * DAY
  const clock = mock.clock(on, { now })
  mock.env(on, { USERPROFILE: 'C:\\Users\\someone', OS: 'Windows_NT' })
  on('command.register', () => ({ value: { command: 'output-diet' } }) as never)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  const root = 'C:/Users/someone/.claude/output-diet'
  const file = (name: string, ageDays: number) => ({ name, kind: 'file', size: 10, mtimeMs: now - ageDays * DAY, isLink: false })
  const dir = (name: string) => ({ name, kind: 'dir', size: 0, mtimeMs: 0, isLink: false })
  const tree: Record<string, unknown[]> = {
    [root]: [dir('old-session'), dir('mixed-session'), dir('new-session')],
    [`${root}/old-session`]: [file('1.txt', 30), file('2.txt', 8)],
    [`${root}/mixed-session`]: [file('1.txt', 9), file('2.txt', 1)],
    [`${root}/new-session`]: [file('1.txt', 0)],
  }
  const slash = (p: string) => p.replace(/\\/g, '/') // the engine hands fs events the platform's own separators
  on('fs.exists', (_, e) => ({ value: slash(e.path) === root }))
  on('fs.list', (_, e) => ({ value: tree[slash(e.path)] ?? [] }) as never)
  const runs: { argv: readonly string[]; init?: { env?: Record<string, string> } }[] = []
  on('process.run', (_, e) => {
    const call = e as unknown as { argv: readonly string[]; init?: { env?: Record<string, string> } }
    runs.push(call)
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } } as never
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(10)
  expect(runs.length).toBe(1)
  const listed = (runs[0]?.init?.env?.OD_PATHS ?? '').split('\n').filter(Boolean).sort()
  expect(listed).toEqual([`${root}/mixed-session/1.txt`, `${root}/old-session`])
  expect(runs[0]?.argv[0]).toBe('powershell.exe')
  expect(runs[0]?.argv.join(' ')).not.toContain(root) // paths ride in the environment, never in the command text
})

test('nothing is deleted when no saved output is old enough', async ($, on) => {
  const clock = mock.clock(on, { now: 10 * 86_400_000 })
  mock.env(on, { HOME: '/home/someone' })
  on('command.register', () => ({ value: { command: 'output-diet' } }) as never)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('fs.exists', () => ({ value: true }))
  on('fs.list', (_, e) =>
    ({ value: e.path.endsWith('output-diet') ? [{ name: 's', kind: 'dir', size: 0, mtimeMs: 0, isLink: false }] : [{ name: '1.txt', kind: 'file', size: 1, mtimeMs: 10 * 86_400_000 - 1000, isLink: false }] }) as never,
  )
  let ran = 0
  on('process.run', () => {
    ran += 1
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } } as never
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(10)
  expect(ran).toBe(0)
})

test('every error line survives, even near-identical ones', async () => {
  const log = [...Array.from({ length: 300 }, (_, i) => `compiling unit ${i}`), 'error at src/a.ts:12', 'error at src/a.ts:40', 'error at src/a.ts:97', 'done'].join('\n')
  const text = trimOutput(log, 150)?.text ?? ''
  for (const l of ['error at src/a.ts:12', 'error at src/a.ts:40', 'error at src/a.ts:97']) expect(text).toContain(l)
})
