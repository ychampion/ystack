#!/usr/bin/env node
// package-bouncer for Antigravity (PreToolUse on run_command). Port of ystack's Claude Code package-bouncer
// for npm-style installs (npm, npx, bun, bunx, pnpm, yarn) and Python ones (pip, python -m pip, uv, uvx, pipx).
// Before the install runs, each package is looked up on its registry:
//   deny: the package doesn't exist, npm pulled it for malware, the asked-for version doesn't exist, the
//         version has known vulnerabilities (OSV), or the name can't be read (a variable or glob);
//   ask:  the package or the version was published less than 14 days ago, or the name looks like a
//         misspelling of a popular package;
//   allow: everything else, and when a registry can't be reached (fail open, like the original).
// Packages from URLs, git, local paths or other registries are not checked. Requirement files are not read.

import { ALLOW, argsOf, commandCwd, commandsIn, isMain, log, runHook } from './lib.mjs'
import { NPM, PYPI } from './popular.mjs'

const GUARD = 'package-bouncer'
export const CONFIG = { minAgeDays: 14, minWeeklyDownloads: 500 }
const DAY = 24 * 60 * 60 * 1000
const USER_AGENT = 'ystack-package-bouncer'
const TIMEOUT_MS = 5_000

// ---- parsing (same rules as the original) ----

