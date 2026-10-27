## qa-engineer (browser QA via the `qa-engineer` MCP)

- After finishing a feature or a fix that changes UI behavior, run the `qa-engineer` skill against the running app, report findings, then fix them.
- Flow: `start_run` with `allowed_hosts` limited to the app under test, `snapshot` before and after each page change, `record_case` for every check, `report_bug` (steps plus screenshot) for every defect, `end_run` with a coverage summary.
- Go beyond the happy path: boundary and unusual inputs, uploads, errors via `intercept`, viewports, `a11y_audit`, console and network errors.
- Test only systems you own or are authorized to test. Never destroy real data unless the environment is declared disposable.
