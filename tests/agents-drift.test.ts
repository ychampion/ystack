// claude/agents/opus-*.md must match what the ystack-setup mod writes (claude/mods/ystack-setup/hooks/items.ts).
// items.ts is the single source of truth. If this fails, regenerate the files:
//   bun -e 'import {AGENTS,agentText} from "./claude/mods/ystack-setup/hooks/items.ts"; for (const n of Object.keys(AGENTS)) await Bun.write(`claude/agents/${n}.md`, agentText(n))'
import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { AGENTS, agentText, frontmatter } from '../claude/mods/ystack-setup/hooks/items.ts'

const dir = join(import.meta.dir, '..', 'claude', 'agents')
const read = (name: string) => readFileSync(join(dir, `${name}.md`), 'utf8').replace(/\r\n/g, '\n')

describe('claude/agents matches the ystack-setup mod', () => {
  for (const name of Object.keys(AGENTS)) {
    test(`${name}.md is byte for byte what ystack-setup writes`, () => {
      expect(read(name)).toBe(agentText(name))
    })
  }

  test('every opus-* file in claude/agents is one the mod knows', () => {
    const files = readdirSync(dir).filter(f => f.startsWith('opus-') && f.endsWith('.md'))
    expect(files.map(f => f.slice(0, -3)).sort()).toEqual(Object.keys(AGENTS).sort())
  })

  test('haiku-max is the fast lookup type: model haiku, effort max', () => {
    const fm = frontmatter(read('haiku-max'))
    expect(fm.name).toBe('haiku-max')
    expect(fm.model).toBe('haiku')
    expect(fm.effort).toBe('max')
    expect(fm.description ?? '').toMatch(/never judgments/)
  })
})
