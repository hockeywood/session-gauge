import { expect, test } from 'claude-code/testing'

import { panelDocId, versionFrom } from '../hooks/panel'

test('session ids become safe document ids', () => {
  expect(panelDocId('69514f62-9032-59bf-a247-dd2d3bc77e73')).toBe('69514f62-9032-59bf-a247-dd2d3bc77e73')
  expect(panelDocId('a/b c')).toBe('a_b_c')
  expect(panelDocId('')).toBe('unknown')
})

test('the document version is read from a write result or from text', () => {
  expect(versionFrom({ result: { db_write: { version: 7 } } })).toBe(7)
  expect(versionFrom({ text: '{"id":"x","data":{},"version":3}' })).toBe(3)
  expect(versionFrom({ text: 'The document is now at version 12.' })).toBe(12)
  expect(versionFrom({ text: 'not found' })).toBe(null)
})

test('a gauge refresh writes this session to the panel store', async ($, on) => {
  const calls: Record<string, unknown>[] = []
  on('ui.status', () => ({ value: undefined }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('clock.now', () => ({ value: 1_000_000 }) as never)
  on('session.id', () => ({ value: 'sess-1' }) as never)
  on('session.model', () => ({ value: 'claude-opus-5-5' }) as never)
  on('tool.check', () => ({ decision: 'allow' }) as never)
  on('tool.call', ($, e) => {
    calls.push(e as never)
    return { result: { db_write: { version: calls.length } }, text: 'ok' } as never
  })
  await $.session.measure({
    context: { tokens: 30000, window: 100000, percent: 30 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 12 }],
    changed: ['context', 'rateLimits'],
  })
  await new Promise(r => (globalThis as any).setTimeout(r, 50))
  const w = calls.find(c => c.action === 'set') as Record<string, any> | undefined
  expect(w?.collection).toBe('sessions')
  expect(w?.doc_id).toBe('sess-1')
  expect(w?.data.context).toBe(30)
  expect(w?.data.windows[0].percent).toBe(12)
})
