import { useEffect, useMemo, useRef, useState } from 'react'
import { getRun } from './api'
import { BugCard } from './BugCard'
import { formatDate, formatDuration } from './format'
import { Link } from './router'
import { CASE_STATUSES, CATEGORIES, SEVERITIES, type Category, type Run, type Severity } from './types'
import { StatusBadge } from './ui'
import { useAsync } from './useAsync'

function Chips<T extends string>({ label, options, value, onChange }: { label: string; options: readonly T[]; value: T | 'all'; onChange: (v: T | 'all') => void }) {
  return (
    <div className="chips" role="group" aria-label={label}>
      <span className="chips-label muted" aria-hidden="true">{label}</span>
      {(['all', ...options] as const).map((o) => (
        <button key={o} type="button" className="chip" aria-pressed={value === o} onClick={() => onChange(o)}>
          {o}
        </button>
      ))}
    </div>
  )
}

function Coverage({ run }: { run: Run }) {
  const rows = CATEGORIES.map((cat) => {
    const cs = run.cases.filter((c) => c.category === cat)
    return { cat, n: cs.length, by: Object.fromEntries(CASE_STATUSES.map((s) => [s, cs.filter((c) => c.status === s).length])) }
  }).filter((r) => r.n > 0)
  if (rows.length === 0) return null
  return (
    <dl className="coverage" aria-label="Coverage by category">
      {rows.map((r) => (
        <div key={r.cat}>
          <dt className="mono">{r.cat}</dt>
          <dd>
            <span className="t-pass">{r.by.pass} pass</span>
            <span className="t-fail">{r.by.fail} fail</span>
            <span className="t-blocked">{r.by.blocked} blocked</span>
          </dd>
        </div>
      ))}
    </dl>
  )
}

export function RunDetail({ id }: { id: string }) {
  const { data: run, error, loading } = useAsync(() => getRun(id), id)
  const [sev, setSev] = useState<Severity | 'all'>('all')
  const [cat, setCat] = useState<Category | 'all'>('all')
  const [image, setImage] = useState<{ src: string; alt: string } | null>(null)
  const dialog = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    if (image) dialog.current?.showModal?.()
  }, [image])

  const bugs = useMemo(() => {
    if (!run) return []
    return run.bugs
      .filter((b) => (sev === 'all' || b.severity === sev) && (cat === 'all' || b.category === cat))
      .sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) || a.id - b.id)
  }, [run, sev, cat])

  if (loading) return <p className="state" role="status">Loading run…</p>
  if (error || !run) {
    return (
      <div className="state error" role="alert">
        <p>Could not load this run: {error?.message}</p>
        <Link to="/">Back to runs</Link>
      </div>
    )
  }

  return (
    <article>
      <Link to="/" className="back">All runs</Link>
      <header className="run-head">
        <div className="title-row">
          <h1>{run.name}</h1>
          <StatusBadge status={run.status} />
        </div>
        <p className="mono muted">{run.base_url}</p>
        <p className="muted">
          Started {formatDate(run.started_at)}, took {formatDuration(run.started_at, run.ended_at)}
        </p>
        {run.summary && <p className="summary">{run.summary}</p>}
        <Coverage run={run} />
      </header>

      <section aria-labelledby="bugs-h">
        <h2 id="bugs-h">Bugs <span className="count">{run.bugs.length}</span></h2>
        {run.bugs.length > 0 && (
          <div className="filters">
            <Chips label="Severity" options={SEVERITIES} value={sev} onChange={setSev} />
            <Chips label="Category" options={CATEGORIES} value={cat} onChange={setCat} />
          </div>
        )}
        {run.bugs.length === 0 ? (
          <p className="empty">No bugs found in this run.</p>
        ) : bugs.length === 0 ? (
          <p className="empty">No bugs match these filters.</p>
        ) : (
          <div className="bugs">
            {bugs.map((b) => (
              <BugCard key={b.id} run={run} bug={b} onOpenImage={(src, alt) => setImage({ src, alt })} />
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="cases-h">
        <h2 id="cases-h">Test cases <span className="count">{run.cases.length}</span></h2>
        {run.cases.length === 0 ? (
          <p className="empty">No test cases recorded.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>ID</th><th>Name</th><th>Category</th><th>Status</th><th>Notes</th></tr>
              </thead>
              <tbody>
                {run.cases.map((c) => (
                  <tr key={c.id}>
                    <td className="mono">{c.id}</td>
                    <td>{c.name}</td>
                    <td className="mono">{c.category}</td>
                    <td><StatusBadge status={c.status} /></td>
                    <td className="muted">{c.notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <dialog
        ref={dialog}
        className="lightbox"
        aria-label="Screenshot"
        onClose={() => setImage(null)}
        onClick={(e) => e.target === e.currentTarget && dialog.current?.close()}
      >
        {image && <img src={image.src} alt={image.alt} />}
        <button type="button" className="btn lightbox-close" onClick={() => dialog.current?.close()}>Close</button>
      </dialog>
    </article>
  )
}
