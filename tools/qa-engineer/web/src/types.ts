// Mirrors internal/report (Go). Keep enums in sync with report.go.
export const SEVERITIES = ['critical', 'high', 'medium', 'low'] as const
export const CATEGORIES = ['functional', 'business', 'ui', 'security', 'a11y', 'performance'] as const
export const CASE_STATUSES = ['pass', 'fail', 'blocked'] as const

export type Severity = (typeof SEVERITIES)[number]
export type Category = (typeof CATEGORIES)[number]
export type CaseStatus = (typeof CASE_STATUSES)[number]
export type RunStatus = 'running' | 'completed' | 'incomplete' | 'corrupt'

export interface Case {
  id: number
  name: string
  category: Category
  status: CaseStatus
  notes?: string
  at: string
}

export interface Bug {
  id: number
  title: string
  severity: Severity
  category: Category
  steps: string[]
  expected: string
  actual: string
  evidence?: string[]
  at: string
}

export interface Run {
  id: string
  name: string
  base_url: string
  allowed_hosts: string[]
  context?: string
  status: RunStatus
  started_at: string
  ended_at?: string
  summary?: string
  cases: Case[]
  bugs: Bug[]
}

export interface RunSummary {
  id: string
  name: string
  base_url: string
  status: RunStatus
  started_at: string
  ended_at?: string
  counts: {
    cases: Record<CaseStatus, number>
    bugs: Record<Severity, number>
  }
}
