// Edits a JSON file's text in place: only the value being set changes. Every other byte stays as it was:
// key order, numbers too large for a double, spacing. The text must already pass JSON.parse.

type Node = { kind: 'object'; start: number; end: number; members: Member[] } | { kind: 'other'; start: number; end: number }
type Member = { key: string; keyStart: number; value: Node }

function parseAt(text: string, i0: number): { node: Node; next: number } {
  let i = i0
  const ws = () => {
    while (i < text.length && /\s/.test(text[i]!)) i++
  }
  const str = () => {
    const s = i
    i++
    while (i < text.length && text[i] !== '"') i += text[i] === '\\' ? 2 : 1
    i++
    return { s, raw: text.slice(s, i) }
  }
  const value = (): Node => {
    ws()
    const start = i
    const c = text[i]
    if (c === '{') {
      i++
      const members: Member[] = []
      ws()
      if (text[i] === '}') {
        i++
        return { kind: 'object', start, end: i, members }
      }
      for (;;) {
        ws()
        const k = str()
        ws()
        i++ // :
        const v = value()
        members.push({ key: JSON.parse(k.raw) as string, keyStart: k.s, value: v })
        ws()
        if (text[i++] === '}') return { kind: 'object', start, end: i, members }
      }
    }
    if (c === '[') {
      i++
      ws()
      if (text[i] === ']') {
        i++
        return { kind: 'other', start, end: i }
      }
      for (;;) {
        value()
        ws()
        if (text[i++] === ']') return { kind: 'other', start, end: i }
      }
    }
    if (c === '"') {
      str()
      return { kind: 'other', start, end: i }
    }
    const m = /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/y
    m.lastIndex = i
    const hit = m.exec(text)
    if (hit === null) throw new Error(`unexpected character at ${i}`)
    i += hit[0].length
    return { kind: 'other', start, end: i }
  }
  const node = value()
  return { node, next: i }
}

const parse = (text: string): Node => parseAt(text, 0).node

const member = (n: Node, key: string): Member | undefined => (n.kind === 'object' ? n.members.filter(m => m.key === key).at(-1) : undefined)

/** The node at `path`, its parent object and its member. */
function locate(text: string, path: string[]) {
  let node: Node = parse(text)
  let parent: Node | undefined
  let mem: Member | undefined
  for (const k of path) {
    const m = member(node, k)
    if (m === undefined) return undefined
    parent = node
    mem = m
    node = m.value
  }
  return { node, parent, mem }
}

/** The raw text of the value at `path`, or undefined when absent. */
export const rawAt = (text: string, path: string[]): string | undefined => {
  const at = locate(text, path)
  return at === undefined ? undefined : text.slice(at.node.start, at.node.end)
}

/** Two JSON values written differently but equal (whitespace aside). */
export const sameJson = (a: string | undefined, b: string | undefined): boolean => {
  if (a === undefined || b === undefined) return a === b
  try {
    return JSON.stringify(JSON.parse(a)) === JSON.stringify(JSON.parse(b))
  } catch {
    return false
  }
}

const lineIndent = (text: string, pos: number): string => /^[ \t]*/.exec(text.slice(text.lastIndexOf('\n', pos - 1) + 1))?.[0] ?? ''
const style = (text: string) => ({ unit: /\n([ \t]+)"/.exec(text)?.[1] ?? '  ', eol: text.includes('\r\n') ? '\r\n' : '\n' })

export type SetResult =
  | { text: string; before?: string; createdAt?: number }
  | { error: string }

/**
 * Sets the value at `path` to `valueJson` (a JSON text). `before` is the raw text it replaced; `createdAt`, when the
 * key was missing, is the length of the shortest path prefix this call created.
 */
export function setAt(text: string, path: string[], valueJson: string): SetResult {
  const { unit, eol } = style(text)
  let node: Node = parse(text)
  let depth = 0
  for (; depth < path.length; depth++) {
    const m = member(node, path[depth]!)
    if (m === undefined) break
    node = m.value
  }
  if (depth === path.length) {
    return { text: text.slice(0, node.start) + valueJson + text.slice(node.end), before: text.slice(node.start, node.end) }
  }
  if (node.kind !== 'object') return { error: `${path.slice(0, depth).join('.')} is not an object` }
  const rest = path.slice(depth + 1)
  let nested: unknown = JSON.parse(valueJson)
  for (const k of [...rest].reverse()) nested = { [k]: nested }
  const key = JSON.stringify(path[depth])
  let insert: string
  let from: number
  let to: number
  if (node.members.length === 0) {
    const ind = lineIndent(text, node.start)
    const v = JSON.stringify(nested, null, unit).replace(/\n/g, eol + ind + unit)
    insert = `{${eol}${ind}${unit}${key}: ${v}${eol}${ind}}`
    from = node.start
    to = node.end
  } else {
    const first = node.members[0]!
    const last = node.members[node.members.length - 1]!
    const gap = text.slice(node.start + 1, first.keyStart)
    if (gap.includes('\n')) {
      const ind = gap.slice(gap.lastIndexOf('\n') + 1)
      insert = `,${eol}${ind}${key}: ${JSON.stringify(nested, null, unit).replace(/\n/g, eol + ind)}`
    } else insert = `, ${key}: ${JSON.stringify(nested)}`
    from = last.value.end
    to = last.value.end
  }
  return { text: text.slice(0, from) + insert + text.slice(to), createdAt: depth + 1 }
}

/** Removes the member at `path` (and its comma); unchanged text when absent. */
export function removeAt(text: string, path: string[]): string {
  const at = locate(text, path)
  if (at === undefined || at.parent === undefined || at.parent.kind !== 'object' || at.mem === undefined) return text
  const ms = at.parent.members
  const idx = ms.indexOf(at.mem)
  if (ms.length === 1) return `${text.slice(0, at.parent.start)}{}${text.slice(at.parent.end)}`
  if (idx === ms.length - 1) return text.slice(0, ms[idx - 1]!.value.end) + text.slice(at.mem.value.end)
  return text.slice(0, at.mem.keyStart) + text.slice(ms[idx + 1]!.keyStart)
}

/** True when the value at `path` is an object with no keys. */
export const isEmptyObject = (text: string, path: string[]): boolean => {
  const at = locate(text, path)
  return at !== undefined && at.node.kind === 'object' && at.node.members.length === 0
}
