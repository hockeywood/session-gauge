import { expect, test } from 'claude-code/testing'

import { readout } from '../hooks/register'

const HOUR = 3_600_000

test('readout lists context, both limits and projections', () => {
  const now = 10 * HOUR
  const text = readout(
    {
      context: 65,
      growth: 5,
      turnsLeft: 3,
      windows: [
        { kind: 'five_hour', percent: 40, resetsAt: now + 2.5 * HOUR, projected: 75 },
        { kind: 'seven_day', percent: 23, resetsAt: now + 4 * 24 * HOUR, projected: 52.4 },
      ],
      source: 'reply',
      readAt: now,
    },
    now,
  )
  expect(text).toBe(
    [
      'Context 65%: compact at the next break',
      'Replies left before 80%: ~3 at ~5.0 points per reply (projected)',
      '5h: 40% used, resets in 2h 30m, on pace for ~75% at reset (projected)',
      'week: 23% used, resets in 4d, on pace for ~52% at reset (projected)',
      'Limits read from the last reply. Compact from 60%, new session from 80%.',
    ].join('\n'),
  )
})

test('/gauge prints the readout; /gauge off and on toggle the band', async ($, on) => {
  on('ui.status', () => ({ value: undefined }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('clock.now', () => ({ value: 1_000_000 }) as never)
  await $.session.measure({
    context: { tokens: 30000, window: 100000, percent: 30 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 12 }],
    changed: ['context', 'rateLimits'],
  })
  const shown = await $.command.run({ command: 'gauge', args: '' } as never)
  expect(shown.text).toContain('Context 30%: healthy')
  expect(shown.text).toContain('5h: 12% used')
  expect((await $.command.run({ command: 'gauge', args: 'off' } as never)).text).toBe('Session gauge band off.')
  expect((await $.command.run({ command: 'gauge', args: 'on' } as never)).text).toBe('Session gauge band on.')
})
