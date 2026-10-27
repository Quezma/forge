import type { Run, RunSummary } from './types'

async function getJSON<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`.trim())
  return res.json() as Promise<T>
}

export const listRuns = () => getJSON<RunSummary[]>('/api/runs')
export const getRun = (id: string) => getJSON<Run>(`/api/runs/${encodeURIComponent(id)}`)
export const screenshotUrl = (runId: string, evidence: string) =>
  `/api/runs/${encodeURIComponent(runId)}/${evidence}`
