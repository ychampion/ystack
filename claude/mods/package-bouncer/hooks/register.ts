import type { EngineInterface, PluginOptions, Register } from 'claude-code'

import { ALLOW_PREFIX, denyMessage, judge, noteText, type Config, type Judgement, type Lookup } from './decide.ts'
import { isGoPrivate, parseInstalls, parseRequirements, type Ecosystem, type Shell, type Spec } from './parse.ts'
import { canonical } from './popular.ts'
import {
  OSV_URL,
  cratesFacts,
  cratesUrl,
  goFacts,
  goInfoUrl,
  goLatestUrl,
  goModuleCandidates,
  npmDownloadsUrl,
  npmFacts,
  npmUrl,
  osvBody,
  osvVulns,
  packagistFacts,
  packagistUrl,
  pypiFacts,
  pypiStatsUrl,
  pypiUrl,
  rubygemsFacts,
  rubygemsUrl,
  type Facts,
} from './registry.ts'
import { pickVersion } from './versions.ts'

const TIMEOUT_MS = 5_000
const USER_AGENT = 'ystack-package-bouncer'
const MAX_REQUIREMENTS = 25

function configFrom(options: PluginOptions): Config {
  const n = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : d)
  return {
    minAgeDays: n(options.minAgeDays, 14),
    minWeeklyDownloads: n(options.minWeeklyDownloads, 500),
    failClosed: options.failClosed === true,
  }
}

type Got = { kind: 'ok'; json: unknown } | { kind: 'missing' } | { kind: 'error'; why: string }

// Per session: registry answers, the owner's allows and the names the bouncer stopped. Reset at each session start.
let cache = new Map<string, Promise<Got>>()
/** `prefix:canonical name` allows one package in one ecosystem; `*:name` allows that exact spelling in all of them. */
let allowed = new Set<string>()
/** `prefix:canonical name` -> the number of the most recent stop that named it. */
let denied = new Map<string, number>()
let denySeq = 0

const ECOSYSTEMS = Object.keys(ALLOW_PREFIX) as Ecosystem[]
const ECO_BY_PREFIX = new Map(ECOSYSTEMS.map(eco => [ALLOW_PREFIX[eco], eco]))
const PREFIX_LIST = ECOSYSTEMS.map(eco => `${ALLOW_PREFIX[eco]}:`).join(', ')
// The same package can be spelled several ways in its own ecosystem (PyPI folds case, '-', '_' and '.'),
// so the key is the ecosystem's canonical name, never a fold borrowed from another ecosystem.
const ecoKey = (eco: Ecosystem, name: string) => `${ALLOW_PREFIX[eco]}:${canonical(name, eco)}`
const exactKey = (name: string) => `*:${name}`
const isAllowed = (spec: Spec) => allowed.has(ecoKey(spec.ecosystem, spec.name)) || allowed.has(exactKey(spec.name))

/** The ecosystems where the bouncer most recently stopped this name in this session (none if it never did). */
function lastDeniedIn(name: string): Ecosystem[] {
  let best = 0
  let ecos: Ecosystem[] = []
  for (const eco of ECOSYSTEMS) {
    const seq = denied.get(ecoKey(eco, name)) ?? 0
    if (seq > best) {
      best = seq
      ecos = [eco]
    } else if (seq > 0 && seq === best) ecos.push(eco)
  }
  return ecos
}

function allowCommand(args: string): { text: string; context?: string[] } {
  const words = args.split(/[\s,]+/).filter(Boolean)
  if (words.length === 0) {
    const list = [...allowed].map(k => (k.startsWith('*:') ? `${k.slice(2)} (exact spelling, any ecosystem)` : k))
    return {
      text:
        list.length > 0
          ? `Allowed this session: ${list.join(', ')}.`
          : 'Nothing allowed yet. Type /allow-package eco:<name> (or just <name>) to allow a package the bouncer stopped.',
    }
  }
  const done: string[] = []
  const exact: string[] = []
  const bad: string[] = []
  for (const word of words) {
    const m = /^([a-z]+):(.+)$/i.exec(word)
    if (m) {
      const eco = ECO_BY_PREFIX.get((m[1] as string).toLowerCase())
      if (!eco) {
        bad.push(word)
        continue
      }
      allowed.add(ecoKey(eco, m[2] as string))
      done.push(`${ALLOW_PREFIX[eco]}:${m[2]}`)
      continue
    }
    const ecos = lastDeniedIn(word)
    if (ecos.length > 0) {
      for (const eco of ecos) {
        allowed.add(ecoKey(eco, word))
        done.push(`${ALLOW_PREFIX[eco]}:${word}`)
      }
    } else {
      // Nothing to say which ecosystem was meant: allow only this exact spelling, with no folding at all.
      allowed.add(exactKey(word))
      exact.push(word)
    }
  }
  const text: string[] = []
  if (done.length > 0) text.push(`Allowed for this session: ${done.join(', ')}. Claude can install ${done.length === 1 ? 'it' : 'them'} now.`)
  if (exact.length > 0) {
    const one = exact.length === 1
    text.push(
      `${exact.join(', ')}: the bouncer hasn't stopped ${one ? 'that name' : 'those names'} this session, so ${one ? 'it is' : 'they are'} allowed in every ecosystem, ` +
        `but only under that exact spelling (no folding of case, '-', '_' or '.'). To allow ${one ? 'it' : 'them'} in one ecosystem instead, type /allow-package eco:<name> (${PREFIX_LIST}).`,
    )
  }
  if (bad.length > 0) {
    text.push(`Not allowed: ${bad.join(', ')}. The part before ':' isn't an ecosystem the bouncer knows; use ${PREFIX_LIST}.`)
  }
  const labels = [...done, ...exact.map(w => `${w} (exact spelling, any ecosystem)`)]
  return {
    text: text.join(' '),
    ...(labels.length > 0 ? { context: [`The owner allowed ${labels.join(', ')} past package-bouncer for this session. Run the install again.`] } : {}),
  }
}

