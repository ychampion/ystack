// devin/plugins/ystack-guards/scripts must be byte for byte antigravity/plugins/ystack-guards/scripts (the
// tests and fixtures stay in the Antigravity folder only). The Antigravity folder is the source: edit
// there, then copy:
//   for f in lib popular push-guard package-bouncer verify; do cp antigravity/plugins/ystack-guards/scripts/$f.mjs devin/plugins/ystack-guards/scripts/; done
import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dir, '..')
const src = join(root, 'antigravity', 'plugins', 'ystack-guards', 'scripts')
const dst = join(root, 'devin', 'plugins', 'ystack-guards', 'scripts')
const read = (dir: string, f: string) => readFileSync(join(dir, f), 'utf8').replace(/\r\n/g, '\n')
const shipped = (dir: string) =>
  readdirSync(dir)
    .filter(f => f.endsWith('.mjs') && !f.endsWith('.test.mjs'))
    .sort()

describe('the Devin guards are the Antigravity guards', () => {
  test('same script files', () => {
    expect(shipped(dst)).toEqual(shipped(src))
  })
  for (const f of shipped(src)) {
    test(`${f} is identical`, () => {
      expect(read(dst, f)).toBe(read(src, f))
    })
  }
  test('every hook command runs a shipped script with --host devin', () => {
    const hooks = JSON.parse(read(join(dst, '..'), 'hooks.json'))
    const commands: string[] = JSON.stringify(hooks).match(/node \\"\$\{PLUGIN_ROOT\}\/scripts\/[a-z-]+\.mjs\\" --host devin/g) ?? []
    expect(commands.length).toBe(4)
    for (const c of commands) expect(shipped(dst)).toContain(c.match(/scripts\/([a-z-]+\.mjs)/)![1])
  })
})
