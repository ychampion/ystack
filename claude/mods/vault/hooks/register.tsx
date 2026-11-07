import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, ToolCallResult } from 'claude-code'

import { parseVault, safeArgs } from './args.ts'
import { describeKey, loadAll, platform, readIndex, removeKey, saveKey, vaultDir, type Backend, type Platform } from './keychain.ts'
import { canonicalPath, isInside } from './paths.ts'
import { NAME, placeholder, placeholderNames, rewriteCommand, type Shell } from './placeholders.ts'
import { findSecret, scrubDeep, scrubText, type Secret } from './scrub.ts'

// vault: Claude uses API keys without seeing them. The owner types a key into a box the mod draws (it
// never passes through the model); it is kept in the operating system's protected storage. Claude writes
// {{vault:NAME}} in shell commands; for that one call the mod puts the value in an environment variable
// and points the command at it, then puts {{vault:NAME}} back wherever the value shows up in a result.

const PANE = 'vault-add'

const adding = atom({ plugin: 'vault', key: 'adding' } as const, '', { shape: 'adding-1' })
const note = atom({ plugin: 'vault', key: 'note' } as const, '', { shape: 'note-1' })
/** Set while saved keys could not be loaded: what the band tells the owner. Empty when all is well. */
const problem = atom({ plugin: 'vault', key: 'problem' } as const, '', { shape: 'problem-1' })

const HIDDEN = '[vault: hidden, scrub error]'

/** A toast that never throws: a surface without toasts must not break the guard. */
function toast($: EngineInterface, text: string) {
  try {
    $.ui.toast(text, { timeoutMs: 10_000 })
  } catch {
    // no toast surface here; the band still shows
  }
}

// Values live in this module's memory only: never in $.store, $.state or a file the mod writes.
let values = new Map<string, string>()
let secrets: Secret[] = []
let loading: Promise<void> | undefined
let plat: Platform | undefined
let droppedExtra = false
const unreadable = new Set<string>()

function setValues(next: Map<string, string>) {
  values = next
  secrets = [...next].map(([name, value]) => ({ name, value }))
}

async function getPlatform($: EngineInterface): Promise<Platform> {
  plat ??= await platform($)
  return plat
}

/** The index file's text as of the last load: another session's add or remove changes it. */
let indexSeen: string | undefined

async function readIndexText($: EngineInterface, p: Platform): Promise<string> {
  const text = await $.fs.read(`${vaultDir(p)}/index.json`).catch(() => '')
  return typeof text === 'string' ? text : ''
}

async function load($: EngineInterface): Promise<void> {
  const p = await getPlatform($)
  const seen = await readIndexText($, p)
  const r = await loadAll($, p)
  setValues(r.values)
  unreadable.clear()
  r.unreadable.forEach(n => unreadable.add(n))
  indexSeen = seen
  if (r.unreadable.length > 0) await setProblem($, `couldn't read ${r.unreadable.join(', ')}`)
  else await setProblem($, '')
}

/** True while saved keys exist that this session could not load: their values would not be hidden. */
let loadFailed = false
let lastRetry = 0

/** Loads the keys again after a failure (the owner may have fixed it). */
async function retryLoad($: EngineInterface): Promise<void> {
  lastRetry = await $.clock.now()
  loading = undefined
  await ensureLoaded($)
}

/** Shows or clears the load problem: a band always, a toast when it first appears. */
async function setProblem($: EngineInterface, why: string): Promise<void> {
  const was = loadFailed
  loadFailed = why !== ''
  const text = loadFailed ? `vault: couldn't load your saved keys (${why}); key hiding is OFF until fixed. /vault list shows which.` : ''
  if (loadFailed && !was) toast($, text)
  await update($, problem, () => text).catch(() => undefined)
}

/** Loads again when another session saved or removed a key since the last load. */
async function ensureCurrent($: EngineInterface): Promise<void> {
  await ensureLoaded($)
  if (loadFailed && (await $.clock.now()) - lastRetry >= 60_000) await retryLoad($)
  if (indexSeen === undefined) return
  const now = await readIndexText($, await getPlatform($))
  if (now === indexSeen) return
  loading = undefined
  await ensureLoaded($)
}