/** A word the shell would expand: its real text is unknown here. */
const isDynamic = w => /[$`*?[\]{}\\]/.test(w)
const unparsed = (ecosystem, raw) => ({ ecosystem, name: raw, raw, source: 'unparsed' })
const isPathLike = a => a === '.' || a === '..' || /^(\.{1,2}[\\/]|[\\/]|~|[A-Za-z]:[\\/])/.test(a)

function walk(args, valueFlags, onFlag) {
  const positionals = []
  let afterDashDash = false
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (afterDashDash) {
      positionals.push(a)
      continue
    }
    if (a === '--') {
      afterDashDash = true
      continue
    }
    if (a.startsWith('-') && a.length > 1) {
      const eq = a.indexOf('=')
      if (eq > 0) {
        onFlag?.(a.slice(0, eq), a.slice(eq + 1))
        continue
      }
      if (valueFlags.includes(a)) {
        onFlag?.(a, args[i + 1])
        i++
        continue
      }
      onFlag?.(a, undefined)
      continue
    }
    positionals.push(a)
  }
  return positionals
}

const NPM_NAME = /^(@[A-Za-z0-9~][A-Za-z0-9._~-]*\/)?[A-Za-z0-9~][A-Za-z0-9._~-]*$/

export function npmSpec(raw, arg = raw) {
  const mk = (source, name = arg, version) => ({ ecosystem: 'npm', name, ...(version !== undefined && version !== '' ? { version } : {}), raw, source })
  if (/^https?:\/\//i.test(arg)) return mk('url')
  if (/^(git\+|git:|git@|github:|gitlab:|bitbucket:|gist:)/i.test(arg)) return mk('git')
  if (/^(file:|link:|workspace:|portal:|patch:)/i.test(arg)) return mk('path')
  if (/^jsr:/i.test(arg)) return mk('other-registry')
  if (isPathLike(arg) || /\.(tgz|tar\.gz|tar)$/i.test(arg)) return mk('path')
  const alias = /^((?:@[^/@\s]+\/)?[^/@\s]+)@npm:(.+)$/.exec(arg)
  if (alias) return npmSpec(raw, alias[2])
  let name
  let version
  if (arg.startsWith('@')) {
    const m = /^(@[^/@\s]+\/[^/@\s]+)(?:@(.*))?$/.exec(arg)
    if (!m) return undefined
    name = m[1]
    version = m[2]
  } else {
    const m = /^([^@/\s]+)(?:@(.*))?$/.exec(arg)
    if (!m) return arg.includes('/') && !isDynamic(arg) ? mk('git') : undefined // GitHub shorthand: user/repo
    name = m[1]
    version = m[2]
  }
  if (!NPM_NAME.test(name) || name.length > 214) return undefined
  if (version !== undefined) {
    if (/^https?:\/\//i.test(version)) return mk('url', name)
    if (/^(file:|link:|workspace:|portal:)/i.test(version) || isPathLike(version)) return mk('path', name)
    if (/^(git\+|git:|git@|github:|gitlab:|bitbucket:|gist:)/i.test(version) || /^[^@\s]+\/[^@\s]+(#.*)?$/.test(version)) return mk('git', name)
  }
  return mk('registry', name, version)
}

/** `npm create vite` -> create-vite; `@scope` -> @scope/create; `@scope/x` -> @scope/create-x. */
export function createPackage(arg) {
  const at = arg.lastIndexOf('@')
  const [base, ver] = at > 0 ? [arg.slice(0, at), arg.slice(at)] : [arg, '']
  if (base.startsWith('@')) {
    const slash = base.indexOf('/')
    if (slash < 0) return `${base}/create${ver}`
    return `${base.slice(0, slash)}/create-${base.slice(slash + 1)}${ver}`
  }
  return `create-${base}${ver}`
}

const NPM_VALUE_FLAGS = [
  '--registry', '--tag', '--prefix', '-w', '--workspace', '--omit', '--include', '--install-strategy', '--cache',
  '--userconfig', '--save-prefix', '--before', '--loglevel', '--otp', '--scope', '-C', '--dir', '--cwd',
  '--filter', '-F', '--backend', '--cache-dir', '--concurrent-scripts', '--network-concurrency', '-c', '--config',
  '--modules-folder', '--network-timeout', '--mutex', '--linker', '--minimum-release-age',
]

function npmInstall(args) {
  let otherRegistry = false
  const positionals = walk(args, NPM_VALUE_FLAGS, f => {
    if (f === '--registry') otherRegistry = true
  })
  return positionals.flatMap(p => {
    const s = npmSpec(p)
    if (!s) return isDynamic(p) ? [unparsed('npm', p)] : []
    return [otherRegistry && s.source === 'registry' ? { ...s, source: 'other-registry' } : s]
  })
}

function npxLike(args) {
  const pkgs = []
  let otherRegistry = false
  const positionals = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--') {
      positionals.push(...args.slice(i + 1))
      break
    }
    if (a === '-p' || a === '--package') {
      if (args[i + 1] !== undefined) pkgs.push(args[i + 1])
      i++
      continue
    }
    if (a.startsWith('--package=')) {
      pkgs.push(a.slice('--package='.length))
      continue
    }
    if (a === '-c' || a === '--call' || a === '--cache' || a === '--userconfig') {
      i++
      continue
    }
    if (a === '--registry') {
      otherRegistry = true
      i++
      continue
    }
    if (a.startsWith('--registry=')) {
      otherRegistry = true
      continue
    }
    if (a.startsWith('-')) continue
    positionals.push(a)
    break
  }
  const names = pkgs.length > 0 ? pkgs : positionals.slice(0, 1)
  return names.flatMap(p => {
    const s = npmSpec(p)
    if (!s) return isDynamic(p) ? [unparsed('npm', p)] : []
    return [otherRegistry && s.source === 'registry' ? { ...s, source: 'other-registry' } : s]
  })
}

function npmCreate(args) {
  const first = walk(args, NPM_VALUE_FLAGS)[0]
  if (first === undefined) return []
  if (isDynamic(first) && !isPathLike(first)) return [unparsed('npm', first)]
  if (/[\\/]/.test(first) && !first.startsWith('@')) return []
  const s = npmSpec(first, createPackage(first))
  return s ? [{ ...s, raw: first }] : []
}

const NPM_INSTALL_SUBS = new Set(['install', 'i', 'add', 'in', 'ins', 'inst', 'insta', 'instal', 'isnt', 'isnta', 'isntal', 'isntall'])

function subAndRest(args) {
  const sub = walk(args, NPM_VALUE_FLAGS)[0]
  return sub === undefined ? [undefined, []] : [sub, args.slice(args.indexOf(sub) + 1)]
}

function parseNpm(args) {
  const [sub, rest] = subAndRest(args)
  if (NPM_INSTALL_SUBS.has(sub)) return npmInstall(rest)
  if (sub === 'exec' || sub === 'x') return npxLike(rest)
  if (sub === 'create' || sub === 'init' || sub === 'innit') return npmCreate(rest)
  return []
}

function parseBun(args) {
  const [sub, rest] = subAndRest(args)
  if (sub === 'add' || sub === 'a' || sub === 'install' || sub === 'i') return npmInstall(rest)
  if (sub === 'x') return npxLike(rest)
  if (sub === 'create' || sub === 'c') return npmCreate(rest)
  return []
}

function parsePnpm(args) {
  const [sub, rest] = subAndRest(args)
  if (sub === 'add' || sub === 'install' || sub === 'i') return npmInstall(rest)
  if (sub === 'dlx') return npxLike(rest)
  if (sub === 'create') return npmCreate(rest)
  return []
}

function parseYarn(args) {
  let rest = args
  if (walk(args, NPM_VALUE_FLAGS)[0] === 'global') rest = args.slice(args.indexOf('global') + 1)
  const [sub, after] = subAndRest(rest)
  if (sub === 'add') return npmInstall(after)
  if (sub === 'dlx') return npxLike(after)
  if (sub === 'create') return npmCreate(after)
  return []
}

export const normalizePypi = name => name.toLowerCase().replace(/[-_.]+/g, '-')

export function pypiSpec(raw, otherRegistry = false) {
  const mk = (source, name = raw, version) => ({ ecosystem: 'pypi', name, ...(version ? { version } : {}), raw, source })
  if (/^(git\+|hg\+|svn\+|bzr\+)/i.test(raw)) return mk('git')
  if (/^(https?|file):\/\//i.test(raw)) return mk('url')
  if (isPathLike(raw) || /\.(whl|tar\.gz|zip|tar\.bz2|tgz)$/i.test(raw)) return mk('path')
  const at = /^([A-Za-z0-9][A-Za-z0-9._-]*)(\[[^\]]*\])?\s*@\s*(\S+)/.exec(raw)
  if (at) return mk(/^git\+/i.test(at[3]) ? 'git' : 'url', at[1])
  const m = /^([A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?)\s*(\[[^\]]*\])?\s*([^;]*)/.exec(raw)
  if (!m) return undefined
  const spec = (m[3] ?? '').trim()
  if (spec !== '' && !/^[<>=!~]/.test(spec)) return undefined
  const exact = /^===?\s*([^,\s*]+)$/.exec(spec)
  return mk(otherRegistry ? 'other-registry' : 'registry', m[1], exact ? exact[1] : spec || undefined)
}

const PIP_VALUE_FLAGS = [
  '-c', '--constraint', '-t', '--target', '--prefix', '--root', '--platform', '--python-version', '--implementation',
  '--abi', '--no-binary', '--only-binary', '--progress-bar', '--src', '--upgrade-strategy', '-f', '--find-links',
  '--trusted-host', '--report', '--config-settings', '-C', '--global-option', '--build-option', '--python', '--log',
  '--cache-dir', '--timeout', '--retries', '--proxy', '--cert', '--client-cert', '--exists-action',
  '--keyring-provider', '--root-user-action', '--group', '--python-platform', '--resolution', '--prerelease',
  '--exclude-newer', '--link-mode', '-p', '--optional', '--package', '--script', '--rev', '--tag', '--branch',
  '--extra', '--with-requirements', '--with-editable', '--directory', '--project', '--index-strategy', '--suffix',
  '--pip-args', '--color', '--config-file', '--marker', '--bounds', '--requirements',
]
const PIP_INDEX_FLAGS = ['-i', '--index-url', '--extra-index-url', '--index', '--default-index', '--extra-index']

function pipInstall(args, acc, fromFlags = []) {
  const otherRegistry = args.some(a => PIP_INDEX_FLAGS.includes(a) || PIP_INDEX_FLAGS.some(f => a.startsWith(f + '=')))
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--') continue
    if (a.startsWith('-') && a.length > 1) {
      const [flag, inline] = a.includes('=') ? [a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1)] : [a, undefined]
      const value = inline ?? args[i + 1]
      const consumed = inline === undefined
      if (['-r', '--requirement', '--requirements', '--with-requirements', '-e', '--editable', '--with-editable'].includes(flag)) {
        if (consumed) i++
        continue
      }
      if (fromFlags.includes(flag)) {
        if (value !== undefined) {
          const s = pypiSpec(value, otherRegistry)
          if (s) acc.push(s)
          else if (isDynamic(value)) acc.push(unparsed('pypi', value))
        }
        if (consumed) i++
        continue
      }
      if ((PIP_INDEX_FLAGS.includes(flag) || PIP_VALUE_FLAGS.includes(flag)) && consumed) i++
      continue
    }
    if (args[i + 1] === '@' && args[i + 2] !== undefined) {
      i += 2 // `name @ https://...`: a direct reference, not checked
      continue
    }
    const s = pypiSpec(a, otherRegistry)
    if (s) acc.push(s)
    else if (isDynamic(a)) acc.push(unparsed('pypi', a))
  }
}

