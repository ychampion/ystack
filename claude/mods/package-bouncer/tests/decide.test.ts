import { expect, test } from 'claude-code/testing'

import { denyMessage, judge, noteText, type Config } from '../hooks/decide.ts'
import type { Spec } from '../hooks/parse.ts'
import { editDistance, isListedPopular, lookalikeOf, popularList } from '../hooks/popular.ts'
import {
  cratesFacts,
  goFacts,
  goModuleCandidates,
  goEscape,
  newestBefore,
  npmFacts,
  npmUrl,
  osvVulns,
  packagistFacts,
  pypiFacts,
  rubygemsFacts,
} from '../hooks/registry.ts'
import { compareVersions, pickVersion } from '../hooks/versions.ts'

const NOW = Date.parse('2026-11-07T12:00:00Z')
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString()
const CFG: Config = { minAgeDays: 14, minWeeklyDownloads: 500, failClosed: false }
const spec = (name: string, version?: string, ecosystem: Spec['ecosystem'] = 'npm'): Spec => ({
  ecosystem,
  name,
  ...(version ? { version } : {}),
  raw: version ? `${name}@${version}` : name,
  source: 'registry',
})

/** A packument shaped like registry.npmjs.org's, trimmed to the fields the bouncer reads. */
function packument(versions: Record<string, { age: number; scripts?: Record<string, string>; gypfile?: boolean }>, created = 900, latest?: string) {
  const names = Object.keys(versions)
  return {
    name: 'x',
    'dist-tags': { latest: latest ?? names[names.length - 1] },
    time: {
      created: daysAgo(created),
      modified: daysAgo(1),
      ...Object.fromEntries(Object.entries(versions).map(([v, o]) => [v, daysAgo(o.age)])),
    },
    versions: Object.fromEntries(
      Object.entries(versions).map(([v, o]) => [v, { name: 'x', version: v, scripts: { test: 'jest', ...(o.scripts ?? {}) }, ...(o.gypfile ? { gypfile: true } : {}) }]),
    ),
  }
}

test('a package that does not exist is denied', async () => {
  const j = judge(spec('reakt-dom-helperz'), { kind: 'missing' }, CFG, NOW)
  expect(j.level).toBe('deny')
  expect(j.denies[0]).toContain("doesn't exist on npm")
  expect(j.denies[0]).toContain('made up')
})

test('an established package at an old version passes cleanly', async () => {
  const facts = npmFacts(packument({ '1.0.0': { age: 400 }, '1.1.0': { age: 200 } }), { downloads: 2_000_000 })
  const j = judge(spec('left-pad'), { kind: 'found', facts, vulns: [] }, CFG, NOW)
  expect(j).toEqual({ spec: spec('left-pad'), level: 'ok', denies: [], notes: [], version: '1.1.0' })
})

test('a brand-new package is denied, with the age in days', async () => {
  const facts = npmFacts(packument({ '0.0.1': { age: 3 } }, 3), { downloads: 40 })
  const j = judge(spec('fresh-thing'), { kind: 'found', facts, vulns: [] }, CFG, NOW)
  expect(j.level).toBe('deny')
  expect(j.denies.join(' ')).toContain('first published 3 days ago')
  expect(j.notes.join(' ')).toContain('40 downloads last week')
})

