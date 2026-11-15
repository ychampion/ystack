import { expect, test } from 'claude-code/testing'

import { cleanPath, coderOf, colorInputs, paletteOf, parseArgs, pictureId, readBmp, toHsl, veilColor } from '../hooks/core'
import type { Rgb } from '../hooks/core'
import { makeColors } from '../hooks/make-colors.js'

/** A 24-bit bitmap of the given rows (top row first), bottom-up unless `topDown`. */
function bmp(rows: Rgb[][], topDown = false): Uint8Array {
  const w = rows[0]!.length
  const h = rows.length
  const stride = Math.ceil((w * 3) / 4) * 4
  const out = new Uint8Array(54 + stride * h)
  const dv = new DataView(out.buffer)
  out[0] = 0x42
  out[1] = 0x4d
  dv.setUint32(2, out.length, true)
  dv.setUint32(10, 54, true)
  dv.setUint32(14, 40, true)
  dv.setInt32(18, w, true)
  dv.setInt32(22, topDown ? -h : h, true)
  dv.setUint16(26, 1, true)
  dv.setUint16(28, 24, true)
  for (let r = 0; r < h; r++) {
    const y = topDown ? r : h - 1 - r
    for (let x = 0; x < w; x++) {
      const o = 54 + y * stride + x * 3
      const px = rows[r]![x]!
      out[o] = px.b
      out[o + 1] = px.g
      out[o + 2] = px.r
    }
  }
  return out
}

const fill = (px: Rgb, n = 16) => Array.from({ length: n }, () => Array.from({ length: n }, () => px))
const RED = { r: 230, g: 30, b: 30 }
const BLUE = { r: 20, g: 40, b: 200 }

test('reads a bottom-up and a top-down bitmap the same, with row padding', () => {
  const rows = [
    [RED, BLUE, RED],
    [BLUE, RED, BLUE],
  ]
  const up = readBmp(bmp(rows))
  const down = readBmp(bmp(rows, true))
  expect(up).toEqual([RED, BLUE, RED, BLUE, RED, BLUE])
  expect(down).toEqual(up)
})

test('refuses what is not a usable bitmap', () => {
  expect(() => readBmp(new Uint8Array(10))).toThrow()
  const b = bmp(fill(RED, 2))
  b[28] = 8
  expect(() => readBmp(b)).toThrow()
})

test('a dark blue picture gives a dark theme with a blue hue', () => {
  const night = readBmp(bmp(fill({ r: 10, g: 20, b: 70 })))
  const p = paletteOf(night)
  expect(p.mode).toBe('dark')
  expect(Math.abs(p.hue - 228)).toBeLessThan(15)
  expect(p.tint).toBeGreaterThan(0)
})

test('a pale picture gives a light theme', () => {
  const p = paletteOf(readBmp(bmp(fill({ r: 235, g: 228, b: 210 }))))
  expect(p.mode).toBe('light')
})

test('a grey picture has no accent and no tint', () => {
  const p = paletteOf(readBmp(bmp(fill({ r: 90, g: 90, b: 90 }))))
  expect(p.accent).toBeUndefined()
  expect(p.tint).toBe(0)
})

test('a vivid patch becomes the accent', () => {
  const rows = fill({ r: 30, g: 30, b: 34 })
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) rows[y]![x] = { r: 240, g: 120, b: 20 }
  const p = paletteOf(readBmp(bmp(rows)))
  expect(p.accent).toBeDefined()
  const h = toHsl({ r: parseInt(p.accent!.slice(1, 3), 16), g: parseInt(p.accent!.slice(3, 5), 16), b: parseInt(p.accent!.slice(5, 7), 16) }).h
  expect(Math.abs(h - 28)).toBeLessThan(12)
})

test('hues average around the wheel, not through it', () => {
  const rows = fill({ r: 200, g: 20, b: 40 })
  for (let y = 0; y < 16; y += 2) rows[y] = Array.from({ length: 16 }, () => ({ r: 200, g: 40, b: 20 }))
  const p = paletteOf(readBmp(bmp(rows)))
  expect(p.hue < 20 || p.hue > 340).toBe(true)
})

test('makeColors paints the theme made from every kind of picture', () => {
  for (const px of [
    { r: 10, g: 20, b: 70 },
    { r: 235, g: 228, b: 210 },
    { r: 90, g: 90, b: 90 },
    { r: 250, g: 10, b: 200 },
    { r: 0, g: 0, b: 0 },
    { r: 255, g: 255, b: 255 },
  ]) {
    const p = paletteOf(readBmp(bmp(fill(px))))
    const { problems } = makeColors(colorInputs(p))
    expect(problems.filter(l => /won't paint/i.test(l))).toEqual([])
    expect(veilColor(p)).toMatch(/^#[0-9a-f]{6}$/)
  }
})

test('only the picture\'s own mode is made', () => {
  const dark = colorInputs(paletteOf(readBmp(bmp(fill({ r: 10, g: 20, b: 70 })))))
  expect(dark.only).toBe('dark')
  expect('light' in dark).toBe(false)
  const light = colorInputs(paletteOf(readBmp(bmp(fill({ r: 235, g: 228, b: 210 })))))
  expect(light.only).toBe('light')
  expect('dark' in light).toBe(false)
})

test('cleans a pasted path and keeps only pictures', () => {
  expect(cleanPath('  "C:\\Users\\a\\My Pics\\x.JPG" ', 'C:/Users/a')).toBe('C:\\Users\\a\\My Pics\\x.JPG')
  expect(cleanPath("'~/Pictures/sea.png'", '/home/a/')).toBe('/home/a/Pictures/sea.png')
  expect(cleanPath('notes.txt', '/home/a')).toBeUndefined()
  expect(cleanPath('\\\\server\\share\\x.jpg', 'C:/Users/a')).toBeUndefined()
  expect(cleanPath('//server/share/x.jpg', '/home/a')).toBeUndefined()
  expect(cleanPath('\\\\?\\C:\\x.jpg', 'C:/Users/a')).toBeUndefined()
  expect(cleanPath('-write.png', '/home/a')).toBeUndefined()
  expect(cleanPath('pics/x.png', '/home/a')).toBeUndefined()
  expect(coderOf('/a/B.JPG')).toBe('jpeg')
  expect(coderOf('/a/b.tif')).toBe('tiff')
  expect(cleanPath('', '/home/a')).toBeUndefined()
})

test('the same picture keeps its id; a changed one gets a new id', () => {
  const a = pictureId('/p/x.jpg', 100, 5)
  expect(pictureId('/p/x.jpg', 100, 5)).toBe(a)
  expect(pictureId('/p/x.jpg', 101, 5)).not.toBe(a)
  expect(a).toMatch(/^[a-z0-9]+$/)
})

test('reads the command arguments', () => {
  expect(parseArgs('')).toEqual({ kind: 'pick' })
  expect(parseArgs('off')).toEqual({ kind: 'off' })
  expect(parseArgs(' status ')).toEqual({ kind: 'status' })
  expect(parseArgs('C:\\a b\\c.png')).toEqual({ kind: 'path', path: 'C:\\a b\\c.png' })
})
