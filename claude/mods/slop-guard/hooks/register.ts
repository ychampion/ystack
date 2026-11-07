import type { EngineInterface, PluginOptions, Register } from 'claude-code'

import {
  type Finding,
  type Level,
  type ProjectConfig,
  type RuleId,
  PROJECT_PATTERN,
  RULES,
  exceptionStated,
  formatFindings,
  isUiFile,
  parseLevels,
  parseList,
  parseProjectConfig,
  rangesOf,
  scan,
} from './rules.ts'

type Settings = { enabled: boolean; levels: Map<RuleId, Level>; unknown: string[]; extraFonts: string[] }
type Status = 'open' | 'fixed' | 'accepted'
type Logged = Finding & { file: string; loop: string; status: Status }

const MAX_LOG = 300
const MAX_STOP_BLOCKS = 2

// Session memory. A reload of the mod starts it over, which only happens when the mod itself is edited.
const log: Logged[] = []
const blocks = new Map<string, number>() // loop -> Stop blocks shown in the current stop sequence
const projectHas = new Map<string, boolean>() // `${root}::${kind}` -> the project already has it
const projectWarned = new Set<string>() // `${root}::${kind}` warned once this session

const key = (f: { file: string; rule: RuleId; text: string }) => `${f.file}::${f.rule}::${f.text}`
const norm = (p: string) => p.replace(/\\/g, '/')
const dirOf = (p: string) => norm(p).replace(/\/[^/]*$/, '')

function settingsFrom(options: PluginOptions): Settings {
  const text = (v: unknown) => (typeof v === 'string' ? v : '')
  const { levels, unknown } = parseLevels(text(options.ruleLevels))
  return { enabled: options.enabled !== false, levels, unknown, extraFonts: parseList(text(options.extraBannedFonts)) }
}

async function ancestors($: EngineInterface, file: string): Promise<{ config?: ProjectConfig; root?: string }> {
  let dir = dirOf(file)
  let config: ProjectConfig | undefined
  let root: string | undefined
  for (let i = 0; i < 12 && dir.length > 2; i++) {
    if (!config && (await $.fs.exists(`${dir}/.slop-guard.json`))) {
      const text = await $.fs.read(`${dir}/.slop-guard.json`).catch(() => undefined)
      if (typeof text === 'string') config = parseProjectConfig(text)
    }
    if (!root && ((await $.fs.exists(`${dir}/package.json`)) || (await $.fs.exists(`${dir}/.git`)))) root = dir
    if (root && (await $.fs.exists(`${dir}/.git`))) break
    const up = dirOf(dir)
    if (up === dir) break
    dir = up
  }
  return { config, root }
}

function scanOptions(s: Settings, config: ProjectConfig | undefined) {
  const levels = new Map(s.levels)
  for (const id of config?.ignore ?? []) levels.set(id, 'off')
  return { levels, extraFonts: s.extraFonts, brandFonts: config?.brandFonts ?? [], technical: config?.mode === 'technical' }
}

/** Whether the project already handles a whole-project concern (reduced motion, focus-visible). Asked once per root. */
async function hasInProject($: EngineInterface, root: string | undefined, kind: NonNullable<Finding['project']>, fileText: string): Promise<boolean> {
  const pattern = PROJECT_PATTERN[kind]
  if (new RegExp(pattern).test(fileText)) return true
  if (!root) return false
  const k = `${root}::${kind}`
  const known = projectHas.get(k)
  if (known !== undefined) return known
  const r = await $.process.run(['git', 'grep', '-l', '-I', '-E', pattern], { cwd: root, timeoutMs: 15_000 }).catch(() => undefined)
  // 0: found. 1: searched, absent. Anything else (not a repo, no git): unknown, so judge by the file alone.
  const has = r?.exitCode === 0
  if (r && (r.exitCode === 0 || r.exitCode === 1)) projectHas.set(k, has)
  return has
}

async function resolveProject($: EngineInterface, found: Finding[], root: string | undefined, content: string): Promise<Finding[]> {
  const out: Finding[] = []
  const seen = new Set<string>()
  for (const f of found) {
    if (!f.project) {
      out.push(f)
      continue
    }
    const k = `${root ?? '?'}::${f.project}`
    if (seen.has(k) || projectWarned.has(k)) continue
    seen.add(k)
    if (await hasInProject($, root, f.project, content)) continue
    projectWarned.add(k)
    out.push({ ...f, note: f.project === 'reduced-motion' ? 'no prefers-reduced-motion handling anywhere in the project' : 'no :focus-visible style anywhere in the project' })
  }
  return out
}

function record(file: string, loop: string, found: Finding[]) {
  for (const f of found) {
    const entry: Logged = { ...f, file: norm(file), loop, status: 'open' }
    const i = log.findIndex(x => key(x) === key(entry) && x.loop === loop && x.status === 'open')
    if (i === -1) log.push(entry)
    else log[i] = entry
  }
  if (log.length > MAX_LOG) log.splice(0, log.length - MAX_LOG)
}

/** Re-reads each file with an open blocking finding and keeps those whose line is still there. */
async function stillOpen($: EngineInterface, s: Settings, loop: string): Promise<Logged[]> {
  const open = log.filter(x => x.loop === loop && x.blocks && x.status === 'open')
  const byFile = new Map<string, Logged[]>()
  for (const f of open) byFile.set(f.file, [...(byFile.get(f.file) ?? []), f])
  const left: Logged[] = []
  for (const [file, items] of byFile) {
    const text = await $.fs.read(file).catch(() => undefined)
    if (typeof text !== 'string') {
      for (const f of items) f.status = 'fixed'
      continue
    }
    const { config } = await ancestors($, file)
    const now = new Set(scan(file, text, scanOptions(s, config)).filter(f => f.blocks).map(f => key({ ...f, file })))
    for (const f of items) {
      if (now.has(key(f))) left.push(f)
      else f.status = 'fixed'
    }
  }
  return left
}

