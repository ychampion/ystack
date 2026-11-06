import { expect, test } from 'claude-code/testing'

import { parseAt, parseStatus, wrap } from '../hooks/queue.ts'

test('status line and start time', async () => {
  expect(parseStatus('All good.\nNIGHT-SHIFT: done — shipped the parser on branch ns/1')).toEqual({ status: 'done', summary: 'shipped the parser on branch ns/1' })
  expect(parseStatus('NIGHT-SHIFT: blocked - needs the Razorpay key')?.status).toBe('blocked')
  expect(parseStatus('still working')).toBeUndefined()
  const now = new Date(2026, 10, 4, 22, 0)
  expect(new Date(parseAt('23:30', now) ?? 0).getHours()).toBe(23)
  expect(new Date(parseAt('01:00', now) ?? 0).getDate()).toBe(5)
  expect(parseAt('soon', now)).toBeUndefined()
  expect(wrap({ id: 1, text: 'Build X', status: 'pending' }, 1, 3, 40, 3)).toContain('NIGHT-SHIFT: done|blocked|failed')
})
