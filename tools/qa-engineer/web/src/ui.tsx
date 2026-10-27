import { CASE_STATUSES, SEVERITIES, type CaseStatus, type RunStatus, type Severity } from './types'

export function SeverityBadge({ severity }: { severity: Severity }) {
  return <span className={`badge sev-${severity}`}>{severity}</span>
}

export function StatusBadge({ status }: { status: RunStatus | CaseStatus }) {
  return <span className={`badge st-${status}`}>{status}</span>
}

/** Pass/fail/blocked split. Labelled for screen readers; segments are decorative. */
export function ProportionBar({ counts }: { counts: Record<CaseStatus, number> }) {
  const total = CASE_STATUSES.reduce((n, s) => n + counts[s], 0)
  const label = `${counts.pass} passed, ${counts.fail} failed, ${counts.blocked} blocked`
  return (
    <div className="bar" role="img" aria-label={label} data-empty={total === 0}>
      {total > 0 &&
        CASE_STATUSES.filter((s) => counts[s] > 0).map((s) => (
          <span key={s} className={`seg seg-${s}`} style={{ flexGrow: counts[s] }} />
        ))}
    </div>
  )
}

export function SeverityPills({ counts }: { counts: Record<Severity, number> }) {
  const shown = SEVERITIES.filter((s) => counts[s] > 0)
  if (shown.length === 0) return <span className="muted no-bugs">no bugs</span>
  return (
    <ul className="pills">
      {shown.map((s) => (
        <li key={s} className={`badge sev-${s}`}>
          {counts[s]} {s}
        </li>
      ))}
    </ul>
  )
}
