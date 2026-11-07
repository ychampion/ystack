// The bouncer's rules: given what the registry said, deny, warn or let through. Pure.

import type { Spec } from './parse.ts'
import { isListedPopular, lookalikeOf } from './popular.ts'
import { REGISTRY_LABEL, newestBefore, type Facts, type Vuln } from './registry.ts'
import { compareVersions, pickVersion } from './versions.ts'

export type Config = { minAgeDays: number; minWeeklyDownloads: number; failClosed: boolean }

export type Lookup =
  | { kind: 'found'; facts: Facts; vulns?: Vuln[] | 'error' }
  | { kind: 'missing' }
  | { kind: 'error'; why: string }

export type Judgement = {
  spec: Spec
  /** `deny` stops the install; `ok` and `warn` let it run; `skipped` was not looked up. */
  level: 'deny' | 'warn' | 'ok' | 'skipped'
  denies: string[]
  notes: string[]
  /** The version the rules looked at. */
  version?: string
}

const DAY = 24 * 60 * 60 * 1000

export function label(spec: Spec, version?: string): string {
  return version ? `${spec.name}@${version}` : spec.name
}

function ago(then: number, now: number): string {
  const days = Math.floor((now - then) / DAY)
  if (days <= 0) {
    const hours = Math.max(1, Math.floor((now - then) / 3_600_000))
    return hours === 1 ? 'an hour ago' : `${hours} hours ago`
  }
  return days === 1 ? 'yesterday' : `${days} days ago`
}

const SOURCE_WORDS: Record<Exclude<Spec['source'], 'registry' | 'unparsed'>, string> = {
  url: 'it comes from a web address',
  git: 'it comes from a git repository',
  path: 'it is a local file or folder',
  'other-registry': 'it comes from a custom registry',
}

