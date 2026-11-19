#!/usr/bin/env node
// verify for Antigravity (Stop) and Devin (PostToolUse + Stop, see the Devin section). Port of the gate in ystack's Claude Code verify mod: when the agent is about
// to finish (it answered with no tool call) after editing code files, and ran no test, build or check
// command after its last edit, it is sent back once to run a real check. Once per conversation at most:
// a marker file keyed by the conversation id is written before asking, so it can never loop.
// Edits to prose (.md, .txt, ...) and to the agent's own artifacts don't count.
// Any error lets the agent stop.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { HOST, isMain, runHook } from './lib.mjs'

const GUARD = 'verify'
const STOP = Object.freeze({})

export const CHECK_CMD =
  /\b(test|tests|vitest|jest|pytest|tsc|typecheck|lint|clippy|build|cargo\s+(test|check|build)|go\s+(test|vet|build)|playwright|gh\s+(pr\s+checks|run\s+(watch|view))|curl|browse|bun\s+(run|-e|test)|bunx|node\s|python\s|Invoke-WebRequest|Measure-Command)\b/i
export const DOC_FILE = /\.(md|mdx|txt|rst|adoc)$/i
const EDIT_TOOLS = new Set(['write_to_file', 'replace_file_content', 'multi_replace_file_content', 'write_file', 'edit_file'])

const norm = p => String(p).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
const inside = (file, dir) => dir !== '' && (norm(file) === dir || norm(file).startsWith(dir + '/'))

/** Tool-call args from a transcript line; the older transcript keeps each value as JSON text. */
function argsOf(args) {
  const out = {}
  for (const [k, v] of Object.entries(args && typeof args === 'object' ? args : {})) {
    if (typeof v === 'string' && /^["[{]|^(true|false)$/.test(v)) {
      try {
        out[k] = JSON.parse(v)
        continue
      } catch {}
    }
    out[k] = v
  }
  return out
}

/**
 * Reads a transcript (JSONL): the code files edited since the last check, in order. `brainDir` holds the
 * agent's own artifacts (plans, walkthroughs), which are not code.
 */
export function editsSinceCheck(text, brainDir = '') {
  const brain = brainDir ? norm(brainDir) : ''
  let files = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    let o
    try {
      o = JSON.parse(line)
    } catch {
      continue
    }
    const calls = Array.isArray(o?.tool_calls) ? o.tool_calls : []
    for (const tc of calls) {
      const a = argsOf(tc?.args)
      if (tc?.name === 'run_command') {
        if (typeof a.CommandLine === 'string' && CHECK_CMD.test(a.CommandLine)) files = []
        continue
      }
      if (!EDIT_TOOLS.has(tc?.name)) continue
      const file = a.TargetFile ?? a.Path ?? a.AbsolutePath
      if (typeof file !== 'string' || !file) continue
      if (a.IsArtifact === true || DOC_FILE.test(file) || inside(file, brain)) continue
      if (!files.includes(file)) files.push(file)
    }
  }
  return files
}

const MANIFESTS = ['package.json', 'pyproject.toml', 'pytest.ini', 'setup.cfg', 'Cargo.toml', 'go.mod']

