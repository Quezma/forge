---
name: qa-engineer
description: "Trigger: feature done, fix done, implementation complete, QA, test my changes. Run browser QA via the qa-engineer MCP, report findings, then fix them."
license: Apache-2.0
metadata:
  author: "quezma"
  version: "1.1"
---

## Activation Contract

Load after finishing any feature or bug fix implementation, before reporting the work as complete. Also load when the user asks for QA of recent changes.

## Hard Rules

- MUST run QA through the `qa-engineer` MCP tools (`mcp__qa-engineer__*`). Never replace it with self-review.
- If those tools are missing, STOP and tell the user to register it: `claude mcp add qa-engineer -s user -- ~/.local/bin/qa-engineer mcp`.
- Delegate the QA run to ONE `general-purpose` subagent with `assets/qa-brief.md` as the brief; browser snapshots must not flood the parent context.
- The app MUST be running locally first. `allowed_hosts` lists only the app under test.
- Never test against production or destroy real data unless the user says the environment is disposable.
- QA is report-only. Show ALL findings to the user before fixing any.
- Fix every finding unless it needs a product decision; ask about those one at a time.
- Re-run QA once, scoped to the fixes. No loop-until-clean.

## Decision Gates

| Situation | Action |
|-----------|--------|
| Change has a UI flow | Full MCP browser run |
| Backend-only change reachable from UI | MCP run through the UI flows that hit it + `network_log` |
| Backend-only, no UI | Skip MCP; subagent tests the API with curl using the same brief |
| System has roles | One `new_context` + login per role, incl. anonymous and other tenant |
| Finding is pre-existing, not caused by the diff | Report as follow-up, do not fix unasked |

## Execution Steps

1. Collect scope: branch diff, changed files, feature/fix intent, roles, test credentials, local app URL.
2. Start the app if not running.
3. Dispatch the subagent with the brief filled in.
4. Subagent ends with `end_run`; returns run ID, dashboard hint and the findings table.
5. Present the report to the user.
6. Fix findings by severity (critical → low), adding a regression test per fix; run project tests.
7. Re-dispatch QA scoped to the fix diff.

## Output Contract

```
## QA Report (run <run_id>)
| # | Severity | Area (flow/role/security) | Finding | Repro | Evidence | Status |
```

Then: fixes applied (file + test per finding), re-QA result, open items needing a decision, and `qa-engineer serve` → `http://127.0.0.1:7777/runs/<run_id>` for the dashboard.

## References

- `assets/qa-brief.md` — subagent brief: coverage checklist, role matrix, security checks.
