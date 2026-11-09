// Finds known key formats in diff text. A finding names the file, the line and the kind of key,
// never the value: nothing here returns or stores the matched text.

import { globMatch } from './rules.ts'

export type Finding = { file: string; line?: number; kind: string; commit?: string }

const PATTERNS: { kind: string; re: RegExp }[] = [
  { kind: 'private key block', re: /-----BEGIN (?:RSA |DSA |EC |OPENSSH |PGP |ENCRYPTED |SSH2 )?PRIVATE KEY(?: BLOCK)?-----/ },
  { kind: 'AWS access key ID', re: /\b(?:AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16}\b/ },
  { kind: 'AWS secret access key', re: /aws_?secret_?access_?key["']?\s*[:=]\s*["']?[A-Za-z0-9/+=]{40}\b/i },
  { kind: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { kind: 'GitHub fine-grained token', re: /\bgithub_pat_[A-Za-z0-9_]{22,}\b/ },
  { kind: 'Anthropic API key', re: /\bsk-ant-(?:api|admin|oat)\d{2}-[A-Za-z0-9_-]{20,}/ },
  // Bounded quantifiers only: each start costs at most a few hundred steps, so a long line scans in linear time.
  { kind: 'OpenAI API key', re: /\bsk-(?!ant-)[A-Za-z0-9_-]{20,200}T3BlbkFJ[A-Za-z0-9_-]{20}|\bsk-(?:proj|svcacct|admin)-[A-Za-z0-9_-]{40}|\bsk-[A-Za-z0-9]{48}(?![A-Za-z0-9])/ },
  { kind: 'Slack token', re: /\bxox[abposr]-[A-Za-z0-9-]{10,}/ },
  { kind: 'Slack webhook URL', re: /https:\/\/hooks\.slack\.com\/services\/T[A-Za-z0-9]+\/B[A-Za-z0-9]+\/[A-Za-z0-9]{16,}/ },
  { kind: 'Stripe secret key', re: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/ },
  { kind: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { kind: 'Google OAuth client secret', re: /\bGOCSPX-[A-Za-z0-9_-]{28}\b/ },
]

/** The documented AWS example credentials: never real, common in docs and tests. */
const AWS_EXAMPLES = /AKIAIOSFODNN7EXAMPLE|wJalrXUtnFEMI\/K7MDENG\/bPxRfiCYEXAMPLEKEY/g

/** Long lines (minified files) are scanned in windows this long, overlapping by more than any key. */
const WINDOW = 4096
const OVERLAP = 512

/** The kinds of key on one line of text (no values). */
export function kindsIn(text: string): string[] {
  const t = text.replace(AWS_EXAMPLES, ' ')
  const found = new Set<string>()
  for (let start = 0; ; start += WINDOW - OVERLAP) {
    const piece = t.length <= WINDOW ? t : t.slice(start, start + WINDOW)
    for (const p of PATTERNS) if (!found.has(p.kind) && p.re.test(piece)) found.add(p.kind)
    if (start + WINDOW >= t.length) break
  }
  return PATTERNS.filter(p => found.has(p.kind)).map(p => p.kind)
}

/**
 * `.env`, `.env.local`, `prod.env`. Not example, sample, template, test or development files: those are
 * flagged only when a line in them matches a key pattern, like any other file.
 */
export function isEnvFile(path: string): boolean {
  const base = (path.replace(/\\/g, '/').split('/').pop() ?? path).toLowerCase()
  if (/\.(example|sample|template|dist|defaults?|test|testing|development|dev)$/.test(base) || /\.(example|sample|template)\./.test(base)) return false
  return base === '.env' || base.startsWith('.env.') || base.endsWith('.env')
}

function unquote(p: string): string {
  const s = p.trim()
  return s.startsWith('"') && s.endsWith('"') && s.length > 1 ? s.slice(1, -1).replace(/\\(.)/g, '$1') : s
}

/**
 * The two paths of a `diff --git A B` line, and the prefix on the new one: `b/`, a mnemonic one (`i/`, `w/`),
 * or none (`diff.noprefix`).
 */
function headerPaths(rest: string): { file: string; prefix: string } | undefined {
  let a: string
  let b: string
  if (rest.startsWith('"')) {
    const m = /^("(?:[^"\\]|\\.)*") (.+)$/.exec(rest)
    if (!m) return undefined
    a = unquote(m[1] as string)
    b = unquote(m[2] as string)
  } else if (rest.endsWith('"')) {
    const k = rest.lastIndexOf(' "')
    if (k < 0) return undefined
    a = rest.slice(0, k)
    b = unquote(rest.slice(k + 1))
  } else {
    // Unquoted: the two halves have the same length unless the file was renamed.
    const mid = (rest.length - 1) / 2
    if (Number.isInteger(mid) && rest[mid] === ' ') {
      a = rest.slice(0, mid)
      b = rest.slice(mid + 1)
    } else {
      const k = rest.lastIndexOf(' ')
      if (k < 0) return undefined
      a = rest.slice(0, k)
      b = rest.slice(k + 1)
    }
  }
  const pa = /^[a-z]\//.exec(a)?.[0]
  const pb = /^[a-z]\//.exec(b)?.[0]
  if (pa && pb) return { file: b.slice(2), prefix: pb }
  return { file: b, prefix: '' }
}

export const COMMIT_MARK = '\u0001pg-commit '

/**
 * Scans unified diff text (`git diff`, or `git log -p` with `--format=%x01pg-commit %h`): only added
 * lines, and any added or changed `.env` file. `allow` holds the allowPaths globs.
 */
export function scanDiff(diff: string, allow: string[]): Finding[] {
  const found: Finding[] = []
  let file: string | undefined
  let line = 0
  let commit: string | undefined
  let envFlagged = false
  let deleted = false
  let prefix = ''
  // Lines left in the current hunk: inside one, a line starting `+++ ` is content, not a header.
  let oldLeft = 0
  let newLeft = 0
  const allowed = (f: string) => allow.some(g => globMatch(g, f))
  const flagEnv = () => {
    if (file && !deleted && !envFlagged && isEnvFile(file) && !allowed(file)) {
      envFlagged = true
      found.push({ file, kind: '.env file', ...(commit ? { commit } : {}) })
    }
  }
  for (const raw of diff.split('\n')) {
    const l = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    if (oldLeft > 0 || newLeft > 0) {
      if (l.startsWith('+') && newLeft > 0) {
        newLeft--
        if (file !== undefined) {
          flagEnv()
          if (!allowed(file)) for (const kind of kindsIn(l.slice(1))) found.push({ file, line, kind, ...(commit ? { commit } : {}) })
        }
        line++
        continue
      }
      if (l.startsWith('-') && oldLeft > 0) {
        oldLeft--
        continue
      }
      if (l.startsWith(' ')) {
        oldLeft--
        newLeft--
        line++
        continue
      }
      if (l.startsWith('\\')) continue
      // Anything else ends the hunk early (a truncated diff): read it as a header.
      oldLeft = 0
      newLeft = 0
    }
    if (l.startsWith(COMMIT_MARK)) {
      commit = l.slice(COMMIT_MARK.length).trim()
      file = undefined
      continue
    }
    if (l.startsWith('diff --git ')) {
      const h = headerPaths(l.slice(11))
      file = h?.file
      prefix = h?.prefix ?? ''
      envFlagged = false
      deleted = false
      continue
    }
    if (l.startsWith('deleted file mode')) {
      deleted = true
      continue
    }
    if (l.startsWith('new file mode')) {
      flagEnv()
      continue
    }
    if (l.startsWith('+++ ')) {
      const p = l.slice(4)
      if (p === '/dev/null') deleted = true
      else {
        const u = unquote(p)
        file = prefix && u.startsWith(prefix) ? u.slice(prefix.length) : u
      }
      continue
    }
    if (l.startsWith('--- ')) continue
    const hunk = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(l)
    if (hunk) {
      oldLeft = hunk[1] === undefined ? 1 : Number(hunk[1])
      line = Number(hunk[2])
      newLeft = hunk[3] === undefined ? 1 : Number(hunk[3])
    }
  }
  return found
}

/** Scans a whole file's text as if every line were added (an untracked file about to be staged). */
export function scanFile(file: string, text: string, allow: string[]): Finding[] {
  if (allow.some(g => globMatch(g, file))) return []
  const found: Finding[] = []
  if (isEnvFile(file)) found.push({ file, kind: '.env file' })
  text.split('\n').forEach((l, i) => {
    for (const kind of kindsIn(l)) found.push({ file, line: i + 1, kind })
  })
  return found
}

export function describe(findings: Finding[], max = 10): string {
  const seen = new Set<string>()
  const lines: string[] = []
  for (const f of findings) {
    const where = `${f.file}${f.line ? ` line ${f.line}` : ''}${f.commit ? ` (commit ${f.commit})` : ''}`
    const key = `${where}|${f.kind}`
    if (seen.has(key)) continue
    seen.add(key)
    lines.push(`- ${where}: ${f.kind}`)
  }
  const more = lines.length > max ? `\n- ...and ${lines.length - max} more` : ''
  return lines.slice(0, max).join('\n') + more
}
