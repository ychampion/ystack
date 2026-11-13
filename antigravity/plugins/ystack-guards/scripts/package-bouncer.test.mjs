import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { decide, editDistance, lookalikeOf, parseInstalls, pickVersion } from './package-bouncer.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const fixture = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', 'pre-tool-use.json'), 'utf8'))
const input = CommandLine => ({ ...fixture, cwd: os.tmpdir(), toolCall: { ...fixture.toolCall, args: { ...fixture.toolCall.args, CommandLine } } })

const NOW = Date.parse('2026-11-14T00:00:00Z')
const DAY = 86_400_000
const iso = t => new Date(t).toISOString()

/** A fake registry: `pkgs` maps name -> { created, versions: { v: publishedAt } , downloads }. */
function fakeFetch(pkgs, { down = false, vulns = {} } = {}) {
  const calls = []
  const fn = async (url, init) => {
    calls.push(url)
    if (down) throw new TypeError('fetch failed')
    const json = body => ({ ok: true, status: 200, json: async () => body })
    const missing = { ok: false, status: 404, json: async () => ({}) }
    if (url.startsWith('https://api.osv.dev/')) {
      const q = JSON.parse(init.body)
      return json({ vulns: vulns[`${q.package.name}@${q.version}`] ?? [] })
    }
    let m = /^https:\/\/api\.npmjs\.org\/downloads\/point\/last-week\/(.+)$/.exec(url)
    if (m) return pkgs[m[1]] ? json({ downloads: pkgs[m[1]].downloads ?? 100_000 }) : missing
    m = /^https:\/\/registry\.npmjs\.org\/(.+)$/.exec(url)
    if (m) {
      const p = pkgs[decodeURIComponent(m[1])]
      if (!p) return missing
      const vs = Object.keys(p.versions)
      return json({
        'dist-tags': { latest: p.latest ?? vs[vs.length - 1] },
        time: { created: iso(p.created), ...Object.fromEntries(vs.map(v => [v, iso(p.versions[v])])) },
        versions: Object.fromEntries(vs.map(v => [v, { name: m[1], version: v }])),
      })
    }
    m = /^https:\/\/pypi\.org\/pypi\/(.+)\/json$/.exec(url)
    if (m) {
      const p = pkgs[`pypi:${m[1]}`]
      if (!p) return missing
      const vs = Object.keys(p.versions)
      return json({ info: { version: vs[vs.length - 1] }, releases: Object.fromEntries(vs.map(v => [v, [{ upload_time_iso_8601: iso(p.versions[v]), yanked: false }]])) })
    }
    m = /^https:\/\/pypistats\.org\/api\/packages\/(.+)\/recent$/.exec(url)
    if (m) return json({ data: { last_week: pkgs[`pypi:${m[1]}`]?.downloads ?? 100_000 } })
    return missing
  }
  fn.calls = calls
  return fn
}

const OLD = NOW - 400 * DAY
const REGISTRY = {
  'left-pad': { created: OLD, versions: { '1.2.0': OLD, '1.3.0': OLD + DAY } },
  'brand-new-thing': { created: NOW - 2 * DAY, versions: { '0.1.0': NOW - 2 * DAY }, downloads: 3 },
  'fresh-release': { created: OLD, versions: { '1.0.0': OLD, '2.0.0': NOW - 3 * DAY } },
  lodahs: { created: OLD, versions: { '1.0.0': OLD }, downloads: 12 },
  '@scope/pkg': { created: OLD, versions: { '1.0.0': OLD } },
  'pypi:requests': { created: OLD, versions: { '2.31.0': OLD, '2.32.0': OLD + DAY } },
}

test('parseInstalls finds npm-style and Python installs', () => {
  const names = cmd => parseInstalls(cmd).map(s => `${s.ecosystem}:${s.name}${s.version ? '@' + s.version : ''}:${s.source}`)
  assert.deepEqual(names('npm install left-pad'), ['npm:left-pad:registry'])
  assert.deepEqual(names('npm i -D left-pad@1.3.0 @scope/pkg'), ['npm:left-pad@1.3.0:registry', 'npm:@scope/pkg:registry'])
  assert.deepEqual(names('bun add left-pad && pnpm add other'), ['npm:left-pad:registry', 'npm:other:registry'])
  assert.deepEqual(names('yarn add x@^1.2'), ['npm:x@^1.2:registry'])
  assert.deepEqual(names('npx create-thing my-app'), ['npm:create-thing:registry'])
  assert.deepEqual(names('npm create vite@latest app'), ['npm:create-vite@latest:registry'])
  assert.deepEqual(names('pip install requests==2.31.0'), ['pypi:requests@2.31.0:registry'])
  assert.deepEqual(names('python -m pip install -U "requests>=2"'), ['pypi:requests@>=2:registry'])
  assert.deepEqual(names('uv add httpx'), ['pypi:httpx:registry'])
  assert.deepEqual(names('uv pip install -r requirements.txt'), [])
  assert.deepEqual(names('npm install ./local-dir https://x.test/a.tgz github:me/repo'), ['npm:./local-dir:path', 'npm:https://x.test/a.tgz:url', 'npm:github:me/repo:git'])
  assert.deepEqual(names('npm install --registry https://npm.example left-pad'), ['npm:left-pad:other-registry'])
  assert.deepEqual(names('npm install $PKG'), ['npm:$PKG:unparsed'])
  assert.deepEqual(names('npm test && npm run build && pip list'), [])
  assert.deepEqual(names('bash -c "npm install left-pad"'), ['npm:left-pad:registry'])
})

