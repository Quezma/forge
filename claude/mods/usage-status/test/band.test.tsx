import { expect, test } from 'claude-code/testing'

test('the band draws gauges on every surface', async ($, on) => {
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.status', () => ({ value: undefined }))
  on('clock.now', () => ({ value: 0 }))
  on('session.model', () => ({ value: 'claude-opus-5-5[1m]' }))
  on('session.id', () => ({ value: 'b0ce86f1-xxxx' }))
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { tokens: 230000, window: 1000000, percent: 23 },
      rateLimits: [
        { kind: 'five_hour', percentUsed: 41 },
        { kind: 'seven_day', percentUsed: 88 },
      ],
      cost: { usd: 1.84 },
    },
  }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({
      plugin: 'usage-status',
      component: 'AbovePrompt',
      surface,
      props: { hasSurvey: false },
    } as never)
    expect((await ui.find({ type: 'Text', text: /opus-5-5 1M/ }))?.text).toContain('88%')
    await ui.unmount()
  }
})