test('a brand-new version of an old package is denied, and an older settled version is suggested', async () => {
  const facts = npmFacts(packument({ '4.0.0': { age: 300 }, '4.1.0': { age: 40 }, '4.2.0': { age: 2 } }), { downloads: 9_000_000 })
  const latest = judge(spec('react'), { kind: 'found', facts, vulns: [] }, CFG, NOW)
  expect(latest.level).toBe('deny')
  expect(latest.denies[0]).toContain('react@4.2.0 came out 2 days ago')
  expect(latest.denies[0]).toContain('install react@4.1.0 instead')
  // Asking for the settled version passes.
  expect(judge(spec('react', '4.1.0'), { kind: 'found', facts, vulns: [] }, CFG, NOW).level).toBe('ok')
  // A caret range resolves to the newest match: the new one, so it is denied.
  expect(judge(spec('react', '^4.0.0'), { kind: 'found', facts, vulns: [] }, CFG, NOW).version).toBe('4.2.0')
  // The rule can be switched off.
  expect(judge(spec('react'), { kind: 'found', facts, vulns: [] }, { ...CFG, minAgeDays: 0 }, NOW).level).toBe('ok')
  // Hours, not days, for something published today.
  const today = npmFacts(packument({ '1.0.0': { age: 400 }, '1.0.1': { age: 0.25 } }), { downloads: 9_000_000 })
  expect(judge(spec('react'), { kind: 'found', facts: today, vulns: [] }, CFG, NOW).denies[0]).toContain('6 hours ago')
})

test('a version with known vulnerabilities is denied with advisory ids and the fix', async () => {
  const facts = npmFacts(packument({ '4.17.15': { age: 2000 }, '4.17.21': { age: 1500 } }), { downloads: 50_000_000 })
  // Trimmed from api.osv.dev's real answer for lodash 4.17.15 (two advisories, aliases folded).
  const osv = {
    vulns: [
      {
        id: 'GHSA-29mw-wpgm-hmr9',
        aliases: ['CVE-2020-28500'],
        summary: 'ReDoS in lodash',
        affected: [{ package: { name: 'lodash', ecosystem: 'npm' }, ranges: [{ type: 'SEMVER', events: [{ introduced: '4.0.0' }, { fixed: '4.17.21' }] }] }],
      },
      {
        id: 'GHSA-35jh-r3h4-6jhm',
        aliases: ['CVE-2021-23337'],
        affected: [{ package: { name: 'lodash', ecosystem: 'npm' }, ranges: [{ type: 'SEMVER', events: [{ introduced: '0' }, { fixed: '4.17.21' }] }] }],
      },
      { id: 'CVE-2021-23337', aliases: ['GHSA-35jh-r3h4-6jhm'], affected: [] },
      { id: 'GHSA-old-withdrawn', withdrawn: '2024-01-01T00:00:00Z', affected: [] },
    ],
  }
  const vulns = osvVulns(osv, 'npm', 'lodash', '4.17.15')
  expect(vulns).toEqual([
    { id: 'GHSA-29mw-wpgm-hmr9', summary: 'ReDoS in lodash', fixed: '4.17.21' },
    { id: 'GHSA-35jh-r3h4-6jhm', fixed: '4.17.21' },
  ])
  const j = judge(spec('lodash', '4.17.15'), { kind: 'found', facts, vulns }, CFG, NOW)
  expect(j.level).toBe('deny')
  expect(j.denies[0]).toContain('GHSA-29mw-wpgm-hmr9 (fixed in 4.17.21)')
  expect(j.denies[0]).toContain('Install lodash@4.17.21 or later')
  // No fix out yet.
  const nofix = judge(spec('lodash', '4.17.15'), { kind: 'found', facts, vulns: [{ id: 'GHSA-x' }] }, CFG, NOW)
  expect(nofix.denies[0]).toContain('no fix yet')
  // The advisory database down is a note, not a block.
  const down = judge(spec('lodash', '4.17.21'), { kind: 'found', facts, vulns: 'error' }, CFG, NOW)
  expect(down.level).toBe('warn')
  expect(down.notes[0]).toContain('known security problems')
})

test('a made-up version is denied; an unreadable range checks latest with a note', async () => {
  const facts = npmFacts(packument({ '1.0.0': { age: 400 }, '1.2.0': { age: 300 } }), { downloads: 100_000 })
  expect(judge(spec('lib', '9.9.9'), { kind: 'found', facts, vulns: [] }, CFG, NOW).denies[0]).toContain('no version 9.9.9')
  const odd = judge(spec('lib', 'some-tag'), { kind: 'found', facts, vulns: [] }, CFG, NOW)
  expect(odd.level).toBe('warn')
  expect(odd.version).toBe('1.2.0')
  expect(odd.notes[0]).toContain('Couldn\'t match "some-tag"')
})

