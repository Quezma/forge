import { useEffect, useState } from 'react'
import { screenshotUrl } from './api'
import { toIssueMarkdown } from './issue'
import type { Bug, Run } from './types'
import { SeverityBadge } from './ui'

function CopyButton({ run, bug }: { run: Run; bug: Bug }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(t)
  }, [copied])
  const copy = () => {
    navigator.clipboard.writeText(toIssueMarkdown(run, bug)).then(() => setCopied(true), () => {})
  }
  return (
    <button type="button" className="btn" onClick={copy}>
      <span aria-live="polite">{copied ? 'Copied' : 'Copy as issue'}</span>
    </button>
  )
}

export function BugCard({ run, bug, onOpenImage }: { run: Run; bug: Bug; onOpenImage: (src: string, alt: string) => void }) {
  return (
    <details className="bug">
      <summary>
        <SeverityBadge severity={bug.severity} />
        <span className="bug-title">{bug.title}</span>
        <span className="bug-cat mono">{bug.category}</span>
      </summary>
      <div className="bug-body">
        <div>
          <h4>Steps to reproduce</h4>
          <ol className="steps">
            {bug.steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </div>
        <div className="vs">
          <div>
            <h4>Expected</h4>
            <p>{bug.expected}</p>
          </div>
          <div>
            <h4>Actual</h4>
            <p>{bug.actual}</p>
          </div>
        </div>
        {bug.evidence && bug.evidence.length > 0 && (
          <div>
            <h4>Evidence</h4>
            <ul className="thumbs">
              {bug.evidence.map((e) => {
                const src = screenshotUrl(run.id, e)
                const alt = `Screenshot for "${bug.title}": ${e}`
                return (
                  <li key={e}>
                    <button type="button" className="thumb" onClick={() => onOpenImage(src, alt)} aria-label={`Open screenshot ${e}`}>
                      <img src={src} alt="" loading="lazy" />
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        )}
        <CopyButton run={run} bug={bug} />
      </div>
    </details>
  )
}
