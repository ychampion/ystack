import type { EngineInterface, Register } from 'claude-code'

import { type Entry, type Index, buildIndex, focus, match, parseNote } from './index.ts'

let index: Index | undefined
let building: Promise<Index> | undefined
const told = new Set<string>()

async function home($: EngineInterface): Promise<string> {
  return ((await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '').replace(/\\/g, '/')
}

async function load($: EngineInterface): Promise<Index> {
  const h = await home($)
  const entries: Entry[] = []
  const projects = await $.fs.list(`${h}/.claude/projects`).catch(() => [])
  for (const p of projects) {
    if (p.kind !== 'dir') continue
    const dir = `${h}/.claude/projects/${p.name}/memory`
    const notes = await $.fs.list(dir).catch(() => [])
    for (const f of notes) {
      if (f.kind !== 'file' || !f.name.endsWith('.md') || f.name === 'MEMORY.md') continue
      const text = await $.fs.read(`${dir}/${f.name}`).catch(() => undefined)
      const e = typeof text === 'string' ? parseNote(`${dir}/${f.name}`, text, false) : undefined
      if (e) entries.push(e)
      if (entries.length > 3000) break
    }
  }
  const skills = await $.fs.list(`${h}/.claude/skills`).catch(() => [])
  for (const s of skills) {
    if (s.kind !== 'dir' && !s.isLink) continue
    const path = `${h}/.claude/skills/${s.name}/SKILL.md`
    const text = await $.fs.read(path).catch(() => undefined)
    const e = typeof text === 'string' ? parseNote(path, text.slice(0, 4000), true) : undefined
    if (e) entries.push({ ...e, name: `skill ${e.name}` })
  }
  return buildIndex(entries)
}

const ready = ($: EngineInterface) => (index ? Promise.resolve(index) : (building ??= load($).then(i => (index = i))))

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    void ready($) // build in the background; the first error waits for it at most once
    return started
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (ran.isError !== true || typeof ran.text !== 'string' || ran.text.length < 12) return ran
    const idx = await ready($)
    // The error itself, not the command: a long command's paths and cmdlet names matched generic notes (seen live).
    const hits = match(idx, focus(ran.text)).filter(m => !told.has(m.entry.path))
    if (hits.length === 0) return ran
    for (const h of hits) told.add(h.entry.path)
    const lines = hits.map(h => `- ${h.entry.name}: ${h.entry.description} (${h.entry.path})`)
    return {
      ...ran,
      context: [
        ...(ran.context ?? []),
        `memory-recall: this error resembles something already learned. Read the note if it fits; ignore it if it does not.\n${lines.join('\n')}`,
      ],
    }
  })
}
