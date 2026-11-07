import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { PaneRow, TwinsPane } from '../types'
import {
  type Marker,
  type Markers,
  type Pair,
  applyEdit,
  bandText,
  findMarkers,
  labelOf,
  locate,
  norm,
  numstat,
  other,
  parsePairs,
  rootOf,
  syncContext,
} from './twins.ts'

// twins reports to the owner only: no notes to Claude, no edits, no model calls. /twins sync is the one
// place Claude hears about a pair, and only because the owner ran it.

const PANE = 'twins'
const STORE_KEY = 'markers'
const MAX_DIFF_CHARS = 12_000

const marks = atom({ plugin: 'twins', key: 'markers' } as const, {} as Markers, { shape: 'markers-1' })
const pane = atom({ plugin: 'twins', key: 'pane' } as const, { rows: [], at: 0 } as TwinsPane, { shape: 'pane-1' })

let twinsFile = '.claude/twins.json'
let pairs: Pair[] = []
let pairsAt = Number.NEGATIVE_INFINITY

async function home($: EngineInterface): Promise<string> {
  return norm((await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '')
}

async function loadPairs($: EngineInterface, force = false): Promise<Pair[]> {
  const now = await $.clock.now()
  if (!force && now - pairsAt < 30_000) return pairs
  const h = await home($)
  const root = norm(await $.session.root())
  const projectFile = /^([a-z]:)?\//i.test(twinsFile) ? twinsFile : `${root}/${twinsFile}`
  const out: Pair[] = []
  for (const f of [projectFile, `${h}/.claude/twins.json`]) {
    const text = await $.fs.read(f).catch(() => undefined)
    if (typeof text === 'string') for (const p of parsePairs(text, h)) if (!out.some(o => o.name === p.name)) out.push(p)
  }
  pairs = out
  pairsAt = now
  return out
}

async function storedMarkers($: EngineInterface): Promise<Markers> {
  const v = await $.store.get(STORE_KEY)
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Markers) : {}
}

async function saveMarkers($: EngineInterface, m: Markers) {
  await $.store.set(STORE_KEY, m)
  await update($, marks, () => m)
}

// One read-modify-write of the markers at a time: edits from parallel helpers land together, and each must see the
// last one's result, or a changed file drops off the list without anyone being told.
let markerQueue: Promise<unknown> = Promise.resolve()
function changeMarkers($: EngineInterface, change: (m: Markers) => Markers | Promise<Markers>): Promise<void> {
  const run = markerQueue.then(async () => {
    const cur = await storedMarkers($)
    const next = await change(cur)
    if (next !== cur) await saveMarkers($, next)
  })
  markerQueue = run.catch(() => undefined)
  return run
}

async function git($: EngineInterface, args: string[]): Promise<string | undefined> {
  // git diff --no-index exits 1 when the files differ: that is an answer, not a failure.
  const r = await $.process.run(['git', 'diff', '--no-index', ...args], { timeoutMs: 15_000 }).catch(() => undefined)
  if (!r || (r.exitCode !== 0 && r.exitCode !== 1)) return undefined
  return r.stdout
}

async function rowsFor($: EngineInterface, ps: readonly Pair[], ms: Markers): Promise<PaneRow[]> {
  const rows: PaneRow[] = []
  for (const p of ps) {
    const mine = Object.values(ms).filter(m => m.pair === p.name)
    if (mine.length === 0) {
      rows.push({ key: p.name, title: `${p.name}: ${labelOf(p, 'a')} and ${labelOf(p, 'b')}`, lines: ['No edits seen on one side only since the last sync.'] })
      continue
    }
    for (const m of mine) {
      const from = other(m.behind)
      const lines = [`Changed on the ${labelOf(p, from)} side; the ${labelOf(p, m.behind)} copy is behind.`]
      for (const f of m.files.slice(0, 15)) {
        const a = f === '(whole item)' ? rootOf(p, m.behind, m.item) : `${rootOf(p, m.behind, m.item)}/${f}`
        const b = f === '(whole item)' ? rootOf(p, from, m.item) : `${rootOf(p, from, m.item)}/${f}`
        const exists = (await $.fs.exists(a).catch(() => false)) === true
        const out = exists ? await git($, ['--numstat', '--', a, b]) : undefined
        lines.push(`  ${f}  ${!exists ? 'new on one side' : out === undefined ? 'could not compare' : out.trim() === '' ? 'now the same' : numstat(out)}`)
      }
      if (m.files.length > 15) lines.push(`  …and ${m.files.length - 15} more`)
      lines.push(`  /twins sync ${m.item} to have Claude port it, or /twins ignore ${m.item}`)
      rows.push({ key: `${p.name}/${m.item}`, title: `${m.item} (${p.name})`, lines })
    }
  }
  return rows
}

async function diffsFor($: EngineInterface, p: Pair, m: Marker): Promise<string> {
  const from = other(m.behind)
  let all = ''
  for (const f of m.files.slice(0, 20)) {
    const to = f === '(whole item)' ? rootOf(p, m.behind, m.item) : `${rootOf(p, m.behind, m.item)}/${f}`
    const src = f === '(whole item)' ? rootOf(p, from, m.item) : `${rootOf(p, from, m.item)}/${f}`
    const exists = (await $.fs.exists(to).catch(() => false)) === true
    const d = exists ? await git($, ['--', to, src]) : `(${f} does not exist on the behind side yet: create it from ${src})\n`
    all += d ?? `(could not diff ${f})\n`
    if (all.length > MAX_DIFF_CHARS) return `${all.slice(0, MAX_DIFF_CHARS)}\n…(cut; read the files for the rest)`
  }
  return all
}

