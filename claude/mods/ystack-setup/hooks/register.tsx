import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AgentEdit, ApplyRecord, SettingEdit } from '../types'
import { AGENTS, type Ctx, ITEMS, KEEP, type Settings, type State, SUBAGENT_MODELS, agentState, effectivePick, get, modelId } from './items.ts'
import { isEmptyObject, rawAt, removeAt, sameJson, setAt } from './jsonedit.ts'

const PANE = 'ystack-setup'
const STACK = 'undo-stack'
const ticks = atom({ plugin: 'ystack-setup', key: 'ticks' } as const, [] as string[], { shape: 'ticks-1' })
// '' until the user picks: then "keep current" when a value exists, else opus.
const pick = atom({ plugin: 'ystack-setup', key: 'pick' } as const, '' as string, { shape: 'pick-2' })
const message = atom({ plugin: 'ystack-setup', key: 'message' } as const, '' as string, { shape: 'message-1' })
const undoable = atom({ plugin: 'ystack-setup', key: 'undoable' } as const, 0 as number, { shape: 'undoable-1' })

type Options = { haikuModel?: string }
type Loaded = { ctx: Ctx; dir: string; settingsPath: string; raw?: string; text?: string; bom: string; error?: string }

const BOM = '﻿'
const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '')
const lf = (t: string) => t.replace(/\r\n/g, '\n')

async function claudeDir($: EngineInterface): Promise<string> {
  const cfg = await $.env.get('CLAUDE_CONFIG_DIR')
  if (cfg) return norm(cfg)
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? ''
  return `${norm(home)}/.claude`
}

const agentPath = (dir: string, name: string) => `${dir}/agents/${name}.md`

async function readOrUndefined($: EngineInterface, path: string): Promise<string | undefined> {
  if (!(await $.fs.exists(path).catch(() => false))) return undefined
  const text = await $.fs.read(path)
  return typeof text === 'string' ? text : undefined
}

/** Settings text without its byte-order mark, parsed; an error when it isn't a JSON object. */
function parseSettings(raw: string | undefined, where: string): { text?: string; bom: string; settings: Settings; error?: string } {
  if (raw === undefined || raw.trim() === '' || raw.trim() === BOM) return { bom: '', settings: {} }
  const bom = raw.startsWith(BOM) ? BOM : ''
  const text = raw.slice(bom.length)
  try {
    const parsed: unknown = JSON.parse(text)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return { text, bom, settings: {}, error: `${where} is not a JSON object` }
    return { text, bom, settings: parsed as Settings }
  } catch (err) {
    return { text, bom, settings: {}, error: `${where} is not valid JSON (${err instanceof Error ? err.message : String(err)})` }
  }
}

/** Reads the user settings, the agent files and the model ids. A settings file that does not parse comes back as `error`. */
async function load($: EngineInterface, opts: Options): Promise<Loaded> {
  const dir = await claudeDir($)
  const settingsPath = `${dir}/settings.json`
  const raw = await readOrUndefined($, settingsPath)
  const { text, bom, settings, error } = parseSettings(raw, settingsPath)
  const agents: Record<string, string | undefined> = {}
  for (const name of Object.keys(AGENTS)) agents[name] = await readOrUndefined($, agentPath(dir, name)).catch(() => undefined)

  const env = (settings.env ?? {}) as Record<string, string | undefined>
  const aliases = {
    opus: env.ANTHROPIC_DEFAULT_OPUS_MODEL ?? (await $.env.get('ANTHROPIC_DEFAULT_OPUS_MODEL')),
    sonnet: env.ANTHROPIC_DEFAULT_SONNET_MODEL ?? (await $.env.get('ANTHROPIC_DEFAULT_SONNET_MODEL')),
    haiku: env.ANTHROPIC_DEFAULT_HAIKU_MODEL ?? (await $.env.get('ANTHROPIC_DEFAULT_HAIKU_MODEL')),
  }
  const session = await $.session.model().catch(() => undefined)
  const mainModel = modelId(session, aliases) ?? modelId(typeof settings.model === 'string' ? settings.model : undefined, aliases)
  const haikuModel = modelId(aliases.haiku, {}) ?? modelId(opts.haikuModel, {})
  return { ctx: { settings, agents, mainModel, haikuModel }, dir, settingsPath, raw, text, bom, error }
}

const WORD: Record<State, string> = { done: 'in place', missing: 'not set', partial: 'different value', differs: 'yours differs', unknown: 'unknown', info: 'info' }