/** Loads the saved values once per session; a failed load is tried again by the next caller. */
async function ensureLoaded($: EngineInterface): Promise<void> {
  try {
    await (loading ??= load($))
  } catch {
    loading = load($) // once more, on this caller's own dispatch
    await loading.catch(async (err: unknown) => {
      loading = undefined // the next caller tries again
      await setProblem($, err instanceof Error ? err.message.slice(0, 120) : 'the load failed').catch(() => undefined)
    })
  }
}

// ---- environment slots: the names $.env.set takes must be written out literally ----

const SLOT_COUNT = 16
const slotsInUse = new Set<number>()
const slotName = (i: number) => `VAULT_SLOT_${i}`

function setSlot($: EngineInterface, i: number, value: string | undefined) {
  switch (i) {
    case 0: return $.env.set('VAULT_SLOT_0', value)
    case 1: return $.env.set('VAULT_SLOT_1', value)
    case 2: return $.env.set('VAULT_SLOT_2', value)
    case 3: return $.env.set('VAULT_SLOT_3', value)
    case 4: return $.env.set('VAULT_SLOT_4', value)
    case 5: return $.env.set('VAULT_SLOT_5', value)
    case 6: return $.env.set('VAULT_SLOT_6', value)
    case 7: return $.env.set('VAULT_SLOT_7', value)
    case 8: return $.env.set('VAULT_SLOT_8', value)
    case 9: return $.env.set('VAULT_SLOT_9', value)
    case 10: return $.env.set('VAULT_SLOT_10', value)
    case 11: return $.env.set('VAULT_SLOT_11', value)
    case 12: return $.env.set('VAULT_SLOT_12', value)
    case 13: return $.env.set('VAULT_SLOT_13', value)
    case 14: return $.env.set('VAULT_SLOT_14', value)
    case 15: return $.env.set('VAULT_SLOT_15', value)
    default: return Promise.resolve({ deny: 'no such slot' })
  }
}

async function clearAllSlots($: EngineInterface) {
  for (let i = 0; i < SLOT_COUNT; i++) if (!slotsInUse.has(i)) await setSlot($, i, undefined).catch(() => undefined)
}

// ---- guards ----

/** Shell text that reaches for the stored keys themselves. A deny-list on spellings: a hint, best effort. */
const STORE_TOUCH = /\.claude[\\/]+vault|\.dpapi\b|secret-tool\b[^\n;|&]*\b(lookup|search)\b|claude-vault|VAULT_SLOT_/i

const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])

function writtenText(input: Record<string, unknown>): string {
  const parts: string[] = []
  for (const k of ['content', 'new_string', 'new_source']) if (typeof input[k] === 'string') parts.push(input[k] as string)
  if (Array.isArray(input.edits)) {
    for (const ed of input.edits) {
      const s = (ed as Record<string, unknown> | null)?.new_string
      if (typeof s === 'string') parts.push(s)
    }
  }
  return parts.join('\n')
}

/** The fields that name a file or folder (Read, Write, Edit, MultiEdit, NotebookEdit, Grep, Glob and the like). */
const PATH_FIELDS = ['file_path', 'notebook_path', 'path']

/**
 * True when a tool's path is the store folder or inside it, however it is spelled. A second layer only:
 * scrubbing every result is the main protection. A search rooted above the store is let through (its
 * results are scrubbed); a glob or URL that spells the store out is refused as a hint.
 */
async function touchesStore($: EngineInterface, input: Record<string, unknown>): Promise<boolean> {
  if (['pattern', 'url'].some(k => typeof input[k] === 'string' && /\.claude[\\/]+vault/i.test(input[k] as string))) return true
  const paths = PATH_FIELDS.map(k => input[k]).filter((v): v is string => typeof v === 'string' && v !== '')
  if (paths.length === 0) return false
  try {
    const p = await getPlatform($)
    const cwd = await $.session.cwd().catch(() => '')
    const store = canonicalPath(vaultDir(p), p)
    return paths.some(raw => isInside(canonicalPath(raw, p, cwd), store))
  } catch {
    // Platform unknown: fall back to the spelling check rather than let the path through unchecked.
    return paths.some(raw => /\.claude[\\/]+vault/i.test(raw))
  }
}

