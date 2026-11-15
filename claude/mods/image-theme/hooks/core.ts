// Pure logic for image-theme: read a tiny bitmap swatch of the picture, find its palette, and turn that into the inputs
// of makeColors and the veil baked into the background. No engine calls, so it is all testable on its own.

export type Rgb = { r: number; g: number; b: number }
export type Hsl = { h: number; s: number; l: number }

/** What the picture comes to: its base hue and saturation, its brightness, and an accent when it has a colour of note. */
export type Palette = {
  /** 0-360, the hue its surfaces are tinted with. */
  hue: number
  /** 0-1, how much of that hue the surfaces carry (kept low). */
  tint: number
  /** 0-1, the picture's mean lightness (relative luminance). */
  luminance: number
  /** The picture's strongest colour, or undefined for a picture with none (black and white, grey). */
  accent?: string
  mode: 'light' | 'dark'
}

/** Pixels from a Windows bitmap (24- or 32-bit, uncompressed or bitfields), top row first. */
export function readBmp(bytes: Uint8Array): Rgb[] {
  const u16 = (o: number) => bytes[o]! | (bytes[o + 1]! << 8)
  const i32 = (o: number) => bytes[o]! | (bytes[o + 1]! << 8) | (bytes[o + 2]! << 16) | (bytes[o + 3]! << 24)
  if (bytes.length < 54 || bytes[0] !== 0x42 || bytes[1] !== 0x4d) throw new Error('not a bitmap')
  const offset = i32(10)
  const width = i32(18)
  const rawHeight = i32(22)
  const bpp = u16(28)
  const compression = i32(30)
  if ((bpp !== 24 && bpp !== 32) || (compression !== 0 && compression !== 3) || width <= 0 || width > 512 || rawHeight === 0) {
    throw new Error(`unsupported bitmap (${bpp} bits, compression ${compression})`)
  }
  const height = Math.abs(rawHeight)
  const topDown = rawHeight < 0
  const step = bpp / 8
  const stride = Math.ceil((width * step) / 4) * 4
  const out: Rgb[] = []
  for (let row = 0; row < height; row++) {
    const y = topDown ? row : height - 1 - row
    for (let x = 0; x < width; x++) {
      const o = offset + y * stride + x * step
      if (o + 2 >= bytes.length) throw new Error('bitmap is cut short')
      out.push({ b: bytes[o]!, g: bytes[o + 1]!, r: bytes[o + 2]! })
    }
  }
  return out
}

export function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function toHsl({ r, g, b }: Rgb): Hsl {
  const R = r / 255
  const G = g / 255
  const B = b / 255
  const max = Math.max(R, G, B)
  const min = Math.min(R, G, B)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === R ? ((G - B) / d + (G < B ? 6 : 0)) * 60 : max === G ? ((B - R) / d + 2) * 60 : ((R - G) / d + 4) * 60
  return { h, s, l }
}