/** The text report `/ystack-setup check` prints. */
async function report($: EngineInterface, opts: Options): Promise<string> {
  const L = await load($, opts)
  const lines = [`ystack-setup check (user settings: ${L.settingsPath})`]
  if (L.error) lines.push(`Can't read settings: ${L.error}. Fix the file; Apply refuses to write until it parses.`)
  let done = 0
  let total = 0
  for (const item of ITEMS) {
    const s = item.status(L.ctx)
    if (item.kind === 'apply' && s.state !== 'info') {
      total++
      if (s.state === 'done') done++
    }
    lines.push(`${WORD[s.state].padEnd(15)} ${item.title}: ${s.note}`)
    for (const d of item.details?.(L.ctx) ?? []) lines.push(`    ${d}`)
  }
  lines.push(`${done} of ${total} in place.`)
  const stack = await readStack($)
  if (stack.length > 0) lines.push(`Undo can revert ${stack.length} Apply(s).`)
  return lines.join('\n')
}

async function readStack($: EngineInterface): Promise<ApplyRecord[]> {
  const v = await $.store.get(STACK)
  return Array.isArray(v) ? (v as ApplyRecord[]) : []
}

async function writeStack($: EngineInterface, stack: ApplyRecord[]) {
  const kept = stack.slice(-20)
  await $.store.set(STACK, kept)
  await update($, undoable, () => kept.length)
}

async function freeBackup($: EngineInterface, file: string, date: string): Promise<string> {
  const base = `${file}.bak-ystack-${date}`
  let path = base
  for (let n = 2; await $.fs.exists(path); n++) path = `${base}-${n}`
  return path
}

async function say($: EngineInterface, text: string): Promise<string> {
  await update($, message, () => text)
  return text
}

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err))

/** Writes the ticked items only: backs up each file it touches, then edits only the keys it sets. */
async function apply($: EngineInterface, opts: Options): Promise<string> {
  const L = await load($, opts)
  if (L.error) return say($, `Nothing changed: ${L.error}. Fix it and press Apply again.`)
  const ticked = await read($, ticks)
  const choice = { pick: await read($, pick), replace: ticked.filter(t => t.startsWith('replace:')).map(t => t.slice('replace:'.length)) }
  const chosen = ITEMS.filter(i => i.kind === 'apply' && ticked.includes(i.id))
  if (chosen.length === 0) return say($, 'Tick at least one item, then press Apply.')
  const changes = chosen.flatMap(i => i.changes(L.ctx, choice))

  // Settings: edit the text in place, so keys, order and large numbers stay exactly as they were.
  let text = L.text ?? '{}\n'
  const settingEdits: SettingEdit[] = []
  for (const c of changes) {
    if (c.kind !== 'setting') continue
    const after = JSON.stringify(c.value)
    const r = setAt(text, c.path, after)
    if ('error' in r) return say($, `Nothing changed: in ${L.settingsPath}, ${r.error}. Fix it and press Apply again.`)
    text = r.text
    settingEdits.push({ path: c.path, after, before: r.before, createdAt: r.createdAt })
  }
  if (settingEdits.length > 0) {
    try {
      JSON.parse(text)
    } catch {
      return say($, 'Nothing changed: the edited settings would not parse.')
    }
  }
  const agentEdits: AgentEdit[] = []
  for (const c of changes) if (c.kind === 'agent') agentEdits.push({ file: agentPath(L.dir, c.name), after: c.text, before: L.ctx.agents[c.name] })

  const kept = chosen.some(i => i.id === 'agents') ? Object.keys(AGENTS).filter(n => agentState(L.ctx, n) === 'differs' && !choice.replace.includes(n)) : []
  const keptNote = kept.length > 0 ? ` Kept your ${kept.map(n => `${n}.md`).join(', ')} (tick replace to overwrite).` : ''
  if (settingEdits.length === 0 && agentEdits.length === 0) return say($, `Everything you ticked is already in place. Nothing changed.${keptNote}`)

  const writes: { file: string; text: string; before?: string }[] = []
  if (settingEdits.length > 0) writes.push({ file: L.settingsPath, text: L.bom + text, before: L.raw })
  for (const a of agentEdits) writes.push({ file: a.file, text: a.after, before: a.before })

  // Backups first, all of them; if one fails, nothing is written.
  const date = new Date(await $.clock.now()).toISOString().slice(0, 10)
  const backups: string[] = []
  for (const w of writes) {
    if (w.before === undefined) continue
    try {
      const b = await freeBackup($, w.file, date)
      await $.fs.write(b, w.before)
      backups.push(b)
    } catch (err) {
      return say($, `Nothing changed: couldn't write a backup of ${w.file} (${errText(err)}).${backups.length ? ` Backups made: ${backups.join(', ')}` : ''}`)
    }
  }
  const written: string[] = []
  const failed: string[] = []
  for (const w of writes) {
    try {
      await $.fs.write(w.file, w.text)
      written.push(w.file)
    } catch (err) {
      failed.push(`${w.file} (${errText(err)})`)
    }
  }
  const rec: ApplyRecord = {
    at: await $.clock.now(),
    settingsFile: L.settingsPath,
    settings: written.includes(L.settingsPath) ? settingEdits : [],
    agents: agentEdits.filter(a => written.includes(a.file)),
    backups,
  }
  if (written.length > 0) await writeStack($, [...(await readStack($)), rec])

  const lines = [failed.length ? 'Apply partly failed.' : `Applied ${chosen.map(i => i.title).join('; ')}.`]
  for (const f of written) lines.push(`Changed ${f}`)
  for (const f of failed) lines.push(`Not written: ${f}`)
  if (backups.length) lines.push(`Backups: ${backups.join(', ')}`)
  if (written.length) lines.push('Press Undo to revert this Apply.')
  return say($, `${lines.join('\n')}${keptNote}`)
}