const PIP_GLOBAL_VALUE_FLAGS = [
  '--python', '--log', '--proxy', '--cert', '--client-cert', '--cache-dir', '--timeout', '--retries', '--exists-action',
  '--trusted-host', '--use-feature', '--use-deprecated', '--root-user-action', '--keyring-provider', '--log-file',
]

function parsePip(args, acc) {
  const sub = walk(args, PIP_GLOBAL_VALUE_FLAGS)[0]
  if (sub === 'install') pipInstall(args.slice(args.indexOf(sub) + 1), acc)
}

const UV_GLOBAL_VALUE_FLAGS = ['--directory', '--project', '--cache-dir', '--color', '--config-file', '--python', '-p']

function parseUv(args, acc) {
  const sub = walk(args, UV_GLOBAL_VALUE_FLAGS)[0]
  if (sub === undefined) return
  const rest = args.slice(args.indexOf(sub) + 1)
  if (sub === 'pip') {
    const sub2 = walk(rest, UV_GLOBAL_VALUE_FLAGS)[0]
    if (sub2 === 'install') pipInstall(rest.slice(rest.indexOf(sub2) + 1), acc)
    return
  }
  if (sub === 'add') return pipInstall(rest, acc)
  if (sub === 'run') return parseUvRun(rest, acc)
  if (sub === 'tool') {
    const sub2 = walk(rest, UV_GLOBAL_VALUE_FLAGS)[0]
    if (sub2 === 'install') pipInstall(rest.slice(rest.indexOf(sub2) + 1), acc, ['--with', '-w'])
    if (sub2 === 'run') parseUvx(rest.slice(rest.indexOf(sub2) + 1), acc)
  }
}