test('pickVersion follows exact pins, ranges and tags', () => {
  const vs = ['1.0.0', '1.2.0', '1.3.0', '2.0.0-beta.1']
  assert.deepEqual(pickVersion(undefined, vs, '1.3.0', 'npm'), { kind: 'latest', version: '1.3.0' })
  assert.deepEqual(pickVersion('^1.0.0', vs, '1.3.0', 'npm'), { kind: 'range', version: '1.3.0' })
  assert.deepEqual(pickVersion('~1.2', vs, '1.3.0', 'npm'), { kind: 'range', version: '1.2.0' })
  assert.deepEqual(pickVersion('9.9.9', vs, '1.3.0', 'npm'), { kind: 'missing' })
  assert.deepEqual(pickVersion('next', vs, '1.3.0', 'npm', { next: '2.0.0-beta.1' }), { kind: 'exact', version: '2.0.0-beta.1' })
})

test('look-alike names', () => {
  assert.equal(editDistance('lodahs', 'lodash'), 1)
  assert.equal(lookalikeOf('lodahs', 'npm'), 'lodash')
  assert.equal(lookalikeOf('lodash', 'npm'), undefined)
  assert.equal(lookalikeOf('reqeusts', 'pypi'), 'requests')
  assert.equal(lookalikeOf('completely-different', 'npm'), undefined)
})

test('a package that does not exist is denied', async () => {
  const out = await decide(input('npm install zq-not-a-real-package-8f3a9c'), { fetchFn: fakeFetch(REGISTRY), now: NOW })
  assert.equal(out.decision, 'deny')
  assert.match(out.reason, /zq-not-a-real-package-8f3a9c doesn't exist on npm/)
})

test('an established package is allowed', async () => {
  assert.deepEqual(await decide(input('npm install left-pad'), { fetchFn: fakeFetch(REGISTRY), now: NOW }), { decision: 'allow' })
  assert.deepEqual(await decide(input('pip install requests==2.31.0'), { fetchFn: fakeFetch(REGISTRY), now: NOW }), { decision: 'allow' })
  assert.deepEqual(await decide(input('npm i @scope/pkg'), { fetchFn: fakeFetch(REGISTRY), now: NOW }), { decision: 'allow' })
})

test('a recently published package or version asks', async () => {
  const fresh = await decide(input('bun add brand-new-thing'), { fetchFn: fakeFetch(REGISTRY), now: NOW })
  assert.equal(fresh.decision, 'ask')
  assert.match(fresh.reason, /first published 2 days ago \(under 14 days\)/)
  const release = await decide(input('npm i fresh-release'), { fetchFn: fakeFetch(REGISTRY), now: NOW })
  assert.equal(release.decision, 'ask')
  assert.match(release.reason, /fresh-release@2\.0\.0 came out 3 days ago.*fresh-release@1\.0\.0/)
  assert.deepEqual(await decide(input('npm i fresh-release@1.0.0'), { fetchFn: fakeFetch(REGISTRY), now: NOW }), { decision: 'allow' })
})

test('a look-alike name asks', async () => {
  const out = await decide(input('npm i lodahs'), { fetchFn: fakeFetch(REGISTRY), now: NOW })
  assert.equal(out.decision, 'ask')
  assert.match(out.reason, /misspelling of the popular package lodash/)
})

test('a made-up version, known vulnerabilities and an unreadable name are denied', async () => {
  const f = fakeFetch(REGISTRY, { vulns: { 'left-pad@1.2.0': [{ id: 'GHSA-test-0001', affected: [{ package: { name: 'left-pad' }, ranges: [{ events: [{ introduced: '0' }, { fixed: '1.3.0' }] }] }] }] } })
  const v = await decide(input('npm i left-pad@7.7.7'), { fetchFn: f, now: NOW })
  assert.equal(v.decision, 'deny')
  assert.match(v.reason, /no version 7\.7\.7/)
  const vuln = await decide(input('npm i left-pad@1.2.0'), { fetchFn: f, now: NOW })
  assert.equal(vuln.decision, 'deny')
  assert.match(vuln.reason, /GHSA-test-0001 \(fixed in 1\.3\.0\).*left-pad@1\.3\.0 or later/)
  const dyn = await decide(input('npm i $PKG'), { fetchFn: f, now: NOW })
  assert.equal(dyn.decision, 'deny')
})

test('a registry that cannot be reached lets the install through', async () => {
  const out = await decide(input('npm install zq-not-a-real-package-8f3a9c'), { fetchFn: fakeFetch(REGISTRY, { down: true }), now: NOW })
  assert.deepEqual(out, { decision: 'allow' })
})

test('commands that install nothing make no network calls', async () => {
  const f = fakeFetch(REGISTRY)
  for (const cmd of ['echo hi', 'npm test', 'npm run build', 'git status', 'pip list', 'npm install']) {
    assert.deepEqual(await decide(input(cmd), { fetchFn: f, now: NOW }), { decision: 'allow' }, cmd)
  }
  assert.equal(f.calls.length, 0)
})