export function hslHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    return Math.round(Math.max(0, Math.min(1, c)) * 255)
      .toString(16)
      .padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`
}

const lum = ({ r, g, b }: Rgb) => {
  const ch = (v: number) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b)
}

/** A hue average that respects the wheel (350 and 10 average to 0, not 180), weighted. */
function meanHue(items: Array<{ h: number; w: number }>): { h: number; strength: number } {
  let x = 0
  let y = 0
  let total = 0
  for (const { h, w } of items) {
    x += Math.cos((h * Math.PI) / 180) * w
    y += Math.sin((h * Math.PI) / 180) * w
    total += w
  }
  if (total === 0) return { h: 0, strength: 0 }
  const h = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
  return { h, strength: Math.hypot(x, y) / total }
}

export function paletteOf(pixels: readonly Rgb[]): Palette {
  if (pixels.length === 0) throw new Error('no pixels')
  const hsl = pixels.map(toHsl)
  const luminance = pixels.reduce((a, p) => a + lum(p), 0) / pixels.length
  // Base hue: every pixel, weighted by how coloured it is.
  const base = meanHue(hsl.map(c => ({ h: c.h, w: c.s * (1 - Math.abs(c.l - 0.5)) })))
  const meanSat = hsl.reduce((a, c) => a + c.s, 0) / hsl.length
  // Accent: the most vivid quarter of the picture, if it is vivid at all.
  const scored = hsl.map(c => ({ c, score: c.s * (1 - Math.abs(c.l - 0.5) * 1.4) })).sort((a, b) => b.score - a.score)
  const top = scored.slice(0, Math.max(1, Math.round(scored.length / 4)))
  const vivid = top[0]!.score
  const accentHue = meanHue(top.map(t => ({ h: t.c.h, w: t.score })))
  const accent = vivid > 0.22 && accentHue.strength > 0.35 ? hslHex(accentHue.h, Math.max(0.55, Math.min(0.85, top[0]!.c.s)), 0.55) : undefined
  return {
    hue: Math.round(base.h),
    tint: Math.round(Math.min(0.18, meanSat * base.strength * 0.9) * 100) / 100,
    luminance: Math.round(luminance * 1000) / 1000,
    ...(accent ? { accent } : {}),
    mode: luminance < 0.4 ? 'dark' : 'light',
  }
}

/** makeColors' input for a palette: surfaces and text tinted with the picture's hue, its accent as the accent. */
export function colorInputs(p: Palette, strength = 1) {
  const s = p.tint * strength
  const dark = {
    'surface-0': hslHex(p.hue, s, 0.085),
    'surface-1': hslHex(p.hue, s, 0.115),
    'surface-2': hslHex(p.hue, s, 0.145),
    'surface-3': hslHex(p.hue, s, 0.17),
    'text-primary': hslHex(p.hue, Math.min(s, 0.12), 0.94),
    'text-secondary': hslHex(p.hue, Math.min(s, 0.1), 0.8),
    'text-muted': hslHex(p.hue, Math.min(s, 0.08), 0.66),
  }
  const light = {
    'surface-0': hslHex(p.hue, s * 0.9, 0.925),
    'surface-1': hslHex(p.hue, s * 0.9, 0.95),
    'surface-2': hslHex(p.hue, s * 0.9, 0.975),
    'surface-3': hslHex(p.hue, s * 0.9, 0.975),
    'text-primary': hslHex(p.hue, Math.min(s, 0.2), 0.12),
    'text-secondary': hslHex(p.hue, Math.min(s, 0.16), 0.27),
    'text-muted': hslHex(p.hue, Math.min(s, 0.12), 0.38),
  }
  // The picture sets one mode, so only that half is made (the other half would never show).
  return {
    label: 'From your picture',
    only: p.mode,
    ...(p.accent ? { roles: { accent: p.accent } } : {}),
    ...(p.mode === 'dark' ? { dark: { gray: { anchors: dark } } } : { light: { gray: { anchors: light } } }),
  }
}

/** The colour the veil and the frosted column are baked in: the page colour of the picture's own mode. */
export function veilColor(p: Palette): string {
  return p.mode === 'dark' ? hslHex(p.hue, p.tint, 0.085) : hslHex(p.hue, p.tint * 0.9, 0.925)
}

const EXTS = /\.(jpe?g|png|bmp|gif|tiff?|webp|heic)$/i

/** A path as typed: quotes off, ~ to home, backslashes kept. Undefined when it names no picture. */
export function cleanPath(raw: string, home: string): string | undefined {
  let p = raw.trim()
  if ((p.startsWith('"') && p.endsWith('"')) || (p.startsWith("'") && p.endsWith("'"))) p = p.slice(1, -1).trim()
  if (p.startsWith('~')) p = home.replace(/[\\/]+$/, '') + p.slice(1)
  return p && EXTS.test(p) ? p : undefined
}

/** A short id for a picture: its path, size and time, so the same file twice keeps one name and a new one gets another. */
export function pictureId(path: string, size: number, mtimeMs: number): string {
  let h = 2166136261
  for (const ch of `${path}|${size}|${Math.round(mtimeMs)}`) {
    h ^= ch.charCodeAt(0)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h.toString(36)
}

export type Args = { kind: 'pick' } | { kind: 'path'; path: string } | { kind: 'off' } | { kind: 'status' } | { kind: 'help' }

export function parseArgs(raw: string): Args {
  const t = raw.trim()
  if (t === '' || t === 'pick') return { kind: 'pick' }
  if (t === 'off' || t === 'clear') return { kind: 'off' }
  if (t === 'status') return { kind: 'status' }
  if (t === 'help') return { kind: 'help' }
  return { kind: 'path', path: t }
}
