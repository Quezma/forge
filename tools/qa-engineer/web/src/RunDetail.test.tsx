import { fireEvent, render, screen } from '@testing-library/react'
import { RunDetail } from './RunDetail'
import type { Run } from './types'

const run: Run = {
  id: 'r1', name: 'checkout', base_url: 'http://localhost:3000', allowed_hosts: [],
  status: 'completed', started_at: '2026-10-03T10:15:00Z', ended_at: '2026-10-03T10:19:12Z',
  summary: 'Two defects found.',
  cases: [{ id: 1, name: 'Pay with card', category: 'functional', status: 'fail', notes: 'timeout', at: '' }],
  bugs: [
    { id: 1, title: 'Payment hangs', severity: 'high', category: 'functional', steps: ['Pay'], expected: 'Done', actual: 'Spinner', at: '' },
    { id: 2, title: 'Button misaligned', severity: 'low', category: 'ui', steps: ['Look'], expected: 'Aligned', actual: 'Off', at: '' },
  ],
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(run), { status: 200 })))
})
afterEach(() => vi.unstubAllGlobals())

describe('RunDetail', () => {
  it('shows bugs and the cases table', async () => {
    render(<RunDetail id="r1" />)
    expect(await screen.findByText('Payment hangs')).toBeTruthy()
    expect(screen.getByText('Button misaligned')).toBeTruthy()
    expect(screen.getByText('Pay with card')).toBeTruthy()
  })

  it('filters by category', async () => {
    render(<RunDetail id="r1" />)
    await screen.findByText('Payment hangs')
    fireEvent.click(screen.getByRole('button', { name: 'ui' }))
    expect(screen.queryByText('Payment hangs')).toBeNull()
    expect(screen.getByText('Button misaligned')).toBeTruthy()
  })

  it('shows an empty state when filters match nothing', async () => {
    render(<RunDetail id="r1" />)
    await screen.findByText('Payment hangs')
    fireEvent.click(screen.getByRole('button', { name: 'ui' }))
    fireEvent.click(screen.getByRole('button', { name: 'high' }))
    expect(screen.getByText('No bugs match these filters.')).toBeTruthy()
  })
})
