import type { EngineInterface, Register } from 'claude-code'

import { cleanPath, coderOf, colorInputs, fromBase64, paletteOf, parseArgs, pictureId, readBmp, veilColor } from './core'
import type { Palette } from './core'
import { makeColors } from './make-colors.js'

const TOOL = 'mcp__image-theme__use_picture'
const STEP_MS = 120_000
const PICK_MS = 600_000

type Platform = 'windows' | 'mac' | 'linux'
/** What is kept across sessions: the picture in use and the palette read from it. */
type Chosen = { id: string; source: string; palette: Palette }

let veil = 0.2
let column = true
let platform: Platform | undefined
let busy = false

async function platformOf($: EngineInterface): Promise<Platform> {
  if (platform) return platform
  if ((await $.env.get('OS')) === 'Windows_NT') return (platform = 'windows')
  const r = await $.process.run(['uname', '-s']).catch(() => undefined)
  return (platform = r?.stdout.trim() === 'Darwin' ? 'mac' : 'linux')
}

async function homeOf($: EngineInterface): Promise<string> {
  return ((await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '').replace(/\\/g, '/').replace(/\/+$/, '')
}

/** Where the baked backgrounds are kept for good: the mod's own folder is replaced on every update. */
async function keepDir($: EngineInterface): Promise<string> {
  const config = await $.env.get('CLAUDE_CONFIG_DIR')
  return `${(config || `${await homeOf($)}/.claude`).replace(/\\/g, '/').replace(/\/+$/, '')}/image-theme`
}

const rootOf = ($: EngineInterface) => $.plugin.root.replace(/\\/g, '/')
const native = (p: Platform, path: string) => (p === 'windows' ? path.replace(/\//g, '\\') : path)
const shown = (file: string) => `backgrounds/${file}`
/** A command's reply without the mod's name: the engine shows it in front already. */
const bare = (text: string) => text.replace(/^image-theme: /, '')

function readChosen(raw: unknown): Chosen | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const c = raw as Partial<Chosen>
  const p = c.palette as Partial<Palette> | undefined
  if (typeof c.id !== 'string' || !/^[a-z0-9]+$/.test(c.id) || typeof c.source !== 'string' || !p) return undefined
  if (typeof p.hue !== 'number' || typeof p.tint !== 'number' || typeof p.luminance !== 'number' || (p.mode !== 'dark' && p.mode !== 'light')) return undefined
  return { id: c.id, source: c.source, palette: p as Palette }
}

/** Windows PowerShell with the shipped helper; STA for the file dialog. */
function ps($: EngineInterface, args: string[], timeoutMs = STEP_MS) {
  const script = native('windows', `${rootOf($)}/hooks/win-image.ps1`)
  return $.process.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-File', script, ...args], { timeoutMs })
}

function failed(r: { exitCode: number; stderr: string }, what: string): string | undefined {
  if (r.exitCode === 0) return undefined
  const why = r.stderr.trim().split('\n').find(l => l.trim()) ?? `exit ${r.exitCode}`
  return `image-theme: could not ${what}: ${why.slice(0, 240)}`
}

/** Opens the system's file dialog; the path chosen, undefined when cancelled, or a message when there is no dialog. */
async function pick($: EngineInterface): Promise<{ path?: string; error?: string }> {
  const p = await platformOf($)
  if (p === 'windows') {
    const r = await ps($, ['-Mode', 'pick'], PICK_MS)
    return r.exitCode === 0 ? { path: r.stdout.trim() || undefined } : { error: failed(r, 'open the file dialog') }
  }
  if (p === 'mac') {
    const r = await $.process.run(['osascript', '-e', 'POSIX path of (choose file with prompt "Choose a picture for your Claude theme" of type {"public.image"})'], { timeoutMs: PICK_MS })
    return { path: r.exitCode === 0 ? r.stdout.trim() || undefined : undefined }
  }
  for (const argv of [
    ['zenity', '--file-selection', '--title=Choose a picture for your Claude theme', '--file-filter=Pictures | *.jpg *.jpeg *.png *.bmp *.gif *.tif *.tiff *.webp'],
    ['kdialog', '--getopenfilename', '.', 'image/jpeg image/png image/bmp image/gif image/tiff image/webp'],
  ]) {
    const r = await $.process.run(argv, { timeoutMs: PICK_MS }).catch(() => undefined)
    if (!r) continue
    return { path: r.exitCode === 0 ? r.stdout.trim() || undefined : undefined }
  }
  return { error: 'image-theme: no file dialog here (zenity or kdialog); give the path instead: /image-theme ~/Pictures/photo.jpg' }
}

/** A 16x16 bitmap of the picture, read back as pixels. */
async function swatch($: EngineInterface, p: Platform, src: string, tmp: string): Promise<Palette> {
  const r =
    p === 'windows'
      ? await ps($, ['-Mode', 'swatch', '-In', native(p, src), '-Out', native(p, tmp)])
      : p === 'mac'
        ? await $.process.run(['sips', '-z', '16', '16', '-s', 'format', 'bmp', src, '--out', tmp], { timeoutMs: STEP_MS })
        : await magick($, [`${coderOf(src)}:${src}`, '-auto-orient', '-resize', '16x16!', '-type', 'TrueColor', `BMP3:${tmp}`])
  const err = failed(r, 'read the picture')
  if (err) throw new Error(err)
  const { base64 } = await $.fs.read(tmp, { as: 'bytes' })
  return paletteOf(readBmp(fromBase64(base64)))
}

/** ImageMagick 7 (`magick`) or 6 (`convert`). */
async function magick($: EngineInterface, args: string[]) {
  const seven = await $.process.run(['magick', ...args], { timeoutMs: STEP_MS }).catch(() => undefined)
  if (seven) return seven
  return $.process.run(['convert', ...args], { timeoutMs: STEP_MS }).catch(err => ({
    exitCode: 127,
    stdout: '',
    stderr: `ImageMagick is not installed (${String((err as Error)?.message ?? err).slice(0, 80)})`,
  }))
}

/** The background JPEG: resized, veiled with the palette's page colour, with a frosted column on Windows. */
async function bake($: EngineInterface, p: Platform, src: string, out: string, palette: Palette): Promise<void> {
  const tint = veilColor(palette)
  if (p === 'windows') {
    const r = await ps($, ['-Mode', 'bake', '-In', native(p, src), '-Out', native(p, out), '-Tint', tint, '-Veil', String(veil), '-Column', column ? '1' : '0'])
    const err = failed(r, 'make the background')
    if (err) throw new Error(err)
    return
  }
  if (p === 'mac') {
    await $.process.run(['mkdir', '-p', out.replace(/\/[^/]*$/, '')])
    for (const [size, q] of [['2560', '80'], ['2560', '62'], ['1920', '62'], ['1440', '55']] as const) {
      const r = await $.process.run(['sips', '-Z', size, '-s', 'format', 'jpeg', '-s', 'formatOptions', q, src, '--out', out], { timeoutMs: STEP_MS })
      const err = failed(r, 'make the background')
      if (err) throw new Error(err)
      if ((await $.fs.stat(out)).size <= 1_000_000) return
    }
    throw new Error('image-theme: the picture stays over 1 MiB even made small; try another one.')
  }
  await $.process.run(['mkdir', '-p', out.replace(/\/[^/]*$/, '')])
  for (const [size, q] of [['2560x4096>', '82'], ['2560x4096>', '64'], ['1920x3072>', '62'], ['1440x2304>', '55']] as const) {
    const r = await magick($, [`${coderOf(src)}:${src}`, '-auto-orient', '-resize', size, '-fill', tint, '-colorize', `${Math.round(veil * 100)}%`, '-strip', '-quality', q, `JPEG:${out}`])
    const err = failed(r, 'make the background')
    if (err) throw new Error(err)
    if ((await $.fs.stat(out)).size <= 1_000_000) return
  }
  throw new Error('image-theme: the picture stays over 1 MiB even made small; try another one.')
}

async function copy($: EngineInterface, from: string, to: string): Promise<void> {
  const p = await platformOf($)
  const r =
    p === 'windows'
      ? await ps($, ['-Mode', 'copy', '-In', native(p, from), '-Out', native(p, to)])
      : await $.process.run(['/bin/sh', '-c', 'mkdir -p "$(dirname "$2")" && cp -f "$1" "$2"', 'sh', from, to], { timeoutMs: STEP_MS })
  const err = failed(r, 'copy the background')
  if (err) throw new Error(err)
}

async function remove($: EngineInterface, path: string): Promise<void> {
  const p = await platformOf($)
  if (p === 'windows') await ps($, ['-Mode', 'remove', '-In', native(p, path)]).catch(() => undefined)
  else await $.process.run(['rm', '-f', '--', path]).catch(() => undefined)
}

const exists = async ($: EngineInterface, path: string) => !!(await $.fs.stat(path).catch(() => undefined))

/** Colours for a palette; when the picture's own tint can't be painted, a plainer one that can. */
function colorsFor(palette: Palette) {
  for (const strength of [1, 0.6, 0.3, 0]) {
    const made = makeColors(colorInputs(palette, strength))
    if (!made.problems.some(l => /won't paint/i.test(l))) return made
  }
  return makeColors(colorInputs(palette, 0))
}

async function apply($: EngineInterface, chosen: Chosen): Promise<void> {
  const { theme } = colorsFor(chosen.palette)
  await $.theme.set({ colors: theme, backdrop: { image: { source: shown(`bg-${chosen.id}.jpg`) } }, overrideColorScheme: chosen.palette.mode })
}

/** Picture to theme: palette, background in the mod's folder and the kept copy, then the theme itself. */
async function usePicture($: EngineInterface, raw: string): Promise<string> {
  const p = await platformOf($)
  const home = await homeOf($)
  const path = cleanPath(raw, home)
  if (!path) return `image-theme: "${raw.trim().slice(0, 120)}" is not a full path to a picture on this computer (JPEG, PNG, BMP, GIF or TIFF; network paths are not used).`
  const info = await $.fs.stat(path).catch(() => undefined)
  if (!info || info.kind !== 'file') return `image-theme: no file at ${path}.`
  const id = pictureId(path, info.size, info.mtimeMs)
  const keep = await keepDir($)
  const file = `bg-${id}.jpg`
  const palette = await swatch($, p, path, `${keep}/swatch.bmp`)
  await bake($, p, path, `${keep}/${file}`, palette)
  await copy($, `${keep}/${file}`, `${rootOf($)}/${shown(file)}`)
  const before = readChosen(await $.store.get('chosen').catch(() => undefined))
  const chosen: Chosen = { id, source: path, palette }
  await apply($, chosen)
  await $.store.set('chosen', chosen)
  if (before && before.id !== id) {
    await remove($, `${keep}/bg-${before.id}.jpg`)
    await remove($, `${rootOf($)}/${shown(`bg-${before.id}.jpg`)}`)
  }
  const name = path.replace(/^.*[\\/]/, '')
  const accent = palette.accent ? `, accent ${palette.accent}` : ''
  return `image-theme: ${name} is now your background, with a ${palette.mode} theme in its colours${accent}. /image-theme off goes back to your own theme. If another theme mod (living-themes) is on, turn it off first: /live-theme off.`
}

async function guarded($: EngineInterface, work: () => Promise<string>): Promise<string> {
  if (busy) return 'image-theme: still working on the last picture.'
  busy = true
  try {
    return await work()
  } catch (err) {
    const msg = String((err as Error)?.message ?? err)
    return msg.startsWith('image-theme:') ? msg : `image-theme: that picture didn't work: ${msg.slice(0, 240)}`
  } finally {
    busy = false
  }
}

async function answer($: EngineInterface, args: string): Promise<{ text: string }> {
  const want = parseArgs(args)
  if (want.kind === 'help') return { text: 'Usage: /image-theme [path | off | status]. With no argument a file picker opens.' }
  if (want.kind === 'status') {
    const chosen = readChosen(await $.store.get('chosen').catch(() => undefined))
    if (!chosen) return { text: 'image-theme: no picture chosen. /image-theme opens a file picker.' }
    const p = chosen.palette
    return { text: `image-theme: ${chosen.source}, a ${p.mode} theme, hue ${p.hue}${p.accent ? `, accent ${p.accent}` : ''}. Veil ${veil}, frosted column ${column ? 'on (Windows)' : 'off'}.` }
  }
  if (want.kind === 'off') {
    const chosen = readChosen(await $.store.get('chosen').catch(() => undefined))
    await $.store.set('chosen', null)
    await $.theme.clear()
    if (chosen) {
      await remove($, `${rootOf($)}/${shown(`bg-${chosen.id}.jpg`)}`)
      await remove($, `${await keepDir($)}/bg-${chosen.id}.jpg`)
    }
    return { text: 'image-theme: back to your own theme. The picture itself was not touched.' }
  }
  if (busy) return { text: 'image-theme: still working on the last picture.' }
  // Both the dialog and the bake can take a while: do them in the background and report with a toast.
  $.clock.after(0, () => {
    void guarded($, async () => {
      let path = want.kind === 'path' ? want.path : undefined
      if (!path) {
        const got = await pick($)
        if (got.error) return got.error
        if (!got.path) return 'image-theme: no picture chosen; nothing changed.'
        path = got.path
      }
      return usePicture($, path)
    }).then(text => {
      $.ui.toast(text, { timeoutMs: 10_000 })
      $.ui.log(text)
    })
  })
  return { text: want.kind === 'pick' ? 'image-theme: choose a picture in the window that just opened.' : 'image-theme: making your theme from that picture…' }
}

export const register: Register = (on, options) => {
  if (typeof options.veil === 'number' && options.veil >= 0 && options.veil <= 0.8) veil = options.veil
  if (options.frostedColumn === false) column = false

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: 'image-theme',
      description: 'Turn a picture into your Claude theme and background. No argument opens a file picker.',
      argumentHint: '[path | off | status]',
    })
    await $.tool.register({
      name: 'use_picture',
      description:
        'Make a picture on this computer the Claude app background, with theme colours taken from it. Only call this when the person asks for a picture as their theme or background. ' +
        'Takes the picture\'s full path (JPEG, PNG, BMP, GIF or TIFF).',
      inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'Full path of the picture' } }, required: ['path'] },
    })
    // Put the chosen picture back, copying the kept background in if an update emptied the mod's folder.
    const chosen = readChosen(await $.store.get('chosen').catch(() => undefined))
    if (chosen) {
      const file = `bg-${chosen.id}.jpg`
      const here = `${rootOf($)}/${shown(file)}`
      const kept = `${await keepDir($)}/${file}`
      if (!(await exists($, here)) && (await exists($, kept))) await copy($, kept, here).catch(() => undefined)
      if (await exists($, here)) await apply($, chosen).catch(() => undefined)
    }
    return started
  })

  on('tool.call', { tool: TOOL }, async ($, e) => {
    // A mod's own tool gets its arguments on the event itself; `input` is read too, in case they move there.
    const flat = e as unknown as { path?: unknown; input?: { path?: unknown } }
    const raw = typeof flat.path === 'string' ? flat.path : flat.input?.path
    const path = typeof raw === 'string' ? raw : ''
    return { result: await guarded($, () => usePicture($, path)) }
  }).catch(() => ({ result: 'image-theme: the picture could not be used; nothing was changed.' }))

  on('command.run', { command: 'image-theme' }, async ($, e) => ({ text: bare((await answer($, e.args)).text) }))
}
