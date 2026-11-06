// Pure rewrite rules, kept apart from the hooks so tests can drive them directly.

// A command word starts the line or follows a shell separator.
const CMD_START = String.raw`(^|[;&|(\n]\s*|&&\s*|\|\|\s*)`

/** npm/npx -> bun/bunx for the subcommands that map one-to-one. Others (publish, view, login) pass. */
export function rewriteNpm(command: string): string {
  let out = command
  // npx <pkg> -> bunx <pkg>
  out = out.replace(new RegExp(CMD_START + String.raw`npx(\s+)`, 'g'), '$1bunx$2')
  // npm run <x> / npm run-script <x> -> bun run <x>
  out = out.replace(new RegExp(CMD_START + String.raw`npm\s+(run|run-script)\b`, 'g'), '$1bun run')
  // npm test / npm t -> bun run test (the package script, not bun's own runner)
  out = out.replace(new RegExp(CMD_START + String.raw`npm\s+(test|t)\b`, 'g'), '$1bun run test')
  // npm start -> bun run start
  out = out.replace(new RegExp(CMD_START + String.raw`npm\s+start\b`, 'g'), '$1bun run start')
  // npm install / i / ci / add with package args -> bun add (dev flag mapped); bare -> bun install
  out = out.replace(
    new RegExp(CMD_START + String.raw`npm\s+(install|i|ci|add)\b([^;&|\n]*)`, 'g'),
    (_m, lead: string, _sub: string, rest: string) => {
      const args = rest.trim().split(/\s+/).filter(Boolean)
      const pkgs = args.filter(a => !a.startsWith('-'))
      const isDev = args.some(a => a === '-D' || a === '--save-dev')
      const isGlobal = args.some(a => a === '-g' || a === '--global')
      if (pkgs.length === 0) return `${lead}bun install`
      const flags = [isDev ? '-d' : '', isGlobal ? '-g' : ''].filter(Boolean)
      return `${lead}bun add ${[...flags, ...pkgs].join(' ')}`
    },
  )
  // npm uninstall / remove / rm <pkg> -> bun remove <pkg>
  out = out.replace(new RegExp(CMD_START + String.raw`npm\s+(uninstall|remove|rm|un)\b`, 'g'), '$1bun remove')
  return out
}

/** A name with spaces is quoted so the shell keeps it one argument. */
const quote = (v: string) => (/\s/.test(v) ? `"${v}"` : v)

const COMMIT_SUBCOMMANDS = 'commit|merge|cherry-pick|revert|rebase|am|pull'

/** Adds -c user.name/-c user.email to every git invocation that can create commits. */
export function addGitIdentity(command: string, name: string, email: string): string {
  if (/user\.email\s*=/.test(command)) return command
  const re = new RegExp(
    String.raw`\bgit((?:\s+-C\s+(?:"[^"]*"|'[^']*'|\S+))*)(\s+)(` + COMMIT_SUBCOMMANDS + String.raw`)\b`,
    'g',
  )
  return command.replace(
    re,
    (_m, dashC: string, sp: string, sub: string) =>
      `git${dashC} -c user.name=${quote(name)} -c user.email=${email}${sp}${sub}`,
  )
}

// Whole lines, for message files.
const ATTRIBUTION_LINE =
  /^[ \t]*(?:Co-Authored-By:[^\n]*(?:Claude|Anthropic|noreply@anthropic\.com)[^\n]*|[^\n]*Generated with \[?Claude Code\]?[^\n]*)(?:\r?\n|$)/gim

// Phrases only, for inline command text: never eats a closing quote or the rest of the command.
const ATTRIBUTION_PHRASE =
  /Co-Authored-By:[ \t]*[^\n"'`]*(?:Claude|Anthropic)[^\n"'`]*|(?:🤖[ \t]*)?Generated with \[Claude Code\]\([^)\s]*\)|(?:🤖[ \t]*)?Generated with Claude Code/gi

/** Removes AI attribution lines from a message file's text. */
export function stripAttribution(text: string): string {
  const hadFinalNewline = text.endsWith('\n')
  const cut = text.replace(ATTRIBUTION_LINE, '').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '')
  return hadFinalNewline ? cut + '\n' : cut
}

/** Removes attribution phrases from inline command text (commit -m, gh --body). */
export function stripInlineAttribution(command: string): string {
  return command.replace(ATTRIBUTION_PHRASE, '').replace(/(\r?\n[ \t]*){3,}/g, '\n\n')
}

/** Paths a `git commit -F <file>` / `--file=<file>` or `gh ... --body-file <file>` names. */
export function messageFiles(command: string): string[] {
  const out: string[] = []
  const re = /(?:\bgit\b[^;&|\n]*?\s(?:-F|--file)(?:\s+|=)|\bgh\b[^;&|\n]*?\s--body-file(?:\s+|=))("([^"]+)"|'([^']+)'|(\S+))/g
  for (const m of command.matchAll(re)) {
    const p = m[2] ?? m[3] ?? m[4]
    if (p && p !== '-') out.push(p)
  }
  return out
}

/** Nested shell deletes (PowerShell -> cmd /c -> rmdir): the quoting breaks and the wrong folder can go. */
export function isNestedCmdDelete(command: string): boolean {
  return /\bcmd(\.exe)?\s+\/[cCkK]\s+["']?\s*(rmdir|rd|del|erase)\b/i.test(command)
}