function fetchJson($: EngineInterface, url: string, init?: { method?: string; body?: string }): Promise<Got> {
  const key = `${init?.method ?? 'GET'} ${url} ${init?.body ?? ''}`
  const hit = cache.get(key)
  if (hit) return hit
  const p = (async (): Promise<Got> => {
    let timer: { cancel: () => void } | undefined
    const timeout = new Promise<Got>(resolve => {
      timer = $.clock.after(TIMEOUT_MS, () => resolve({ kind: 'error', why: 'timed out after 5 seconds' }))
    })
    const request = $.http
      .fetch(url, {
        method: init?.method ?? 'GET',
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...(init?.body ? { 'Content-Type': 'application/json' } : {}) },
        ...(init?.body ? { body: init.body } : {}),
      })
      .then((r): Got => {
        if (r.status === 404 || r.status === 410) return { kind: 'missing' }
        if (!r.ok) return { kind: 'error', why: `the registry answered ${r.status}` }
        try {
          return { kind: 'ok', json: JSON.parse(r.text) as unknown }
        } catch {
          return { kind: 'error', why: 'the registry sent something unreadable' }
        }
      })
      .catch((err: unknown): Got => ({ kind: 'error', why: `network error: ${String(err).slice(0, 120)}` }))
    const got = await Promise.race([request, timeout])
    timer?.cancel()
    return got
  })()
  cache.set(key, p)
  // A failed lookup is retried next time rather than remembered.
  void p.then(g => {
    if (g.kind === 'error') cache.delete(key)
  })
  return p
}

async function osv($: EngineInterface, spec: Spec, name: string, version: string) {
  const got = await fetchJson($, OSV_URL, { method: 'POST', body: osvBody(spec.ecosystem, name, version) })
  return got.kind === 'ok' ? osvVulns(got.json, spec.ecosystem, name, version) : got.kind === 'missing' ? [] : ('error' as const)
}

/** What the registry and the advisory database say about one requested package. */
async function lookup($: EngineInterface, spec: Spec): Promise<Lookup> {
  let facts: Facts
  let osvName = spec.name
  switch (spec.ecosystem) {
    case 'npm': {
      const [doc, dl] = await Promise.all([fetchJson($, npmUrl(spec.name)), fetchJson($, npmDownloadsUrl(spec.name))])
      if (doc.kind !== 'ok') return doc
      facts = npmFacts(doc.json, dl.kind === 'ok' ? dl.json : undefined)
      break
    }
    case 'pypi': {
      const [doc, stats] = await Promise.all([fetchJson($, pypiUrl(spec.name)), fetchJson($, pypiStatsUrl(spec.name))])
      if (doc.kind !== 'ok') return doc
      facts = pypiFacts(doc.json, stats.kind === 'ok' ? stats.json : undefined)
      break
    }
    case 'crates': {
      const doc = await fetchJson($, cratesUrl(spec.name))
      if (doc.kind !== 'ok') return doc
      facts = cratesFacts(doc.json)
      break
    }
    case 'go': {
      let found: { module: string; json: unknown } | undefined
      for (const module of goModuleCandidates(spec.name)) {
        const got = await fetchJson($, goLatestUrl(module))
        if (got.kind === 'error') return got
        if (got.kind === 'ok') {
          found = { module, json: got.json }
          break
        }
      }
      if (!found) return { kind: 'missing' }
      const wants = spec.version && !['latest', 'upgrade', 'patch'].includes(spec.version) ? spec.version : undefined
      const asked = wants ? await fetchJson($, goInfoUrl(found.module, wants)) : undefined
      if (asked?.kind === 'error') return asked
      facts = goFacts(found.module, found.json, asked?.kind === 'ok' ? asked.json : undefined, wants)
      osvName = found.module
      break
    }
    case 'rubygems': {
      const doc = await fetchJson($, rubygemsUrl(spec.name))
      if (doc.kind !== 'ok') return doc
      facts = rubygemsFacts(doc.json)
      break
    }
    case 'packagist': {
      const doc = await fetchJson($, packagistUrl(spec.name))
      if (doc.kind !== 'ok') return doc
      facts = packagistFacts(doc.json, spec.name)
      if (Object.keys(facts.versions).length === 0 && !facts.latest) return { kind: 'missing' }
      break
    }
  }
  const pick = pickVersion(spec.version, Object.keys(facts.versions), facts.latest, spec.ecosystem, facts.tags)
  const version = pick.kind === 'missing' ? undefined : pick.version
  const vulns = version ? await osv($, spec, osvName, version) : undefined
  return { kind: 'found', facts, ...(vulns !== undefined ? { vulns } : {}) }
}