/** Puts {{vault:NAME}} wherever a saved value shows up in what the tool answered. */
function scrubResult(ran: ToolCallResult, list: readonly Secret[]): ToolCallResult {
  if (list.length === 0) return ran
  if (ran.deny !== undefined) {
    const d = scrubText(ran.deny, list)
    return d.names.length > 0 ? { deny: d.text } : ran
  }
  const result = scrubDeep(ran.result, list)
  const text = ran.text !== undefined ? scrubText(ran.text, list) : undefined
  const context = ran.context ? scrubDeep(ran.context, list) : undefined
  const changed = result.names.length > 0 || (text?.names.length ?? 0) > 0 || (context?.names.length ?? 0) > 0
  if (!changed) return ran
  if (ran.isError) return { deny: text?.text ?? 'The command failed (its output held a saved key and was hidden).' }
  // A fresh answer without `ref`: the engine maps and records the scrubbed result, not its own copy.
  return { result: result.value, ...(context ? { context: context.value } : {}) }
}

let warnedScrub = false
function warnScrub($: EngineInterface) {
  if (warnedScrub) return
  warnedScrub = true
  toast($, `vault: part of a message could not be checked for saved keys, so it was replaced with ${HIDDEN}.`)
}

/** A block put in place of one that could not be checked, keeping what pairs it with its tool call. */
function hiddenBlock(block: unknown): unknown {
  const b = block !== null && typeof block === 'object' ? (block as Record<string, unknown>) : {}
  if (b.type === 'tool_result' && typeof b.tool_use_id === 'string') return { type: 'tool_result', tool_use_id: b.tool_use_id, content: HIDDEN, is_error: true }
  if (b.type === 'tool_use' && typeof b.id === 'string' && typeof b.name === 'string') return { type: 'tool_use', id: b.id, name: b.name, input: {} }
  return { type: 'text', text: HIDDEN }
}

function hiddenContent(content: unknown): unknown {
  return Array.isArray(content) ? content.map(hiddenBlock) : HIDDEN
}

/** Scrubs a row's content block by block; a block whose check throws is replaced, never kept as it was. */
function scrubContent(content: unknown, list: readonly Secret[]): { value: unknown; changed: boolean; failed: boolean } {
  if (!Array.isArray(content)) {
    try {
      const r = scrubDeep(content, list)
      return { value: r.value, changed: r.value !== content, failed: false }
    } catch {
      return { value: HIDDEN, changed: true, failed: true }
    }
  }
  let changed = false
  let failed = false
  const value = content.map(block => {
    try {
      const r = scrubDeep(block, list)
      if (r.value !== block) changed = true
      return r.value
    } catch {
      changed = failed = true
      return hiddenBlock(block)
    }
  })
  return { value: changed ? value : content, changed, failed }
}

function where(b: Backend | undefined): string {
  if (b === 'dpapi') return "Windows' encrypted storage for your account"
  if (b === 'secret-tool') return "your system's keyring"
  if (b === 'file') return 'a file only your user account can read (not encrypted)'
  return 'secure storage'
}

async function listText($: EngineInterface): Promise<string> {
  await ensureLoaded($)
  const p = await getPlatform($)
  const index = await readIndex($, p)
  const names = [...new Set([...Object.keys(index.keys), ...values.keys()])].sort()
  if (names.length === 0) return 'No keys saved yet. Type /vault add NAME to add one.'
  return [
    'Saved keys (values are never shown):',
    ...names.map(n => {
      const e = index.keys[n]
      const problem = unreadable.has(n) || !values.has(n) ? ' (could not be read on this machine)' : ''
      return `- ${n}${e?.description ? `: ${e.description}` : ''}${problem}`
    }),
  ].join('\n')
}

