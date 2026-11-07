import type { EngineInterface, Register } from 'claude-code'

import { MAX_CHARS, type Profile, expandHome, screen, section } from './profile.ts'

// Adds the owner's own profile (facts about them, what they own, what they authorize) to the system prompt,
// once per session, framed as facts that never override safety rules. Lines that try to switch safety off are dropped.

const PANE = 'operator'
const SECTION_ID = 'operator-context:profile'

let profileSetting = '~/.claude/operator.md'
let isForSubagents = true

type Loaded = { path: string; profile?: Profile } // no profile: no file, or nothing left in it
let loading: Promise<Loaded> | undefined
let isBandSeen = false

async function home($: EngineInterface): Promise<string> {
  return (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? ''
}

// Read once, at the first need, and kept for the session: the section stays the same every turn.
function load($: EngineInterface): Promise<Loaded> {
  loading ??= (async (): Promise<Loaded> => {
    const path = expandHome(profileSetting, await home($))
    const raw = await $.fs.read(path).catch(() => undefined)
    if (typeof raw !== 'string') return { path }
    const profile = screen(raw)
    return { path, profile: profile.text === '' && profile.dropped.length === 0 ? undefined : profile }
  })()
  return loading
}

const hasIssue = (p?: Profile) => p !== undefined && (p.dropped.length > 0 || p.isCut)

export const register: Register = (on, options) => {
  if (typeof options.profileFile === 'string' && options.profileFile.trim() !== '') profileSetting = options.profileFile.trim()
  isForSubagents = options.subagents !== false

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'operator', description: 'Your operator profile as Claude sees it, or `edit` for where the file is', argumentHint: '[edit]' })
    loading = undefined // a new session (or /clear) reads the file afresh
    isBandSeen = false
    void load($)
    return next(e)
  })

  // One session section, appended after everything the engine and other plugins composed.
  on('prompt.compose', async ($, e, next) => {
    const out = await next(e)
    const { profile } = await load($)
    if (!profile || profile.text === '') return out
    if (out.sections.some(s => s.id === SECTION_ID)) return out
    return { sections: [...out.sections, { id: SECTION_ID, text: section(profile.text), scope: 'session' as const }] }
  })

  // A subagent's system prompt is its agent definition's, so the profile rides at the top of its task instead.
  // A fork already has the main thread's prompt; a resumed run keeps the prompt it started with.
  on('agent.spawn', async ($, e, next) => {
    if (!isForSubagents || e.fork || e.resume !== undefined) return next(e)
    const { profile } = await load($)
    if (!profile || profile.text === '') return next(e)
    return next({ ...e, prompt: `${section(profile.text)}\n\n---\n\n${e.prompt}` })
  })

  on('command.run', { command: 'operator' }, async ($, e) => {
    const { path, profile } = await load($)
    if (e.args.trim().toLowerCase() === 'edit') {
      return {
        text: `Your profile file: ${path}\nEdit it in any editor. Changes apply from the next session. Keep it to facts and authorizations, under ${MAX_CHARS} characters.`,
      }
    }
    isBandSeen = true
    await $.ui.open({ id: PANE, title: 'Operator profile' })
    if (!profile) return { text: `No operator profile loaded (no file at ${path}, or it is empty).` }
    return { text: 'Operator profile pane opened.' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (isBandSeen || e.props.hasSurvey || loading === undefined) return next(e)
    const { profile } = await load($)
    if (!hasIssue(profile) || !profile) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const parts: string[] = []
    if (profile.dropped.length > 0) parts.push(`dropped ${profile.dropped.length} line${profile.dropped.length === 1 ? '' : 's'} that try to switch off safety`)
    if (profile.isCut) parts.push(`file is ${profile.chars} characters, cut to ${MAX_CHARS}`)
    return (
      <Box>
        <Text color="warning">operator-context: {parts.join('; ')} (/operator)</Text>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const { path, profile } = await load($)
    return (
      <Box flexDirection="column">
        <Text dimColor>{path}</Text>
        {!profile && <Text>No profile loaded: no file here, or it is empty. Claude gets no operator section.</Text>}
        {profile && (
          <Text bold>
            Loaded: {profile.text.length} characters{profile.isCut ? ` (file had ${profile.chars}, cut to ${MAX_CHARS})` : ''}
          </Text>
        )}
        {profile && profile.text !== '' && <Text>{profile.text}</Text>}
        {profile && profile.dropped.length > 0 && <Text color="warning">Dropped (these try to switch off safety):</Text>}
        {profile?.dropped.map(l => (
          <Text color="warning">- {l}</Text>
        ))}
      </Box>
    )
  })
}
