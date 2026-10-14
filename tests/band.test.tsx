import { expect, test } from 'claude-code/testing'

test('the band draws on terminal and desktop, and More opens the detail', async ($, on) => {
  on('ui.status', () => ({ value: undefined }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('clock.now', () => ({ value: 1_000_000 }) as never)
  await $.session.measure({
    context: { tokens: 65000, window: 100000, percent: 65 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 41 }],
    changed: ['context', 'rateLimits'],
  })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'session-gauge', surface, component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120 } as never })
    expect((await ui.find({ text: 'compact at the next break' }))).toBeTruthy()
    expect((await ui.find({ type: 'Button', key: 'compact' }))).toBeTruthy()
    await ui.press({ key: 'more' })
    expect((await ui.find({ text: /projection|on pace/ }))).toBeTruthy()
    await ui.press({ key: 'more' })
  }
})