function parseUvx(args, acc) {
  let from
  const withs = []
  let otherRegistry = false
  let first
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    const [flag, inline] = a.includes('=') && a.startsWith('-') ? [a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1)] : [a, undefined]
    const value = inline ?? args[i + 1]
    if (flag === '--from' || flag === '--spec') {
      from = value
      if (inline === undefined) i++
      continue
    }
    if (flag === '--with' || flag === '-w') {
      if (value !== undefined) withs.push(value)
      if (inline === undefined) i++
      continue
    }
    if (PIP_INDEX_FLAGS.includes(flag)) {
      otherRegistry = true
      if (inline === undefined) i++
      continue
    }
    if (a.startsWith('-')) {
      if (PIP_VALUE_FLAGS.includes(flag) && inline === undefined) i++
      continue
    }
    first = a
    break
  }
  for (const p of [from ?? first, ...withs]) {
    if (p === undefined) continue
    const s = pypiSpec(p, otherRegistry)
    if (s) acc.push(s)
    else if (isDynamic(p)) acc.push(unparsed('pypi', p))
  }
}

function parseUvRun(args, acc) {
  const opts = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--' || !a.startsWith('-')) break
    const flag = a.includes('=') ? a.slice(0, a.indexOf('=')) : a
    if (flag === '--with' || PIP_INDEX_FLAGS.includes(flag)) {
      opts.push(a)
      if (!a.includes('=') && args[i + 1] !== undefined) opts.push(args[++i])
      continue
    }
    if ((PIP_VALUE_FLAGS.includes(flag) || UV_GLOBAL_VALUE_FLAGS.includes(flag)) && !a.includes('=')) i++
  }
  pipInstall(opts, acc, ['--with'])
}

function parsePipx(args, acc) {
  const sub = walk(args, [])[0]
  if (sub === undefined) return
  const rest = args.slice(args.indexOf(sub) + 1)
  if (sub === 'install') pipInstall(rest, acc)
  if (sub === 'run') parseUvx(rest, acc)
}

function parsePython(args, acc) {
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '-m') {
      const mod = args[i + 1]
      const rest = args.slice(i + 2)
      if (mod === 'pip' || mod === 'pip3') parsePip(rest, acc)
      if (mod === 'uv') parseUv(rest, acc)
      if (mod === 'pipx') parsePipx(rest, acc)
      return
    }
    if (a === '-c') return
    if (a === '-X' || a === '-W') {
      i++
      continue
    }
    if (!a.startsWith('-')) return
  }
}

