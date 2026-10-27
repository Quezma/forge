import { formatDate, formatDuration } from './format'

describe('formatDuration', () => {
  const s = '2026-10-03T10:00:00Z'
  it('formats seconds', () => expect(formatDuration(s, '2026-10-03T10:00:45Z')).toBe('45s'))
  it('formats minutes', () => expect(formatDuration(s, '2026-10-03T10:04:12Z')).toBe('4m 12s'))
  it('formats hours', () => expect(formatDuration(s, '2026-10-03T11:03:00Z')).toBe('1h 3m'))
  it('measures to now without an end', () => {
    expect(formatDuration(new Date(Date.now() - 5000).toISOString())).toMatch(/^[45678]s$/)
  })
})

describe('formatDate', () => {
  it('returns a dash for invalid dates', () => expect(formatDate('nope')).toBe('—'))
  it('returns a dash for the Go zero date', () => expect(formatDate('0001-01-01T00:00:00Z')).toBe('—'))
  it('formats a real date', () => expect(formatDate('2026-10-03T10:00:00Z')).toContain('2026'))
})
