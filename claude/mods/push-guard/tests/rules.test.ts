import { expect, test } from 'claude-code/testing'

import { actions, globMatch, type PushAction } from '../hooks/rules.ts'
import { describe, isEnvFile, kindsIn, scanDiff } from '../hooks/secrets.ts'

// Fake keys are built from pieces so this file itself never holds a key-shaped literal.
const AWS = 'AKIA' + 'Q7'.repeat(8)
const GH = 'ghp_' + 'a1B2'.repeat(9)
const ANT = 'sk-ant-' + 'api03-' + 'x9'.repeat(20)
const OPENAI = 'sk-' + 'proj-' + 'Ab3'.repeat(15)
const STRIPE = 'sk_' + 'live_' + 'z9'.repeat(12)
const SLACK = 'xox' + 'b-' + '1234567890-abcdefghij'
const GOOGLE = 'AIza' + 'S'.repeat(35)
const PEM = '-----BEGIN ' + 'RSA PRIVATE KEY-----'

const push = (cmd: string, shell: 'bash' | 'powershell' = 'bash') => actions(cmd, shell).find(a => a.kind === 'push') as PushAction

test('commits: an earlier git add widens what is scanned, quotes and -C are read', async () => {
  expect(actions('git add -A && git commit -m "wip"', 'bash')).toEqual([{ kind: 'commit', base: { replay: [] }, tracked: 'all', untracked: 'all' }])
  expect(actions('git add src/a.ts; git commit -m x', 'bash')[0]).toMatchObject({ tracked: ['src/a.ts'], untracked: ['src/a.ts'] })
  expect(actions('git -C sub commit -am "msg"', 'bash')).toEqual([{ kind: 'commit', base: { replay: ['-C', 'sub'] }, tracked: 'all', untracked: 'none' }])
  expect(actions("cd repo && git commit -m 'a && git push -f origin main'", 'bash')).toEqual([{ kind: 'commit', base: { cwd: 'repo', replay: [] }, tracked: 'none', untracked: 'none' }])
  expect(actions('git commit -m "x" -- notes.md', 'bash')[0]).toMatchObject({ tracked: ['notes.md'] })
  expect(actions('git status && git log --oneline', 'bash')).toEqual([])
})

test('force pushes: --force, -f in a bundle, --force-with-lease, +refspec, HEAD:main', async () => {
  expect(push('git push --force origin main').forced).toEqual([{ branch: 'main' }])
  expect(push('git push -fu origin feature').forced).toEqual([{ branch: 'feature' }])
  expect(push('git push --force-with-lease').forced).toEqual([{ current: true, upstream: true }])
  expect(push('git push origin +main').forced).toEqual([{ branch: 'main' }])
  expect(push('git push origin HEAD:refs/heads/master -f').forced).toEqual([{ branch: 'master' }])
  expect(push('git push origin HEAD -f').forced).toEqual([{ current: true }])
  expect(push('git push --all --force origin').forced).toEqual([{ all: true }])
  expect(push('git push origin main').forced).toEqual([])
  expect(push('git push origin main').revs).toEqual(['main'])
  expect(push('git push').revs).toEqual(['HEAD'])
  expect(push('git push origin -- --output=/tmp/x main').revs).toEqual(['main'])
  expect(push('git push --all --tags origin')).toMatchObject({ revs: [], revFlags: ['--branches', '--tags'] })
  expect(push('git push --force-if-includes origin main').forced).toEqual([])
})

test('PowerShell: Set-Location, the call operator and backslash paths', async () => {
  const p = push('Set-Location C:\\work\\app; & git push --force origin main', 'powershell')
  expect(p.base.cwd).toBe('C:\\work\\app')
  expect(p.forced).toEqual([{ branch: 'main' }])
  expect(actions('git commit -m "it`"s done"; git push', 'powershell').map(a => a.kind)).toEqual(['commit', 'push'])
  expect(push('& "C:\\Program Files\\Git\\cmd\\git.exe" push -f origin master', 'powershell').forced).toEqual([{ branch: 'master' }])
})

test('wrappers: bash -c, pwsh -Command, env vars and sudo are seen through', async () => {
  expect(push('bash -lc "git push -f origin master"').forced).toEqual([{ branch: 'master' }])
  expect(push('pwsh -NoProfile -Command "git push --force origin main"').forced).toEqual([{ branch: 'main' }])
  expect(push('GIT_SSH_COMMAND="ssh -i k" git push -f origin main').forced).toEqual([{ branch: 'main' }])
  expect(push('cmd /c git push -f origin main').forced).toEqual([{ branch: 'main' }])
})

test('text that only mentions git is not a git command', async () => {
  expect(actions('echo "git push --force origin main"', 'bash')).toEqual([])
  expect(actions("grep -rn 'gh repo delete' docs", 'bash')).toEqual([])
  expect(actions('# git push -f origin main\nls', 'bash')).toEqual([])
})

