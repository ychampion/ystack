import { expect, mock, test, type Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

// The whole loop against stand-ins for the machine: an in-memory "PowerShell + DPAPI", an in-memory
// file system, the process environment, and a shell that records what reached it.

const KEY = 'sk-live-4f9a2C7d1E8b3A6f0D5c9B2e7A1f4C8d'

type World = {
  dpapi: Map<string, string>
  argvSeen: string[][]
  stdinSeen: string[]
  env: Map<string, string>
  envLog: string[]
  files: Map<string, string>
  shell: { command: string; slot?: string }[]
  /** When set, the PowerShell that loads the saved keys fails, as a broken DPAPI or profile would. */
  failLoad?: boolean
}

function world(on: On, shellAnswer: (command: string, env: Map<string, string>) => unknown = () => 'ok'): World {
  const w: World = { dpapi: new Map(), argvSeen: [], stdinSeen: [], env: new Map(), envLog: [], files: new Map(), shell: [] }
  mock.env(on, { OS: 'Windows_NT', USERPROFILE: 'C:\\Users\\tester', SystemRoot: 'C:\\Windows' })
  mock.clock(on, { now: Date.parse('2026-11-07T12:00:00Z') })
  on('process.run', async ($, e) => {
    w.argvSeen.push([...e.argv])
    const script = e.argv[e.argv.length - 1] ?? ''
    const stdin = e.init?.stdin ?? ''
    w.stdinSeen.push(stdin)
    const name = /'([A-Za-z][A-Za-z0-9_]*)\.dpapi'/.exec(script)?.[1]
    if (script.includes('ConvertFrom-SecureString') && name) {
      w.dpapi.set(name, stdin.trim()) // base64, as the real script reads it
      return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    if (script.includes('ConvertTo-Json')) {
      if (w.failLoad) return { value: { exitCode: 1, stdout: '', stderr: 'Key not valid for use in specified state.', isStdoutTruncated: false, isStderrTruncated: false } }
      return { value: { exitCode: 0, stdout: JSON.stringify(Object.fromEntries(w.dpapi)), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    if (script.includes('Remove-Item') && name) {
      w.dpapi.delete(name)
      return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    return { value: { exitCode: 1, stdout: '', stderr: 'unexpected', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  // The kit hands paths over resolved; one spelling per file here.
  const key = (p: string) => p.replace(/\//g, '\\')
  on('fs.read', async ($, e) => (w.files.has(key(e.path)) ? { value: w.files.get(key(e.path)) as string } : { deny: 'ENOENT' }))
  on('fs.write', async ($, e) => {
    w.files.set(key(e.path), e.text)
    return { value: undefined }
  })
  on('fs.list', async () => ({ value: [] }))
  on('env.set', async ($, e) => {
    if (e.value === undefined) w.env.delete(e.name)
    else w.env.set(e.name, e.value)
    w.envLog.push(`${e.name}=${e.value === undefined ? '(unset)' : e.value === KEY ? '(the key)' : 'other'}`)
    return { value: {} }
  })
  on('command.register', async ($, e) => ({ value: { command: e.name } }))
  on('tool.register', async ($, e) => ({ value: { tool: e.name } }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  on('tool.call', async ($, e) => {
    if (e.tool === 'Bash' || e.tool === 'PowerShell') {
      const slot = /VAULT_SLOT_(\d+)/.exec(e.command)?.[0]
      w.shell.push({ command: e.command, ...(slot ? { slot } : {}) })
      return { result: shellAnswer(e.command, w.env) }
    }
    return { result: { content: `read: ${KEY}` } }
  })
  return w
}

const PANE = {
  plugin: 'vault',
  component: 'Pane',
  requestId: 'vault-add',
  props: { title: 'Add key', isFocused: true, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const

const run = ($: Engine, args: string) => $.command.run({ command: 'vault', args } as Parameters<typeof $.command.run>[0])

async function addKey($: Engine, name: string, value: string) {
  await run($, `add ${name}`)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.input({ key: 'value', text: value })
  const msg = await ui.find({ type: 'Text', text: /Saved|Not saved/ })
  await ui.unmount()
  return msg?.text ?? ''
}

test('adding a key: it goes to storage on stdin, and no row Claude reads holds it', async ($, on) => {
  const w = world(on)
  const rows = mock.session(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const opened = await run($, 'add OPENAI_KEY')
  expect(opened.text).toContain('Type the key for OPENAI_KEY in the box')
  expect(await addKey($, 'OPENAI_KEY', `  ${KEY}\n`)).toContain("Saved OPENAI_KEY in Windows' encrypted storage")
  // Stored DPAPI-side as base64 of the value, which arrived on standard input only.
  expect(atob(w.dpapi.get('OPENAI_KEY') as string)).toBe(KEY)
  for (const argv of w.argvSeen) expect(argv.join(' ')).not.toContain(KEY)
  for (const argv of w.argvSeen) expect(argv.join(' ')).not.toContain(btoa(KEY))
  // The index holds the name and where it went, never the value.
  const index = [...w.files.values()].join('\n')
  expect(index).toContain('OPENAI_KEY')
  expect(index).not.toContain(KEY)
  // Every row appended to the conversation (what the transcript keeps) is free of the value.
  const appended = JSON.stringify(rows.appended())
  expect(appended).toContain('the owner saved a key named OPENAI_KEY')
  expect(appended).not.toContain(KEY)
  expect(appended).not.toContain(btoa(KEY))
})

test('using a key: the command references an env slot set only for that call, and output is scrubbed', async ($, on) => {
  const w = world(on, (command, env) => {
    const v = env.get('VAULT_SLOT_0') ?? ''
    return { stdout: `got ${v}\nb64 ${btoa('Bearer ' + v)}\nwrapped ${v.slice(0, 10)}\n${v.slice(10)}`, stderr: '', interrupted: false }
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await addKey($, 'OPENAI_KEY', KEY)
  const r = await $.tool.call({ tool: 'Bash', command: 'curl -H "Authorization: Bearer {{vault:OPENAI_KEY}}" https://api.example.com' })
  expect(w.shell[0]?.command).toBe('curl -H "Authorization: Bearer ${VAULT_SLOT_0}" https://api.example.com')
  expect(w.envLog).toContain('VAULT_SLOT_0=(the key)')
  expect(w.env.has('VAULT_SLOT_0')).toBe(false) // unset again after the call
  const out = JSON.stringify(r.result)
  expect(out).not.toContain(KEY)
  expect(out).not.toContain(KEY.slice(10))
  expect(out).toContain('got {{vault:OPENAI_KEY}}')
  expect(out).toContain('wrapped {{vault:OPENAI_KEY}}')
  expect((out.match(/\{\{vault:OPENAI_KEY\}\}/g) ?? []).length).toBe(3)
})

test('PowerShell gets $env: references', async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await addKey($, 'API_TOKEN', KEY)
  await $.tool.call({ tool: 'PowerShell', command: "Invoke-RestMethod -Headers @{ 'X-Token' = '{{vault:API_TOKEN}}' } -Uri $u" })
  expect(w.shell[0]?.command).toBe('Invoke-RestMethod -Headers @{ \'X-Token\' = "${env:VAULT_SLOT_0}" } -Uri $u')
})

test('an unknown key name is refused with the add command to give the owner', async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const r = await $.tool.call({ tool: 'Bash', command: 'echo {{vault:NOPE}}' })
  expect(r.deny ?? r.text).toContain('/vault add NOPE')
  expect(w.shell).toEqual([])
})

test('every tool result is scrubbed, not only shell output', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await addKey($, 'OPENAI_KEY', KEY)
  const r = await $.tool.call({ tool: 'Read', file_path: 'C:\\work\\.env' })
  expect(JSON.stringify(r.result)).toBe('{"content":"read: {{vault:OPENAI_KEY}}"}')
})

test('writing a saved value into a file is denied, in raw or encoded form', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await addKey($, 'OPENAI_KEY', KEY)
  const raw = await $.tool.call({ tool: 'Write', file_path: 'C:\\work\\.env', content: `OPENAI_API_KEY=${KEY}\n` })
  expect(raw.deny ?? raw.text).toContain('would write the saved key OPENAI_KEY into a file')
  const enc = await $.tool.call({ tool: 'Edit', file_path: 'a.ts', old_string: 'x', new_string: `const k = atob("${btoa(KEY)}")` })
  expect(enc.deny ?? enc.text).toContain('OPENAI_KEY')
  const fine = await $.tool.call({ tool: 'Write', file_path: 'C:\\work\\notes.md', content: 'use {{vault:OPENAI_KEY}} here' })
  expect(fine.deny).toBeUndefined()
})

test('vault_list returns names and notes, never values', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await addKey($, 'OPENAI_KEY', KEY)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.input({ key: 'description', text: 'OpenAI production key' })
  await ui.unmount()
  const r = await $.tool.call({ tool: 'mcp__vault__vault_list' } as unknown as Parameters<typeof $.tool.call>[0])
  expect(String(r.result)).toContain('OPENAI_KEY: OpenAI production key')
  expect(JSON.stringify(r)).not.toContain(KEY)
  const listed = await run($, 'list')
  expect(listed.text).toContain('OPENAI_KEY')
  expect(listed.text).not.toContain(KEY)
})

test('a key pasted after the name in /vault add is dropped from the command, and the owner is told', async ($, on) => {
  world(on)
  const rows = mock.session(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const r = await run($, `add OPENAI_KEY ${KEY}`)
  expect(r.text).toContain('I left out what you typed after the name')
  expect(r.text).not.toContain(KEY)
  expect(JSON.stringify(rows.appended())).not.toContain(KEY)
})

test('remove deletes the key from storage and from scrubbing', async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await addKey($, 'OPENAI_KEY', KEY)
  expect((await run($, 'remove OPENAI_KEY')).text).toBe('Removed OPENAI_KEY.')
  expect(w.dpapi.has('OPENAI_KEY')).toBe(false)
  expect((await run($, 'remove OPENAI_KEY')).text).toBe('There was no key named OPENAI_KEY.')
})

test('commands that reach for the stored keys are refused', async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  for (const command of ['Get-Content $HOME\\.claude\\vault\\OPENAI_KEY.dpapi', 'cat ~/.claude/vault/index.json', 'secret-tool lookup service claude-vault name X', 'echo $VAULT_SLOT_0']) {
    const r = await $.tool.call({ tool: 'Bash', command })
    expect(r.deny ?? r.text).toContain('vault:')
  }
  const read = await $.tool.call({ tool: 'Read', file_path: 'C:\\Users\\tester\\.claude\\vault\\index.json' })
  expect(read.deny ?? read.text).toContain('off limits')
  expect(w.shell).toEqual([])
})

test('the store folder is off limits however its path is spelled', async ($, on) => {
  world(on)
  on('session.cwd', () => ({ value: 'C:\\Users\\tester\\.claude' }))
  await $.session.start({ cwd: 'C:\\Users\\tester\\.claude', surface: 'terminal', isInteractive: true })
  const calls: Record<string, unknown>[] = [
    { tool: 'Read', file_path: 'C:\\Users\\tester\\.claude\\.\\vault\\index.json' },
    { tool: 'Read', file_path: 'C:/Users/tester/.claude/x/../vault/OPENAI_KEY.dpapi' },
    { tool: 'Read', file_path: 'c:\\USERS\\Tester\\.CLAUDE\\Vault\\index.json' },
    { tool: 'Read', file_path: 'C:\\Users\\tester\\.claude\\vault.\\index.json' },
    { tool: 'Read', file_path: 'C:\\Users\\tester\\.claude\\vault\\ \\..\\index.json' },
    { tool: 'Read', file_path: 'C:\\Users\\tester\\.claude\\vault\\...\\..\\index.json' },
    { tool: 'Read', file_path: '\\\\?\\C:\\Users\\tester\\.claude\\vault\\index.json' },
    { tool: 'Read', file_path: 'vault\\index.json' },
    { tool: 'Read', file_path: '..\\.claude\\vault' },
    { tool: 'Write', file_path: '~/.claude/./vault/index.json', content: '{}' },
    { tool: 'Edit', file_path: '~\\.claude\\x\\..\\vault\\index.json', old_string: 'a', new_string: 'b' },
    { tool: 'NotebookEdit', notebook_path: 'C:\\Users\\tester\\.claude\\.\\vault\\n.ipynb', new_source: 'x' },
    { tool: 'Grep', pattern: 'sk-', path: 'C:\\Users\\tester\\.claude\\.\\vault' },
    { tool: 'Glob', pattern: '*', path: '~/.claude/x/../vault/' },
  ]
  for (const call of calls) {
    const r = await $.tool.call(call as unknown as Parameters<typeof $.tool.call>[0])
    expect(`${JSON.stringify(call)} -> ${r.deny ?? 'allowed'}`).toContain('off limits')
  }
})

test('the folders around the store stay usable: an ancestor search, a look-alike sibling', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const calls: Record<string, unknown>[] = [
    { tool: 'Grep', pattern: 'x', path: 'C:\\Users\\tester\\.claude' },
    { tool: 'Glob', pattern: '*.md', path: '~/.claude' },
    { tool: 'Read', file_path: 'C:\\Users\\tester\\.claude\\vaults\\notes.md' },
    { tool: 'Read', file_path: 'C:\\Users\\tester\\.claude\\vault-notes.md' },
  ]
  for (const call of calls) {
    const r = await $.tool.call(call as unknown as Parameters<typeof $.tool.call>[0])
    expect(`${JSON.stringify(call)} -> ${r.deny ?? 'allowed'}`).toContain('allowed')
  }
})

test('keys saved earlier are loaded at session start and scrubbed from the first result', async ($, on) => {
  const w = world(on, () => ({ stdout: `env dump: X=${KEY}`, stderr: '', interrupted: false }))
  w.dpapi.set('OLD_KEY', btoa(KEY))
  w.files.set('C:\\Users\\tester\\.claude\\vault\\index.json',JSON.stringify({ keys: { OLD_KEY: { description: '', addedAt: 1, backend: 'dpapi' } } }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const r = await $.tool.call({ tool: 'Bash', command: 'env' })
  expect(JSON.stringify(r.result)).toContain('X={{vault:OLD_KEY}}')
})

test('a key pasted where the name goes is kept out of the chat', async ($, on) => {
  world(on)
  const rows = mock.session(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const stripe = ('sk' + '_live_51HxYzAbCdEfGhIjKlMnOpQr')
  const r = await run($, `add ${stripe}`)
  expect(r.text).not.toContain(stripe)
  expect(JSON.stringify(rows.appended())).not.toContain(stripe)
})

test('a key saved by another session is usable here and scrubbed', async ($, on) => {
  const w = world(on, (command, env) => ({ stdout: `got ${env.get('VAULT_SLOT_0') ?? ''}`, stderr: '', interrupted: false }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'echo warm-up' })
  // another session saves OTHER_KEY: the DPAPI file and the shared index change on disk
  w.dpapi.set('OTHER_KEY', btoa(KEY))
  w.files.set('C:\\Users\\tester\\.claude\\vault\\index.json', JSON.stringify({ keys: { OTHER_KEY: { description: '', addedAt: 1, backend: 'dpapi' } } }))
  const r = await $.tool.call({ tool: 'Bash', command: 'echo {{vault:OTHER_KEY}}' })
  expect(r.deny).toBeUndefined()
  expect(JSON.stringify(r.result)).toContain('got {{vault:OTHER_KEY}}')
  expect(JSON.stringify(r.result)).not.toContain(KEY)
})

const BAND = {
  plugin: 'vault',
  component: 'AbovePrompt',
  requestId: 'above-prompt',
  surface: 'terminal',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80, scroll: { offset: 0, bodyRows: 9 }, view: {} },
} as const

test('saved keys that cannot be loaded: the owner is told, and {{vault:...}} commands are refused until fixed', async ($, on) => {
  const w = world(on, (command, env) => ({ stdout: `got ${env.get('VAULT_SLOT_0') ?? ''}`, stderr: '', interrupted: false }))
  const toasts: string[] = []
  on('ui.toast', (_, e) => {
    toasts.push(JSON.stringify(e))
    return { value: undefined }
  })
  on('ui.render', ($, e) => h($.ui.resolve(e).Box, {}) as never)
  w.failLoad = true
  w.dpapi.set('OLD_KEY', btoa(KEY))
  w.files.set('C:\\Users\\tester\\.claude\\vault\\index.json', JSON.stringify({ keys: { OLD_KEY: { description: '', addedAt: 1, backend: 'dpapi' } } }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const r = await $.tool.call({ tool: 'Bash', command: 'curl -H "X-Token: {{vault:OLD_KEY}}" https://api.example.com' })
  expect(r.deny ?? '').toContain("couldn't load your saved keys")
  expect(w.shell).toEqual([])
  expect(toasts.join('\n')).toContain('key hiding is OFF')
  const band = await $.ui.mount(BAND)
  expect(await band.find({ type: 'Text', text: /key hiding is OFF/ })).toBeDefined()
  await band.unmount()
  // fixed: the next call loads the keys, uses them, and the band goes away
  w.failLoad = false
  const ok = await $.tool.call({ tool: 'Bash', command: 'echo {{vault:OLD_KEY}}' })
  expect(ok.deny).toBeUndefined()
  expect(JSON.stringify(ok.result)).toContain('got {{vault:OLD_KEY}}')
  const after = await $.ui.mount(BAND)
  expect(await after.find({ type: 'Text', text: /key hiding is OFF/ })).toBeUndefined()
  await after.unmount()
})

test('a row that cannot be scrubbed is not kept as it was: the risky part is hidden', async ($, on) => {
  world(on)
  const rows = mock.session(on)
  on('ui.toast', () => ({ value: undefined }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await addKey($, 'OPENAI_KEY', KEY)
  let deep: unknown = KEY
  for (let i = 0; i < 80; i++) deep = { x: deep }
  await $.session.append({
    message: { type: 'user', content: [{ type: 'text', text: 'kept as is' }, { type: 'text', text: 'see below', extra: deep }] },
  } as unknown as Parameters<typeof $.session.append>[0])
  const appended = JSON.stringify(rows.appended())
  expect(appended).not.toContain(KEY)
  expect(appended).toContain('[vault: hidden, scrub error]')
  expect(appended).toContain('kept as is')
})
