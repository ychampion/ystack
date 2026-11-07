import { expect, test } from 'claude-code/testing'

import { parseVault, safeArgs } from '../hooks/args.ts'
import { decode, encode, fileSave, psLoadAll, psSave, secretToolStore } from '../hooks/keychain.ts'
import { placeholderNames, rewriteCommand } from '../hooks/placeholders.ts'
import { canonicalPath, isInside } from '../hooks/paths.ts'
import { findSecret, formsOf, scrubDeep, scrubText, type Secret } from '../hooks/scrub.ts'

test('paths fold to one spelling per platform', async () => {
  const win = { os: 'windows', home: 'C:\\Users\\Me', powershell: '' } as const
  const linux = { os: 'linux', home: '/home/me', powershell: '' } as const
  const mac = { os: 'mac', home: '/Users/Me', powershell: '' } as const
  expect(canonicalPath('~\\.claude\\.\\x\\..\\Vault.\\', win)).toBe('c:/users/me/.claude/vault')
  expect(canonicalPath('\\\\?\\C:\\a\\\\b', win)).toBe('c:/a/b')
  expect(canonicalPath('\\\\?\\UNC\\srv\\share\\x', win)).toBe('//srv/share/x')
  expect(canonicalPath('sub\\..\\f', win, 'D:\\Work')).toBe('d:/work/f')
  expect(canonicalPath('\\f', win, 'D:\\Work')).toBe('d:/f')
  expect(canonicalPath('D:f', win, 'D:\\Work')).toBe('d:/work/f')
  expect(canonicalPath('E:f', win, 'D:\\Work')).toBe('e:/f')
  expect(canonicalPath('/../../etc', win, 'C:\\')).toBe('c:/etc')
  expect(canonicalPath('~/.claude//./vault/', linux)).toBe('/home/me/.claude/vault')
  expect(canonicalPath('../.Claude/vault', linux, '/home/me/w')).toBe('/home/me/.Claude/vault')
  expect(canonicalPath('a\\b', linux, '/w')).toBe('/w/a\\b') // a backslash is a letter on Linux
  expect(canonicalPath('~/.Claude/Vault', mac)).toBe('/users/me/.claude/vault')
  expect(isInside('/h/.claude/vault', '/h/.claude/vault')).toBe(true)
  expect(isInside('/h/.claude/vault/k', '/h/.claude/vault')).toBe(true)
  expect(isInside('/h/.claude/vaults', '/h/.claude/vault')).toBe(false)
  expect(isInside('/h/.claude', '/h/.claude/vault')).toBe(false)
})

const slot = (name: string) => (name === 'A' ? 'VAULT_SLOT_0' : 'VAULT_SLOT_1')
const bash = (c: string) => rewriteCommand(c, 'bash', slot)
const ps = (c: string) => rewriteCommand(c, 'powershell', slot)

test('placeholders are found once each, and only well-formed ones', async () => {
  expect(placeholderNames('a {{vault:A}} b {{vault:B}} {{vault:A}} {{vault:9bad}} {{vault:}} {vault:C}')).toEqual(['A', 'B'])
})

test('bash: the value is referenced, never written, in every quoting context', async () => {
  expect(bash('curl -H "Authorization: Bearer {{vault:A}}" https://x')).toEqual({
    command: 'curl -H "Authorization: Bearer ${VAULT_SLOT_0}" https://x',
  })
  expect(bash('echo {{vault:A}}')).toEqual({ command: 'echo "${VAULT_SLOT_0}"' })
  expect(bash('tool --key={{vault:A}}')).toEqual({ command: 'tool --key="${VAULT_SLOT_0}"' })
  expect(bash("curl -H 'X-Key: {{vault:A}}' x")).toEqual({ command: `curl -H 'X-Key: '"\${VAULT_SLOT_0}"'' x` })
  expect(bash("printf $'k=\\t{{vault:A}}'")).toEqual({ command: `printf $'k=\\t'"\${VAULT_SLOT_0}"$''` })
  expect(bash('echo "$(cat <<<{{vault:A}})"')).toEqual({ command: 'echo "$(cat <<<"${VAULT_SLOT_0}")"' })
  expect(bash('A={{vault:A}} B="{{vault:B}}" cmd')).toEqual({ command: 'A="${VAULT_SLOT_0}" B="${VAULT_SLOT_1}" cmd' })
  // An escaped brace is no placeholder: left as typed.
  expect(bash('echo \\{{vault:A}}')).toEqual({ command: 'echo \\{{vault:A}}' })
})