test('deletions: --delete, :branch, --prune, gh repo delete, DELETE on a ref', async () => {
  expect(push('git push origin --delete old-a old-b').deletes).toEqual(['origin/old-a', 'origin/old-b'])
  expect(push('git push origin :old').deletes).toEqual(['origin/old'])
  expect(push('git push -d upstream refs/heads/x').deletes).toEqual(['upstream/x'])
  expect(push('git push --prune origin').deletes).toEqual(['origin:prune'])
  expect(push('git push origin main').deletes).toEqual([])
  expect(actions('gh repo delete me/tool --yes', 'bash')).toMatchObject([{ kind: 'delete-repo', repo: 'me/tool' }])
  expect(actions('gh api -X DELETE repos/me/tool/git/refs/heads/dev', 'bash')).toMatchObject([{ kind: 'delete-ref', target: 'me/tool/dev' }])
  expect(actions('curl -X DELETE https://api.github.com/repos/me/tool', 'bash')).toMatchObject([{ kind: 'delete-repo', repo: 'me/tool' }])
})

test('going public: gh repo edit/create, gh api and curl; private changes pass', async () => {
  expect(actions('gh repo edit me/x --visibility public --accept-visibility-change-consequences', 'bash')).toMatchObject([{ kind: 'public', repo: 'me/x' }])
  expect(actions('gh repo edit --visibility=public', 'bash')).toMatchObject([{ kind: 'public' }])
  expect((actions('gh repo edit --visibility=public', 'bash')[0] as { repo?: string }).repo).toBeUndefined()
  expect(actions('gh repo create tool --public --source .', 'bash')).toMatchObject([{ kind: 'public', repo: 'tool' }])
  expect(actions('gh repo create --public', 'bash')).toMatchObject([{ kind: 'public', repo: 'new' }])
  expect(actions('gh api -X PATCH repos/me/x -F private=false', 'bash')).toMatchObject([{ kind: 'public', repo: 'me/x' }])
  expect(actions('gh api repos/me/x --method PATCH -f visibility=public', 'bash')).toMatchObject([{ kind: 'public', repo: 'me/x' }])
  expect(actions(`curl -X PATCH https://api.github.com/repos/me/x -d '{"private": false}'`, 'bash')).toMatchObject([{ kind: 'public', repo: 'me/x' }])
  expect(actions(`Invoke-RestMethod -Uri https://api.github.com/repos/me/x -Method Patch -Body '{"visibility":"public"}'`, 'powershell')).toMatchObject([{ kind: 'public', repo: 'me/x' }])
  expect(actions('gh repo edit me/x --visibility private', 'bash')).toEqual([])
  expect(actions('gh repo create tool --private', 'bash')).toEqual([])
  expect(actions('gh api repos/me/x', 'bash')).toEqual([])
  expect(actions('gh repo view me/x --json visibility', 'bash')).toEqual([])
})

test('globs: **, *, and bare names matching the base name', async () => {
  expect(globMatch('tests/fixtures/**', 'tests/fixtures/a/b.json')).toBe(true)
  expect(globMatch('*.snap', 'src/__snapshots__/x.snap')).toBe(true)
  expect(globMatch('release/*', 'release/1.2')).toBe(true)
  expect(globMatch('release/*', 'release/1/2')).toBe(false)
  expect(globMatch('main', 'main')).toBe(true)
  expect(globMatch('main', 'maintenance')).toBe(false)
})

test('key formats are recognised by kind', async () => {
  expect(kindsIn(`const k = "${AWS}"`)).toEqual(['AWS access key ID'])
  expect(kindsIn(`token: ${GH}`)).toEqual(['GitHub token'])
  expect(kindsIn(`ANTHROPIC_API_KEY=${ANT}`)).toEqual(['Anthropic API key'])
  expect(kindsIn(`OPENAI_API_KEY=${OPENAI}`)).toEqual(['OpenAI API key'])
  expect(kindsIn(STRIPE)).toEqual(['Stripe secret key'])
  expect(kindsIn(SLACK)).toEqual(['Slack token'])
  expect(kindsIn(GOOGLE)).toEqual(['Google API key'])
  expect(kindsIn(PEM)).toEqual(['private key block'])
  expect(kindsIn('const sk = "sk-short"; pk_live_abc; AKIA')).toEqual([])
  expect(isEnvFile('.env')).toBe(true)
  expect(isEnvFile('app/.env.production')).toBe(true)
  expect(isEnvFile('.env.example')).toBe(false)
  expect(isEnvFile('env.ts')).toBe(false)
})

test('a diff scan reports file, line and kind, only on added lines, and never the value', async () => {
  const diff = [
    'diff --git a/src/conf.ts b/src/conf.ts',
    '--- a/src/conf.ts',
    '+++ b/src/conf.ts',
    '@@ -10,0 +11,2 @@',
    '+const a = 1',
    `+const key = "${AWS}"`,
    `-const old = "${GH}"`,
    'diff --git a/fixtures/k.txt b/fixtures/k.txt',
    'new file mode 100644',
    '--- /dev/null',
    '+++ b/fixtures/k.txt',
    '@@ -0,0 +1 @@',
    `+${STRIPE}`,
  ].join('\n')
  const found = scanDiff(diff, [])
  expect(found).toEqual([
    { file: 'src/conf.ts', line: 12, kind: 'AWS access key ID' },
    { file: 'fixtures/k.txt', line: 1, kind: 'Stripe secret key' },
  ])
  expect(scanDiff(diff, ['fixtures/**'])).toEqual([{ file: 'src/conf.ts', line: 12, kind: 'AWS access key ID' }])
  const text = describe(found)
  expect(text).toContain('src/conf.ts line 12: AWS access key ID')
  expect(text).not.toContain(AWS)
  expect(text).not.toContain(STRIPE)
})
