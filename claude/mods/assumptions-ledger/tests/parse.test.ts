import { expect, test } from 'claude-code/testing'

import { parseAssumptions, triageNote } from '../hooks/parse.ts'

test('the triage note sends only owner calls to the inbox', async () => {
  const note = triageNote('Build UI', ['Titles are props'])
  expect(note).toContain('"Build UI"')
  expect(note).toContain('- Titles are props')
  expect(note).toContain('mcp__decision-inbox__ask')
  expect(note).toContain('Settle technical ones without asking the owner')
})

test('reads the section in its usual shapes', async () => {
  const md = 'Done.\n\n## Assumptions I made\n- The API is v2\n- **Bun** is installed\n  on the server too\n\n## Next\n- not this'
  expect(parseAssumptions(md)).toEqual(['The API is v2', 'Bun is installed on the server too'])
  expect(parseAssumptions('**Assumptions I made:**\n1. Port 3000 is free\n2) No auth needed')).toEqual(['Port 3000 is free', 'No auth needed'])
  expect(parseAssumptions('### Assumptions I made\n- None')).toEqual([])
  expect(parseAssumptions('no section here')).toEqual([])
})