/**
 * Reverts the latest Apply: each key only where it still holds what Apply wrote, each agent file only where its
 * content is still what Apply wrote. Anything changed since is kept and listed. Other keys are never touched.
 */
async function undo($: EngineInterface): Promise<string> {
  const stack = await readStack($)
  const rec = stack.at(-1)
  if (rec === undefined) return say($, 'Nothing to undo.')
  const reverted: string[] = []
  const left: string[] = []
  const leftover: string[] = []
  const failed: string[] = []

  if (rec.settings.length > 0) {
    const raw = await readOrUndefined($, rec.settingsFile).catch(() => undefined)
    const p = parseSettings(raw, rec.settingsFile)
    if (p.error !== undefined || p.text === undefined) return say($, `Undo stopped: ${p.error ?? `${rec.settingsFile} is missing`}. Nothing was changed.`)
    let text = p.text
    for (const e of [...rec.settings].reverse()) {
      const name = e.path.join('.')
      const now = rawAt(text, e.path)
      if (!sameJson(now, e.after)) {
        left.push(now === undefined ? `${name} (removed since)` : `${name} (left as you changed it)`)
        continue
      }
      if (e.before !== undefined) {
        const r = setAt(text, e.path, e.before)
        if ('error' in r) {
          left.push(`${name} (${r.error})`)
          continue
        }
        text = r.text
      } else {
        text = removeAt(text, e.path)
        // Drop the objects this Apply created, if they are now empty.
        for (let len = e.path.length - 1; e.createdAt !== undefined && len >= e.createdAt; len--) {
          if (!isEmptyObject(text, e.path.slice(0, len))) break
          text = removeAt(text, e.path.slice(0, len))
        }
      }
      reverted.push(name)
    }
    if (text !== p.text) {
      try {
        await $.fs.write(rec.settingsFile, p.bom + text)
      } catch (err) {
        return say($, `Undo stopped: couldn't write ${rec.settingsFile} (${errText(err)}). Nothing was changed; backups: ${rec.backups.join(', ') || 'none'}.`)
      }
    }
  }

  for (const a of rec.agents) {
    const now = await readOrUndefined($, a.file).catch(() => undefined)
    if (now === undefined || lf(now) !== lf(a.after)) {
      left.push(`${a.file} (${now === undefined ? 'removed since' : 'left as you changed it'})`)
      continue
    }
    if (a.before === undefined) {
      leftover.push(a.file)
      continue
    }
    try {
      await $.fs.write(a.file, a.before)
      reverted.push(a.file)
    } catch (err) {
      failed.push(`${a.file} (${errText(err)})`)
    }
  }

  await writeStack($, stack.slice(0, -1))
  const lines = [`Undone. Reverted: ${reverted.join(', ') || 'nothing'}.`]
  if (left.length) lines.push(`Kept: ${left.join('; ')}.`)
  if (leftover.length) lines.push(`Apply created these; delete them to finish: ${leftover.join(', ')}`)
  if (failed.length) lines.push(`Couldn't restore: ${failed.join('; ')}. Backups: ${rec.backups.join(', ') || 'none'}.`)
  const more = stack.length - 1
  if (more > 0) lines.push(`Undo again to revert the Apply before (${more} left).`)
  return say($, lines.join('\n'))
}

