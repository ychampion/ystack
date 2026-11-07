import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { VoiceView } from '../types'
import { type Doc, buildNote, featureVerdict, findQuotes, isConcrete, isOptOut, resolveDir, sharpenerFires } from './voice.ts'

const MAX_FILES = 500
const MAX_BYTES = 300_000
const NOTE_FILE = /\.(md|markdown|txt)$/i

const last = atom({ plugin: 'user-voice', key: 'last' } as const, { request: '', quotes: [], isFeature: false, hasDir: false, at: 0 } as VoiceView, { shape: 'last-1' })

let evidenceDir = 'feedback'
let maxQuotes = 3
let proposeFirst = true

// Notes are read once and kept until their file changes.
const cache = new Map<string, { mtime: number; text: string }>()

async function loadDocs($: EngineInterface, dir: string): Promise<Doc[]> {
  const docs: Doc[] = []
  const walk = async (path: string, depth: number) => {
    if (depth > 4 || docs.length >= MAX_FILES) return
    for (const f of await $.fs.list(path).catch(() => [])) {
      if (docs.length >= MAX_FILES) return
      if (f.name.startsWith('.')) continue
      const full = `${path}/${f.name}`
      if (f.kind === 'dir') await walk(full, depth + 1)
      else if (f.kind === 'file' && NOTE_FILE.test(f.name) && f.size <= MAX_BYTES) {
        const hit = cache.get(full)
        if (hit && hit.mtime === f.mtimeMs) {
          docs.push({ path: full, text: hit.text })
          continue
        }
        const text = await $.fs.read(full).catch(() => undefined)
        if (typeof text !== 'string') continue
        cache.set(full, { mtime: f.mtimeMs, text })
        docs.push({ path: full, text })
      }
    }
  }
  await walk(dir, 0)
  return docs
}

async function isFeatureRequest($: EngineInterface, text: string): Promise<boolean> {
  const v = featureVerdict(text)
  if (v !== 'maybe') return v === 'yes'
  // Only an unclear prompt costs one small call, capped at a few seconds.
  const r = await $.model
    .complete({
      model: 'haiku',
      prompt: `Is this message asking to add or change a product feature, page or user-facing behaviour? Answer yes or no only.\n\nMessage: ${text.slice(0, 1200)}`,
      maxTokens: 3,
      timeoutMs: 4000,
    })
    .catch(() => undefined)
  return r?.isAnswered === true && /^\s*yes/i.test(r.text)
}

async function evidenceRoot($: EngineInterface): Promise<string> {
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? ''
  return resolveDir(evidenceDir, await $.session.root(), home)
}

export const register: Register = (on, options) => {
  if (typeof options.evidenceDir === 'string' && options.evidenceDir.trim()) evidenceDir = options.evidenceDir.trim()
  if (typeof options.maxQuotes === 'number' && options.maxQuotes >= 0) maxQuotes = Math.min(10, Math.floor(options.maxQuotes))
  proposeFirst = options.proposeFirst !== false

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'user-voice', description: 'user-voice: the user notes matched to your last feature request' })
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    const isPerson = e.origin.kind === 'composer' || e.origin.kind === 'bridge'
    if (!isPerson || e.command !== undefined || e.isMeta) return next(e)
    if (!(await isFeatureRequest($, e.text))) {
      if ((await read($, last)).isFeature) await update($, last, v => ({ ...v, isFeature: false }))
      return next(e)
    }
    const dir = await evidenceRoot($)
    const hasDir = (await $.fs.exists(dir).catch(() => false)) === true
    const quotes = hasDir ? findQuotes(e.text, await loadDocs($, dir), maxQuotes) : []
    // "just do it", "no questions", "go ahead": the owner has opted out of a question round, so it is built as asked.
    const isBuildAsAsked = isConcrete(e.text) || isOptOut(e.text)
    const note = buildNote({ quotes, proposeFirst, isConcrete: isBuildAsAsked, sharpenerFires: sharpenerFires(e.text), hasEvidenceDir: hasDir })
    const at = await $.clock.now()
    await update($, last, () => ({ request: e.text.slice(0, 300), quotes: quotes.map(q => ({ path: q.path, text: q.text })), isFeature: true, hasDir, at }))
    return next({ ...e, context: [...(e.context ?? []), note] })
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'user-voice' }, async $ => {
    const v = await read($, last)
    const dir = await evidenceRoot($)
    if (v.at === 0) return { text: `user-voice: no feature request yet this session. Notes folder: ${dir}` }
    if (!v.hasDir) return { text: `user-voice: the notes folder ${dir} does not exist, so nothing was matched. Set evidenceDir in /config.` }
    if (v.quotes.length === 0) return { text: `user-voice: no user note mentions "${v.request.slice(0, 80)}" yet (searched ${dir}).` }
    return { text: [`user-voice: notes matched to "${v.request.slice(0, 80)}":`, ...v.quotes.map(q => `- "${q.text}"\n  ${q.path}`)].join('\n') }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const v = await read($, last)
    if (e.props.hasSurvey || !v.isFeature || !v.hasDir || v.quotes.length > 0) return next(e)
    const below = await next(e)
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {below}
        <Text dimColor>user-voice: No user note mentions this yet</Text>
      </Box>
    )
  }).catch(($, e, next) => next(e))
}
