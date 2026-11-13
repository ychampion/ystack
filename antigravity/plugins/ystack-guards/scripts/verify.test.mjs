import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { decide, editsSinceCheck } from './verify.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const stopFixture = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', 'stop.json'), 'utf8'))
const editNoCheck = fs.readFileSync(path.join(HERE, 'fixtures', 'transcript-edit-no-check.jsonl'), 'utf8')

let root
let n = 0
before(() => (root = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-test-'))))
after(() => fs.rmSync(root, { recursive: true, force: true }))

/** A conversation laid out like Antigravity's: <brain>/<id>/.system_generated/logs/transcript_full.jsonl. */
function conversation(lines) {
  const id = `conv-${++n}`
  const logs = path.join(root, 'brain', id, '.system_generated', 'logs')
  fs.mkdirSync(logs, { recursive: true })
  const transcriptPath = path.join(logs, 'transcript_full.jsonl')
  fs.writeFileSync(transcriptPath, typeof lines === 'string' ? lines : lines.map(l => JSON.stringify(l)).join('\n') + '\n')
  return { ...stopFixture, conversationId: id, transcriptPath, cwd: root, workspacePaths: [root] }
}
const call = (name, args) => ({ type: 'PLANNER_RESPONSE', tool_calls: [{ name, args }] })
const state = () => path.join(root, 'state')

test('edits with no check after them: sent back once, then allowed to stop', () => {
  const input = conversation(editNoCheck)
  const first = decide(input, { dir: state() })
  assert.equal(first.decision, 'continue')
  assert.match(first.reason, /edited 1 file\(s\) \(add\.js\)/)
  assert.deepEqual(decide(input, { dir: state() }), {}, 'never twice in one conversation')
})

test('a check after the last edit lets the agent stop', () => {
  const input = conversation([
    call('write_to_file', { TargetFile: 'C:/p/a.ts', CodeContent: 'x' }),
    call('run_command', { CommandLine: 'bun run typecheck && bun test' }),
  ])
  assert.deepEqual(decide(input, { dir: state() }), {})
})

test('prose and the agent own artifacts do not count as edits', () => {
  const input = conversation([
    call('write_to_file', { TargetFile: 'C:/p/README.md', CodeContent: 'x' }),
    call('edit_file', { Path: 'C:/p/notes.txt', Target: 'a', Replacement: 'b' }),
  ])
  assert.deepEqual(decide(input, { dir: state() }), {})
  const brain = path.dirname(path.dirname(path.dirname(path.dirname(input.transcriptPath))))
  assert.deepEqual(editsSinceCheck(JSON.stringify(call('write_file', { Path: path.join(brain, 'x', 'plan.json') })), brain), [])
})

test('only a no-tool-call finish is gated', () => {
  const input = conversation(editNoCheck)
  assert.deepEqual(decide({ ...input, terminationReason: 'ERROR' }, { dir: state() }), {})
  assert.deepEqual(decide({ ...input, continuationActive: true }, { dir: state() }), {})
  assert.deepEqual(decide({ ...input, transcriptPath: path.join(root, 'missing', 'transcript_full.jsonl') }, { dir: state() }), {})
})

test('the older transcript form (JSON-encoded args) is read too', () => {
  const lines = [{ tool_calls: [{ name: 'replace_file_content', args: { TargetFile: JSON.stringify('C:/p/b.py') } }] }, { tool_calls: [{ name: 'run_command', args: { CommandLine: JSON.stringify('echo done') } }] }]
  assert.deepEqual(editsSinceCheck(lines.map(l => JSON.stringify(l)).join('\n')), ['C:/p/b.py'])
})

test('the hint uses the project scripts', () => {
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { test: 'x', build: 'y' } }))
  fs.writeFileSync(path.join(root, 'bun.lock'), '')
  const input = conversation([call('write_to_file', { TargetFile: path.join(root, 'src', 'a.ts'), CodeContent: 'x' })])
  assert.match(decide(input, { dir: state() }).reason, /`bun run test && bun run build`/)
})

test('the script answers from fixture stdin and lets the agent stop on bad input', () => {
  const run = (stdin, env = {}) => spawnSync(process.execPath, [path.join(HERE, 'verify.mjs')], { input: stdin, encoding: 'utf8', env: { ...process.env, PLUGIN_DATA: path.join(root, 'plugin-data'), ...env } })
  const input = conversation(editNoCheck)
  assert.equal(JSON.parse(run(JSON.stringify(input)).stdout).decision, 'continue')
  assert.ok(fs.readdirSync(path.join(root, 'plugin-data')).some(f => f.startsWith('verify-')), 'state kept under PLUGIN_DATA')
  assert.deepEqual(JSON.parse(run(JSON.stringify(input)).stdout), {})
  const bad = run('{')
  assert.deepEqual(JSON.parse(bad.stdout), {})
  assert.match(bad.stderr, /internal error/)
})
