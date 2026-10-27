import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionMeasureInput } from 'claude-code'

import type { Gauge, Snapshot } from '../types'

const snapshot = atom({ plugin: 'usage-status', key: 'snapshot' } as const, null)

const CELLS = 10
const k = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`)
const tone = (p: number) => (p < 50 ? 'success' : p < 80 ? 'warning' : 'error')

const until = (iso: string | undefined, now: number) => {
  if (!iso) return undefined
  const m = Math.max(0, Math.round((Date.parse(iso) - now) / 60000))
  const d = Math.floor(m / 1440)
  const h = Math.floor((m % 1440) / 60)
  return d > 0 ? `${d}d${h}h` : h > 0 ? `${h}h${m % 60}m` : `${m}m`
}

const take = (
  model: string,
  id: string,
  u: Pick<SessionMeasureInput, 'context' | 'rateLimits' | 'cost'>,
  now: number,
): Snapshot => {
  const c = u.context
  const limit = (kind: string, label: string): Gauge => {
    const l = u.rateLimits.find(r => r.kind === kind)
    const reset = until(l?.resetsAt, now)
    return { label, percent: l?.percentUsed, note: reset && `↻ ${reset}` }
  }
  return {
    model: model.replace(/^claude-/, '').replace(/\[1m\]$/, ' 1M'),
    id: id.slice(0, 8),
    cost: u.cost?.usd,
    gauges: [
      {
        label: 'ctx',
        percent: c.percent,
        note: c.tokens === undefined ? `${k(c.window)} window` : `${k(c.window - c.tokens)} left`,
      },
      limit('five_hour', '5h'),
      limit('seven_day', 'week'),
    ],
  }
}

async function refresh($: EngineInterface, u: Parameters<typeof take>[2]) {
  const s = take(await $.session.model(), await $.session.id(), u, await $.clock.now())
  await update($, snapshot, () => s)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    $.ui.status(undefined)
    await refresh($, await $.session.usage())
    return r
  })

  on('session.measure', async ($, e, next) => {
    await refresh($, e)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const s = await read($, snapshot)
    if (s === null || e.props.hasSurvey) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const sep = () => <Text color="subtle"> │ </Text>

    const gauge = (g: Gauge) => {
      const filled = g.percent === undefined ? 0 : Math.min(CELLS, Math.round((g.percent / 100) * CELLS))
      const color = g.percent === undefined ? 'inactive' : tone(g.percent)
      return (
        <Text>
          {sep()}
          <Text color="subtle">{g.label} </Text>
          <Text color={color}>{'━'.repeat(filled)}</Text>
          <Text color="inactive">{'━'.repeat(CELLS - filled)}</Text>
          <Text color={color} weight="bold">
            {' '}
            {g.percent === undefined ? '–' : `${g.percent}%`}
          </Text>
          {g.note ? <Text dimColor> {g.note}</Text> : null}
        </Text>
      )
    }

    return (
      <Box flexDirection="row" paddingX={1} marginTop={1}>
        <Text wrap="truncate-end">
          <Text color="claude" weight="bold">◆ {s.model}</Text>
          {sep()}
          <Text dimColor>{s.id}</Text>
          {s.cost === undefined ? null : sep()}
          {s.cost === undefined ? null : <Text color="suggestion">${s.cost.toFixed(2)}</Text>}
          {s.gauges.map(gauge)}
        </Text>
      </Box>
    )
  })
}
