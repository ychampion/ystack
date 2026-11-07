// Realistic command outputs, generated so the files stay small.

const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1)

/** `bun test` with 2 failures among 240 passing tests. */
export const BUN_TEST_FAIL = [
  'bun test v1.3.2 (b131639c)',
  '',
  'src/parser.test.ts:',
  ...range(120).map(i => `(pass) parser > parses case ${i} [0.${i % 9}${i % 7}ms]`),
  '(fail) parser > handles an error in nested quotes [1.20ms]',
  '',
  'error: expect(received).toBe(expected)',
  '',
  'Expected: "a\\"b"',
  'Received: "a"',
  '',
  '      at <anonymous> (C:/repo/src/parser.test.ts:88:23)',
  '',
  'src/billing.test.ts:',
  ...range(118).map(i => `(pass) billing > invoice ${i} totals [0.${i % 8}1ms]`),
  '(fail) billing > rounds tax to cents [0.40ms]',
  '',
  'error: expect(received).toEqual(expected)',
  '  - 10.05',
  '  + 10.049999',
  '      at <anonymous> (C:/repo/src/billing.test.ts:41:17)',
  '',
  ' 238 pass',
  ' 2 fail',
  ' 512 expect() calls',
  'Ran 240 tests across 2 files. [1.84s]',
].join('\n')

/** `bun install` with ANSI colour, carriage-return progress redraws and repeated resolve lines. */
export const INSTALL_LOG = [
  '\x1b[1mbun install\x1b[0m \x1b[2mv1.3.2\x1b[0m',
  ...range(60).map(i => `Resolving dependencies \r[${'='.repeat(i % 20)}>] ${i * 2}%\rResolved ${i * 3} packages`),
  ...range(220).map(i => `\x1b[32m+\x1b[0m package-${i}@${i % 5}.${i % 9}.${i % 3}`),
  '\x1b[33mwarn:\x1b[0m incorrect peer dependency "react@18.3.1"',
  ...range(40).map(i => `Downloading \r${i * 2.5}% \r${i * 2.5 + 1}%`),
  '',
  '\x1b[1m221 packages\x1b[0m installed [4.12s]',
].join('\n')

/** A long source file, as `cat` prints it. */
export const LONG_FILE = range(600)
  .map(i => (i % 10 === 0 ? `// error handling for case ${i}` : `export const value${i} = ${i} // line ${i}`))
  .join('\n')

export const SHORT_OUTPUT = range(12)
  .map(i => `line ${i}`)
  .join('\n')