test('bash heredocs: expanded when unquoted, refused when quoted', async () => {
  expect(bash('cat <<EOF > .env\nKEY={{vault:A}}\nEOF\necho done {{vault:B}}')).toEqual({
    command: 'cat <<EOF > .env\nKEY=${VAULT_SLOT_0}\nEOF\necho done "${VAULT_SLOT_1}"',
  })
  const quoted = bash("cat <<'EOF'\nKEY={{vault:A}}\nEOF")
  expect('error' in quoted && quoted.error).toContain('quoted heredoc')
})

test('PowerShell: double quotes and bare words reference $env:, single quotes become double quotes', async () => {
  expect(ps('Invoke-RestMethod -Headers @{ Authorization = "Bearer {{vault:A}}" } -Uri $u')).toEqual({
    command: 'Invoke-RestMethod -Headers @{ Authorization = "Bearer ${env:VAULT_SLOT_0}" } -Uri $u',
  })
  expect(ps('tool --key={{vault:A}}')).toEqual({ command: 'tool --key=${env:VAULT_SLOT_0}' })
  expect(ps("$h = 'Bearer {{vault:A}} costs $5 `n it''s'")).toEqual({
    command: '$h = "Bearer ${env:VAULT_SLOT_0} costs `$5 ``n it\'s"',
  })
  expect(ps("echo 'no placeholder $here'")).toEqual({ command: "echo 'no placeholder $here'" })
  expect(ps("$b = @'\nkey: {{vault:A}} $notavar\n'@")).toEqual({ command: '$b = @"\nkey: ${env:VAULT_SLOT_0} `$notavar\n"@' })
  expect(ps('$b = @"\nkey: {{vault:B}}\n"@')).toEqual({ command: '$b = @"\nkey: ${env:VAULT_SLOT_1}\n"@' })
})

const KEY = 'sk-live-4f9a2C7d1E8b3A6f0D5c9B2e7A1f4C8d'
const SECRETS: Secret[] = [{ name: 'OPENAI_KEY', value: KEY }]

