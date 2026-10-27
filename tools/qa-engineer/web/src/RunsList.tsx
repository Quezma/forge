import { listRuns } from './api'
import { formatDate, formatDuration } from './format'
import { Link } from './router'
import { ProportionBar, SeverityPills, StatusBadge } from './ui'
import { useAsync } from './useAsync'

export function RunsList() {
  const { data, error, loading } = useAsync(listRuns, 'runs')

  if (loading) return <p className="state" role="status">Loading runs…</p>
  if (error) return <p className="state error" role="alert">Could not load runs: {error.message}</p>
  if (!data || data.length === 0) {
    return (
      <div className="state">
        <h1>No runs yet</h1>
        <p className="muted">Ask Claude to QA a flow, for example "QA the checkout flow on localhost:3000", and the report will appear here.</p>
      </div>
    )
  }

  return (
    <section aria-labelledby="runs-h">
      <h1 id="runs-h">Runs</h1>
      <ul className="runs">
        {data.map((r) => (
          <li key={r.id}>
            <Link to={`/runs/${encodeURIComponent(r.id)}`} className="run-row">
              <div className="run-main">
                <span className="run-name">{r.name}</span>
                <span className="run-url mono">{r.base_url}</span>
              </div>
              <StatusBadge status={r.status} />
              <div className="run-meta muted">
                <span>{formatDate(r.started_at)}</span>
                <span>{formatDuration(r.started_at, r.ended_at)}</span>
              </div>
              <ProportionBar counts={r.counts.cases} />
              <SeverityPills counts={r.counts.bugs} />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
