import type { EngineInterface, PluginOptions, Register } from 'claude-code'

import { denyMessage, judge, noteText, type Config, type Judgement, type Lookup } from './decide.ts'
import { isGoPrivate, normalizePypi, parseInstalls, parseRequirements, type Shell, type Spec } from './parse.ts'
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

// Per session: registry answers and the owner's allowed names. Reset at each session start.
let cache = new Map<string, Promise<Got>>()
let allowed = new Set<string>()

const allowKey = (name: string) => normalizePypi(name)

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
      if (spec.source === 'registry' && allowed.has(allowKey(spec.name))) {
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
    await $.command.register({
      name: 'allow-package',
      description: 'Let Claude install a package the bouncer stopped (this session only)',
      argumentHint: '<name> [more names]',
    })
    return next(e)
  })

  on('command.run', { command: 'allow-package' }, async ($, e) => {
    const names = e.args.split(/[\s,]+/).filter(Boolean)
    if (names.length === 0) {
      const list = [...allowed]
      return {
        text: list.length > 0 ? `Allowed this session: ${list.join(', ')}.` : 'Nothing allowed yet. Type /allow-package <name> to allow a package the bouncer stopped.',
      }
    }
    for (const n of names) allowed.add(allowKey(n))
    return {
      text: `Allowed for this session: ${names.join(', ')}. Claude can install ${names.length === 1 ? 'it' : 'them'} now.`,
      context: [`The owner allowed ${names.join(', ')} past package-bouncer for this session. Run the install again.`],
    }
  })

  on('tool.call', { tool: ['Bash', 'PowerShell'] }, async ($, e, next) => {
    const shell: Shell = e.tool === 'PowerShell' ? 'powershell' : 'bash'
    const judgements = await check($, e.command, shell, cfg)
    if (!judgements) return next(e)
    if (judgements.some(j => j.level === 'deny')) return { deny: denyMessage(judgements) }
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
