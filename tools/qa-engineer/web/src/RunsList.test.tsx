import { render, screen } from '@testing-library/react'
import { RunsList } from './RunsList'
import type { RunSummary } from './types'

const run: RunSummary = {
  id: '20261003T101500Z-login', name: 'login flow', base_url: 'http://localhost:3000',
  status: 'completed', started_at: '2026-10-03T10:15:00Z', ended_at: '2026-10-03T10:19:12Z',
  counts: { cases: { pass: 3, fail: 1, blocked: 0 }, bugs: { critical: 0, high: 1, medium: 0, low: 0 } },
}

function mockRuns(body: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })))
}

afterEach(() => vi.unstubAllGlobals())

describe('RunsList', () => {
  it('shows a run with its severity pill and proportion label', async () => {
    mockRuns([run])
    render(<RunsList />)
    expect(await screen.findByText('login flow')).toBeTruthy()
    expect(screen.getByText('1 high')).toBeTruthy()
    expect(screen.getByLabelText('3 passed, 1 failed, 0 blocked')).toBeTruthy()
    expect(screen.queryByText('0 critical')).toBeNull()
  })

  it('shows the empty state', async () => {
    mockRuns([])
    render(<RunsList />)
    expect(await screen.findByText('No runs yet')).toBeTruthy()
  })

  it('shows an error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })))
    render(<RunsList />)
    expect(await screen.findByRole('alert')).toBeTruthy()
  })
})