/** The check the project most likely uses, found from the manifest nearest the first edited file. */
export function suggestCheck(files, roots) {
  const starts = [...files.map(f => path.dirname(f)), ...roots].filter(Boolean)
  for (const start of starts) {
    let dir = path.resolve(start)
    for (let i = 0; i < 12; i++) {
      for (const m of MANIFESTS) {
        const p = path.join(dir, m)
        if (!fs.existsSync(p)) continue
        if (m === 'package.json') {
          const pkg = fs.readFileSync(p, 'utf8')
          const scripts = pkg.match(/"scripts"\s*:\s*\{([^}]*)\}/)?.[1] ?? ''
          const has = s => new RegExp(`"${s}"\\s*:`).test(scripts)
          const lock = ['bun.lock', 'bun.lockb', 'pnpm-lock.yaml', 'yarn.lock', 'package-lock.json'].find(l => fs.existsSync(path.join(dir, l)))
          const pm = lock?.startsWith('pnpm') ? 'pnpm' : lock === 'yarn.lock' ? 'yarn' : lock === 'package-lock.json' ? 'npm' : 'bun'
          const run = s => (pm === 'yarn' ? `yarn ${s}` : `${pm} run ${s}`)
          return [has('typecheck') ? run('typecheck') : '', has('test') ? run('test') : pm === 'bun' ? 'bun test' : '', has('build') ? run('build') : '']
            .filter(Boolean)
            .join(' && ') || 'a real run of what changed'
        }
        if (m === 'Cargo.toml') return 'cargo test'
        if (m === 'go.mod') return 'go test ./...'
        return 'python -m pytest -q'
      }
      const up = path.dirname(dir)
      if (up === dir) break
      dir = up
    }
  }
  return "the project's build or test command, or a real run of what changed"
}

export function stateDir() {
  return process.env.PLUGIN_DATA || path.join(os.tmpdir(), 'ystack-guards')
}

const markerFor = (dir, id) => path.join(dir, `verify-${String(id).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 120)}.done`)

/** The hook: Stop input -> `{decision:'continue', reason}` once, else `{}` (let it stop). */
export function decide(input, { dir = stateDir() } = {}) {
  if (!input || input.terminationReason !== 'NO_TOOL_CALL' || input.continuationActive === true) return STOP
  const id = input.conversationId
  const tp = input.transcriptPath
  if (!id || typeof tp !== 'string' || !tp) return STOP
  const marker = markerFor(dir, id)
  if (fs.existsSync(marker)) return STOP
  let text
  for (const p of [tp, path.join(path.dirname(tp), 'transcript.jsonl')]) {
    try {
      text = fs.readFileSync(p, 'utf8')
      break
    } catch {}
  }
  if (text === undefined) return STOP
  // transcriptPath is <brain>/<conversation>/.system_generated/logs/transcript_full.jsonl
  const brainDir = path.resolve(path.dirname(tp), '..', '..')
  const files = editsSinceCheck(text, brainDir)
  if (files.length === 0) return STOP
  // Mark first: if anything after this fails, the agent is never asked twice.
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(marker, new Date().toISOString())
  const roots = [input.cwd, ...(Array.isArray(input.workspacePaths) ? input.workspacePaths : [])]
  const shown = files.slice(0, 5).map(f => path.basename(f)).join(', ') + (files.length > 5 ? `, and ${files.length - 5} more` : '')
  return {
    decision: 'continue',
    reason:
      `verify: you edited ${files.length} file(s) (${shown}) but ran no test, build or check after the last edit. ` +
      `Before finishing, run \`${suggestCheck(files, roots)}\` (or the closest real check: run the thing you changed) and report what it showed. ` +
      "If no check can be run here, say so plainly in your answer instead of implying it works. You'll only be asked this once.",
  }
}

// ---- Devin ----
// Devin's Stop input carries no transcript, so the Devin hooks keep their own record: PostToolUse notes each
// code file edited and clears the list when a check command runs; Stop reads it.

const DEVIN_EDIT_TOOLS = new Set(['write', 'edit', 'apply_patch', 'notebook_edit'])
const DEVIN_SHELL_TOOLS = new Set(['exec', 'shell_command'])
const PATCH_FILE = /^\*\*\* (?:Add|Update) File: (.+)$/gm

/** The files a Devin edit-tool call wrote, from whichever field names it uses. */
export function devinEditedFiles(toolInput) {
  const ti = toolInput && typeof toolInput === 'object' ? toolInput : {}
  const out = []
  for (const k of ['file_path', 'path', 'target_file', 'filePath', 'notebook_path']) if (typeof ti[k] === 'string' && ti[k]) out.push(ti[k])
  for (const k of ['patch', 'input', 'diff']) {
    if (typeof ti[k] !== 'string') continue
    for (const m of ti[k].matchAll(PATCH_FILE)) out.push(m[1].trim())
  }
  return [...new Set(out)]
}