function blockReason(left: Logged[]): string {
  const lines = left.slice(0, 12).map(f => `- ${f.file}:${f.line} [${f.rule}] \`${f.match}\``)
  const more = left.length > 12 ? [`- and ${left.length - 12} more (/slop-guard lists them)`] : []
  return [
    `slop-guard: ${left.length} unmistakable AI-design tell${left.length === 1 ? ' is' : 's are'} still in the code you wrote:`,
    ...lines,
    ...more,
    'Fix each one now. If one is a deliberate exception (a client brand font, a real customer number), keep it with `slop-ok: <reason>` on that line, or say plainly in your reply which finding is a deliberate slop-guard exception and why.',
  ].join('\n')
}

async function gate($: EngineInterface, s: Settings, loop: string, isActive: boolean, lastText: string): Promise<string | undefined> {
  if (!s.enabled) return undefined
  if (!isActive) blocks.delete(loop)
  const left = await stillOpen($, s, loop)
  if (left.length === 0) {
    blocks.delete(loop)
    return undefined
  }
  const shown = blocks.get(loop) ?? 0
  // Accept a stated exception: strictly before any block, loosely once the block was shown; never block more than twice.
  if (exceptionStated(lastText, shown === 0) || shown >= MAX_STOP_BLOCKS) {
    for (const f of left) f.status = 'accepted'
    blocks.delete(loop)
    return undefined
  }
  blocks.set(loop, shown + 1)
  return blockReason(left)
}

function listing(s: Settings): string {
  const head = s.enabled ? 'slop-guard is on.' : 'slop-guard is off (the "enabled" setting in /config).'
  const overrides = [...s.levels].map(([id, l]) => `${id}=${l}`)
  const notes = [
    overrides.length ? `Overrides: ${overrides.join(', ')}.` : '',
    s.unknown.length ? `Ignored unknown rule settings: ${s.unknown.join(', ')}.` : '',
    s.extraFonts.length ? `Extra banned fonts: ${s.extraFonts.join(', ')}.` : '',
  ].filter(Boolean)
  if (log.length === 0) return [head, ...notes, 'No findings this session.', `Rule ids: ${RULES.map(r => r.id).join(', ')}.`].join('\n')
  const byFile = new Map<string, Logged[]>()
  for (const f of log) byFile.set(f.file, [...(byFile.get(f.file) ?? []), f])
  const counts = { open: 0, fixed: 0, accepted: 0 }
  for (const f of log) counts[f.status] += 1
  const out = [head, ...notes, `${log.length} finding(s) this session: ${counts.open} open, ${counts.fixed} fixed, ${counts.accepted} kept as exceptions.`]
  for (const [file, items] of byFile) {
    out.push(file)
    for (const f of items.sort((a, b) => a.line - b.line))
      out.push(`  L${f.line} ${f.rule}${f.blocks ? ' (blocking)' : ''} · ${f.status}${f.loop === 'main' ? '' : ` · subagent ${f.loop}`}: ${f.match}`)
  }
  return out.join('\n')
}

export const register: Register = (on, options) => {
  const s = settingsFrom(options)

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'slop-guard', description: 'List the AI-design findings slop-guard made this session' })
    return next(e)
  })

  on('command.run', { command: 'slop-guard' }, async () => ({ text: listing(s) }))

  on('tool.call', { tool: ['Edit', 'Write'] }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError === true || !s.enabled) return ran
    // Everything after the edit is advisory: a failure here must never touch the edit that already ran.
    try {
      const file = e.file_path
      if (!isUiFile(file)) return ran
      const written = e.tool === 'Write' ? e.content : undefined
      const read = await $.fs.read(file).catch(() => undefined)
      const content = typeof read === 'string' ? read : written
      if (typeof content !== 'string') return ran
      const ranges = e.tool === 'Write' ? [[1, content.split('\n').length] as [number, number]] : rangesOf(content, e.new_string)
      if (ranges.length === 0) return ran
      const { config, root } = await ancestors($, file)
      const raw = scan(file, content, { ...scanOptions(s, config), ranges })
      const found = await resolveProject($, raw, root, content)
      if (found.length === 0) return ran
      record(file, e.agentId ?? 'main', found)
      return { ...ran, context: [...(ran.context ?? []), formatFindings(file, found)] }
    } catch {
      return ran
    }
  }).catch(($, e, next) => next(e)) // only an engine failure inside next() reaches this; our own work is caught above

  // Fail open: a broken check never holds a turn.
  on('classic.Stop', async ($, e, next) => {
    const reason = await gate($, s, 'main', e.stop_hook_active, e.last_assistant_message ?? '').catch(() => undefined)
    return reason ? { block: reason } : next(e)
  }).catch(($, e, next) => next(e))

  on('classic.SubagentStop', async ($, e, next) => {
    const reason = await gate($, s, e.agent_id, e.stop_hook_active, e.last_assistant_message ?? '').catch(() => undefined)
    return reason ? { block: reason } : next(e)
  }).catch(($, e, next) => next(e))
}