test('look-alike names are denied unless popular in their own right', async () => {
  const quiet = npmFacts(packument({ '1.0.0': { age: 400 } }), { downloads: 120 })
  const j = judge(spec('lodahs'), { kind: 'found', facts: quiet, vulns: [] }, CFG, NOW)
  expect(j.level).toBe('deny')
  expect(j.denies[0]).toContain('misspelling of the popular package lodash')
  const busy = npmFacts(packument({ '1.0.0': { age: 400 } }), { downloads: 3_000_000 })
  expect(judge(spec('lodahs'), { kind: 'found', facts: busy, vulns: [] }, CFG, NOW).level).toBe('ok')
  // A listed popular package is never its own look-alike.
  expect(judge(spec('preact'), { kind: 'found', facts: quiet, vulns: [] }, CFG, NOW).denies).toEqual([])
})

test('npm security placeholders are denied', async () => {
  const facts = npmFacts(packument({ '0.0.1-security': { age: 100 } }, 500, '0.0.1-security'), { downloads: 10 })
  const j = judge(spec('evil-pkg'), { kind: 'found', facts, vulns: [] }, CFG, NOW)
  expect(j.level).toBe('deny')
  expect(j.denies[0]).toContain('held malware')
})

test('install scripts and low downloads are warnings, not blocks', async () => {
  const facts = npmFacts(
    packument({ '2.0.0': { age: 365, scripts: { postinstall: 'node ./setup.js' } }, '2.1.0': { age: 100, gypfile: true } }),
    { downloads: 90 },
  )
  const j = judge(spec('native-thing', '2.0.0'), { kind: 'found', facts, vulns: [] }, CFG, NOW)
  expect(j.level).toBe('warn')
  expect(j.notes.join(' ')).toContain('runs code when installed (postinstall: node ./setup.js)')
  expect(j.notes.join(' ')).toContain('90 downloads')
  expect(judge(spec('native-thing'), { kind: 'found', facts, vulns: [] }, CFG, NOW).notes.join(' ')).toContain('node-gyp')
  expect(noteText([j])).toContain('package-bouncer notes:')
})

test('registry unreachable: a warning by default, a block with failClosed', async () => {
  const open = judge(spec('anything'), { kind: 'error', why: 'timed out after 5 seconds' }, CFG, NOW)
  expect(open.level).toBe('warn')
  expect(open.notes[0]).toContain("Couldn't reach npm")
  const closed = judge(spec('anything'), { kind: 'error', why: 'timed out after 5 seconds' }, { ...CFG, failClosed: true }, NOW)
  expect(closed.level).toBe('deny')
  expect(closed.denies[0]).toContain('set to block')
})

test('git, URL and path installs are reported, never looked up or blocked', async () => {
  const j = judge({ ecosystem: 'npm', name: 'github:u/r', raw: 'github:u/r', source: 'git' }, undefined, { ...CFG, failClosed: true }, NOW)
  expect(j.level).toBe('skipped')
  expect(j.notes[0]).toContain('not checked: it comes from a git repository')
})

test('the deny message names the allow command and reads plainly', async () => {
  const a = judge(spec('reakt-dom-helperz'), { kind: 'missing' }, CFG, NOW)
  const msg = denyMessage([a])
  expect(msg.startsWith('package-bouncer stopped this install:')).toBe(true)
  expect(msg).toContain('/allow-package npm:reakt-dom-helperz')
  const py = judge({ ecosystem: 'pypi', name: 'My_Pkg', raw: 'My_Pkg', source: 'registry' }, { kind: 'missing' }, CFG, NOW)
  const gem = judge({ ecosystem: 'rubygems', name: 'gemx', raw: 'gemx', source: 'registry' }, { kind: 'missing' }, CFG, NOW)
  const php = judge({ ecosystem: 'packagist', name: 'a/b', raw: 'a/b', source: 'registry' }, { kind: 'missing' }, CFG, NOW)
  expect(denyMessage([py, gem, php])).toContain('/allow-package pypi:My_Pkg gem:gemx composer:a/b')
})

