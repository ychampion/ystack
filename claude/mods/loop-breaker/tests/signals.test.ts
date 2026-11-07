import { expect, test } from 'claude-code/testing'

import { errorSignature, escalate, evidencePack, hashText, newLoop, normCommand, observeCommand, observeFile, testOutcomes } from '../hooks/signals.ts'

test('commands and errors normalise', async () => {
  expect(normCommand('  bun   test  2>&1 | tail -20')).toBe('bun test')
  expect(normCommand("tsc -p 'a b'")).toBe('tsc -p "a b"')
  const a = errorSignature('ok\nError: Cannot find module C:\\work\\app\\src\\x.ts at line 12 (0xdeadbeef)')
  const b = errorSignature('Error: Cannot find module /home/me/app/lib/y.ts at line 99 (0x1234)')
  expect(a).toBe(b)
  expect(a).toContain('cannot find module <path>')
  expect(errorSignature('all good\nExit code 1')).toBe('')
})

test('the same failing command trips after N repeats', async () => {
  let s = newLoop()
  const fail = { cmd: 'bun test', isOk: false, output: '(fail) adds\nerror: expected 2' }
  for (let i = 1; i <= 2; i++) {
    const r = observeCommand(s, fail, 3)
    expect(r.signals).toEqual([])
    s = r.state
  }
  const r = observeCommand(s, { ...fail, cmd: 'bun  test 2>&1' }, 3)
  expect(r.signals[0]?.kind).toBe('command')
  expect(r.signals[0]?.count).toBe(3)
})

test('the same error across different commands trips', async () => {
  let s = newLoop()
  const cmds = ['node a.js', 'node b.js', 'python c.py']
  let last
  for (const [i, cmd] of cmds.entries()) {
    last = observeCommand(s, { cmd, isOk: false, output: `TypeError: undefined is not a function at ${i + 10}:4` }, 3)
    s = last.state
  }
  expect(last?.signals[0]?.kind).toBe('error')
})

test('a check that passes after failing resets the counters', async () => {
  let s = newLoop('fix the parser')
  s = observeCommand(s, { cmd: 'bun test', isOk: false, output: 'error: boom' }, 3).state
  s = observeCommand(s, { cmd: 'bun test', isOk: false, output: 'error: boom' }, 3).state
  s = { ...s, level: 1 }
  const r = observeCommand(s, { cmd: 'bun test', isOk: true, output: '(pass) x' }, 3)
  expect(r.isProgress).toBe(true)
  expect(r.state.cmdFails).toEqual({})
  expect(r.state.level).toBe(0)
  expect(r.state.task).toBe('fix the parser')
})

test('A to B to A on a file trips', async () => {
  const A = hashText('const x = 1'),
    B = hashText('const x = 2')
  let s = newLoop()
  let r = observeFile(s, 'C:/r/x.ts', B, A)
  expect(r.signals).toEqual([])
  s = r.state
  r = observeFile(s, 'C:/r/x.ts', A)
  expect(r.signals[0]?.kind).toBe('revert')
  expect(r.signals[0]?.what).toBe('x.ts')
  // A to B to C is progress, not a loop
  const C = hashText('const x = 3')
  expect(observeFile(observeFile(newLoop(), 'f', B, A).state, 'f', C).signals).toEqual([])
})

test('test outcomes parse and flapping trips on the third flip', async () => {
  expect([...testOutcomes('(pass) adds [1.2ms]\n(fail) subtracts\n--- FAIL: TestX\nFAILED tests/a.py::test_b - x')]).toEqual([
    ['adds', 'pass'],
    ['subtracts', 'fail'],
    ['TestX', 'fail'],
    ['tests/a.py::test_b', 'fail'],
  ])
  let s = newLoop()
  const outs = ['(pass) parses', '(fail) parses', '(pass) parses', '(fail) parses']
  const kinds: string[] = []
  for (const [i, o] of outs.entries()) {
    // vary the command so neither the command nor the error counter is what trips
    const r = observeCommand(s, { cmd: `bun test --seed ${i}`, isOk: true, output: o }, 9)
    kinds.push(r.signals.map(x => x.kind).join(','))
    s = r.state
  }
  expect(kinds).toEqual(['', '', '', 'flap'])
})

test('the ladder: note, second opinion, stop; no second opinion without the model', async () => {
  let s = newLoop()
  const a = escalate(s, true)
  expect(a.action).toBe('note')
  const b = escalate(a.state, true)
  expect(b.action).toBe('second-opinion')
  expect(escalate(b.state, true).action).toBe('stop')
  // model unknown (or the setting off): step 2 is skipped straight to the stop
  s = escalate(newLoop(), false).state
  expect(escalate(s, false).action).toBe('stop')
})

test('the evidence pack carries the task, failures and files, and no history', async () => {
  let s = newLoop('Make the login page load')
  s = observeCommand(s, { cmd: 'bun test login', isOk: false, output: 'error: 500 from /api/login' }, 3).state
  s = observeFile(s, 'src/login.ts', hashText('b'), hashText('a')).state
  const pack = evidencePack(s, { kind: 'command', what: 'bun test login', count: 3 })
  expect(pack).toContain('Make the login page load')
  expect(pack).toContain('error: 500 from /api/login')
  expect(pack).toContain('src/login.ts')
})

test('rerunning a check that fails differently each time is the fix cycle, not a loop', async () => {
  let s = newLoop()
  const kinds: string[] = []
  // five independent failures, one fixed per round: the failing set shrinks every run
  const all = ['a', 'b', 'c', 'd', 'e']
  for (let round = 0; round < 5; round++) {
    const out = all.slice(round).map(t => `(fail) ${t}\nerror: expect(received).toBe(expected)`).join('\n')
    const r = observeCommand(s, { cmd: 'bun test', isOk: false, output: out }, 3)
    kinds.push(r.signals.map(x => x.kind).join(','))
    s = r.state
  }
  expect(kinds).toEqual(['', '', '', '', ''])
  // the same failure again and again still trips
  for (let i = 0; i < 2; i++) s = observeCommand(s, { cmd: 'bun test', isOk: false, output: '(fail) e\nerror: expect(received).toBe(expected)' }, 3).state
  expect(observeCommand(s, { cmd: 'bun test', isOk: false, output: '(fail) e\nerror: expect(received).toBe(expected)' }, 3).signals[0]?.kind).toBe('command')
})
