// Finds saved keys in text, in the forms they commonly leak in (raw, base64, URL-encoded, hex, JSON-escaped,
// wrapped over several lines), and puts `{{vault:NAME}}` in their place. Pure: tests drive it directly.

import { placeholder } from './placeholders.ts'

export type Secret = { name: string; value: string }
type Needle = { name: string; text: string; flat: string }

/** Below this, a form is too short to search for without hitting ordinary text. */
const MIN_FORM = 8

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s)
}

function b64(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

/**
 * The stretch of base64 that encodes `bytes` whatever sits before and after them: for each of the three
 * byte alignments, the characters that depend on the value's bits alone.
 */
function base64Forms(bytes: Uint8Array): string[] {
  const out: string[] = []
  for (const shift of [0, 1, 2]) {
    const padded = new Uint8Array(shift + bytes.length)
    padded.set(bytes, shift)
    const enc = b64(padded).replace(/=+$/, '')
    const start = shift === 0 ? 0 : shift === 1 ? 2 : 3
    const end = Math.floor(((shift + bytes.length) * 8) / 6)
    const stable = enc.slice(start, end)
    if (stable.length >= MIN_FORM) out.push(stable, stable.replace(/\+/g, '-').replace(/\//g, '_'))
  }
  return out
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('')
}

/** Every form of one secret worth searching for, longest first. */
export function formsOf(value: string): string[] {
  const bytes = utf8(value)
  const forms = new Set<string>([value])
  const json = JSON.stringify(value).slice(1, -1)
  forms.add(json)
  const url = encodeURIComponent(value)
  forms.add(url)
  forms.add(url.replace(/%[0-9A-F]{2}/g, h => h.toLowerCase()))
  forms.add(url.replace(/%20/g, '+'))
  if (bytes.length * 2 >= MIN_FORM) {
    forms.add(hex(bytes))
    forms.add(hex(bytes).toUpperCase())
  }
  // The whole encoding, padding included, of the value alone or with the newline `echo` adds: so
  // `printf %s KEY | base64` leaves no tail behind.
  for (const tail of ['', '\n', '\r\n']) {
    const whole = b64(utf8(value + tail))
    if (bytes.length >= 6) forms.add(whole).add(whole.replace(/\+/g, '-').replace(/\//g, '_'))
  }
  for (const f of base64Forms(bytes)) forms.add(f)
  return [...forms].filter(f => f.length > 0 && (f === value || f.length >= MIN_FORM)).sort((a, b) => b.length - a.length)
}

const flatten = (s: string) => s.replace(/[\r\n]/g, '')

const needleCache = new WeakMap<readonly Secret[], Needle[]>()

function needles(secrets: readonly Secret[]): Needle[] {
  const hit = needleCache.get(secrets)
  if (hit) return hit
  const built = secrets
    .filter(s => s.value.length > 0)
    .flatMap(s => formsOf(s.value).map(text => ({ name: s.name, text, flat: flatten(text) })))
    .sort((a, b) => b.text.length - a.text.length)
  needleCache.set(secrets, built)
  return built
}

export type ScrubResult = { text: string; names: string[] }

/** Replaces every form of every secret in `text`, including ones a line break splits. */
export function scrubText(text: string, secrets: readonly Secret[]): ScrubResult {
  if (secrets.length === 0 || text.length === 0) return { text, names: [] }
  const all = needles(secrets)
  const names = new Set<string>()

  // Exact forms first.
  let out = text
  for (const nd of all) {
    if (nd.text.length === 0 || !out.includes(nd.text)) continue
    out = out.split(nd.text).join(placeholder(nd.name))
    names.add(nd.name)
  }

  // Then forms broken over lines (wrapped base64 or hex, a terminal's wrap): search with line breaks removed.
  if (/[\r\n]/.test(out)) {
    const map: number[] = []
    let flat = ''
    for (let i = 0; i < out.length; i++) {
      const ch = out[i] as string
      if (ch === '\r' || ch === '\n') continue
      map.push(i)
      flat += ch
    }
    const spans: { start: number; end: number; name: string }[] = []
    for (const nd of all) {
      if (nd.flat.length < MIN_FORM) continue
      let from = 0
      for (;;) {
        const at = flat.indexOf(nd.flat, from)
        if (at < 0) break
        const start = map[at] as number
        const end = (map[at + nd.flat.length - 1] as number) + 1
        if (!spans.some(s => start < s.end && end > s.start)) spans.push({ start, end, name: nd.name })
        from = at + nd.flat.length
      }
    }
    if (spans.length > 0) {
      spans.sort((a, b) => b.start - a.start)
      for (const s of spans) {
        out = out.slice(0, s.start) + placeholder(s.name) + out.slice(s.end)
        names.add(s.name)
      }
    }
  }
  return { text: out, names: [...names] }
}

/** The first secret any form of which appears in `text`. */
export function findSecret(text: string, secrets: readonly Secret[]): string | undefined {
  return scrubText(text, secrets).names[0]
}

/**
 * Scrubs every string inside a JSON-like value; answers the same object when nothing changed. Throws on a
 * value nested past 64 levels rather than handing it back unchecked: callers hide what they could not check.
 */
export function scrubDeep<T>(value: T, secrets: readonly Secret[], depth = 0): { value: T; names: string[] } {
  if (secrets.length === 0) return { value, names: [] }
  if (depth > 64) throw new Error('vault: nested too deeply to check for saved keys')
  if (typeof value === 'string') {
    const r = scrubText(value, secrets)
    return { value: r.text as T, names: r.names }
  }
  if (Array.isArray(value)) {
    const names = new Set<string>()
    let changed = false
    const next = value.map(item => {
      const r = scrubDeep(item, secrets, depth + 1)
      if (r.value !== item) changed = true
      r.names.forEach(n => names.add(n))
      return r.value
    })
    return { value: (changed ? next : value) as T, names: [...names] }
  }
  if (value !== null && typeof value === 'object') {
    const names = new Set<string>()
    let changed = false
    const next: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const r = scrubDeep(v, secrets, depth + 1)
      if (r.value !== v) changed = true
      r.names.forEach(n => names.add(n))
      next[k] = r.value
    }
    return { value: (changed ? next : value) as T, names: [...names] }
  }
  return { value, names: [] }
}
