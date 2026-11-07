// Pure logic for twins: which pair a path belongs to, the twin path on the other side, and the "behind" markers.

export type Pair = { name: string; a: string; b: string; note?: string; aLabel?: string; bLabel?: string }
export type Side = 'a' | 'b'
export type Hit = { pair: Pair; side: Side; item: string; sub: string }
/** One marker per pair and item: which side is behind, and the files changed on the other side. */
export type Marker = { pair: string; item: string; behind: Side; files: string[]; at: number }
export type Markers = Record<string, Marker>

export const norm = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '')
export const expandHome = (p: string, home: string): string => (/^~(\/|\\|$)/.test(p) ? `${norm(home)}${p.slice(1)}` : p)
const esc = (s: string): string => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')

/** Reads a twins file: `{ "pairs": [...] }` or a bare list. Pairs without one `*` on each side are dropped. */
export function parsePairs(text: string, home: string): Pair[] {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return []
  }
  const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' && Array.isArray((raw as { pairs?: unknown }).pairs) ? (raw as { pairs: unknown[] }).pairs : []
  const out: Pair[] = []
  for (const p of list) {
    if (!p || typeof p !== 'object') continue
    const r = p as Record<string, unknown>
    const name = typeof r.name === 'string' ? r.name.trim() : ''
    const a = typeof r.a === 'string' ? norm(expandHome(r.a.trim(), home)) : ''
    const b = typeof r.b === 'string' ? norm(expandHome(r.b.trim(), home)) : ''
    if (!name || a.split('*').length !== 2 || b.split('*').length !== 2) continue
    const pair: Pair = { name, a, b }
    if (typeof r.note === 'string' && r.note.trim()) pair.note = r.note.trim()
    if (typeof r.aLabel === 'string' && r.aLabel.trim()) pair.aLabel = r.aLabel.trim()
    if (typeof r.bLabel === 'string' && r.bLabel.trim()) pair.bLabel = r.bLabel.trim()
    out.push(pair)
  }
  return out
}

function patternRe(pattern: string): RegExp {
  const [pre = '', post = ''] = pattern.split('*')
  return new RegExp(`^${esc(pre)}([^/]+)${esc(post)}(/.*)?$`, 'i')
}

/** Which side of which pair a file is on, or undefined. The first matching pair wins. */
export function locate(pairs: readonly Pair[], file: string): Hit | undefined {
  const f = norm(file)
  for (const pair of pairs) {
    for (const side of ['a', 'b'] as const) {
      const m = f.match(patternRe(pair[side]))
      if (m?.[1]) return { pair, side, item: m[1], sub: (m[2] ?? '').replace(/^\//, '') }
    }
  }
  return undefined
}

/** The folder (or file) of an item on one side: the pattern with `*` filled in. */
export const rootOf = (pair: Pair, side: Side, item: string): string => pair[side].replace('*', item)
export const other = (s: Side): Side => (s === 'a' ? 'b' : 'a')
export const keyOf = (pair: string, item: string): string => `${pair}/${item}`

/** A short name for a side: its label, else the first path segment where the two sides differ. */
export function labelOf(pair: Pair, side: Side): string {
  const own = side === 'a' ? pair.aLabel : pair.bLabel
  if (own) return own
  const x = pair[side].split('/')
  const y = pair[other(side)].split('/')
  for (let i = 0; i < x.length; i++) if ((x[i] ?? '').toLowerCase() !== (y[i] ?? '').toLowerCase() && x[i] !== '*') return (x[i] ?? side).replace(/^\./, '')
  return side
}

/**
 * Folds one successful edit into the markers. An edit on the side that was behind takes that file off
 * the list (it is being synced); the marker goes once its list is empty, and an edit there to a file the
 * other side never changed leaves it be. Any other edit marks the far side behind.
 */
export function applyEdit(markers: Markers, hit: Hit, now: number): Markers {
  const key = keyOf(hit.pair.name, hit.item)
  const cur = markers[key]
  const file = hit.sub || '(whole item)'
  if (cur && cur.behind === hit.side) {
    const files = cur.files.filter(f => f.toLowerCase() !== file.toLowerCase())
    const out = { ...markers }
    if (files.length === cur.files.length) return markers // a file the other side never changed
    if (files.length === 0) delete out[key]
    else out[key] = { ...cur, files, at: now }
    return out
  }
  const files = cur ? [...new Set([...cur.files, file])] : [file]
  return { ...markers, [key]: { pair: hit.pair.name, item: hit.item, behind: other(hit.side), files: files.slice(-200), at: now } }
}

/** Finds markers by `name`: an item ("verify"), or "pair/item". */
export function findMarkers(markers: Markers, name: string): Marker[] {
  const n = name.trim().toLowerCase()
  if (!n) return []
  return Object.entries(markers)
    .filter(([k, m]) => k.toLowerCase() === n || m.item.toLowerCase() === n || m.pair.toLowerCase() === n)
    .map(([, m]) => m)
}

export function bandText(markers: Markers, pairs: readonly Pair[]): string | undefined {
  const list = Object.values(markers).sort((x, y) => y.at - x.at)
  if (list.length === 0) return undefined
  const first = list[0]
  if (!first) return undefined
  const pair = pairs.find(p => p.name === first.pair)
  const side = pair ? labelOf(pair, first.behind) : first.behind
  const n = first.files.length
  const more = list.length > 1 ? ` (+${list.length - 1} more)` : ''
  return `twins: the ${side} copy of ${first.item} is behind (${n} file${n === 1 ? '' : 's'})${more} · /twins`
}

/** Summarises `git diff --numstat` lines as "+12 -3". */
export function numstat(out: string): string {
  let add = 0
  let del = 0
  for (const line of out.split(/\r?\n/)) {
    const m = line.match(/^(\d+|-)\s+(\d+|-)\s/)
    if (!m) continue
    add += m[1] === '-' ? 0 : Number(m[1])
    del += m[2] === '-' ? 0 : Number(m[2])
  }
  return `+${add} -${del}`
}

/** The instruction Claude gets only when the owner runs /twins sync. */
export function syncContext(m: Marker, pair: Pair, diffs: string): string {
  const from = other(m.behind)
  return [
    `twins sync requested by the owner: port the recent change in "${m.item}" from the ${labelOf(pair, from)} copy to the ${labelOf(pair, m.behind)} copy.`,
    `From: ${rootOf(pair, from, m.item)}`,
    `To:   ${rootOf(pair, m.behind, m.item)}`,
    `Changed files (relative to the item): ${m.files.join(', ')}`,
    pair.note ? `Rule for this pair: ${pair.note}` : '',
    'Port only this change; keep intentional differences between the copies. Show the owner what you changed, then tell them to run /twins done ' + m.item + ' once they are happy.',
    diffs ? `Current differences (from -> to):\n${diffs}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}
