// What each registry says about a package, read out of its JSON into one shape. Pure: the caller fetches.

import { normalizePypi, type Ecosystem } from './parse.ts'
import { compareVersions, isPrerelease, newestStable } from './versions.ts'

export type VersionFacts = {
  /** When this version was published, ms since the epoch. */
  time?: number
  yanked?: boolean
  /** npm install-time scripts, as `name: command`. */
  scripts?: string[]
}

export type Facts = {
  /** When the package was first published. */
  createdAt?: number
  latest?: string
  versions: Record<string, VersionFacts>
  /** npm dist-tags (latest, next, beta). */
  tags?: Record<string, string>
  weeklyDownloads?: number
  /** A download count high enough that a look-alike name is an established package, not a squat. */
  isPopular?: boolean
  /** npm replaced the package with a security placeholder (it was malicious). */
  isSecurityHolding?: boolean
  /** The module path a Go package lives in. */
  module?: string
}

export type Vuln = { id: string; summary?: string; fixed?: string }

const obj = (v: unknown): Record<string, unknown> | undefined =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const ms = (v: unknown): number | undefined => {
  const s = str(v)
  if (!s) return undefined
  const t = Date.parse(s)
  return Number.isFinite(t) ? t : undefined
}

// ---- URLs ----

export function npmUrl(name: string): string {
  return `https://registry.npmjs.org/${name.startsWith('@') ? name.replace('/', '%2f') : encodeURIComponent(name)}`
}
export function npmDownloadsUrl(name: string): string {
  return `https://api.npmjs.org/downloads/point/last-week/${name}`
}
export function pypiUrl(name: string): string {
  return `https://pypi.org/pypi/${encodeURIComponent(normalizePypi(name))}/json`
}
export function pypiStatsUrl(name: string): string {
  return `https://pypistats.org/api/packages/${encodeURIComponent(normalizePypi(name))}/recent`
}
export function cratesUrl(name: string): string {
  return `https://crates.io/api/v1/crates/${encodeURIComponent(name)}`
}
/** Go module paths are case-encoded for the proxy: an upper-case letter becomes `!` and its lower case. */
export function goEscape(path: string): string {
  return path.replace(/[A-Z]/g, c => '!' + c.toLowerCase())
}
export function goLatestUrl(module: string): string {
  return `https://proxy.golang.org/${goEscape(module)}/@latest`
}
export function goInfoUrl(module: string, version: string): string {
  return `https://proxy.golang.org/${goEscape(module)}/@v/${goEscape(version)}.info`
}
/** A Go package path, then each parent down to host/owner: the module is the longest one the proxy knows. */
export function goModuleCandidates(path: string): string[] {
  const parts = path.split('/')
  const out: string[] = []
  for (let n = parts.length; n >= Math.min(3, parts.length) && out.length < 4; n--) out.push(parts.slice(0, n).join('/'))
  return out
}
export function rubygemsUrl(name: string): string {
  return `https://rubygems.org/api/v1/versions/${encodeURIComponent(name)}.json`
}
export function packagistUrl(name: string): string {
  return `https://repo.packagist.org/p2/${name.toLowerCase()}.json`
}
export const OSV_URL = 'https://api.osv.dev/v1/query'

const OSV_ECOSYSTEM: Record<Ecosystem, string> = {
  npm: 'npm',
  pypi: 'PyPI',
  crates: 'crates.io',
  go: 'Go',
  rubygems: 'RubyGems',
  packagist: 'Packagist',
}

export function osvBody(eco: Ecosystem, name: string, version: string): string {
  return JSON.stringify({ package: { name, ecosystem: OSV_ECOSYSTEM[eco] }, version })
}

export const REGISTRY_LABEL: Record<Ecosystem, string> = {
  npm: 'npm',
  pypi: 'PyPI',
  crates: 'crates.io',
  go: 'the Go module proxy',
  rubygems: 'RubyGems',
  packagist: 'Packagist',
}

// ---- facts ----

const NPM_INSTALL_SCRIPTS = ['preinstall', 'install', 'postinstall']

