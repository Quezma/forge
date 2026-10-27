import type { Bug, Run } from './types'

export function toIssueMarkdown(run: Run, bug: Bug): string {
  const lines = [
    `## ${bug.title}`,
    '',
    `**Severity:** ${bug.severity} | **Category:** ${bug.category} | **Run:** ${run.name} (${run.id})`,
    '',
    '### Steps to reproduce',
    ...bug.steps.map((s, i) => `${i + 1}. ${s}`),
    '',
    '### Expected',
    bug.expected,
    '',
    '### Actual',
    bug.actual,
  ]
  if (bug.evidence?.length) {
    lines.push('', '### Evidence', ...bug.evidence.map((e) => `- ${e}`))
  }
  return lines.join('\n') + '\n'
}
