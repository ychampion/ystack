// One spelling per path, so a check on a folder can't be stepped around with `.`, `..`, doubled or mixed
// slashes, `~`, a relative path or (on Windows and macOS, whose disks ignore case) a change of letter case.
// Pure: symbolic links, junctions and Windows short names (CLAUDE~1) are not resolved.

import type { Platform } from './keychain.ts'

/**
 * The absolute, folded form of `raw`: `~` expanded, relative paths joined to `cwd`, `.` and `..` resolved,
 * `/` as the only separator, no trailing `/`. On Windows also: `\\?\` and `\\.\` prefixes dropped, trailing
 * dots and spaces dropped from each part (Windows ignores them), lower case. On macOS also lower case.
 */
export function canonicalPath(raw: string, p: Platform, cwd = ''): string {
  const win = p.os === 'windows'
  const slashes = (s: string) => (win ? s.replace(/\\/g, '/') : s)
  let s = slashes(raw)
  if (s === '~' || s.startsWith('~/')) s = slashes(p.home) + s.slice(1)
  if (win) s = s.replace(/^\/\/[?.]\/unc\//i, '//').replace(/^\/\/[?.]\//, '')
  const base = () => (cwd ? canonicalPath(cwd, p) : '/')

  let root: string
  let rest: string
  if (win && /^[a-z]:/i.test(s)) {
    const drive = s.slice(0, 2)
    if (s[2] === '/') {
      root = `${drive}/`
      rest = s.slice(3)
    } else {
      // `C:name` is relative to the current folder when that is on drive C:.
      const b = base()
      if (b.slice(0, 2).toLowerCase() === drive.toLowerCase()) return canonicalPath(`${b}/${s.slice(2)}`, p)
      root = `${drive}/`
      rest = s.slice(2)
    }
  } else if (win && s.startsWith('//')) {
    root = '//'
    rest = s.slice(2)
  } else if (s.startsWith('/')) {
    // On Windows `\name` is on the current folder's drive.
    const drive = win ? /^[a-z]:/i.exec(base())?.[0] : undefined
    root = drive ? `${drive}/` : '/'
    rest = s.slice(1)
  } else if (cwd) {
    return canonicalPath(`${base()}/${s}`, p)
  } else {
    root = '/'
    rest = s
  }

  const out: string[] = []
  for (let part of rest.split('/')) {
    // Windows opens `vault.` as `vault`; a part of only dots and spaces (`...`, ` `) stays a name that `..` cancels.
    if (win && part !== '.' && part !== '..') part = part.replace(/[. ]+$/, '') || part
    if (part === '' || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  const joined = root + out.join('/')
  return win || p.os === 'mac' ? joined.toLowerCase() : joined
}

/** True when `path` is `dir` or anything inside it. Both must already be canonical. */
export function isInside(path: string, dir: string): boolean {
  return path === dir || path.startsWith(dir.endsWith('/') ? dir : `${dir}/`)
}