export function npmFacts(packument: unknown, downloads?: unknown): Facts {
  const doc = obj(packument) ?? {}
  const time = obj(doc.time) ?? {}
  const tags = Object.fromEntries(
    Object.entries(obj(doc['dist-tags']) ?? {}).flatMap(([k, v]) => (typeof v === 'string' ? [[k, v]] : [])),
  ) as Record<string, string>
  const versions: Record<string, VersionFacts> = {}
  for (const [v, manifest] of Object.entries(obj(doc.versions) ?? {})) {
    const m = obj(manifest) ?? {}
    const scripts = obj(m.scripts) ?? {}
    const found = NPM_INSTALL_SCRIPTS.flatMap(k => (typeof scripts[k] === 'string' ? [`${k}: ${scripts[k] as string}`] : []))
    // A binding.gyp with no install script still compiles native code on install.
    if (found.length === 0 && m.gypfile === true) found.push('install: node-gyp rebuild (native build)')
    const t = ms(time[v])
    versions[v] = { ...(t !== undefined ? { time: t } : {}), ...(found.length > 0 ? { scripts: found } : {}) }
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

export function pypiFacts(json: unknown, stats?: unknown): Facts {
  const doc = obj(json) ?? {}
  const versions: Record<string, VersionFacts> = {}
  let created: number | undefined
  for (const [v, files] of Object.entries(obj(doc.releases) ?? {})) {
    if (!Array.isArray(files) || files.length === 0) continue
    let first: number | undefined
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

export function cratesFacts(json: unknown): Facts {
  const doc = obj(json) ?? {}
  const crate = obj(doc.crate) ?? {}
  const versions: Record<string, VersionFacts> = {}
  for (const v of Array.isArray(doc.versions) ? doc.versions : []) {
    const vo = obj(v) ?? {}
    const n = str(vo.num)
    if (!n) continue
    const t = ms(vo.created_at)
    versions[n] = { ...(t !== undefined ? { time: t } : {}), ...(vo.yanked === true ? { yanked: true } : {}) }
  }
  const latest = str(crate.max_stable_version) ?? str(crate.newest_version) ?? newestStable(Object.keys(versions))
  const recent = num(crate.recent_downloads) // last 90 days
  const created = ms(crate.created_at)
  return {
    ...(created !== undefined ? { createdAt: created } : {}),
    ...(latest ? { latest } : {}),
    versions,
    ...(recent !== undefined ? { weeklyDownloads: Math.round(recent / 13), isPopular: recent >= 100_000 } : {}),
  }
}

/**
 * Go: the proxy's `.info` answers ({ Version, Time }) for the versions asked about. A requested branch or
 * commit (`@master`) resolves to a pseudo-version, kept as a tag so the rules check what would install.
 */
export function goFacts(module: string, latestInfo: unknown, requestedInfo?: unknown, requested?: string): Facts {
  const versions: Record<string, VersionFacts> = {}
  let latest: string | undefined
  for (const [info, isLatest] of [
    [latestInfo, true],
    [requestedInfo, false],
  ] as const) {
    const o = obj(info)
    const v = str(o?.Version)
    if (!v) continue
    const t = ms(o?.Time)
    versions[v] = t !== undefined ? { time: t } : {}
    if (isLatest) latest = v
  }
  const resolved = str(obj(requestedInfo)?.Version)
  const tags = requested && resolved && requested !== resolved ? { [requested]: resolved } : undefined
  return { module, ...(latest ? { latest } : {}), versions, ...(tags ? { tags } : {}) }
}

export function rubygemsFacts(json: unknown): Facts {
  const rows = Array.isArray(json) ? json : []
  const versions: Record<string, VersionFacts> = {}
  let created: number | undefined
  let total = 0
  let latest: string | undefined
  for (const r of rows) {
    const o = obj(r) ?? {}
    const n = str(o.number)
    if (!n) continue
    const t = ms(o.created_at)
    if (versions[n] === undefined) versions[n] = t !== undefined ? { time: t } : {}
    if (t !== undefined && (created === undefined || t < created)) created = t
    total += num(o.downloads_count) ?? 0
    if (!latest && o.prerelease !== true) latest = n // newest first
  }
  const newest = latest ?? newestStable(Object.keys(versions))
  return {
    ...(created !== undefined ? { createdAt: created } : {}),
    ...(newest ? { latest: newest } : {}),
    versions,
    ...(rows.length > 0 ? { isPopular: total >= 1_000_000 } : {}),
  }
}

export function packagistFacts(json: unknown, name: string): Facts {
  const pkgs = obj(obj(json)?.packages) ?? {}
  const rows = pkgs[name.toLowerCase()]
  const versions: Record<string, VersionFacts> = {}
  let created: number | undefined
  for (const r of Array.isArray(rows) ? rows : []) {
    const o = obj(r) ?? {}
    const v = str(o.version)
    if (!v || v.startsWith('dev-') || v.endsWith('-dev')) continue
    const t = ms(o.time)
    versions[v.replace(/^v/, '')] = t !== undefined ? { time: t } : {}
    if (t !== undefined && (created === undefined || t < created)) created = t
  }
  const latest = newestStable(Object.keys(versions))
  return { ...(created !== undefined ? { createdAt: created } : {}), ...(latest ? { latest } : {}), versions }
}

// ---- vulnerabilities ----

/** OSV's answer for one version: each advisory once (aliases folded), with the first fixed version above it. */
export function osvVulns(json: unknown, eco: Ecosystem, name: string, version: string): Vuln[] {
  const list = obj(json)?.vulns
  if (!Array.isArray(list)) return []
  const same = (n: unknown) =>
    typeof n === 'string' && (eco === 'pypi' ? normalizePypi(n) === normalizePypi(name) : n.toLowerCase() === name.toLowerCase())
  const seen = new Set<string>()
  const out: Vuln[] = []
  for (const raw of list) {
    const v = obj(raw)
    const id = str(v?.id)
    if (!v || !id || v.withdrawn !== undefined) continue
    const aliases = Array.isArray(v.aliases) ? v.aliases.filter((a): a is string => typeof a === 'string') : []
    if (seen.has(id) || aliases.some(a => seen.has(a))) continue
    seen.add(id)
    aliases.forEach(a => seen.add(a))
    const fixes: string[] = []
    for (const a of Array.isArray(v.affected) ? v.affected : []) {
      const ao = obj(a)
      if (!ao || !same(obj(ao.package)?.name)) continue
      for (const r of Array.isArray(ao.ranges) ? ao.ranges : []) {
        for (const ev of Array.isArray(obj(r)?.events) ? (obj(r)?.events as unknown[]) : []) {
          const f = str(obj(ev)?.fixed)
          if (f) fixes.push(f)
        }
      }
    }
    const above = fixes.filter(f => compareVersions(f, version) > 0).sort(compareVersions)
    const fixed = above[0]
    const summary = str(v.summary)
    out.push({ id, ...(summary ? { summary } : {}), ...(fixed ? { fixed } : {}) })
  }
  return out
}

/** The newest version published before `cutoff`, for suggesting an older, settled release. */
export function newestBefore(facts: Facts, cutoff: number): string | undefined {
  const old = Object.entries(facts.versions)
    .filter(([v, f]) => f.time !== undefined && f.time <= cutoff && !f.yanked && !isPrerelease(v))
    .map(([v]) => v)
  return newestStable(old)
}