async function requirementSpecs($: EngineInterface, files: string[]): Promise<{ specs: Spec[]; notes: string[] }> {
  const specs: Spec[] = []
  const notes: string[] = []
  const queue = [...files]
  const seen = new Set<string>()
  while (queue.length > 0 && seen.size < 5) {
    const f = queue.shift() as string
    if (seen.has(f)) continue
    seen.add(f)
    const text = await $.fs.read(f).catch(() => undefined)
    if (typeof text !== 'string') {
      notes.push(`Couldn't read ${f}, so the packages in it were not checked.`)
      continue
    }
    const r = parseRequirements(text)
    specs.push(...r.specs)
    queue.push(...r.nested)
  }
  if (specs.length > MAX_REQUIREMENTS) {
    notes.push(`Only the first ${MAX_REQUIREMENTS} of ${specs.length} requirements were checked.`)
    return { specs: specs.slice(0, MAX_REQUIREMENTS), notes }
  }
  return { specs, notes }
}

async function check($: EngineInterface, command: string, shell: Shell, cfg: Config) {
  const parsed = parseInstalls(command, shell)
  const extraNotes: string[] = []
  let specs = parsed.specs
  if (parsed.requirementFiles.length > 0) {
    const r = await requirementSpecs($, parsed.requirementFiles)
    specs = [...specs, ...r.specs]
    extraNotes.push(...r.notes)
  }
  if (specs.length === 0) return undefined
  if (specs.some(s => s.ecosystem === 'go' && s.source === 'registry')) {
    // Private Go modules never reach the public proxy: don't call them made up.
    const priv = [await $.env.get('GOPRIVATE'), await $.env.get('GONOPROXY')].filter(Boolean).join(',')
    if (priv) specs = specs.map(s => (s.ecosystem === 'go' && s.source === 'registry' && isGoPrivate(s.name, priv) ? { ...s, source: 'other-registry' as const } : s))
  }
  const now = await $.clock.now()
  const judgements: Judgement[] = await Promise.all(
    specs.map(async spec => {
      if (spec.source === 'registry' && isAllowed(spec)) {
        return { spec, level: 'ok' as const, denies: [], notes: [`${spec.name} was allowed by the owner for this session.`] }
      }
      const found = spec.source === 'registry' ? await lookup($, spec) : undefined
      return judge(spec, found, cfg, now)
    }),
  )
  if (extraNotes.length > 0) judgements.push({ spec: specs[0] as Spec, level: 'warn', denies: [], notes: extraNotes })
  return judgements
}

export const register: Register = (on, options) => {
  const cfg = configFrom(options)

  on('session.start', async ($, e, next) => {
    cache = new Map()
    allowed = new Set()
    denied = new Map()
    denySeq = 0
    await $.command.register({
      name: 'allow-package',
      description: 'Let Claude install a package the bouncer stopped (this session only)',
      argumentHint: '[npm:|pypi:|crates:|go:|gem:|composer:]<name> [more names]',
    })
    return next(e)
  })

  on('command.run', { command: 'allow-package' }, async ($, e) => allowCommand(e.args))

  on('tool.call', { tool: ['Bash', 'PowerShell'] }, async ($, e, next) => {
    const shell: Shell = e.tool === 'PowerShell' ? 'powershell' : 'bash'
    const judgements = await check($, e.command, shell, cfg)
    if (!judgements) return next(e)
    if (judgements.some(j => j.level === 'deny')) {
      denySeq++
      for (const j of judgements) if (j.level === 'deny' && j.spec.source === 'registry') denied.set(ecoKey(j.spec.ecosystem, j.spec.name), denySeq)
      return { deny: denyMessage(judgements) }
    }
    const ran = await next(e)
    const note = noteText(judgements)
    if (note === undefined || ran.deny !== undefined) return ran
    return { ...ran, context: [...(ran.context ?? []), note] }
  }).catch(($, e, next) => {
    if (next.called) return next(e)
    // The check itself broke: let the install run, unless the owner asked to block when unsure.
    return cfg.failClosed ? { deny: 'package-bouncer could not check this install, and it is set to block when it can\'t check. Tell the owner.' } : next(e)
  })
}
