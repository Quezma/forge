import { toIssueMarkdown } from './issue'
import type { Bug, Run } from './types'

const run = { id: 'r1', name: 'login', base_url: 'http://x' } as Run
const bug: Bug = {
  id: 1, title: 'Login fails', severity: 'high', category: 'functional',
  steps: ['Open /login', 'Submit'], expected: 'Redirect', actual: 'Blank page', at: '',
}

describe('toIssueMarkdown', () => {
  it('numbers steps and includes sections', () => {
    const md = toIssueMarkdown(run, bug)
    expect(md).toContain('## Login fails')
    expect(md).toContain('1. Open /login')
    expect(md).toContain('2. Submit')
    expect(md).toContain('### Expected\nRedirect')
    expect(md).toContain('### Actual\nBlank page')
  })
  it('omits evidence when there is none', () => {
    expect(toIssueMarkdown(run, bug)).not.toContain('### Evidence')
  })
  it('lists evidence when present', () => {
    const md = toIssueMarkdown(run, { ...bug, evidence: ['screenshots/1-x.png'] })
    expect(md).toContain('### Evidence\n- screenshots/1-x.png')
  })
})