test('scrubbing: the raw value, its URL, hex, JSON and base64 forms', async () => {
  expect(scrubText(`token=${KEY}&x=1`, SECRETS)).toEqual({ text: 'token={{vault:OPENAI_KEY}}&x=1', names: ['OPENAI_KEY'] })
  const odd: Secret[] = [{ name: 'PW', value: 'p@ss w/rd+"quote"\\slash' }]
  expect(scrubText(`u=${encodeURIComponent(odd[0]!.value)}`, odd).text).toBe('u={{vault:PW}}')
  expect(scrubText(`u=${encodeURIComponent(odd[0]!.value).replace(/%20/g, '+')}`, odd).text).toBe('u={{vault:PW}}')
  expect(scrubText(JSON.stringify({ pw: odd[0]!.value }), odd).text).toBe('{"pw":"{{vault:PW}}"}')
  const hex = [...new TextEncoder().encode(KEY)].map(b => b.toString(16).padStart(2, '0')).join('')
  expect(scrubText(`xxd: ${hex}`, SECRETS).text).toBe('xxd: {{vault:OPENAI_KEY}}')
  // base64 of the key embedded in longer text, at every byte alignment, standard and URL-safe alphabets
  for (const prefix of ['', 'a', 'ab', 'Bearer ', 'Authorization: Basic user:']) {
    const encoded = btoa(prefix + KEY + '!tail')
    const out = scrubText(`header: ${encoded}`, SECRETS)
    expect(out.names).toEqual(['OPENAI_KEY'])
    const urlSafe = encoded.replace(/\+/g, '-').replace(/\//g, '_')
    expect(scrubText(urlSafe, SECRETS).names).toEqual(['OPENAI_KEY'])
  }
})

test('scrubbing: a value encoded on its own leaves no base64 tail', async () => {
  // Seen live: `printf '%s' KEY | base64` once left the last character and padding behind.
  const dummy = 'ystack-vault-livetest-7Qp2xZ9kLm4N'
  const one: Secret[] = [{ name: 'LIVETEST', value: dummy }]
  expect(scrubText(btoa(dummy), one).text).toBe('{{vault:LIVETEST}}')
  expect(scrubText(`${btoa(dummy + '\n')}\n`, one).text).toBe('{{vault:LIVETEST}}\n')
})

test('scrubbing: values split across lines and multi-line values', async () => {
  const wrapped = btoa(`{"key":"${KEY}"}`).replace(/(.{20})/g, '$1\n')
  const out = scrubText(`base64 -w20 says:\n${wrapped}\ndone`, SECRETS)
  expect(out.names).toEqual(['OPENAI_KEY'])
  expect(out.text).toContain('{{vault:OPENAI_KEY}}')
  const split = `${KEY.slice(0, 15)}\r\n${KEY.slice(15)}`
  expect(scrubText(`terminal wrap: ${split} end`, SECRETS).text).toBe('terminal wrap: {{vault:OPENAI_KEY}} end')
  const pem = '-----BEGIN KEY-----\nMIIBVgIBADANBgkqhkiG9w0BAQEFAASCAUAwggE8\nAgEAAkEAq7BFUpkGp3+XQ\n-----END KEY-----'
  const pemSecrets: Secret[] = [{ name: 'PEM', value: pem }]
  expect(scrubText(`file:\n${pem.replace(/\n/g, '\r\n')}\n`, pemSecrets).text).toBe('file:\n{{vault:PEM}}\n')
})

test('scrubbing leaves clean text alone and keeps unchanged objects identical', async () => {
  const clean = 'build ok\nall 12 tests passed\nhash: 4f9a2C7d'
  expect(scrubText(clean, SECRETS)).toEqual({ text: clean, names: [] })
  const obj = { stdout: clean, nested: [{ a: 1 }, 'x'], n: null }
  expect(scrubDeep(obj, SECRETS).value).toBe(obj)
  const dirty = { stdout: 'ok', stderr: `leak ${KEY}`, more: [KEY] }
  const r = scrubDeep(dirty, SECRETS)
  expect(r.value).toEqual({ stdout: 'ok', stderr: 'leak {{vault:OPENAI_KEY}}', more: ['{{vault:OPENAI_KEY}}'] })
  expect(r.names).toEqual(['OPENAI_KEY'])
  expect(findSecret(`x ${btoa(KEY)}`, SECRETS)).toBe('OPENAI_KEY')
  expect(findSecret('nothing here', SECRETS)).toBeUndefined()
  // Short forms are not searched for (too many false hits); the raw value always is.
  expect(formsOf('abc')).toEqual(['abc'])
})

test('/vault arguments: only the subcommand and a valid name are kept', async () => {
  expect(safeArgs('add OPENAI_KEY')).toBe('add OPENAI_KEY')
  expect(safeArgs('add OPENAI_KEY sk-live-pasted-by-mistake')).toBe('add OPENAI_KEY')
  expect(safeArgs('add sk-live-1234')).toBe('add')
  expect(safeArgs('sk-live-1234')).toBe('')
  expect(safeArgs('list extra')).toBe('list')
  expect(parseVault('add OPENAI_KEY')).toEqual({ kind: 'add', name: 'OPENAI_KEY' })
  expect(parseVault('rm X1')).toEqual({ kind: 'remove', name: 'X1' })
  expect(parseVault('').kind).toBe('help')
  expect(parseVault('add 1bad').kind).toBe('bad')
})

test('storage commands carry the value on stdin only, never in the command line', async () => {
  expect(decode(encode('ünïcødé key ✓'))).toBe('ünïcødé key ✓')
  for (const script of [psSave('OPENAI_KEY'), psLoadAll()]) expect(script).not.toContain(KEY)
  expect(psSave('OPENAI_KEY')).toContain('[Console]::In.ReadToEnd()')
  expect(secretToolStore('OPENAI_KEY')).toEqual(['secret-tool', 'store', '--label', 'Claude vault: OPENAI_KEY', 'service', 'claude-vault', 'name', 'OPENAI_KEY'])
  expect(fileSave('/home/u/.claude/vault', 'OPENAI_KEY').join(' ')).toContain('umask 077')
  expect(() => psSave("x'; Remove-Item C:\\ -Recurse; '")).toThrow()
})

test('a pasted key that happens to fit the name pattern is not kept as a name', async () => {
  // Stripe, GitHub and AWS keys use only letters, digits and underscores, so they pass NAME.
  for (const k of [('sk' + '_live_51HxYzAbCdEfGhIjKlMnOpQr'), ('gh' + 'p_aB3dE5gH7jK9mN1pQ3sT5vX7zA9cE1gH3jK5'), ('AK' + 'IAIOSFODNN7EXAMPLE')]) {
    expect(safeArgs(`add ${k}`)).toBe('add')
    expect(parseVault(`add ${k}`).kind).toBe('bad')
  }
  // ordinary names still work
  for (const n of ['OPENAI_KEY', 'STRIPE_KEY_2', 'MY_SERVICE_ACCOUNT_TOKEN', 'github_token']) expect(safeArgs(`add ${n}`)).toBe(`add ${n}`)
})
