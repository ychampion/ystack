// Loose version comparison and range matching across npm, PyPI, crates, Go, RubyGems and Packagist.
// Good enough to pick which published version an install would take; unknown syntax answers undefined.

import type { Ecosystem } from './parse.ts'

type Parsed = { nums: number[]; pre: string; post: boolean }

function parse(v: string): Parsed | undefined {
  const s = v.trim().replace(/^[=v]+/i, '').replace(/\+.*$/, '')
  const m = /^(\d+(?:\.\d+)*)(.*)$/.exec(s)
  if (!m) return undefined
  const nums = (m[1] as string).split('.').map(Number)
  const tail = (m[2] as string).replace(/^[-.]/, '').toLowerCase()
  const post = /^(post|rev|r)\d*$/.test(tail) || /^\d+$/.test(tail)
  return { nums, pre: post ? '' : tail, post }
}

/** True for a pre-release (1.0.0-beta.1, 2.0rc1, 1.0.dev0). */
export function isPrerelease(v: string): boolean {
  const p = parse(v)
  return p !== undefined && p.pre !== ''
}

/** <0 when a is older, >0 when newer, 0 when equal; unparseable versions sort first. */
export function compareVersions(a: string, b: string): number {
  const pa = parse(a)
  const pb = parse(b)
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

type Test = (v: string) => boolean

function upperOfCaret(nums: number[]): number[] {
  const [maj = 0, min = 0, pat = 0] = nums
  if (maj > 0 || nums.length === 1) return [maj + 1]
  if (min > 0 || nums.length === 2) return [0, min + 1]
  return [0, 0, pat + 1]
}

/** `~=1.4.2` / `~>1.4.2`: the last given part may rise. */
function upperOfPessimistic(nums: number[]): number[] {
  if (nums.length <= 1) return [(nums[0] ?? 0) + 1]
  const head = nums.slice(0, -1)
  head[head.length - 1] = (head[head.length - 1] ?? 0) + 1
  return head
}

function upperOfNpmTilde(nums: number[]): number[] {
  if (nums.length <= 1) return [(nums[0] ?? 0) + 1]
  return [nums[0] ?? 0, (nums[1] ?? 0) + 1]
}

const v2s = (nums: number[]) => nums.join('.')

/** Compares only the numeric parts, so 2.0.0-beta is not below an upper bound of 2. */
function belowNums(v: string, hiNums: number[]): boolean {
  const p = parse(v)
  if (!p) return false
  const len = Math.max(p.nums.length, hiNums.length)
  for (let i = 0; i < len; i++) {
    const d = (p.nums[i] ?? 0) - (hiNums[i] ?? 0)
    if (d !== 0) return d < 0
  }
  return false
}

function between(lo: string, hiNums: number[]): Test {
  return v => compareVersions(v, lo) >= 0 && belowNums(v, hiNums)
}

function comparator(raw: string, eco: Ecosystem): Test | undefined {
  const c = raw.trim()
  if (c === '' || c === '*' || c === 'x' || c === 'X' || c === 'latest') return () => true
  const m = /^(\^|~>|~=|~|>=|<=|>|<|===|==|=|!=)?\s*v?([\d]+(?:\.(?:\d+|[xX*]))*)(.*)$/.exec(c)
  if (!m) return undefined
  const op = m[1] ?? ''
  const partsRaw = (m[2] as string).split('.')
  const wild = partsRaw.findIndex(p => /^[xX*]$/.test(p))
  const nums = (wild >= 0 ? partsRaw.slice(0, wild) : partsRaw).map(Number)
  const tail = m[3] as string
  const base = v2s(nums) + tail
  const hasWild = wild >= 0
  const isPartialBare = op === '' && !tail && (hasWild || (eco === 'npm' && nums.length < 3))

  if (hasWild || isPartialBare) {
    if (op === '!=') return v => !between(v2s(nums), [...nums.slice(0, -1), (nums[nums.length - 1] ?? 0) + 1])(v)
    if (nums.length === 0) return () => true
    const hi = [...nums.slice(0, -1), (nums[nums.length - 1] ?? 0) + 1]
    return between(v2s(nums), hi)
  }
  switch (op) {
    case '^':
      return between(base, upperOfCaret(nums))
    case '~':
      return between(base, eco === 'packagist' ? upperOfPessimistic(nums) : upperOfNpmTilde(nums))
    case '~=':
    case '~>':
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
    case '':
      // cargo reads a bare version as a caret requirement
      if (eco === 'crates') return between(base, upperOfCaret(nums))
      return v => compareVersions(v, base) === 0
    default:
      return v => compareVersions(v, base) === 0
  }
}

/** Parses a range into a test, or undefined when its syntax is not understood. */
export function rangeTest(range: string, eco: Ecosystem): Test | undefined {
  const alternatives = range.split('||')
  const tests: Test[] = []
  for (const alt of alternatives) {
    const parts = alt
      .trim()
      .replace(/(\^|~>|~=|~|>=|<=|>|<|===|==|=|!=)\s+/g, '$1')
      .split(/[\s,]+/)
      .filter(Boolean)
    const ts: Test[] = []
    for (const p of parts) {
      const t = comparator(p, eco)
      if (!t) return undefined
      ts.push(t)
    }
    tests.push(v => ts.every(t => t(v)))
  }
  return v => tests.some(t => t(v))
}

export type Pick =
  | { kind: 'exact'; version: string }
  | { kind: 'range'; version: string }
  | { kind: 'latest'; version: string }
  | { kind: 'missing' } // an exact version the registry doesn't have
  | { kind: 'unresolved'; version?: string } // a range we couldn't read, or nothing matched: latest is checked

/**
 * Which published version an install of `requested` would take.
 * `tags` maps npm dist-tags (latest, next) to versions.
 */
export function pickVersion(
  requested: string | undefined,
  versions: readonly string[],
  latest: string | undefined,
  eco: Ecosystem,
  tags: Readonly<Record<string, string>> = {},
): Pick {
  const fallback = latest ?? newestStable(versions)
  if (requested === undefined || requested === '' || requested === 'latest' || requested === '*') {
    return fallback ? { kind: 'latest', version: fallback } : { kind: 'unresolved' }
  }
  const r = requested.trim()
  const tagged = tags[r]
  if (tagged) return { kind: 'exact', version: tagged }
  const bare = r.replace(/^(===|==|=)\s*/, '')
  // cargo reads a bare `1.0.0` as `^1.0.0`; only `=1.0.0` pins it.
  const pinsExactly = eco !== 'crates' || r.startsWith('=')
  // PyPI, RubyGems and Packagist compare versions numerically (pip's ==4.2.0 is 4.2); npm, Go and cargo
  // name one exact string.
  const padsZeros = eco === 'pypi' || eco === 'rubygems' || eco === 'packagist'
  const exact = pinsExactly
    ? (versions.find(v => v === bare || v === bare.replace(/^v/, '') || `v${v}` === bare) ??
      (padsZeros && parse(bare) ? versions.find(v => parse(v) !== undefined && compareVersions(v, bare) === 0) : undefined))
    : undefined
  if (exact) return { kind: 'exact', version: exact }
  // A full version (three parts, or an == pin) that isn't published is a made-up version.
  if (/^(===|==|=)?\s*v?\d+\.\d+\.\d+([-.+][0-9A-Za-z.-]+)?$/.test(r) && eco !== 'crates') return { kind: 'missing' }
  if (/^(===|==)\s*\S+$/.test(r) && !r.includes('*')) return { kind: 'missing' }
  const test = rangeTest(r, eco)
  if (!test) return fallback ? { kind: 'unresolved', version: fallback } : { kind: 'unresolved' }
  const allowPre = /-|rc|alpha|beta|dev|a\d|b\d/i.test(r)
  const matching = versions.filter(v => test(v) && (allowPre || !isPrerelease(v)))
  if (matching.length === 0) return fallback ? { kind: 'unresolved', version: fallback } : { kind: 'unresolved' }
  const best = matching.reduce((a, b) => (compareVersions(a, b) >= 0 ? a : b))
  return { kind: 'range', version: best }
}

export function newestStable(versions: readonly string[]): string | undefined {
  const stable = versions.filter(v => !isPrerelease(v))
  const pool = stable.length > 0 ? stable : versions
  if (pool.length === 0) return undefined
  return pool.reduce((a, b) => (compareVersions(a, b) >= 0 ? a : b))
}
