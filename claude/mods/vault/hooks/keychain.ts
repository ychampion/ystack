// Where key values live: the operating system's protected storage, reached through child processes.
// A value travels only on a child's standard input or output, never in its command line.
// Windows: DPAPI (encrypted for this Windows account) files. Linux: the Secret Service via `secret-tool`
// when it works, else a file only this user can read. macOS: a file only this user can read.

import type { EngineInterface } from 'claude-code'

import { NAME } from './placeholders.ts'

export type Backend = 'dpapi' | 'secret-tool' | 'file'

export type Entry = { description: string; addedAt: number; backend: Backend }
export type Index = { keys: Record<string, Entry> }

/** base64 of the UTF-8 bytes: what crosses a child's pipes, so no code page can mangle a value. */
export function encode(value: string): string {
  let bin = ''
  for (const b of new TextEncoder().encode(value)) bin += String.fromCharCode(b)
  return btoa(bin)
}

export function decode(b64: string): string {
  const bin = atob(b64.trim())
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

function assertName(name: string): void {
  if (!NAME.test(name)) throw new Error(`not a key name: ${name}`)
}

// ---- Windows (PowerShell + DPAPI) ----

const PS_DIR = "$d = Join-Path $HOME '.claude\\vault'; "

/** Saves the base64 value read from standard input, DPAPI-encrypted for the current user. */
export function psSave(name: string): string {
  assertName(name)
  return (
    "$ErrorActionPreference = 'Stop'; " +
    PS_DIR +
    'New-Item -ItemType Directory -Force -Path $d | Out-Null; ' +
    '$b = [Console]::In.ReadToEnd().Trim(); if (-not $b) { exit 3 }; ' +
    '$plain = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($b)); ' +
    '$enc = ConvertTo-SecureString -String $plain -AsPlainText -Force | ConvertFrom-SecureString; ' +
    `Set-Content -LiteralPath (Join-Path $d '${name}.dpapi') -Value $enc -NoNewline -Encoding ASCII`
  )
}

/** Prints `{ NAME: base64 }` for every saved key (an empty string where one could not be decrypted). */
export function psLoadAll(): string {
  return (
    PS_DIR +
    '$out = @{}; ' +
    'if (Test-Path -LiteralPath $d) { Get-ChildItem -LiteralPath $d -Filter *.dpapi | ForEach-Object { ' +
    '$f = $_; try { ' +
    '$sec = ConvertTo-SecureString -String ((Get-Content -Raw -LiteralPath $f.FullName).Trim()); ' +
    "$plain = [System.Net.NetworkCredential]::new('', $sec).Password; " +
    '$out[$f.BaseName] = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($plain)) ' +
    "} catch { $out[$f.BaseName] = '' } } }; " +
    '[Console]::Out.Write((ConvertTo-Json -InputObject $out -Compress))'
  )
}

export function psRemove(name: string): string {
  assertName(name)
  return PS_DIR + `Remove-Item -LiteralPath (Join-Path $d '${name}.dpapi') -Force -ErrorAction SilentlyContinue`
}

// ---- Linux / macOS ----

export const SECRET_SERVICE = 'claude-vault'

export function secretToolStore(name: string): string[] {
  assertName(name)
  return ['secret-tool', 'store', '--label', `Claude vault: ${name}`, 'service', SECRET_SERVICE, 'name', name]
}
export function secretToolLookup(name: string): string[] {
  assertName(name)
  return ['secret-tool', 'lookup', 'service', SECRET_SERVICE, 'name', name]
}
export function secretToolClear(name: string): string[] {
  assertName(name)
  return ['secret-tool', 'clear', 'service', SECRET_SERVICE, 'name', name]
}
/** Writes standard input to `<dir>/<file>` with permissions 0600 in a 0700 folder; paths ride as arguments. */
export function fileSave(dir: string, name: string): string[] {
  assertName(name)
  return [
    'sh',
    '-c',
    'umask 077 && mkdir -p "$1" && chmod 700 "$1" && cat > "$1/$2.tmp" && chmod 600 "$1/$2.tmp" && mv -f "$1/$2.tmp" "$1/$2"',
    'sh',
    dir,
    `${name}.b64`,
  ]
}
export function fileLoad(dir: string, name: string): string[] {
  assertName(name)
  return ['sh', '-c', 'cat "$1/$2"', 'sh', dir, `${name}.b64`]
}
export function fileRemove(dir: string, name: string): string[] {
  assertName(name)
  return ['sh', '-c', 'rm -f "$1/$2"', 'sh', dir, `${name}.b64`]
}

// ---- the runner ----

export type Platform = { os: 'windows' | 'linux' | 'mac'; home: string; powershell: string }

export async function platform($: EngineInterface): Promise<Platform> {
  const isWindows = (await $.env.get('OS')) === 'Windows_NT'
  if (isWindows) {
    const home = (await $.env.get('USERPROFILE')) ?? ''
    const root = (await $.env.get('SystemRoot')) ?? 'C:\\Windows'
    return { os: 'windows', home, powershell: `${root}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe` }
  }
  const home = (await $.env.get('HOME')) ?? ''
  const uname = await $.process.run(['uname', '-s'], { timeoutMs: 5_000 }).catch(() => undefined)
  return { os: uname?.stdout.trim() === 'Darwin' ? 'mac' : 'linux', home, powershell: '' }
}

export const vaultDir = (p: Platform) => `${p.home}/.claude/vault`
const indexPath = (p: Platform) => `${vaultDir(p)}/index.json`

function ps($: EngineInterface, p: Platform, script: string, stdin?: string) {
  return $.process.run([p.powershell, '-NoProfile', '-NonInteractive', '-Command', script], {
    ...(stdin !== undefined ? { stdin } : {}),
    timeoutMs: 30_000,
  })
}

export async function readIndex($: EngineInterface, p: Platform): Promise<Index> {
  const text = await $.fs.read(indexPath(p)).catch(() => undefined)
  if (typeof text !== 'string') return { keys: {} }
  try {
    const parsed = JSON.parse(text) as Partial<Index>
    const keys: Record<string, Entry> = {}
    for (const [k, v] of Object.entries(parsed.keys ?? {})) {
      if (NAME.test(k) && v && typeof v === 'object') keys[k] = v as Entry
    }
    return { keys }
  } catch {
    return { keys: {} }
  }
}

async function writeIndex($: EngineInterface, p: Platform, index: Index): Promise<void> {
  await $.fs.write(indexPath(p), JSON.stringify(index, null, 2) + '\n')
}

/** Saves a key; answers where it went, or throws with a plain reason. */
export async function saveKey($: EngineInterface, p: Platform, name: string, value: string, now: number): Promise<Backend> {
  const b64 = encode(value)
  let backend: Backend
  if (p.os === 'windows') {
    const r = await ps($, p, psSave(name), b64)
    if (r.exitCode !== 0) throw new Error('Windows could not encrypt the key (PowerShell failed).')
    backend = 'dpapi'
  } else {
    const tool = p.os === 'linux' ? await $.process.run(secretToolStore(name), { stdin: b64, timeoutMs: 15_000 }).catch(() => undefined) : undefined
    if (tool?.exitCode === 0) backend = 'secret-tool'
    else {
      const r = await $.process.run(fileSave(vaultDir(p), name), { stdin: b64, timeoutMs: 15_000 })
      if (r.exitCode !== 0) throw new Error('Could not write the key file.')
      backend = 'file'
    }
  }
  const index = await readIndex($, p)
  index.keys[name] = { description: index.keys[name]?.description ?? '', addedAt: now, backend }
  await writeIndex($, p, index)
  return backend
}

/** Sets the note on what a key is for (names and notes are not secret; they live in the index). */
export async function describeKey($: EngineInterface, p: Platform, name: string, description: string): Promise<boolean> {
  const index = await readIndex($, p)
  const entry = index.keys[name]
  if (!entry) return false
  index.keys[name] = { ...entry, description: description.trim().slice(0, 200) }
  await writeIndex($, p, index)
  return true
}

/** Every saved key's value, by name. Keys that can't be read are left out and named in `unreadable`. */
export async function loadAll($: EngineInterface, p: Platform): Promise<{ values: Map<string, string>; unreadable: string[] }> {
  const values = new Map<string, string>()
  const unreadable: string[] = []
  const index = await readIndex($, p)
  if (p.os === 'windows') {
    if (Object.keys(index.keys).length === 0) {
      // No index: skip starting PowerShell unless key files exist.
      const listed = await $.fs.list(vaultDir(p)).catch(() => [])
      if (!listed.some(f => f.name.endsWith('.dpapi'))) return { values, unreadable }
    }
    const r = await ps($, p, psLoadAll())
    if (r.exitCode !== 0) return { values, unreadable: Object.keys(index.keys) }
    const parsed = JSON.parse(r.stdout || '{}') as Record<string, string>
    for (const [name, b64] of Object.entries(parsed)) {
      if (!NAME.test(name)) continue
      if (b64) values.set(name, decode(b64))
      else unreadable.push(name)
    }
    return { values, unreadable }
  }
  for (const [name, entry] of Object.entries(index.keys)) {
    const argv = entry.backend === 'secret-tool' ? secretToolLookup(name) : fileLoad(vaultDir(p), name)
    const r = await $.process.run(argv, { timeoutMs: 15_000 }).catch(() => undefined)
    if (r?.exitCode === 0 && r.stdout.trim()) values.set(name, decode(r.stdout))
    else unreadable.push(name)
  }
  return { values, unreadable }
}

export async function removeKey($: EngineInterface, p: Platform, name: string): Promise<boolean> {
  const index = await readIndex($, p)
  const entry = index.keys[name]
  if (p.os === 'windows') await ps($, p, psRemove(name))
  else if (entry?.backend === 'secret-tool') await $.process.run(secretToolClear(name), { timeoutMs: 15_000 }).catch(() => undefined)
  else await $.process.run(fileRemove(vaultDir(p), name), { timeoutMs: 15_000 }).catch(() => undefined)
  if (entry) {
    delete index.keys[name]
    await writeIndex($, p, index)
  }
  return entry !== undefined
}