const HELP = [
  'vault keeps API keys where Claude can use them without seeing them.',
  '- /vault add NAME: opens a box to type the key into (NAME like OPENAI_KEY)',
  '- /vault list: shows the names you saved',
  '- /vault remove NAME: deletes one',
  'Claude uses a key by writing {{vault:NAME}} in a command.',
].join('\n')

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    values = new Map()
    secrets = []
    loading = undefined
    indexSeen = undefined
    unreadable.clear()
    loadFailed = false
    lastRetry = 0
    warnedScrub = false
    await update($, problem, () => '').catch(() => undefined)
    await $.command.register({
      name: 'vault',
      description: 'Save, list or remove API keys Claude can use without seeing them',
      argumentHint: 'add NAME | list | remove NAME',
    })
    await $.tool.register({
      name: 'vault_list',
      isDeferred: false,
      description:
        'Lists the API keys the owner saved in the vault: each name and what it is for, never the values. ' +
        'To use a key, write {{vault:NAME}} in a Bash or PowerShell command, e.g. curl -H "Authorization: Bearer {{vault:OPENAI_KEY}}" https://... ' +
        'The real value is passed in only while the command runs, and anywhere it shows up in what you read back it is replaced with {{vault:NAME}}. ' +
        'Never ask the owner to paste a key into the chat: ask them to type /vault add NAME, which opens a private box. ' +
        'Do not try to print, transform or save a key value; writing one into a file is blocked.',
      inputSchema: { type: 'object', properties: {} },
    })
    void ensureLoaded($)
    void clearAllSlots($)
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    await clearAllSlots($)
    return next(e)
  })

  // Outermost: keep only the subcommand and a valid name in what the transcript records of /vault,
  // so a key pasted after the name is never stored or read by Claude.
  on('command.run', { command: 'vault' }, ($, e, next) => {
    const clean = safeArgs(e.args)
    droppedExtra = clean !== e.args.trim().replace(/\s+/g, ' ')
    return next(clean === e.args ? e : { ...e, args: clean })
  }).catch(($, e, next) => (next.called ? next(e) : next({ ...e, args: '' })))

  on('command.run', { command: 'vault' }, async ($, e) => {
    const extra = droppedExtra ? 'I left out what you typed after the name, so it is not kept in the chat. ' : ''
    droppedExtra = false
    const cmd = parseVault(e.args)
    if (cmd.kind === 'help') return { text: `${extra}${HELP}\n\n${await listText($)}` }
    if (cmd.kind === 'bad') return { text: extra + cmd.why }
    if (cmd.kind === 'list') return { text: extra + (await listText($)) }
    if (cmd.kind === 'remove') {
      await ensureLoaded($)
      const p = await getPlatform($)
      const known = await removeKey($, p, cmd.name)
      const had = values.has(cmd.name)
      const next = new Map(values)
      next.delete(cmd.name)
      setValues(next)
      indexSeen = await readIndexText($, p)
      return { text: extra + (known || had ? `Removed ${cmd.name}.` : `There was no key named ${cmd.name}.`) }
    }
    await update($, adding, () => cmd.name)
    await update($, note, () => '')
    await $.ui.open({ id: PANE, title: `Add key ${cmd.name}`, focus: true, closeOnEscape: true })
    return {
      text: `${extra}Type the key for ${cmd.name} in the box that just opened and press Enter. It goes straight to secure storage; Claude never sees it.`,
    }
  })

  on('tool.call', { tool: /^mcp__vault__vault_list$/ }, async $ => ({ result: await listText($) })).catch(() => ({
    result: 'vault: the list could not be read just now. Ask the owner to type /vault list.',
  }))

  on('tool.call', async ($, e, next) => {
    await ensureCurrent($)
    let list = secrets
    const input = e as unknown as Record<string, unknown>
    const tool = String(e.tool)

    if (WRITE_TOOLS.has(tool) && list.length > 0) {
      const hit = findSecret(writtenText(input), list)
      if (hit) {
        return {
          deny: `vault: that would write the saved key ${hit} into a file, which is blocked. Use ${placeholder(hit)} in a shell command where the key is needed instead.`,
        }
      }
    }

    if (e.tool === 'Bash' || e.tool === 'PowerShell') {
      if (STORE_TOUCH.test(e.command)) return { deny: 'vault: that command reaches for the stored keys themselves, which Claude may not read.' }
      const names = placeholderNames(e.command)
      if (names.length === 0) return scrubResult(await next(e), list)
      if (loadFailed) {
        await retryLoad($) // a command that needs a key is worth one more try
        list = secrets // scrub with the keys just loaded
      }
      if (loadFailed) {
        return {
          deny: `vault: refused. I couldn't load your saved keys, so key hiding is OFF and the key could show up in what you read back. Tell the owner (the band above the prompt says what failed); try again once it is fixed.`,
        }
      }

      const missing = names.filter(n => !values.has(n))
      if (missing.length > 0) {
        return {
          deny: `vault: no saved key named ${missing.join(', ')}. Ask the owner to type /vault add ${missing[0]} (they type the key into a private box), then try again.`,
        }
      }
      const free = [...Array(SLOT_COUNT).keys()].filter(i => !slotsInUse.has(i))
      if (free.length < names.length) return { deny: 'vault: too many keys in use at once. Try again in a moment.' }
      const slotFor = new Map(names.map((n, k) => [n, free[k] as number]))
      const shell: Shell = e.tool === 'PowerShell' ? 'powershell' : 'bash'
      const rewritten = rewriteCommand(e.command, shell, n => slotName(slotFor.get(n) as number))
      if ('error' in rewritten) return { deny: `vault: ${rewritten.error}` }

      for (const i of slotFor.values()) slotsInUse.add(i)
      try {
        for (const [n, i] of slotFor) {
          const set = await setSlot($, i, values.get(n) as string)
          if (set.deny) return { deny: `vault: couldn't pass the key to the command here (${set.deny}).` }
        }
        const ran = await next({ ...e, command: rewritten.command })
        return scrubResult(ran, list)
      } finally {
        for (const i of slotFor.values()) {
          await setSlot($, i, undefined).catch(() => undefined)
          slotsInUse.delete(i)
        }
      }
    }

    if (await touchesStore($, input)) return { deny: 'vault: the stored keys are off limits.' }
    return scrubResult(await next(e), list)
  }).catch(($, e, next) => {
    // A broken guard must not leak a key: hold back an answer it could not check, refuse a call it could
    // not prepare. With no keys saved there is nothing to protect, so the call goes on.
    if (secrets.length === 0) return next(e)
    return next.called
      ? { deny: 'vault: could not check this result for saved keys, so it was held back. Try again.' }
      : { deny: 'vault: could not prepare this call safely, so it was refused. Try again.' }
  })

  // Belt and braces: every row the conversation keeps is scrubbed before it is stored or sent.
  // A row that cannot be checked is never kept as it was: the part that failed is replaced by a marker.
  on('session.append', ($, e, next) => {
    const list = secrets
    if (list.length === 0) return next(e)
    const r = scrubContent(e.message.content, list)
    if (r.failed) warnScrub($)
    return r.changed ? next({ ...e, message: { ...e.message, content: r.value as typeof e.message.content } }) : next(e)
  }).catch(($, e, next) => {
    if (secrets.length === 0) return next(e)
    warnScrub($)
    return next({ ...e, message: { ...e.message, content: hiddenContent(e.message.content) as typeof e.message.content } })
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const text = await read($, problem)
    if (e.props.hasSurvey || !text) return next(e)
    const { Text } = $.ui.resolve(e)
    return <Text color="warning">{text}</Text>
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Input } = $.ui.resolve(e)
    const name = await read($, adding)
    const message = await read($, note)

    const save = async (raw: string) => {
      const value = raw.trim()
      if (!NAME.test(name)) return update($, note, () => 'Open this box with /vault add NAME first.')
      if (!value) return update($, note, () => 'Nothing typed.')
      try {
        await ensureLoaded($)
        const p = await getPlatform($)
        const backend = await saveKey($, p, name, value, await $.clock.now())
        const next = new Map(values)
        next.set(name, value)
        setValues(next)
        unreadable.delete(name)
        indexSeen = await readIndexText($, p)
        await $.session
          .append({
            message: {
              type: 'user',
              content: [
                {
                  type: 'text',
                  text: `vault: the owner saved a key named ${name}. Where a command needs it, write ${placeholder(name)}; never ask for its value.`,
                },
              ],
            },
          })
          .catch(() => undefined)
        return update($, note, () => `Saved ${name} in ${where(backend)}. Add a note on what it is for below if you like, or press Esc.`)
      } catch (err) {
        return update($, note, () => `Not saved: ${err instanceof Error ? err.message : 'something went wrong'}`)
      }
    }

    const describe = async (raw: string) => {
      if (!NAME.test(name) || !values.has(name)) return update($, note, () => 'Save the key first.')
      const ok = await describeKey($, await getPlatform($), name, raw)
      return update($, note, () => (ok ? 'Note saved. Press Esc to close.' : 'Could not save the note.'))
    }

    return (
      <Box flexDirection="column">
        <Text>
          Paste the key for {name || 'NAME'} and press Enter. It goes to secure storage and is never shown to Claude. It is visible on
          your screen while you type.
        </Text>
        <Input key="value" label="Key  " placeholder="paste the key here" submitLabel="save" autoFocus onSubmit={v => void save(v)} />
        <Input key="description" label="Note " placeholder="what it is for (optional)" submitLabel="save note" onSubmit={v => void describe(v)} />
        {message !== '' && <Text dimColor>{message}</Text>}
      </Box>
    )
  })
}
