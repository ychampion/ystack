// The guards as Devin runs them: Claude-style input (`tool_name`, `tool_input`), `--host devin`, and
// Claude-style answers (`{}` for no objection, `decision: "block"` to stop or send back).
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { shellCall, toDevin } from './lib.mjs'
import { decide as pushDecide } from './push-guard.mjs'
import { decideDevin, devinEditedFiles, recordDevin } from './verify.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const exec = (command, cwd) => ({ hook_event_name: 'PreToolUse', session_id: 's1', tool_name: 'exec', tool_input: { command, ...(cwd ? { cwd } : {}) } })

function run(script, input, env = {}) {
  const r = spawnSync(process.execPath, [path.join(HERE, script), '--host', 'devin'], {
    input: typeof input === 'string' ? input : JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env, ...env },
  })
  assert.equal(r.status, 0, r.stderr)
  return JSON.parse(r.stdout)
}

function sh(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`)
  return r.stdout.trim()
}

test('shellCall reads Devin exec calls and ignores other tools', () => {
  const cwd = os.tmpdir()
  assert.deepEqual(shellCall(exec('git status', cwd)), { command: 'git status', cwd: path.resolve(cwd) })
  assert.deepEqual(shellCall({ ...exec('ls'), tool_name: 'shell_command' })?.command, 'ls')
  assert.equal(shellCall({ tool_name: 'edit', tool_input: { file_path: 'a.js' } }), undefined)
  assert.equal(shellCall({}), undefined)
})

test('toDevin: allow is empty, deny and continue block, ask asks', () => {
  assert.deepEqual(toDevin({ decision: 'allow' }), {})
  assert.deepEqual(toDevin({}), {})
  assert.deepEqual(toDevin(undefined), {})
  assert.deepEqual(toDevin({ decision: 'deny', reason: 'no' }), { decision: 'block', reason: 'no' })
  assert.deepEqual(toDevin({ decision: 'continue', reason: 'check' }, 'Stop'), { decision: 'block', reason: 'check' })
  assert.deepEqual(toDevin({ decision: 'ask', reason: 'new' }, 'PreToolUse'), {
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: 'new' },
  })
})

test('push-guard stops a Devin force-push to main and lets a plain one through', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ystack-devin-pg-'))
  try {
    sh(dir, 'init', '-q', '-b', 'main')
    assert.equal(pushDecide(exec('git push --force origin main', dir)).decision, 'deny')
    assert.equal(pushDecide(exec('git status', dir)).decision, 'allow')
    assert.deepEqual(run('push-guard.mjs', exec('git push -f origin main', dir)).decision, 'block')
    assert.deepEqual(run('push-guard.mjs', exec('echo hi', dir)), {})
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('a guard reached through a symlinked plugin folder still answers (Devin links its plugin cache)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ystack-devin-link-'))
  const link = path.join(dir, 'local')
  try {
    fs.symlinkSync(HERE, link, process.platform === 'win32' ? 'junction' : 'dir')
    const r = spawnSync(process.execPath, [path.join(link, 'push-guard.mjs'), '--host', 'devin'], {
      input: JSON.stringify(exec('gh repo edit acme/app --visibility public', os.tmpdir())),
      encoding: 'utf8',
    })
    assert.equal(r.status, 0, r.stderr)
    assert.equal(JSON.parse(r.stdout).decision, 'block')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('push-guard stops making a repo public from Devin', () => {
  const out = run('push-guard.mjs', exec('gh repo edit acme/app --visibility public', os.tmpdir()))
  assert.equal(out.decision, 'block')
  assert.match(out.reason, /public/i)
})

test('package-bouncer leaves non-install commands alone and answers {} for other tools', () => {
  assert.deepEqual(run('package-bouncer.mjs', exec('bun test', os.tmpdir())), {})
  assert.deepEqual(run('package-bouncer.mjs', { hook_event_name: 'PreToolUse', tool_name: 'read', tool_input: { file_path: 'x' } }), {})
})

test('a guard given bad stdin under --host devin answers {} (no objection)', () => {
  assert.deepEqual(run('push-guard.mjs', 'not json'), {})
  assert.deepEqual(run('verify.mjs', 'not json'), {})
})

test('devinEditedFiles reads path fields and apply_patch headers', () => {
  assert.deepEqual(devinEditedFiles({ file_path: 'src/a.ts' }), ['src/a.ts'])
  assert.deepEqual(devinEditedFiles({ path: 'b.py' }), ['b.py'])
  assert.deepEqual(devinEditedFiles({ patch: '*** Begin Patch\n*** Update File: x.js\n@@\n-a\n+b\n*** Add File: y.js\n+c\n*** End Patch' }), ['x.js', 'y.js'])
  assert.deepEqual(devinEditedFiles(undefined), [])
})

test('verify (Devin): edits with no check send the agent back once', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ystack-devin-v-'))
  try {
    const base = { session_id: 'sess-1' }
    recordDevin({ ...base, hook_event_name: 'PostToolUse', tool_name: 'edit', tool_input: { file_path: path.join(dir, 'a.js') }, tool_response: { success: true } }, { dir })
    const first = decideDevin({ ...base, hook_event_name: 'Stop', stop_hook_active: false }, { dir })
    assert.equal(first.decision, 'continue')
    assert.match(first.reason, /a\.js/)
    assert.deepEqual(decideDevin({ ...base, hook_event_name: 'Stop', stop_hook_active: false }, { dir }), {})
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('verify (Devin): a check after the edit, prose edits, failed edits and stop_hook_active all let it stop', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ystack-devin-v-'))
  try {
    const post = (session_id, tool_name, tool_input, success = true) =>
      recordDevin({ session_id, hook_event_name: 'PostToolUse', tool_name, tool_input, tool_response: { success } }, { dir })
    const stop = (session_id, active = false) => decideDevin({ session_id, hook_event_name: 'Stop', stop_hook_active: active }, { dir })

    post('checked', 'write', { file_path: 'a.ts' })
    post('checked', 'exec', { command: 'bun test' })
    assert.deepEqual(stop('checked'), {})

    post('prose', 'edit', { file_path: 'README.md' })
    assert.deepEqual(stop('prose'), {})

    post('failed', 'edit', { file_path: 'a.ts' }, false)
    assert.deepEqual(stop('failed'), {})

    post('active', 'edit', { file_path: 'a.ts' })
    assert.deepEqual(stop('active', true), {})

    post('later', 'exec', { command: 'bun test' })
    post('later', 'edit', { file_path: 'b.ts' })
    assert.equal(stop('later').decision, 'continue')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('verify script under --host devin: PostToolUse then Stop blocks once, via PLUGIN_DATA', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ystack-devin-v-'))
  try {
    const env = { PLUGIN_DATA: dir }
    const id = `proc-${process.pid}`
    assert.deepEqual(run('verify.mjs', { session_id: id, hook_event_name: 'PostToolUse', tool_name: 'edit', tool_input: { file_path: 'm.js' }, tool_response: { success: true } }, env), {})
    const out = run('verify.mjs', { session_id: id, hook_event_name: 'Stop', stop_hook_active: false }, env)
    assert.equal(out.decision, 'block')
    assert.match(out.reason, /m\.js/)
    assert.deepEqual(run('verify.mjs', { session_id: id, hook_event_name: 'Stop', stop_hook_active: false }, env), {})
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('a Devin command sent as an argv array is still checked', () => {
  const out = run('push-guard.mjs', { hook_event_name: 'PreToolUse', tool_name: 'exec', tool_input: { command: ['gh', 'repo', 'edit', 'acme/app', '--visibility', 'public'] } })
  assert.equal(out.decision, 'block')
})

test('real Devin input carries no cwd: the folder comes from DEVIN_PROJECT_DIR', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ystack-devin-cwd-'))
  try {
    sh(dir, 'init', '-q', '-b', 'main')
    const input = exec('git push -f')
    const saved = process.env.DEVIN_PROJECT_DIR
    process.env.DEVIN_PROJECT_DIR = dir
    try {
      assert.equal(shellCall(input).cwd, path.resolve(dir))
    } finally {
      if (saved === undefined) delete process.env.DEVIN_PROJECT_DIR
      else process.env.DEVIN_PROJECT_DIR = saved
    }
    // A bare force-push reads the branch from the project folder (main here) and is stopped.
    assert.equal(run('push-guard.mjs', input, { DEVIN_PROJECT_DIR: dir }).decision, 'block')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('verify (Devin): a check that fails still counts as a check', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ystack-devin-v-'))
  try {
    recordDevin({ session_id: 'f', hook_event_name: 'PostToolUse', tool_name: 'edit', tool_input: { file_path: 'a.ts' }, tool_response: { success: true } }, { dir })
    recordDevin({ session_id: 'f', hook_event_name: 'PostToolUse', tool_name: 'exec', tool_input: { command: 'bun test' }, tool_response: { success: false } }, { dir })
    assert.deepEqual(decideDevin({ session_id: 'f', hook_event_name: 'Stop', stop_hook_active: false }, { dir }), {})
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
