import { expect, mock, test, type TestBody } from 'claude-code/testing'
import type { On } from 'claude-code'

// Wiring tests. Nothing here touches the network: a stand-in beneath the plugin answers $.http.fetch from
// a small table, and another stands in for the shell and records what reached it.

const NOW = Date.parse('2026-11-07T12:00:00Z')
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString()

const OLD_PACKAGE = JSON.stringify({
  'dist-tags': { latest: '1.0.0' },
  time: { created: daysAgo(900), '1.0.0': daysAgo(400) },
  versions: { '1.0.0': { scripts: { postinstall: 'node build.js' } } },
})

type Table = Record<string, { status: number; body?: string } | 'throw'>

function registry(on: On, table: Table): string[] {
  const asked: string[] = []
  on('http.fetch', async ($, e) => {
    asked.push(`${e.init?.method ?? 'GET'} ${e.url}`)
    const hit = table[e.url] ?? { status: 404, body: '{}' }
    if (hit === 'throw') return { deny: 'getaddrinfo ENOTFOUND' }
    return { value: { status: hit.status, ok: hit.status >= 200 && hit.status < 300, headers: {}, text: hit.body ?? '{}' } }
  })
  return asked
}

function shell(on: On): string[] {
  const seen: string[] = []
  on('tool.call', async ($, e) => {
    if (e.tool === 'Bash' || e.tool === 'PowerShell') seen.push(e.command)
    return { result: 'installed' }
  })
  return seen
}

const refusal = (r: { deny?: string; text?: string; isError?: true }) => r.deny ?? (r.isError ? r.text : undefined)

test('a made-up npm name is stopped before the shell runs it, and /allow-package lets it through', async ($, on) => {
  mock.clock(on, { now: NOW })
  registry(on, {})
  const seen = shell(on)
  const first = await $.tool.call({ tool: 'Bash', command: 'npm install reakt-helperz' })
  expect(refusal(first)).toContain("reakt-helperz doesn't exist on npm")
  expect(refusal(first)).toContain('/allow-package npm:reakt-helperz')
  expect(seen).toEqual([])

  const allowed = await $.command.run({ command: 'allow-package', args: 'reakt-helperz' } as Parameters<typeof $.command.run>[0])
  expect(allowed.text).toContain('Allowed for this session: npm:reakt-helperz')
  await $.tool.call({ tool: 'Bash', command: 'npm install reakt-helperz' })
  expect(seen).toEqual(['npm install reakt-helperz'])
})

test('an install that passes runs, and its warnings reach Claude as a note', async ($, on) => {
  mock.clock(on, { now: NOW })
  const asked = registry(on, {
    'https://registry.npmjs.org/build-helper': { status: 200, body: OLD_PACKAGE },
    'https://api.npmjs.org/downloads/point/last-week/build-helper': { status: 200, body: '{"downloads":40000}' },
    'https://api.osv.dev/v1/query': { status: 200, body: '{}' },
  })
  const seen = shell(on)
  const r = await $.tool.call({ tool: 'PowerShell', command: 'npm i build-helper; bun install' })
  expect(seen).toEqual(['npm i build-helper; bun install'])
  expect(r.context?.join('\n')).toContain('build-helper@1.0.0 runs code when installed (postinstall: node build.js)')
  expect(asked).toContain('POST https://api.osv.dev/v1/query')
})

test('commands with no installs pass straight through without any lookups', async ($, on) => {
  mock.clock(on, { now: NOW })
  const asked = registry(on, {})
  const seen = shell(on)
  await $.tool.call({ tool: 'Bash', command: 'npm ci && npm run build && git status' })
  expect(seen).toEqual(['npm ci && npm run build && git status'])
  expect(asked).toEqual([])
})

test('registry down: the install goes ahead with a warning', async ($, on) => {
  mock.clock(on, { now: NOW })
  registry(on, { 'https://pypi.org/pypi/requests/json': 'throw', 'https://pypistats.org/api/packages/requests/recent': 'throw' })
  const seen = shell(on)
  const r = await $.tool.call({ tool: 'Bash', command: 'pip install requests' })
  expect(seen).toEqual(['pip install requests'])
  expect(r.context?.join('\n')).toContain("Couldn't reach PyPI to check requests")
})

test('registry down with failClosed on: the install is stopped', { options: { failClosed: true } }, async ($, on) => {
  mock.clock(on, { now: NOW })
  registry(on, { 'https://pypi.org/pypi/requests/json': 'throw', 'https://pypistats.org/api/packages/requests/recent': 'throw' })
  const seen = shell(on)
  const r = await $.tool.call({ tool: 'Bash', command: 'pip install requests' })
  expect(refusal(r)).toContain('set to block')
  expect(seen).toEqual([])
})

test('minAgeDays from settings decides what counts as too new', { options: { minAgeDays: 500 } }, async ($, on) => {
  mock.clock(on, { now: NOW })
  registry(on, {
    'https://registry.npmjs.org/build-helper': { status: 200, body: OLD_PACKAGE },
    'https://api.npmjs.org/downloads/point/last-week/build-helper': { status: 200, body: '{"downloads":40000}' },
    'https://api.osv.dev/v1/query': { status: 200, body: '{}' },
  })
  const seen = shell(on)
  const r = await $.tool.call({ tool: 'Bash', command: 'bun add build-helper' })
  expect(refusal(r)).toContain('came out 400 days ago (the rule is at least 500 days')
  expect(seen).toEqual([])
})

type RunArg = Parameters<Parameters<TestBody>[0]['command']['run']>[0]
const allow = (args: string) => ({ command: 'allow-package', args }) as RunArg