const stateFor = (dir, id) => path.join(dir, `verify-devin-${String(id).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 120)}.json`)

function readState(file) {
  try {
    const s = JSON.parse(fs.readFileSync(file, 'utf8'))
    return { files: Array.isArray(s.files) ? s.files : [], asked: s.asked === true }
  } catch (err) {
    if (err?.code !== 'ENOENT') log(GUARD, `could not read ${file}, starting it afresh: ${err?.message ?? err}`)
    return { files: [], asked: false }
  }
}

// Written to a temporary file and renamed, so a hook running at the same moment never reads half a file.
function writeState(file, state) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(state))
  fs.renameSync(tmp, file)
}

/** PostToolUse: keep the list of code files edited since the last check. Always answers `{}`. */
export function recordDevin(input, { dir = stateDir() } = {}) {
  const id = input?.session_id
  const tool = input?.tool_name
  if (typeof tool !== 'string') return STOP
  if (!id) {
    log(GUARD, `${tool} call has no session_id; not recording it`)
    return STOP
  }
  const file = stateFor(dir, id)
  if (DEVIN_SHELL_TOOLS.has(tool)) {
    // A check counts even when it fails (a failing test still tells the agent something); no success test here.
    let cmd = input.tool_input?.command
    if (Array.isArray(cmd)) cmd = cmd.map(String).join(' ')
    if (typeof cmd !== 'string' || !CHECK_CMD.test(cmd)) return STOP
    const s = readState(file)
    if (s.files.length > 0) writeState(file, { ...s, files: [] })
    return STOP
  }
  if (!DEVIN_EDIT_TOOLS.has(tool)) return STOP
  if (input.tool_response && input.tool_response.success === false) return STOP
  const edited = devinEditedFiles(input.tool_input)
  if (edited.length === 0) log(GUARD, `${tool} call names no file I can read (tool_input keys: ${Object.keys(input.tool_input ?? {}).join(', ') || 'none'})`)
  const code = edited.filter(f => !DOC_FILE.test(f))
  if (code.length === 0) return STOP
  const s = readState(file)
  writeState(file, { ...s, files: [...new Set([...s.files, ...code])] })
  return STOP
}

/** Stop: send the agent back once (`decision: 'continue'`, which Devin gets as a block) if edits are unchecked. */
export function decideDevin(input, { dir = stateDir() } = {}) {
  const id = input?.session_id
  if (!id || input.stop_hook_active === true) return STOP
  const file = stateFor(dir, id)
  const s = readState(file)
  if (s.asked || s.files.length === 0) return STOP
  // Mark first: if anything after this fails, the agent is never asked twice.
  writeState(file, { ...s, asked: true })
  const roots = [input.cwd, process.env.DEVIN_PROJECT_DIR].filter(r => typeof r === 'string' && r)
  const files = s.files.map(f => (path.isAbsolute(f) || roots.length === 0 ? f : path.resolve(roots[0], f)))
  const shown = files.slice(0, 5).map(f => path.basename(f)).join(', ') + (files.length > 5 ? `, and ${files.length - 5} more` : '')
  return {
    decision: 'continue',
    reason:
      `verify: you edited ${files.length} file(s) (${shown}) but ran no test, build or check after the last edit. ` +
      `Before finishing, run \`${suggestCheck(files, roots)}\` (or the closest real check: run the thing you changed) and report what it showed. ` +
      "If no check can be run here, say so plainly in your answer instead of implying it works. You'll only be asked this once.",
  }
}

if (isMain(import.meta.url)) {
  await runHook(
    GUARD,
    input => {
      if (HOST !== 'devin') return decide(input)
      if (input?.hook_event_name === 'PostToolUse') return recordDevin(input)
      if (input?.hook_event_name === 'Stop') return decideDevin(input)
      return STOP
    },
    { pass: STOP },
  )
}
