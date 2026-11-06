import type { EngineInterface, Register } from 'claude-code'

import {
  type Effort,
  CONFIG_DEFAULT,
  LADDER,
  asEffort,
  effectiveEffort,
  isCodexExec,
  missingBriefParts,
  nextUp,
  parseCodex,
  taskKey,
} from './ladder.ts'

type Run = { key: string; effort: Effort; at: number; isError: boolean }
const MAX_GRANT_MS = 6 * 60 * 60 * 1000
const RECENT_MS = 48 * 60 * 60 * 1000

async function runs($: EngineInterface): Promise<Run[]> {
  const v = await $.store.get('runs')
  return Array.isArray(v) ? (v as Run[]) : []
}

async function maxGrant($: EngineInterface): Promise<number | undefined> {
  const v = await $.store.get('maxGrantUntil')
  return typeof v === 'number' ? v : undefined
}

export const register: Register = (on, options) => {
  const configDefault = asEffort(options.defaultEffort) ?? CONFIG_DEFAULT
  const template = typeof options.briefTemplate === 'string' ? options.briefTemplate.trim() : ''
  const blockFast = options.blockFastTier !== false

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'codex-allow-max',
      description: 'Allow ONE codex run at max effort in the next 6 hours (only you can grant it)',
    })
    return next(e)
  })

  on('command.run', { command: 'codex-allow-max' }, async ($, e) => {
    if (e.origin.kind !== 'composer' && e.origin.kind !== 'bridge') return { text: 'codex-ladder: only the user can grant max (type the command yourself).' }
    await $.store.set('maxGrantUntil', (await $.clock.now()) + MAX_GRANT_MS)
    return { text: 'codex-ladder: one codex run at max effort is allowed in the next 6 hours.' }
  })

  on('tool.call', { tool: ['Bash', 'PowerShell'] }, async ($, e, next) => {
    if (!isCodexExec(e.command)) return next(e)
    const call = parseCodex(e.command)

    if (call.effort === 'ultra') return { deny: 'codex-ladder: "ultra" is not a codex effort. Use the ladder (medium, high, xhigh), or ask the user for max.' }
    if (blockFast && call.hasServiceTier) return { deny: 'codex-ladder: the fast/priority service tier is off. Remove service_tier/--fast.' }
    if (call.effort === 'low' && call.profile !== 'docs')
      return { deny: 'codex-ladder: "low" is only for non-coding trivial work and is selected with `--profile docs`. Use medium for a small code change.' }

    const effort = effectiveEffort(call, configDefault)
    if (effort === 'max') {
      const until = await maxGrant($)
      if (until === undefined || until < (await $.clock.now()))
        return { deny: "codex-ladder: max needs the user's per-task permission. Ask them; they grant one run with /codex-allow-max." }
      await $.store.delete('maxGrantUntil') // one shot
    }

    const notes: string[] = []
    const brief = call.briefFile !== undefined ? await $.fs.read(call.briefFile).catch(() => undefined) : call.inlineBrief
    if (typeof brief === 'string' && brief.length > 0) {
      const missing = missingBriefParts(brief)
      if (missing.length > 0)
        notes.push(`codex-ladder: the brief lacks ${missing.join(', ')}.${template ? ` Start from ${template} next time.` : ''}`)
    }

    const key = taskKey(call)
    const now = await $.clock.now()
    if (key !== undefined) {
      const prev = (await runs($)).filter(r => r.key === key && now - r.at < RECENT_MS).at(-1)
      if (prev !== undefined && LADDER.indexOf(effort) <= LADDER.indexOf(prev.effort) && prev.effort !== 'xhigh' && prev.effort !== 'max') {
        notes.push(
          `codex-ladder: this brief already ran at ${prev.effort} ${Math.round((now - prev.at) / 60000)} min ago. ` +
            `If that run under-delivered, the ladder says escalate to ${nextUp(prev.effort)}, not retry at the same tier.`,
        )
      }
    }

    const ran = await next(e)
    if (key !== undefined && ran.deny === undefined) {
      const list = [...(await runs($)), { key, effort, at: now, isError: ran.isError === true }].slice(-200)
      await $.store.set('runs', list)
    }
    if (notes.length === 0 || ran.deny !== undefined) return ran
    return { ...ran, context: [...(ran.context ?? []), ...notes] }
  }).catch(($, e, next) => next(e)) // fail open on a parser bug
}
