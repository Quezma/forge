export function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime()) || d.getFullYear() < 2000) return '—'
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

export function formatDuration(start: string, end?: string): string {
  const s = new Date(start).getTime()
  const e = end ? new Date(end).getTime() : Date.now()
  if (Number.isNaN(s) || Number.isNaN(e)) return '—'
  const total = Math.max(0, Math.round((e - s) / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${total % 60}s`
  return `${total}s`
}
