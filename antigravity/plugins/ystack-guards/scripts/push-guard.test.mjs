import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe as group, test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { decide, describe, ghPublic, kindsIn, parsePush, scanDiff } from './push-guard.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
// AWS's documented example key, built in two parts so this file itself never trips a key scanner.
const KEY = 'AKIA' + 'IOSFODNN7EXAMPLE'
const fixture = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', 'pre-tool-use.json'), 'utf8'))
const input = (CommandLine, cwd) => ({ ...fixture, cwd, toolCall: { ...fixture.toolCall, args: { ...fixture.toolCall.args, CommandLine } } })

function sh(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`)
  return r.stdout.trim()
}

test('finds key kinds without returning values', () => {
  assert.deepEqual(kindsIn(`aws_key = "${KEY}"`), ['AWS access key ID'])
  assert.deepEqual(kindsIn('nothing to see here'), [])
  assert.deepEqual(kindsIn('x '.repeat(5_000) + KEY), ['AWS access key ID'])
})

test('scanDiff reads added lines only, with file and line', () => {
  const diff = [
    '\u0001pg-commit abc1234',
    'diff --git a/config.js b/config.js',
    '--- a/config.js',
    '+++ b/config.js',
    '@@ -3 +3 @@',
    `-const old = "${KEY}"`,
    '+const key = process.env.KEY',
    '@@ -10,0 +11,2 @@',
    '+// fine',
    `+const leaked = "${KEY}"`,
    'diff --git a/.env b/.env',
    'new file mode 100644',
    '--- /dev/null',
    '+++ b/.env',
    '@@ -0,0 +1 @@',
    '+X=1',
  ].join('\n')
  const found = scanDiff(diff)
  assert.deepEqual(found, [
    { file: 'config.js', line: 12, kind: 'AWS access key ID', commit: 'abc1234' },
    { file: '.env', kind: '.env file', commit: 'abc1234' },
  ])
  const text = describe(found)
  assert.match(text, /config\.js line 12 \(commit abc1234\): AWS access key ID/)
  assert.ok(!text.includes(KEY))
})

test('parsePush: force targets and what goes out', () => {
  assert.deepEqual(parsePush([]), { remote: 'origin', revs: ['HEAD'], revFlags: [], forced: [] })
  assert.deepEqual(parsePush(['-f']).forced, [{ current: true, upstream: true }])
  assert.deepEqual(parsePush(['--force-with-lease', 'origin', 'main']).forced, [{ branch: 'main' }])
  assert.deepEqual(parsePush(['--forc', 'origin', 'main']).forced, [{ branch: 'main' }], 'unambiguous prefix of --force')
  assert.deepEqual(parsePush(['origin', '+feature:refs/heads/master']).forced, [{ branch: 'master' }])
  assert.deepEqual(parsePush(['origin', '+HEAD']).forced, [{ current: true }])
  assert.deepEqual(parsePush(['-f', 'origin', '$BRANCH']).forced, [{ unknown: '$BRANCH' }])
  assert.deepEqual(parsePush(['--mirror']).forced, [{ all: true }])
  assert.deepEqual(parsePush(['origin', 'feature']), { remote: 'origin', revs: ['feature'], revFlags: [], forced: [] })
  assert.deepEqual(parsePush(['origin', ':old-branch']).revs, [], 'a delete pushes no commits')
  assert.deepEqual(parsePush(['--all']).revFlags, ['--branches'])
})

test('gh: making a repo public', () => {
  assert.ok(ghPublic(['gh', 'repo', 'edit', 'me/x', '--visibility', 'public']))
  assert.ok(ghPublic(['gh', 'repo', 'edit', '--visibility=public']))
  assert.ok(ghPublic(['gh', 'repo', 'create', 'new-thing', '--public', '--source', '.']))
  assert.ok(ghPublic(['gh', 'api', '-X', 'PATCH', 'repos/me/x', '-F', 'private=false']))
  assert.ok(ghPublic(['gh', 'api', 'repos/me/x', '-f', 'visibility=public']))
  assert.equal(ghPublic(['gh', 'repo', 'edit', 'me/x', '--visibility', 'private']), undefined)
  assert.equal(ghPublic(['gh', 'repo', 'create', 'x', '--private']), undefined)
  assert.equal(ghPublic(['gh', 'pr', 'create', '--title', 'public']), undefined)
})

test('non-push commands are allowed', () => {
  assert.deepEqual(decide(input('echo hello', os.tmpdir())), { decision: 'allow' })
  assert.deepEqual(decide(input('git status', os.tmpdir())), { decision: 'allow' })
  assert.deepEqual(decide({ toolCall: { name: 'view_file', args: {} } }), { decision: 'allow' })
  assert.equal(decide(input('gh repo edit --visibility public', os.tmpdir())).decision, 'deny')
  assert.equal(decide(input('curl -X PATCH https://api.github.com/repos/me/x -d \'{"private":false}\'', os.tmpdir())).decision, 'deny')
})

group('against a real repository with a bare remote', () => {
  let root
  let repo
  before(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-test-'))
    repo = path.join(root, 'work')
    sh(root, 'init', '-q', '--bare', 'remote.git')
    sh(root, 'init', '-q', '-b', 'main', 'work')
    sh(repo, 'config', 'user.name', 'test')
    sh(repo, 'config', 'user.email', 'test@example.invalid')
    sh(repo, 'config', 'commit.gpgsign', 'false')
    sh(repo, 'remote', 'add', 'origin', path.join(root, 'remote.git'))
    fs.writeFileSync(path.join(repo, 'README'), 'hello\n')
    sh(repo, 'add', '.')
    sh(repo, 'commit', '-q', '-m', 'first')
    sh(repo, 'push', '-q', '-u', 'origin', 'main')
  })
  after(() => fs.rmSync(root, { recursive: true, force: true }))

  test('a clean push is allowed', () => {
    fs.writeFileSync(path.join(repo, 'app.js'), 'console.log(1)\n')
    sh(repo, 'add', '.')
    sh(repo, 'commit', '-q', '-m', 'clean')
    assert.deepEqual(decide(input('git push', repo)), { decision: 'allow' })
    sh(repo, 'push', '-q')
  })

  test('a push carrying a key is denied, without printing the key', () => {
    fs.writeFileSync(path.join(repo, 'config.js'), `module.exports = { key: "${KEY}" }\n`)
    sh(repo, 'add', '.')
    sh(repo, 'commit', '-q', '-m', 'add config')
    for (const cmd of ['git push', 'git push origin main', `cd "${repo}" && git push`, 'git -c x=y push origin HEAD:refs/heads/main']) {
      const out = decide(input(cmd, cmd.startsWith('cd') ? root : repo))
      assert.equal(out.decision, 'deny', cmd)
      assert.match(out.reason, /config\.js line 1 \(commit [0-9a-f]+\): AWS access key ID/)
      assert.ok(!out.reason.includes(KEY), 'the key is never shown')
    }
    // Pushing only the old, already-pushed branch tip carries nothing new.
    assert.deepEqual(decide(input('git push origin origin/main:refs/heads/other', repo)), { decision: 'allow' })
  })

  test('force-pushing to main is denied; to a feature branch is allowed', () => {
    sh(repo, 'reset', '-q', '--hard', 'origin/main')
    assert.equal(decide(input('git push --force', repo)).decision, 'deny')
    assert.equal(decide(input('git push -f origin main', repo)).decision, 'deny')
    assert.equal(decide(input('git push origin +HEAD:master', repo)).decision, 'deny')
    sh(repo, 'checkout', '-q', '-b', 'feature')
    assert.deepEqual(decide(input('git push -f origin feature', repo)), { decision: 'allow' })
  })

  test('the script answers on stdout from fixture stdin, and fails open on bad input', () => {
    const run = stdin => spawnSync(process.execPath, [path.join(HERE, 'push-guard.mjs')], { input: stdin, encoding: 'utf8' })
    const ok = run(JSON.stringify(input('echo hi', repo)))
    assert.deepEqual(JSON.parse(ok.stdout), { decision: 'allow' })
    const bad = run('not json')
    assert.deepEqual(JSON.parse(bad.stdout), { decision: 'allow' })
    assert.match(bad.stderr, /internal error, letting it through/)
  })
})
