import { expect, test } from 'claude-code/testing'

import { advice, project, turnsLeft } from '../hooks/register'

const HOUR = 3_600_000

test('advice thresholds', () => {
  expect(advice(null).text).toBe('fresh')
  expect(advice(40).text).toBe('healthy')
  expect(advice(65).text).toBe('compact at the next break')
  expect(advice(85).text).toBe('start a new session')
})

test('projection blends own pace with a typical one', () => {
  // 5h window, 2.5h in, 40% used: weight 2/3, own 16/h, typical 10/h, rate 14/h, +35 over 2.5h
  const now = 10 * HOUR
  expect(Math.round(project('five_hour', 40, now + 2.5 * HOUR, now)!)).toBe(75)
  expect(project('five_hour', 40, null, now)).toBe(null)
  expect(project('five_hour', 40, now - 1, now)).toBe(null)
})

test('replies left at the recent growth', () => {
  expect(turnsLeft([10], 10)).toEqual({ growth: null, left: null })
  // +5, +5, +5 per reply, now at 40: (80 - 40) / 5 = 8
  expect(turnsLeft([25, 30, 35, 40], 40)).toEqual({ growth: 5, left: 8 })
})

test('a measurement sets the status line and toasts once per threshold', async ($, on) => {
  const statuses: (string | undefined)[] = []
  const toasts: string[] = []
  on('ui.status', ($, e) => { statuses.push(e.text); return { value: undefined } as never })
  on('ui.toast', ($, e) => { toasts.push(e.text); return { value: undefined } as never })
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('clock.now', () => ({ value: 1_000_000 }) as never)

  const measure = (percent: number) => $.session.measure({
    context: { tokens: percent * 1000, window: 100000, percent },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 41 },
      { kind: 'seven_day', percentUsed: 18 },
    ],
    changed: ['context', 'rateLimits'],
  })

  await measure(65)
  await measure(66)
  await measure(82)

  expect(statuses.at(-1)).toBe('Context 82% | 5h 41% | week 18% | start a new session')
  expect(toasts).toEqual(['Context 65%: compact at the next break', 'Context 82%: start a new session'])
})