test('allowing a name the bouncer stopped on PyPI does not let a different npm package through', async ($, on) => {
  mock.clock(on, { now: NOW })
  registry(on, {})
  const seen = shell(on)
  expect(refusal(await $.tool.call({ tool: 'Bash', command: 'pip install my_pkg' }))).toContain('/allow-package pypi:my_pkg')
  const r = await $.command.run(allow('my_pkg'))
  expect(r.text).toContain('pypi:my_pkg')
  // The npm package my-pkg is a different package: still checked, still stopped.
  expect(refusal(await $.tool.call({ tool: 'Bash', command: 'npm install my-pkg' }))).toContain("my-pkg doesn't exist on npm")
  // The same PyPI package under another spelling is allowed.
  await $.tool.call({ tool: 'Bash', command: 'pip install My.Pkg' })
  expect(seen).toEqual(['pip install My.Pkg'])
})

test('/allow-package eco:NAME allows the name only in that ecosystem', async ($, on) => {
  mock.clock(on, { now: NOW })
  registry(on, {})
  const seen = shell(on)
  const r = await $.command.run(allow('pypi:other_pkg'))
  expect(r.text).toContain('pypi:other_pkg')
  expect(refusal(await $.tool.call({ tool: 'Bash', command: 'npm install other-pkg' }))).toContain("other-pkg doesn't exist on npm")
  expect(refusal(await $.tool.call({ tool: 'Bash', command: 'npm install other_pkg' }))).toContain("other_pkg doesn't exist on npm")
  await $.tool.call({ tool: 'Bash', command: 'pip install other-pkg' })
  await $.tool.call({ tool: 'Bash', command: 'gem install other_pkg' }).then(x => expect(refusal(x)).toContain("doesn't exist on"))
  expect(seen).toEqual(['pip install other-pkg'])
  const g = await $.command.run(allow('gem:rails-thing composer:acme/tool crates:my_crate go:example.com/m npm:@s/x'))
  expect(g.text).toContain('gem:rails-thing')
  await $.tool.call({ tool: 'Bash', command: 'gem install rails-thing' })
  await $.tool.call({ tool: 'Bash', command: 'composer require acme/tool' })
  await $.tool.call({ tool: 'Bash', command: 'cargo add my-crate' })
  await $.tool.call({ tool: 'Bash', command: 'npm i @s/x' })
  expect(seen).toEqual(['pip install other-pkg', 'gem install rails-thing', 'composer require acme/tool', 'cargo add my-crate', 'npm i @s/x'])
})

test('an unknown ecosystem prefix allows nothing', async ($, on) => {
  mock.clock(on, { now: NOW })
  registry(on, {})
  const seen = shell(on)
  const r = await $.command.run(allow('maven:thing'))
  expect(r.text).toContain("isn't an ecosystem")
  expect(refusal(await $.tool.call({ tool: 'Bash', command: 'npm install thing' }))).toContain("thing doesn't exist on npm")
  expect(seen).toEqual([])
})

test('a bare name with no earlier block is allowed under its exact spelling only, in every ecosystem', async ($, on) => {
  mock.clock(on, { now: NOW })
  registry(on, {})
  const seen = shell(on)
  const r = await $.command.run(allow('exact_pkg'))
  expect(r.text).toContain('exact spelling')
  await $.tool.call({ tool: 'Bash', command: 'npm install exact_pkg' })
  await $.tool.call({ tool: 'Bash', command: 'pip install exact_pkg' })
  expect(refusal(await $.tool.call({ tool: 'Bash', command: 'pip install exact-pkg' }))).toContain("exact-pkg doesn't exist on PyPI")
  expect(refusal(await $.tool.call({ tool: 'Bash', command: 'npm install Exact_pkg' }))).toContain("Exact_pkg doesn't exist on npm")
  expect(seen).toEqual(['npm install exact_pkg', 'pip install exact_pkg'])
})

test('a bare name follows the most recent block of that name', async ($, on) => {
  mock.clock(on, { now: NOW })
  registry(on, {})
  const seen = shell(on)
  await $.tool.call({ tool: 'Bash', command: 'npm install twice-blocked' })
  await $.tool.call({ tool: 'Bash', command: 'pip install twice_blocked' })
  const r = await $.command.run(allow('twice-blocked'))
  expect(r.text).toContain('pypi:twice-blocked')
  expect(r.text).not.toContain('npm:')
  expect(refusal(await $.tool.call({ tool: 'Bash', command: 'npm install twice-blocked' }))).toContain("doesn't exist on npm")
  await $.tool.call({ tool: 'Bash', command: 'pip install twice-blocked' })
  // One install that was stopped in two ecosystems at once: both are allowed.
  await $.tool.call({ tool: 'Bash', command: 'npm install both-x && pip install both-x' })
  await $.command.run(allow('both-x'))
  await $.tool.call({ tool: 'Bash', command: 'npm install both-x && pip install both-x' })
  expect(seen).toEqual(['pip install twice-blocked', 'npm install both-x && pip install both-x'])
})

test('git and local installs are let through and named as not checked', async ($, on) => {
  mock.clock(on, { now: NOW })
  const asked = registry(on, {})
  const seen = shell(on)
  const r = await $.tool.call({ tool: 'Bash', command: 'npm i github:user/repo ./local' })
  expect(seen).toEqual(['npm i github:user/repo ./local'])
  expect(asked).toEqual([])
  expect(r.context?.join('\n')).toContain('github:user/repo was not checked')
})
