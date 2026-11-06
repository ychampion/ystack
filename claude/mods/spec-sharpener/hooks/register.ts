import type { Register } from 'claude-code'

import { SHARPEN_NOTE, isOpenBuild } from './sharpen.ts'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'sharpen', description: 'spec-sharpener on/off (asks pointed questions on large open builds)', argumentHint: 'on|off' })
    return next(e)
  })

  on('command.run', { command: 'sharpen' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg !== 'on' && arg !== 'off') return { text: `spec-sharpener is ${(await $.store.get('off')) === true ? 'off' : 'on'}. Use /sharpen on|off.` }
    await $.store.set('off', arg === 'off')
    return { text: `spec-sharpener ${arg}.` }
  })

  on('prompt.submit', async ($, e, next) => {
    const isPerson = e.origin.kind === 'composer' || e.origin.kind === 'bridge'
    if (!isPerson || e.command !== undefined || e.isMeta || !isOpenBuild(e.text)) return next(e)
    if ((await $.store.get('off')) === true) return next(e)
    return next({ ...e, context: [...(e.context ?? []), SHARPEN_NOTE] })
  })
}