export const register: Register = (on, options) => {
  if (typeof options.twinsFile === 'string' && options.twinsFile.trim()) twinsFile = norm(options.twinsFile.trim())

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'twins',
      description: 'Twin copies that drifted apart: list them, or `sync <name>` (Claude ports the change), `done <name>`, `ignore <name>`',
      argumentHint: '[sync|done|ignore <name>]',
    })
    await update($, marks, () => ({}))
    const kept = await storedMarkers($)
    await update($, marks, () => kept)
    await loadPairs($, true)
    return next(e)
  })

  // Event-driven: only a successful edit on one side marks the other side behind.
  on('tool.call', { tool: ['Edit', 'Write', 'NotebookEdit'] }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError === true) return ran
    const input = e as unknown as { file_path?: string; notebook_path?: string }
    const file = input.file_path ?? input.notebook_path
    if (!file) return ran
    const ps = await loadPairs($)
    if (ps.length === 0) return ran
    const hit = locate(ps, file)
    if (!hit) return ran
    // Only items that exist on both sides count.
    const far = rootOf(hit.pair, other(hit.side), hit.item)
    if ((await $.fs.exists(far).catch(() => false)) !== true) return ran
    const now = await $.clock.now()
    await changeMarkers($, m => applyEdit(m, hit, now))
    return ran
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'twins' }, async ($, e) => {
    const [verb = '', ...rest] = e.args.trim().split(/\s+/)
    const name = rest.join(' ')
    const ps = await loadPairs($, true)
    const ms = await storedMarkers($)

    if (verb === 'done' || verb === 'ignore') {
      const found = findMarkers(ms, name)
      if (found.length === 0) return { text: `twins: nothing marked behind for "${name}". /twins lists what is.` }
      await changeMarkers($, cur => {
        const out = { ...cur }
        for (const m of found) delete out[`${m.pair}/${m.item}`]
        return out
      })
      return { text: `twins: cleared ${found.map(m => m.item).join(', ')}${verb === 'ignore' ? ' without syncing' : ''}.` }
    }

    if (verb === 'sync') {
      const found = findMarkers(ms, name)
      const m = found[0]
      if (!m) return { text: `twins: nothing marked behind for "${name}". /twins lists what is.` }
      if (found.length > 1) return { text: `twins: "${name}" matches ${found.length} items; name one: ${found.map(f => `${f.pair}/${f.item}`).join(', ')}` }
      const p = ps.find(x => x.name === m.pair)
      if (!p) return { text: `twins: the pair "${m.pair}" is no longer in your twins file. /twins ignore ${m.item} clears it.` }
      const ctx = syncContext(m, p, await diffsFor($, p, m))
      // A command hook may not submit (it would wait on itself): queue the prompt from a timer, after the reply.
      const ask = `Sync the twin copies of ${m.item} as the twins note above says.`
      $.clock.after(0, () => void $.prompt.submit({ text: ask }).catch(() => undefined))
      return {
        text: `twins: asked Claude to port the ${labelOf(p, other(m.behind))} change in ${m.item} to the ${labelOf(p, m.behind)} copy (${m.files.length} file${m.files.length === 1 ? '' : 's'}). Run /twins done ${m.item} when you are happy with it.`,
        context: [ctx],
      }
    }

    if (verb !== '') return { text: 'twins: use /twins, /twins sync <name>, /twins done <name> or /twins ignore <name>.' }
    if (ps.length === 0) return { text: `twins: no pairs set. Add them to ~/.claude/twins.json or ${twinsFile} in the project, e.g. {"pairs":[{"name":"mods","a":"~/one/*","b":"~/two/*","note":"..."}]}` }
    await update($, pane, (): TwinsPane => ({ rows: [], at: -1 }))
    await $.ui.open({ id: PANE, title: 'Twins' })
    const rows = await rowsFor($, ps, ms)
    const at = await $.clock.now()
    await update($, pane, () => ({ rows, at }))
    const behind = Object.keys(ms).length
    return { text: behind === 0 ? `twins: ${ps.length} pair${ps.length === 1 ? '' : 's'}, all in step.` : `twins: ${behind} item${behind === 1 ? '' : 's'} behind (see the pane).` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const v = await read($, pane)
    if (v.at === -1) return <Text dimColor>Comparing the copies…</Text>
    if (v.rows.length === 0) return <Text dimColor>Run /twins to compare the copies.</Text>
    return (
      <Box flexDirection="column">
        {v.rows.map(r => (
          <Box flexDirection="column" key={r.key}>
            <Text bold>{r.title}</Text>
            {r.lines.map(l => (
              <Text>{l}</Text>
            ))}
          </Box>
        ))}
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const m = await read($, marks)
    const text = bandText(m, pairs)
    if (e.props.hasSurvey || !text) return next(e)
    const below = await next(e)
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {below}
        <Text dimColor>{text}</Text>
      </Box>
    )
  }).catch(($, e, next) => next(e))
}