/** Every registry package a command line would install, duplicates folded. */
export function parseInstalls(command, cwd = process.cwd()) {
  const acc = []
  for (const c of commandsIn(command, cwd)) {
    const base = c.prog
    const args = c.words.slice(1)
    if (base === 'npm') acc.push(...parseNpm(args))
    else if (base === 'npx' || base === 'bunx' || base === 'pnpx') acc.push(...npxLike(args))
    else if (base === 'bun') acc.push(...parseBun(args))
    else if (base === 'pnpm') acc.push(...parsePnpm(args))
    else if (base === 'yarn') acc.push(...parseYarn(args))
    else if (/^pip(\d+(\.\d+)?)?$/.test(base)) parsePip(args, acc)
    else if (/^python(\d+(\.\d+)?)?$/.test(base) || base === 'py') parsePython(args, acc)
    else if (base === 'uv') parseUv(args, acc)
    else if (base === 'uvx') parseUvx(args, acc)
    else if (base === 'pipx') parsePipx(args, acc)
  }
  const seen = new Set()
  return acc.filter(s => {
    const k = `${s.ecosystem}|${s.source}|${s.name}|${s.version ?? ''}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

// ---- versions (loose comparison, enough to pick what an install would take) ----

function parseVersion(v) {
  const s = v.trim().replace(/^[=v]+/i, '').replace(/\+.*$/, '')
  const m = /^(\d+(?:\.\d+)*)(.*)$/.exec(s)
  if (!m) return undefined
  const tail = m[2].replace(/^[-.]/, '').toLowerCase()
  const post = /^(post|rev|r)\d*$/.test(tail) || /^\d+$/.test(tail)
  return { nums: m[1].split('.').map(Number), pre: post ? '' : tail, post }
}

export const isPrerelease = v => parseVersion(v)?.pre !== '' && parseVersion(v) !== undefined

export function compareVersions(a, b) {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  if (!pa || !pb) return pa ? 1 : pb ? -1 : a.localeCompare(b)
  const len = Math.max(pa.nums.length, pb.nums.length)
  for (let i = 0; i < len; i++) {
    const d = (pa.nums[i] ?? 0) - (pb.nums[i] ?? 0)
    if (d !== 0) return d
  }
  if (pa.pre !== pb.pre) {
    if (pa.pre === '') return 1
    if (pb.pre === '') return -1
    return pa.pre.localeCompare(pb.pre, undefined, { numeric: true })
  }
  if (pa.post !== pb.post) return pa.post ? 1 : -1
  return 0
}

export function newestStable(versions) {
  const stable = versions.filter(v => !isPrerelease(v))
  const pool = stable.length > 0 ? stable : versions
  return pool.length === 0 ? undefined : pool.reduce((a, b) => (compareVersions(a, b) >= 0 ? a : b))
}

function belowNums(v, hi) {
  const p = parseVersion(v)
  if (!p) return false
  const len = Math.max(p.nums.length, hi.length)
  for (let i = 0; i < len; i++) {
    const d = (p.nums[i] ?? 0) - (hi[i] ?? 0)
    if (d !== 0) return d < 0
  }
  return false
}
const between = (lo, hi) => v => compareVersions(v, lo) >= 0 && belowNums(v, hi)
const upperOfCaret = ([maj = 0, min = 0, pat = 0], len) => (maj > 0 || len === 1 ? [maj + 1] : min > 0 || len === 2 ? [0, min + 1] : [0, 0, pat + 1])
const upperOfPessimistic = nums => {
  if (nums.length <= 1) return [(nums[0] ?? 0) + 1]
  const head = nums.slice(0, -1)
  head[head.length - 1] += 1
  return head
}
const upperOfTilde = nums => (nums.length <= 1 ? [(nums[0] ?? 0) + 1] : [nums[0], nums[1] + 1])

function comparator(raw, eco) {
  const c = raw.trim()
  if (c === '' || c === '*' || c === 'x' || c === 'X' || c === 'latest') return () => true
  const m = /^(\^|~=|~|>=|<=|>|<|===|==|=|!=)?\s*v?(\d+(?:\.(?:\d+|[xX*]))*)(.*)$/.exec(c)
  if (!m) return undefined
  const op = m[1] ?? ''
  const partsRaw = m[2].split('.')
  const wild = partsRaw.findIndex(p => /^[xX*]$/.test(p))
  const nums = (wild >= 0 ? partsRaw.slice(0, wild) : partsRaw).map(Number)
  const tail = m[3]
  const base = nums.join('.') + tail
  if (wild >= 0 || (op === '' && !tail && eco === 'npm' && nums.length < 3)) {
    if (nums.length === 0) return () => true
    const hi = [...nums.slice(0, -1), nums[nums.length - 1] + 1]
    const t = between(nums.join('.'), hi)
    return op === '!=' ? v => !t(v) : t
  }
  switch (op) {
    case '^':
      return between(base, upperOfCaret(nums, nums.length))
    case '~':
      return between(base, upperOfTilde(nums))
    case '~=':
      return between(base, upperOfPessimistic(nums))
    case '>=':
      return v => compareVersions(v, base) >= 0
    case '>':
      return v => compareVersions(v, base) > 0
    case '<=':
      return v => compareVersions(v, base) <= 0
    case '<':
      return v => compareVersions(v, base) < 0
    case '!=':
      return v => compareVersions(v, base) !== 0
    default:
      return v => compareVersions(v, base) === 0
  }
}

function rangeTest(range, eco) {
  const tests = []
  for (const alt of range.split('||')) {
    const parts = alt.trim().replace(/(\^|~=|~|>=|<=|>|<|===|==|=|!=)\s+/g, '$1').split(/[\s,]+/).filter(Boolean)
    const ts = []
    for (const p of parts) {
      const t = comparator(p, eco)
      if (!t) return undefined
      ts.push(t)
    }
    tests.push(v => ts.every(t => t(v)))
  }
  return v => tests.some(t => t(v))
}

/** Which published version an install of `requested` would take. */
export function pickVersion(requested, versions, latest, eco, tags = {}) {
  const fallback = latest ?? newestStable(versions)
  if (requested === undefined || requested === '' || requested === 'latest' || requested === '*') {
    return fallback ? { kind: 'latest', version: fallback } : { kind: 'unresolved' }
  }
  const r = requested.trim()
  if (tags[r]) return { kind: 'exact', version: tags[r] }
  const bare = r.replace(/^(===|==|=)\s*/, '')
  const exact =
    versions.find(v => v === bare || v === bare.replace(/^v/, '') || `v${v}` === bare) ??
    (eco === 'pypi' && parseVersion(bare) ? versions.find(v => parseVersion(v) !== undefined && compareVersions(v, bare) === 0) : undefined)
  if (exact) return { kind: 'exact', version: exact }
  if (/^(===|==|=)?\s*v?\d+\.\d+\.\d+([-.+][0-9A-Za-z.-]+)?$/.test(r)) return { kind: 'missing' }
  if (/^(===|==)\s*\S+$/.test(r) && !r.includes('*')) return { kind: 'missing' }
  const test = rangeTest(r, eco)
  const unresolved = fallback ? { kind: 'unresolved', version: fallback } : { kind: 'unresolved' }
  if (!test) return unresolved
  const allowPre = /-|rc|alpha|beta|dev|a\d|b\d/i.test(r)
  const matching = versions.filter(v => test(v) && (allowPre || !isPrerelease(v)))
  if (matching.length === 0) return unresolved
  return { kind: 'range', version: matching.reduce((a, b) => (compareVersions(a, b) >= 0 ? a : b)) }
}

// ---- look-alike names ----

const list = text => text.split(/\s+/).filter(Boolean)
const LISTS = { npm: list(NPM), pypi: list(PYPI) }
const canonical = (name, eco) => (eco === 'pypi' ? normalizePypi(name) : name.toLowerCase())
const CANON = { npm: new Set(LISTS.npm.map(n => canonical(n, 'npm'))), pypi: new Set(LISTS.pypi.map(n => canonical(n, 'pypi'))) }
const ownerOf = (c, eco) => (eco === 'npm' && c.startsWith('@') ? c.split('/')[0] : undefined)

/** Optimal string alignment distance, stopping early past `max`. */
export function editDistance(a, b, max = 3) {
  if (Math.abs(a.length - b.length) > max) return max + 1
  const d = Array.from({ length: a.length + 1 }, (_, i) => {
    const row = new Array(b.length + 1).fill(0)
    row[0] = i
    return row
  })
  for (let j = 0; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    let rowMin = Infinity
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let v = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2][j - 2] + 1)
      d[i][j] = v
      if (v < rowMin) rowMin = v
    }
    if (rowMin > max) return max + 1
  }
  return d[a.length][b.length]
}

/** The popular package `name` looks like: one edit away for 4-7 characters, two for longer names. */
export function lookalikeOf(name, eco) {
  const c = canonical(name, eco)
  if (CANON[eco].has(c)) return undefined
  const owner = ownerOf(c, eco)
  let best
  for (const p of LISTS[eco]) {
    const pc = canonical(p, eco)
    if (pc.length < 4) continue
    if (owner !== undefined && owner === ownerOf(pc, eco)) continue
    const max = pc.length >= 8 ? 2 : 1
    const dist = editDistance(c, pc, max)
    if (dist >= 1 && dist <= max && (!best || dist < best.d)) best = { name: p, d: dist }
  }
  return best?.name
}

// ---- registries ----

const obj = v => (v !== null && typeof v === 'object' && !Array.isArray(v) ? v : undefined)
const str = v => (typeof v === 'string' ? v : undefined)
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const ms = v => {
  const t = Date.parse(str(v) ?? '')
  return Number.isFinite(t) ? t : undefined
}

export const npmUrl = name => `https://registry.npmjs.org/${name.startsWith('@') ? name.replace('/', '%2f') : encodeURIComponent(name)}`
export const npmDownloadsUrl = name => `https://api.npmjs.org/downloads/point/last-week/${name}`
export const pypiUrl = name => `https://pypi.org/pypi/${encodeURIComponent(normalizePypi(name))}/json`
export const pypiStatsUrl = name => `https://pypistats.org/api/packages/${encodeURIComponent(normalizePypi(name))}/recent`
export const OSV_URL = 'https://api.osv.dev/v1/query'
const REGISTRY_LABEL = { npm: 'npm', pypi: 'PyPI' }

export function npmFacts(packument, downloads) {
  const doc = obj(packument) ?? {}
  const time = obj(doc.time) ?? {}
  const tags = Object.fromEntries(Object.entries(obj(doc['dist-tags']) ?? {}).filter(([, v]) => typeof v === 'string'))
  const versions = {}
  for (const v of Object.keys(obj(doc.versions) ?? {})) {
    const t = ms(time[v])
    versions[v] = t !== undefined ? { time: t } : {}
  }
  const latest = tags.latest ?? newestStable(Object.keys(versions))
  const weekly = num(obj(downloads)?.downloads)
  const created = ms(time.created)
  return {
    ...(created !== undefined ? { createdAt: created } : {}),
    ...(latest ? { latest } : {}),
    versions,
    tags,
    ...(weekly !== undefined ? { weeklyDownloads: weekly, isPopular: weekly >= 25_000 } : {}),
    ...(latest !== undefined && /-security$/.test(latest) ? { isSecurityHolding: true } : {}),
  }
}

export function pypiFacts(json, stats) {
  const doc = obj(json) ?? {}
  const versions = {}
  let created
  for (const [v, files] of Object.entries(obj(doc.releases) ?? {})) {
    if (!Array.isArray(files) || files.length === 0) continue
    let first
    let allYanked = true
    for (const f of files) {
      const fo = obj(f) ?? {}
      const t = ms(fo.upload_time_iso_8601) ?? ms(fo.upload_time)
      if (t !== undefined && (first === undefined || t < first)) first = t
      if (fo.yanked !== true) allYanked = false
    }
    versions[v] = { ...(first !== undefined ? { time: first } : {}), ...(allYanked ? { yanked: true } : {}) }
    if (first !== undefined && (created === undefined || first < created)) created = first
  }
  const latest = str(obj(doc.info)?.version) ?? newestStable(Object.keys(versions))
  const weekly = num(obj(obj(stats)?.data)?.last_week)
  return {
    ...(created !== undefined ? { createdAt: created } : {}),
    ...(latest ? { latest } : {}),
    versions,
    ...(weekly !== undefined ? { weeklyDownloads: weekly, isPopular: weekly >= 25_000 } : {}),
  }
}

/** OSV's advisories for one version, aliases folded, each with the first fixed version above it. */
export function osvVulns(json, eco, name, version) {
  const vulns = obj(json)?.vulns
  if (!Array.isArray(vulns)) return []
  const same = n => typeof n === 'string' && (eco === 'pypi' ? normalizePypi(n) === normalizePypi(name) : n.toLowerCase() === name.toLowerCase())
  const seen = new Set()
  const out = []
  for (const v of vulns.map(obj)) {
    const id = str(v?.id)
    if (!v || !id || v.withdrawn !== undefined) continue
    const aliases = Array.isArray(v.aliases) ? v.aliases.filter(a => typeof a === 'string') : []
    if (seen.has(id) || aliases.some(a => seen.has(a))) continue
    seen.add(id)
    aliases.forEach(a => seen.add(a))
    const fixes = []
    for (const a of Array.isArray(v.affected) ? v.affected.map(obj) : []) {
      if (!a || !same(obj(a.package)?.name)) continue
      for (const r of Array.isArray(a.ranges) ? a.ranges : []) {
        for (const ev of Array.isArray(obj(r)?.events) ? obj(r).events : []) {
          const f = str(obj(ev)?.fixed)
          if (f) fixes.push(f)
        }
      }
    }
    const fixed = fixes.filter(f => compareVersions(f, version) > 0).sort(compareVersions)[0]
    out.push({ id, ...(fixed ? { fixed } : {}) })
  }
  return out
}

function newestBefore(facts, cutoff) {
  return newestStable(Object.entries(facts.versions).filter(([v, f]) => f.time !== undefined && f.time <= cutoff && !f.yanked && !isPrerelease(v)).map(([v]) => v))
}

/** GET or POST JSON: `{kind:'ok', json}`, `{kind:'missing'}` (404/410) or `{kind:'error', why}`. Never throws. */
export async function fetchJson(fetchFn, url, body) {
  try {
    const r = await fetchFn(url, {
      method: body ? 'POST' : 'GET',
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body } : {}),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (r.status === 404 || r.status === 410) return { kind: 'missing' }
    if (!r.ok) return { kind: 'error', why: `the registry answered ${r.status}` }
    return { kind: 'ok', json: await r.json() }
  } catch (err) {
    return { kind: 'error', why: err?.name === 'TimeoutError' || err?.name === 'AbortError' ? 'timed out' : String(err?.message ?? err).slice(0, 120) }
  }
}

/** Looks a package up: `{kind:'found', facts, vulns}`, `{kind:'missing'}` or `{kind:'error', why}`. */
export async function lookup(spec, fetchFn = globalThis.fetch) {
  const [doc, extra] =
    spec.ecosystem === 'npm'
      ? await Promise.all([fetchJson(fetchFn, npmUrl(spec.name)), fetchJson(fetchFn, npmDownloadsUrl(spec.name))])
      : await Promise.all([fetchJson(fetchFn, pypiUrl(spec.name)), fetchJson(fetchFn, pypiStatsUrl(spec.name))])
  if (doc.kind !== 'ok') return doc
  const stats = extra.kind === 'ok' ? extra.json : undefined
  const facts = spec.ecosystem === 'npm' ? npmFacts(doc.json, stats) : pypiFacts(doc.json, stats)
  const pick = pickVersion(spec.version, Object.keys(facts.versions), facts.latest, spec.ecosystem, facts.tags)
  let vulns
  if (pick.version && !facts.isSecurityHolding) {
    const name = spec.ecosystem === 'pypi' ? normalizePypi(spec.name) : spec.name
    const osv = await fetchJson(fetchFn, OSV_URL, JSON.stringify({ package: { name, ecosystem: spec.ecosystem === 'npm' ? 'npm' : 'PyPI' }, version: pick.version }))
    vulns = osv.kind === 'ok' ? osvVulns(osv.json, spec.ecosystem, spec.name, pick.version) : 'error'
  }
  return { kind: 'found', facts, ...(vulns !== undefined ? { vulns } : {}) }
}

// ---- the rules ----

function ago(then, now) {
  const days = Math.floor((now - then) / DAY)
  if (days <= 0) {
    const hours = Math.max(1, Math.floor((now - then) / 3_600_000))
    return hours === 1 ? 'an hour ago' : `${hours} hours ago`
  }
  return days === 1 ? 'yesterday' : `${days} days ago`
}

const label = (spec, version) => (version ? `${spec.name}@${version}` : spec.name)

/** One package's verdict: `denies` stop the install, `asks` put it to the user, `notes` go to stderr. */
export function judge(spec, found, now = Date.now(), cfg = CONFIG) {
  const where = REGISTRY_LABEL[spec.ecosystem]
  const out = { spec, denies: [], asks: [], notes: [] }
  if (spec.source === 'unparsed') {
    out.denies.push(`I can't read this package name ('${spec.raw}'): the shell would fill it in. Write the package name out literally so it can be checked.`)
    return out
  }
  if (spec.source !== 'registry') {
    out.notes.push(`${spec.raw} was not checked (not from the public ${where} registry).`)
    return out
  }
  if (!found || found.kind === 'error') {
    out.notes.push(`couldn't reach ${where} to check ${spec.name} (${found?.why ?? 'no answer'}), so it was let through unchecked`)
    return out
  }
  if (found.kind === 'missing') {
    out.denies.push(
      `${spec.name} doesn't exist on ${where}. The name may be made up (attackers register names that AI tools invent). Check the spelling or find the real package; if it's private, the user can install it themselves.`,
    )
    return out
  }
  const { facts } = found
  if (facts.isSecurityHolding) {
    out.denies.push(`npm took ${spec.name} down for security reasons (it held malware). Don't install it.`)
    return out
  }
  const pick = pickVersion(spec.version, Object.keys(facts.versions), facts.latest, spec.ecosystem, facts.tags)
  if (pick.kind === 'missing') {
    out.denies.push(`${spec.name} has no version ${spec.version} on ${where}. The version may be made up.`)
    return out
  }
  const version = pick.version
  const vf = version ? facts.versions[version] : undefined
  if (Array.isArray(found.vulns) && found.vulns.length > 0 && version) {
    const shown = found.vulns.slice(0, 3)
    const fixes = found.vulns.map(v => v.fixed).filter(Boolean).sort(compareVersions)
    const fix = fixes[fixes.length - 1]
    const ids = shown.map(v => (v.fixed ? `${v.id} (fixed in ${v.fixed})` : `${v.id} (no fix yet)`)).join(', ')
    const more = found.vulns.length > shown.length ? ` and ${found.vulns.length - shown.length} more` : ''
    out.denies.push(
      `${label(spec, version)} has known security problems: ${ids}${more}.` + (fix ? ` Install ${spec.name}@${fix} or later instead.` : ' No fixed version is out yet; pick another package.'),
    )
  } else if (found.vulns === 'error') {
    out.notes.push(`couldn't check ${label(spec, version)} for known security problems (the advisory database didn't answer)`)
  }
  const minAge = cfg.minAgeDays * DAY
  if (cfg.minAgeDays > 0) {
    if (facts.createdAt !== undefined && now - facts.createdAt < minAge) {
      out.asks.push(`${spec.name} was first published ${ago(facts.createdAt, now)} (under ${cfg.minAgeDays} days). Brand-new packages are a common way to slip in malware.`)
    } else if (vf?.time !== undefined && now - vf.time < minAge) {
      const older = newestBefore(facts, now - minAge)
      out.asks.push(
        `${label(spec, version)} came out ${ago(vf.time, now)} (under ${cfg.minAgeDays} days, so a bad release may not have been caught yet).` +
          (older ? ` The newest version older than that is ${older}: ${spec.name}@${older}.` : ''),
      )
    }
  }
  if (facts.isPopular !== true) {
    const twin = lookalikeOf(spec.name, spec.ecosystem)
    if (twin) out.asks.push(`${spec.name} looks like a misspelling of the popular package ${twin}, and it isn't widely used itself. Did you mean ${twin}?`)
  }
  if (facts.weeklyDownloads !== undefined && facts.weeklyDownloads < cfg.minWeeklyDownloads) {
    out.notes.push(`${spec.name} is little used (${facts.weeklyDownloads} downloads last week)`)
  }
  if (vf?.yanked) out.notes.push(`${label(spec, version)} was withdrawn (yanked) by its author`)
  return out
}

/** The hook: PreToolUse input -> decision. `fetchFn` and `now` are for tests. */
export async function decide(input, { fetchFn = globalThis.fetch, now = Date.now() } = {}) {
  const tc = input?.toolCall
  if (!tc || tc.name !== 'run_command') return ALLOW
  const args = argsOf(tc)
  const command = typeof args.CommandLine === 'string' ? args.CommandLine : ''
  if (!/\b(npm|npx|bunx?|pnpm|pnpx|yarn|pip\d*(\.\d+)?|pipx|python\d*(\.\d+)?|py|uvx?)\b/i.test(command)) return ALLOW
  const specs = parseInstalls(command, commandCwd(input, args)).slice(0, 20)
  if (specs.length === 0) return ALLOW
  const verdicts = await Promise.all(specs.map(async s => judge(s, s.source === 'registry' ? await lookup(s, fetchFn) : undefined, now)))
  for (const v of verdicts) for (const n of v.notes) log(GUARD, n)
  const denies = verdicts.flatMap(v => v.denies)
  const asks = verdicts.flatMap(v => v.asks)
  if (denies.length > 0) {
    return {
      decision: 'deny',
      reason: ['package-bouncer stopped this install:', ...[...denies, ...asks].map(d => `- ${d}`), 'Tell the user this in plain words. If they still want it, they can run the install themselves.'].join('\n'),
    }
  }
  if (asks.length > 0) {
    return { decision: 'ask', reason: ['package-bouncer: check this install before it runs:', ...asks.map(a => `- ${a}`)].join('\n') }
  }
  return ALLOW
}

if (isMain(import.meta.url)) await runHook(GUARD, input => decide(input), { pass: ALLOW })