test('PyPI, crates.io, Go, RubyGems and Packagist answers read into facts', async () => {
  const py = pypiFacts(
    {
      info: { version: '2.0.0' },
      releases: {
        '1.0.0': [{ upload_time_iso_8601: daysAgo(700), yanked: false }],
        '2.0.0': [{ upload_time_iso_8601: daysAgo(5), yanked: false }, { upload_time_iso_8601: daysAgo(4), yanked: false }],
        '2.0.1': [{ upload_time_iso_8601: daysAgo(1), yanked: true }],
        '0.0.0': [],
      },
    },
    { data: { last_day: 1, last_week: 300, last_month: 900 } },
  )
  expect(py.latest).toBe('2.0.0')
  expect(py.createdAt).toBe(Date.parse(daysAgo(700)))
  expect(py.versions['2.0.0']?.time).toBe(Date.parse(daysAgo(5)))
  expect(py.versions['2.0.1']?.yanked).toBe(true)
  expect(py.weeklyDownloads).toBe(300)
  const pj = judge(spec('somepkg', undefined, 'pypi'), { kind: 'found', facts: py, vulns: [] }, CFG, NOW)
  expect(pj.denies[0]).toContain('somepkg@2.0.0 came out 5 days ago')
  expect(pj.denies[0]).toContain('install somepkg@1.0.0')

  const cr = cratesFacts({
    crate: { created_at: daysAgo(3000), max_stable_version: '1.0.18', newest_version: '1.0.18', recent_downloads: 410_000_000 },
    versions: [
      { num: '1.0.18', created_at: daysAgo(200), yanked: false },
      { num: '1.0.17', created_at: daysAgo(300), yanked: true },
    ],
  })
  expect(cr.latest).toBe('1.0.18')
  expect(cr.isPopular).toBe(true)
  expect(cr.versions['1.0.17']?.yanked).toBe(true)

  const go = goFacts('github.com/google/uuid', { Version: 'v1.6.0', Time: '2024-01-23T18:54:04Z' }, { Version: 'v1.3.0', Time: '2021-07-12T22:33:52Z' })
  expect(Object.keys(go.versions)).toEqual(['v1.6.0', 'v1.3.0'])
  expect(go.latest).toBe('v1.6.0')
  const goBranch = goFacts('example.com/m', { Version: 'v1.0.0' }, { Version: 'v1.0.1-0.20261101000000-abcdef123456', Time: daysAgo(6) }, 'master')
  expect(pickVersion('master', Object.keys(goBranch.versions), goBranch.latest, 'go', goBranch.tags)).toEqual({
    kind: 'exact',
    version: 'v1.0.1-0.20261101000000-abcdef123456',
  })
  expect(goModuleCandidates('golang.org/x/tools/cmd/goimports')).toEqual([
    'golang.org/x/tools/cmd/goimports',
    'golang.org/x/tools/cmd',
    'golang.org/x/tools',
  ])
  expect(goEscape('github.com/BurntSushi/toml')).toBe('github.com/!burnt!sushi/toml')

  const rb = rubygemsFacts([
    { number: '14.0.0.beta', created_at: daysAgo(2), downloads_count: 10, prerelease: true },
    { number: '13.4.2', created_at: daysAgo(200), downloads_count: 90_000_000, prerelease: false },
    { number: '0.4.0', created_at: daysAgo(6000), downloads_count: 1_000, prerelease: false },
  ])
  expect(rb.latest).toBe('13.4.2')
  expect(rb.isPopular).toBe(true)
  expect(rb.createdAt).toBe(Date.parse(daysAgo(6000)))

  const pk = packagistFacts(
    {
      minified: 'composer/2.0',
      packages: {
        'monolog/monolog': [
          { version: '3.12.1', time: daysAgo(40) },
          { version: 'v3.12.0', time: daysAgo(90) },
          { version: 'dev-main', time: daysAgo(1) },
        ],
      },
    },
    'Monolog/Monolog',
  )
  expect(pk.latest).toBe('3.12.1')
  expect(Object.keys(pk.versions)).toEqual(['3.12.1', '3.12.0'])
  expect(newestBefore(pk, NOW - 60 * 86_400_000)).toBe('3.12.0')
})