async function press($: EngineInterface, run: () => Promise<string>) {
  try {
    await run()
  } catch (err) {
    await say($, `Something failed: ${errText(err)}. Backups are kept next to each file.`)
  }
}

async function toggle($: EngineInterface, key: string) {
  await update($, ticks, t => (t.includes(key) ? t.filter(k => k !== key) : [...t, key]))
}

async function choose($: EngineInterface, model: string) {
  await update($, pick, () => model)
}

export const register: Register = (on, options) => {
  const opts = options as Options

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'ystack-setup', description: 'Recommended Claude Code settings: tick, Apply, Undo. "/ystack-setup check" prints a report' })
    return next(e)
  })

  on('command.run', { command: 'ystack-setup' }, async ($, e) => {
    if (e.args.trim() === 'check') return { text: await report($, opts) }
    const n = (await readStack($)).length
    await update($, undoable, () => n)
    await $.ui.open({ id: PANE, title: 'ystack setup' })
    return { text: 'Setup pane opened. Tick what you want, then press Apply. Nothing changes before that.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const L = await load($, opts)
    const ticked = await read($, ticks)
    const picked = effectivePick(L.ctx, await read($, pick))
    const current = get(L.ctx.settings, ['env', 'CLAUDE_CODE_SUBAGENT_MODEL'])
    const canUndo = (await read($, undoable)) > 0 || (await readStack($)).length > 0
    const msg = await read($, message)
    return (
      <Box flexDirection="column">
        <Text dimColor>Tick the settings you want, then press Apply. Each file is backed up first; Undo reverts only what Apply set.</Text>
        <Text dimColor>Restart Claude Code or run /reload-plugins to apply. Undo stays available after a restart.</Text>
        {L.error !== undefined && <Text color="red">{`Can't read settings: ${L.error}. Apply will refuse until it parses.`}</Text>}
        {ITEMS.map(item => {
          const s = item.status(L.ctx)
          const isOn = ticked.includes(item.id)
          return (
            <Box flexDirection="column" key={`item-${item.id}`} marginTop={1}>
              {item.kind === 'apply' && s.state !== 'info' ? (
                <Button key={`tick-${item.id}`} label={`[${isOn ? 'x' : ' '}] ${item.title}`} onPress={() => toggle($, item.id)} />
              ) : (
                <Text bold>{item.title}</Text>
              )}
              <Text dimColor>{`    Changes: ${item.what(L.ctx)}`}</Text>
              <Text dimColor>{`    Why: ${item.why}`}</Text>
              {item.gain !== undefined && <Text dimColor>{`    ${item.gain}`}</Text>}
              <Text>{`    Now: ${s.note}`}</Text>
              {item.id === 'subagent-model' && (
                <Box flexDirection="row">
                  {current !== undefined && (
                    <Button key={`pick-${KEEP}`} label={`(${picked === KEEP ? '*' : ' '}) keep current (${String(current)})`} onPress={() => choose($, KEEP)} />
                  )}
                  {SUBAGENT_MODELS.filter(m => m !== current).map(m => (
                    <Button key={`pick-${m}`} label={`(${picked === m ? '*' : ' '}) ${m}`} onPress={() => choose($, m)} />
                  ))}
                </Box>
              )}
              {(item.details?.(L.ctx) ?? []).map((d, i) => (
                <Text key={`d-${item.id}-${i}`} dimColor>{`    ${d}`}</Text>
              ))}
              {item.id === 'agents' &&
                Object.keys(AGENTS)
                  .filter(n => agentState(L.ctx, n) === 'differs')
                  .map(n => (
                    <Button key={`replace-${n}`} label={`[${ticked.includes(`replace:${n}`) ? 'x' : ' '}] replace ${n}.md`} onPress={() => toggle($, `replace:${n}`)} />
                  ))}
            </Box>
          )
        })}
        <Box flexDirection="row" marginTop={1}>
          <Button key="apply" label="Apply" onPress={() => press($, () => apply($, opts))} />
          {canUndo && <Button key="undo" label="Undo" onPress={() => press($, () => undo($))} />}
        </Box>
        {msg !== '' && <Text>{msg}</Text>}
      </Box>
    )
  })
}
