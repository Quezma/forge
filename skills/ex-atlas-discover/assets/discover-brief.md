# Discover brief (pass to the subagent, filled in)

You map the code patterns of an Elixir project into ex_atlas pattern knowledge. You DO NOT edit source. Your only writes are `record_pattern`, `set_purpose`, and `reindex` (derived data) (MCP tools `mcp__ex_atlas__*`).

## Inputs
- Root: <abs path>   App ns: <MyApp>   `<app>` = the lowercase app directory under `lib/` (the mix app name)
- Project conventions: <AGENTS.md / CLAUDE.md notes, or "none">
- If the `mcp__ex_atlas__*` tools are unavailable: stop, report "run `mix ex_atlas.install` and the printed `claude mcp add` command". Do nothing else.

## Entry shape (record_pattern, op `add`)
`area`: area name matching `[A-Za-z0-9_-]+` (index areas are lowercase first segments, e.g. "payroll", "web", "core") or `_global` for project-wide rules.
`entry`:
```
{"kind": "rule|helper|api|anti_pattern",
 "audience": "internal|external",
 "text": "<one terse imperative line>",
 "evidence": ["<function id e.g. App.Billing.Invoices.fetch/2>", "<or module name>"],
 "prevalence": "<optional, measured, e.g. '138 of 140 Repo calls in context modules'>"}
```
- Evidence must exist in the index; the tool rejects unknown ids. Verify with `module` / `callers` first.
- `external` = public API other areas may call. `internal` = local convention or helper.
- Update/retire existing entries by `id`; do not duplicate.
  - update: `{"area":"payroll","op":"update","entry":{"id":"payroll-3","text":"..."}}`
  - retire: `{"area":"payroll","op":"retire","entry":{"id":"payroll-3"}}`

## Procedure
1. `reindex` with `full: true`. Note degraded mode if reported.
2. No tool lists modules or areas. Enumerate modules with grep `^defmodule` over `lib/**/*.ex`, derive each module's area from its file path, then call `module` per module as needed (and `callers` for usage). Read the project `AGENTS.md`. Count functions per area to rank areas.
   Area rule: `lib/<app>/<x>/...` -> `x`; `lib/<app>/<x>.ex` with a sibling dir `lib/<app>/<x>/` -> `x`; any other `lib/<app>/<x>.ex` and `lib/<app>.ex` -> `core`; `lib/<app>_web/**` and `lib/<app>_web.ex` -> `web`.
3. Write `_global` first, each rule with measured prevalence:
   - layering: which areas may call `Repo` (grep count per area vs total)
   - error-tuple shape
   - tenancy
   - transactions
   - query composition
4. Then one pass per area, ordered by function count descending. Per area record:
   - public API (`kind: api`, `audience: external`)
   - local conventions (`rule`, `internal`)
   - go-to helpers (`helper`) — prefer ones with high caller counts
   - anti-patterns (`anti_pattern`) seen in the code, with evidence
5. Purpose lines (`set_purpose`, args `area`, `id`, `text`). Write one for every public function that has `callers >= 3` or sits in the area's root context module, and either has no `@doc` or has a `@doc` whose first paragraph does not state, in task words, what a caller uses it for (docs that explain mechanics, constraints or internals do not count; nor does a one-line doc that only restates the function name, e.g. "Parses the input." on `parse/1` or "Normalizes a name." on `normalize_name/1`; nor does a doc that only states the return shape, e.g. "`%{id => total}` for the given ids." or "`{:ok, struct}` or `{:error, reason}`.": say what a caller uses it for in task words, with the input/output forms and the error result).
   - Describe caller intent in task words, the way a developer would search a task. Never mechanics or implementation.
   - Read the source before using a side-effect verb (emit, send, schedule, enqueue, mark, persist, write). If the function only builds or returns the thing, say "build"/"return". State status/disabled/inactive outcomes, raises, and preconditions (e.g. needs an open tenant transaction) when the caller must handle them. (First run: ~16% of drafted lines broke this.)
   - Shape: "list unpaid invoices for a customer"; "format an amount in cents as a currency string".
   - Why: natural task queries only find a function if some text states what callers use it for.
   - Skip private and rarely used functions, and functions whose `@doc` already states caller intent.
   - Every purpose line is later checked against the code by an independent verifier: no claims you have not confirmed (behavior, error shapes, tenant/transaction requirements).
6. Budget: keep each area file <= 1500 tokens. Estimate it as the byte size of the area JSON file under `.ex_atlas/patterns/` divided by 4. (`context_for_task` `tokens` is area + `_global` + neighbours' external view, not the area file alone; use it only as a sanity check.) Over budget: merge or drop low-value entries (fewest callers, weakest evidence).
7. Run `mix ex_atlas.acceptance` in the root. Capture per-case pass/fail. Do not edit anything to make it pass.

## Rules
- No evidence in the index, no entry.
- Prevalence is grep- or index-measured; state the measurement scope. Never estimate.
- Respect project conventions over generic Elixir advice (AGENTS.md/CLAUDE.md wins on conflict).
- No unmeasured absolutes: "only"/"never"/"always" needs a grep proving zero exceptions; otherwise state the measured ratio.
- Before recommending a reader/writer, check whether it needs an open tenant transaction or silently returns defaults outside one; say so in the entry.
- Drop duplicates (same rule, different words).

## Report format (exact; no extra prose)
```
# ex_atlas discover · <root> · <YYYY-MM-DD>
reindex: ok|degraded
areas: <area>=entries/tokens ...   # include _global
purposes: set=N
acceptance: <pass>/<total>
## Acceptance failures
<case id> | <expected> | <actual>
## Gaps
- <area or topic you could not cover, why>
```
Empty section -> `none`.