test('scoped npm names are escaped for the registry', async () => {
  expect(npmUrl('@babel/core')).toBe('https://registry.npmjs.org/@babel%2fcore')
  expect(npmUrl('left-pad')).toBe('https://registry.npmjs.org/left-pad')
})

test('version ranges pick what the package manager would', async () => {
  const vs = ['1.0.0', '1.2.3', '1.9.0', '2.0.0-beta.1', '2.0.0', '2.1.0', '3.0.0-rc.1']
  const p = (r: string | undefined, eco: Spec['ecosystem'] = 'npm') => pickVersion(r, vs, '2.1.0', eco)
  expect(p(undefined)).toEqual({ kind: 'latest', version: '2.1.0' })
  expect(p('^1.0.0')).toEqual({ kind: 'range', version: '1.9.0' })
  expect(p('~1.2.0')).toEqual({ kind: 'range', version: '1.2.3' })
  expect(p('1.x')).toEqual({ kind: 'range', version: '1.9.0' })
  expect(p('1')).toEqual({ kind: 'range', version: '1.9.0' })
  expect(p('>=1.2.0 <2.0.0')).toEqual({ kind: 'range', version: '1.9.0' })
  expect(p('^1.0.0 || ^2.0.0')).toEqual({ kind: 'range', version: '2.1.0' })
  expect(p('2.0.0-beta.1')).toEqual({ kind: 'exact', version: '2.0.0-beta.1' })
  expect(p('>=2.0.0-rc.0')).toEqual({ kind: 'range', version: '3.0.0-rc.1' })
  expect(p('4.0.0')).toEqual({ kind: 'missing' })
  expect(p('==1.2.3', 'pypi')).toEqual({ kind: 'exact', version: '1.2.3' })
  expect(p('==7.7.7', 'pypi')).toEqual({ kind: 'missing' })
  expect(p('~=1.2', 'pypi')).toEqual({ kind: 'range', version: '1.9.0' })
  expect(p('>=1.0,<2', 'pypi')).toEqual({ kind: 'range', version: '1.9.0' })
  expect(p('~> 1.2', 'rubygems')).toEqual({ kind: 'range', version: '1.9.0' })
  expect(p('1.0', 'crates')).toEqual({ kind: 'range', version: '1.9.0' })
  expect(p('1.2.3', 'crates')).toEqual({ kind: 'range', version: '1.9.0' }) // cargo: bare means caret
  expect(p('=1.2.3', 'crates')).toEqual({ kind: 'exact', version: '1.2.3' })
  expect(p('~1.2', 'packagist')).toEqual({ kind: 'range', version: '1.9.0' })
  expect(p('~1.2', 'npm')).toEqual({ kind: 'range', version: '1.2.3' })
  expect(p('1.0.*', 'packagist')).toEqual({ kind: 'range', version: '1.0.0' })
  expect(p('^9')).toEqual({ kind: 'unresolved', version: '2.1.0' })
  expect(pickVersion('next', ['1.0.0', '2.0.0-canary.3'], '1.0.0', 'npm', { latest: '1.0.0', next: '2.0.0-canary.3' })).toEqual({
    kind: 'exact',
    version: '2.0.0-canary.3',
  })
  expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0)
  expect(compareVersions('2.0.0', '2.0.0rc1')).toBeGreaterThan(0)
  expect(compareVersions('1.0.post1', '1.0')).toBeGreaterThan(0)
  expect(compareVersions('v1.2.3', '1.2.3')).toBe(0)
})

