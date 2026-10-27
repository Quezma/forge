# QA Engineer MCP — Design

Date: 2026-10-03
Status: Approved (pending written-spec review)

## Goal

A Go service that Claude Code connects to over MCP and uses to act as a QA
engineer against a web application. Given a flow ("test the login at
localhost:3000 with a@b.com / pass123"), Claude explores beyond the happy path:
corner cases, invalid and unusual inputs, business-rule violations,
UI/responsive issues and accessibility. What to test is decided by the calling agent. Every case tried and every
bug found is recorded and browsable in a local dashboard.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Who reasons | Claude (the MCP client) | No API key or agent loop in the service; quality tracks the model |
| Target scope (v1) | Web UI via real browser | Network capture/interception covers most API-level checks for UI flows |
| Browser driver | playwright-go (`github.com/mxschmitt/playwright-go`, v0.6201.1) | Mature Go binding; the module moved back to this path from v0.6100 |
| MCP SDK | Official Go SDK (`github.com/modelcontextprotocol/go-sdk`) | First-party |
| Report storage | JSON + PNG files on disk | No database; files are the data, Claude can read them directly |
| Report viewing | React + Vite dashboard embedded in the Go binary | Single artifact to install |

Out of scope for v1: direct HTTP API testing, autonomous agent loop, bug
editing/triage state, live dashboard updates, dashboard auth, concurrent runs.

## Architecture

One binary, `qa-engineer`, two subcommands:

- `qa-engineer mcp` — MCP server over stdio
  (`claude mcp add qa-engineer -- qa-engineer mcp`).
- `qa-engineer serve [--port 7777] [--dir ./qa-reports]` — HTTP server for the
  dashboard and a read-only JSON API. Binds to `127.0.0.1` only.
- `qa-engineer install` — downloads the Playwright driver and Chromium.
- `qa-engineer fixture [--port 3999]` — serves the deliberately buggy demo app.

Both subcommands resolve the reports directory the same way: `--dir` flag, else
`./qa-reports` relative to the working directory (the project under test).

### Packages

```
cmd/qa-engineer/     main: subcommand dispatch
internal/browser/    playwright-go wrapper: session, actions, console/network capture, host guard
internal/report/     run model, atomic JSON persistence, loading
internal/mcp/        tool definitions; thin adapters over browser/report
internal/web/        HTTP API + embedded SPA (go:embed of web/dist)
web/                 Vite + React dashboard source
internal/fixtureapp/ deliberately buggy web app used by integration tests and demos
                     (not testdata/: Go cannot import packages under testdata)
```

Each package is usable and testable without the MCP layer.

### Storage layout

```
qa-reports/
  <run-id>/            run-id = <UTC timestamp>-<slug of run name>
    run.json
    screenshots/<n>-<slug>.png
```

`run.json`:

```json
{
  "id": "20261003T101500Z-login",
  "name": "login",
  "base_url": "http://localhost:3000",
  "allowed_hosts": ["localhost:3000"],
  "context": "free text supplied by Claude: creds, business rules",
  "status": "running | completed | incomplete",
  "started_at": "...", "ended_at": "...",
  "summary": "closing summary written by Claude",
  "cases": [
    {"id": 1, "name": "...", "category": "security", "status": "pass|fail|blocked", "notes": "...", "at": "..."}
  ],
  "bugs": [
    {"id": 1, "title": "...", "severity": "critical|high|medium|low",
     "category": "functional|business|ui|security|a11y|performance",
     "steps": ["..."], "expected": "...", "actual": "...",
     "evidence": ["screenshots/3-login-error.png"], "at": "..."}
  ]
}
```

The MCP process marks its run `incomplete` on graceful shutdown if `end_run`
was never called. To cover crashes, the dashboard API derives status: a run
stored as `running` whose `run.json` was last modified more than 30 minutes ago
is reported as `incomplete`.

## MCP tools

All browser tools act on the single active run. Calling a browser or reporting
tool with no active run returns an error telling Claude to call `start_run`.

### Run lifecycle
- `start_run(name, base_url, allowed_hosts[], context?, headed?=false)` → `run_id`.
  Launches Chromium, creates the run directory, writes initial `run.json`.
  Fails if a run is already active.
- `end_run(summary)` → run path and dashboard hint. Closes browser, sets
  `completed`, writes `run.json`.

### Browser
- `navigate(url)`
- `snapshot()` → accessibility tree with stable element refs (`e1`, `e2`, …)
  valid until the next snapshot.
- `click(ref)`, `fill(ref, value)`, `press(key, ref?)`, `select(ref, value)`, `hover(ref)`
- `screenshot(name, full_page?=false)` → relative path under the run dir.
- `console_logs(clear?=true)` → console messages and page errors since last read.
- `network_log(clear?=true, filter?)` → method, url, status, timing, response
  headers, failure reason.
- `set_viewport(preset | width,height)`; presets: `mobile` 390x844,
  `tablet` 820x1180, `desktop` 1440x900.
- `new_context()` → discards cookies/storage (fresh incognito session) and
  reopens a page.
- `storage()` → cookies (with HttpOnly/Secure/SameSite flags), localStorage,
  sessionStorage.
- `intercept(url_pattern, action, status?, body?, delay_ms?)`;
  actions: `block | delay | mock | clear`.
- `a11y_audit()` → axe-core violations (axe script embedded in the binary).

Every action accepts an optional `timeout_ms` (default 10000). Timeouts return
a tool error naming the action and elapsed time.

### What to test

The tool has no built-in checklists, strategies or test inputs. The calling
agent decides which flows, paths, inputs and checks to run (from its own
knowledge or what the user provides) and uses the tools below to execute them
and record the results.

### Reporting
- `record_case(name, category, status, notes?)`
- `report_bug(title, severity, category, steps[], expected, actual, evidence[]?)`
  Evidence paths must exist inside the run directory.

Every reporting call persists `run.json` immediately via write-to-temp +
rename.

## Safety: host guard

`allowed_hosts` is required and non-empty on `start_run`; entries are
`host` or `host:port`. A bare host allows any port; `host:port` allows only
that port; `*.example.com` allows subdomains (not the apex). Matching is
case-insensitive. `base_url` must itself be allowed.

Enforcement is an in-process forward proxy (`127.0.0.1:<random>`) that
Chromium is launched behind (`--proxy-server`, bypass list `<-loopback>` so
loopback traffic is proxied too). The proxy checks every request's target
host:port — plain HTTP by absolute URL, HTTPS/WSS by `CONNECT` authority —
and answers disallowed ones with `403` plus header `X-Qa-Guard: blocked`.

Why a proxy rather than Playwright routes: verified on 2026-10-03 that route
handlers only see the first request of a redirect chain, so a route-based
guard leaks on redirects (including redirects to IP literals, which DNS-level
`--host-resolver-rules` cannot catch). The proxy sees every hop.

- `navigate` additionally rejects disallowed URLs up front with a clear error.
- Blocked requests appear in `network_log` with failure `blocked_by_guard`.

## Dashboard

### JSON API (read-only)
- `GET /api/runs` → `[{id, name, base_url, status, started_at, ended_at,
  counts: {cases: {pass, fail, blocked}, bugs: {critical, high, medium, low}}}]`
  newest first.
- `GET /api/runs/{id}` → full `run.json` (with derived status).
- `GET /api/runs/{id}/screenshots/{file}` → image. Path traversal rejected.
- Any other path → SPA `index.html`.

### Views
1. **Runs list** — name, target URL, date, duration, pass/fail bar, severity pills.
2. **Run detail** — header (target, duration, status, Claude summary, coverage
   by category); bug list filterable by severity and category with expandable
   steps / expected vs actual / screenshot thumbnails + lightbox; test-cases
   table.
3. **Copy as issue** — per-bug button copying a markdown issue body.

Built with the frontend design skills (design-taste-frontend et al.) during
implementation. `npm run dev` proxies `/api` to the Go server; `make build`
runs `vite build` then `go build`.

## Error handling

- Tools return MCP tool errors with actionable text; the server never panics
  out (recover per tool call).
- Missing Playwright driver/browsers → `start_run` error telling the user to
  run `qa-engineer install`. Playwright driver output goes to stderr so it
  never corrupts the MCP stdio stream.
- Stale element ref → error instructing to re-run `snapshot`.
- Process shutdown with an active run → browser closed, run marked
  `incomplete`, file written.
- Corrupt `run.json` in the dashboard → that run listed with status `corrupt`;
  others unaffected.

## Testing

TDD throughout.

- `report`: create/append/persist/reload, atomic write, evidence path validation.
- Host guard: allowed, blocked, port mismatch, subdomain, wildcard, redirect to
  disallowed host.
- `browser` + `mcp`: integration tests against `internal/fixtureapp` served via
  `httptest`. The fixture contains a login form with: emails rejected when they differ
  only in case or surrounding whitespace, a raw server error page for an empty
  submit, a banner that overflows at mobile width, and a logo without alt text. Tests
  drive real tools and assert observable results (snapshot refs, fill/click,
  network capture, intercept, storage flags, axe violations). Integration
  tests are skipped with a clear message when Playwright browsers are absent.
- `web` API: `httptest` over a fixture `qa-reports` dir, including corrupt run
  and traversal attempts.
- Frontend: one Vitest smoke test per view.

## Success criteria

1. `claude mcp add qa-engineer -- qa-engineer mcp` works, and Claude can run a
   login QA session against the fixture app end to end.
2. Against the fixture app, a session where the agent tests the login flow
   surfaces at least: case/whitespace email rejection, raw error on empty
   submit, mobile overflow, missing alt text.
3. `qa-engineer serve` shows that run with bugs, cases and screenshots.
4. Requests to hosts outside `allowed_hosts` never leave the browser.