export function judge(spec: Spec, lookup: Lookup | undefined, cfg: Config, now: number): Judgement {
  const where = REGISTRY_LABEL[spec.ecosystem]
  if (spec.source === 'unparsed') {
    return {
      spec,
      level: 'deny',
      denies: [`package-bouncer: I can't read this package name ('${spec.raw}'). Write the package name out literally so it can be checked.`],
      notes: [],
    }
  }
  if (spec.source !== 'registry') {
    return { spec, level: 'skipped', denies: [], notes: [`${spec.raw} was not checked: ${SOURCE_WORDS[spec.source]}.`] }
  }
  if (!lookup || lookup.kind === 'error') {
    const why = lookup?.kind === 'error' ? lookup.why : 'no answer'
    if (cfg.failClosed) {
      return {
        spec,
        level: 'deny',
        denies: [`Couldn't reach ${where} to check ${spec.name} (${why}), and the bouncer is set to block when it can't check.`],
        notes: [],
      }
    }
    return { spec, level: 'warn', denies: [], notes: [`Couldn't reach ${where} to check ${spec.name} (${why}), so it was let through unchecked.`] }
  }
  if (lookup.kind === 'missing') {
    return {
      spec,
      level: 'deny',
      denies: [
        `${spec.name} doesn't exist on ${where}. The name may be made up (attackers register names that AI tools invent). Check the spelling or find the real package; if it's private, the owner can allow it.`,
      ],
      notes: [],
    }
  }

  const { facts } = lookup
  const denies: string[] = []
  const notes: string[] = []

  if (facts.isSecurityHolding) {
    denies.push(`npm took ${spec.name} down for security reasons (it held malware). Don't install it.`)
    return { spec, level: 'deny', denies, notes }
  }

  const pick = pickVersion(spec.version, Object.keys(facts.versions), facts.latest, spec.ecosystem, facts.tags)
  if (pick.kind === 'missing') {
    denies.push(`${spec.name} has no version ${spec.version} on ${where}. The version may be made up.`)
    return { spec, level: 'deny', denies, notes }
  }
  const version = pick.version
  if (pick.kind === 'unresolved' && spec.version) {
    notes.push(`Couldn't match "${spec.version}" for ${spec.name} to a published version, so the newest (${version ?? 'unknown'}) was checked.`)
  }
  const vf = version ? facts.versions[version] : undefined

  // Known vulnerabilities in the version that would be installed.
  if (Array.isArray(lookup.vulns) && lookup.vulns.length > 0 && version) {
    const shown = lookup.vulns.slice(0, 3)
    const fix = highestFix(lookup.vulns)
    const ids = shown.map(v => (v.fixed ? `${v.id} (fixed in ${v.fixed})` : `${v.id} (no fix yet)`)).join(', ')
    const more = lookup.vulns.length > shown.length ? ` and ${lookup.vulns.length - shown.length} more` : ''
    denies.push(
      `${label(spec, version)} has known security problems: ${ids}${more}.` +
        (fix ? ` Install ${spec.name}@${fix} or later instead.` : ' No fixed version is out yet; pick another package.'),
    )
  } else if (lookup.vulns === 'error') {
    if (cfg.failClosed)
      denies.push(
        `Couldn't check ${label(spec, version)} for known security problems (the advisory database didn't answer), and the bouncer is set to block when it can't check.`,
      )
    else notes.push(`Couldn't check ${label(spec, version)} for known security problems (the advisory database didn't answer).`)
  }

  // Age: brand-new packages and brand-new versions are where malware lands first.
  const minAge = cfg.minAgeDays * DAY
  if (cfg.minAgeDays > 0) {
    if (facts.createdAt !== undefined && now - facts.createdAt < minAge) {
      denies.push(
        `${spec.name} was first published ${ago(facts.createdAt, now)} (the rule is at least ${cfg.minAgeDays} days). Brand-new packages are a common way to slip in malware.`,
      )
    } else if (vf?.time !== undefined && now - vf.time < minAge) {
      const older = newestBefore(facts, now - minAge)
      denies.push(
        `${label(spec, version)} came out ${ago(vf.time, now)} (the rule is at least ${cfg.minAgeDays} days, so a bad release has time to be caught).` +
          (older ? ` The newest version older than that is ${older}: install ${spec.name}@${older} instead.` : ''),
      )
    }
  }

  // Look-alike names.
  if (!isListedPopular(spec.name, spec.ecosystem) && facts.isPopular !== true) {
    const twin = lookalikeOf(spec.name, spec.ecosystem)
    if (twin) {
      denies.push(
        `${spec.name} looks like a misspelling of the popular package ${twin}, and it isn't widely used itself. Look-alike names are a common attack; did you mean ${twin}?`,
      )
    }
  }

  // Warnings only.
  if (facts.weeklyDownloads !== undefined && facts.weeklyDownloads < cfg.minWeeklyDownloads) {
    notes.push(`${spec.name} is little used (${facts.weeklyDownloads} downloads last week). Worth a second look.`)
  }
  if (vf?.scripts && vf.scripts.length > 0) {
    const shown = vf.scripts.map(s => (s.length > 90 ? s.slice(0, 87) + '...' : s)).join('; ')
    notes.push(`${label(spec, version)} runs code when installed (${shown}).`)
  }
  if (vf?.yanked) notes.push(`${label(spec, version)} was withdrawn (yanked) by its author.`)

  const level = denies.length > 0 ? 'deny' : notes.length > 0 ? 'warn' : 'ok'
  return { spec, level, denies, notes, ...(version ? { version } : {}) }
}

function highestFix(vulns: Vuln[]): string | undefined {
  let best: string | undefined
  for (const v of vulns) {
    if (!v.fixed) continue
    if (!best || compareVersions(v.fixed, best) > 0) best = v.fixed
  }
  return best
}

/** The message Claude reads when the install is stopped: plain words it can pass on to the owner. */
export function denyMessage(judgements: Judgement[]): string {
  const lines = judgements.flatMap(j => j.denies.map(d => `- ${d}`))
  // An unreadable name can't be allowed by name: only the ones the registry was asked about are offered.
  const names = [...new Set(judgements.filter(j => j.level === 'deny' && j.spec.source !== 'unparsed').map(j => j.spec.name))]
  return [
    'package-bouncer stopped this install:',
    ...lines,
    names.length > 0
      ? `Tell the owner this in plain words. If they still want it, they can type /allow-package ${names.join(' ')} and you can run the install again.`
      : 'Tell the owner this in plain words, then run the install again with the names written out.',
  ].join('\n')
}

/** The note Claude reads after an install that ran: warnings and what wasn't checked. */
export function noteText(judgements: Judgement[]): string | undefined {
  const notes = judgements.flatMap(j => j.notes)
  if (notes.length === 0) return undefined
  return ['package-bouncer notes:', ...notes.map(n => `- ${n}`)].join('\n')
}