test('look-alike detection: edit distance, length limits and namespaces', async () => {
  expect(editDistance('lodash', 'lodahs')).toBe(1) // a swap counts once
  expect(editDistance('express', 'expres')).toBe(1)
  expect(lookalikeOf('lodahs', 'npm')).toBe('lodash')
  expect(lookalikeOf('expresss', 'npm')).toBe('express')
  expect(lookalikeOf('requets', 'pypi')).toBe('requests')
  expect(lookalikeOf('python_dateutil', 'pypi')).toBeUndefined() // same name, PyPI-normalised
  expect(lookalikeOf('beautifulsoup', 'pypi')).toBe('beautifulsoup4')
  expect(lookalikeOf('serde_jsom', 'crates')).toBe('serde_json')
  expect(lookalikeOf('nokogirl', 'rubygems')).toBe('nokogiri')
  expect(lookalikeOf('github.com/sirupsem/logrus', 'go')).toBe('github.com/sirupsen/logrus')
  expect(lookalikeOf('github.com/sirupsen/logruss', 'go')).toBeUndefined() // the same owner's own repo
  expect(lookalikeOf('monolog/monologg', 'packagist')).toBeUndefined() // same vendor owns both
  expect(lookalikeOf('monologg/monolog', 'packagist')).toBe('monolog/monolog')
  expect(lookalikeOf('@types/nock', 'npm')).toBeUndefined() // inside the @types scope only its owner publishes
  expect(lookalikeOf('@typess/node', 'npm')).toBe('@types/node')
  expect(lookalikeOf('zodd', 'npm')).toBeUndefined() // names under 4 letters are too short to judge
  expect(lookalikeOf('totally-unrelated-name', 'npm')).toBeUndefined()
  expect(isListedPopular('Django', 'pypi')).toBe(true)
  for (const eco of ['npm', 'pypi', 'crates', 'rubygems'] as const) expect(popularList(eco).length).toBeGreaterThanOrEqual(150)
  for (const eco of ['go', 'packagist'] as const) expect(popularList(eco).length).toBeGreaterThanOrEqual(90)
})

test('a PyPI or RubyGems pin that pads zeros matches the published version', async () => {
  // pip treats ==4.2.0 as 4.2; Django publishes "4.2"
  expect(pickVersion('4.2.0', ['4.1', '4.2', '5.0'], '5.0', 'pypi')).toEqual({ kind: 'exact', version: '4.2' })
  expect(pickVersion('7.1.0', ['7.0', '7.1'], '7.1', 'rubygems')).toEqual({ kind: 'exact', version: '7.1' })
  // npm names one exact string: 4.2.0 is not 4.2
  expect(pickVersion('4.2.0', ['4.2', '5.0'], '5.0', 'npm').kind).toBe('missing')
  // still made up when nothing matches numerically
  expect(pickVersion('4.3.0', ['4.1', '4.2'], '4.2', 'pypi').kind).toBe('missing')
})

test('failClosed also blocks when the advisory database cannot be reached', async () => {
  const facts = npmFacts(packument({ '1.0.0': { age: 400 } }), { downloads: 2_000_000 })
  const open = judge(spec('left-pad'), { kind: 'found', facts, vulns: 'error' }, CFG, NOW)
  expect(open.level).toBe('warn')
  const closed = judge(spec('left-pad'), { kind: 'found', facts, vulns: 'error' }, { ...CFG, failClosed: true }, NOW)
  expect(closed.level).toBe('deny')
  expect(closed.denies[0]).toContain("block when it can't check")
})

test('an unreadable package word is denied, and the owner is not offered /allow-package for it', async () => {
  const s: Spec = { ecosystem: 'npm', name: '$PKG', raw: '$PKG', source: 'unparsed' as Spec['source'] }
  const j = judge(s, undefined, CFG, NOW)
  expect(j.level).toBe('deny')
  expect(j.denies).toEqual(["package-bouncer: I can't read this package name ('$PKG'). Write the package name out literally so it can be checked."])
  expect(denyMessage([j])).not.toContain('/allow-package')
})
