# Discover brief (pass to the subagent, filled in)

You map the code patterns of a React/TypeScript project into react_atlas pattern knowledge. You DO NOT edit source. Your only writes are `record_pattern`, `set_purpose`, `reindex` (derived data) (MCP tools `mcp__react_atlas__*`) and, only if the design-system guess is wrong, `.react_atlas/config.json` `designSystem` (edit the file).

## Inputs
- Root: <abs path>   Package: <name>   Framework: <vite|next|cra|other>
- Project conventions: <AGENTS.md / CLAUDE.md notes, or "none">
- If the `mcp__react_atlas__*` tools are unavailable: stop, report "run `react-atlas install` and the printed `claude mcp add` command". Do nothing else.

## Entry shape (record_pattern, op `add`)
`area`: area name matching `[A-Za-z0-9_-]+` (`src/features/<x>` -> `x`, `src/<x>` -> `x`, e.g. "cart", "components", "hooks") or `_global` for project-wide rules.
`entry`:
```
{"kind": "rule|helper|api|anti_pattern",
 "audience": "internal|external",
 "text": "<one terse imperative line>",
 "evidence": ["<symbol id e.g. src/components/ui/Button.tsx#Button>"],
 "prevalence": "<optional, measured, e.g. '41 of 43 buttons in src/features use ui/Button'>",
 "match": {"target": "<symbol id | intrinsic:<tag> | external:<pkg>>", "from_area": "<optional area>"}}   // anti_pattern only
```
- Evidence must exist in the index; the tool rejects unknown ids. Verify with `component` / `callers` first.
- `external` = public API other areas may use. `internal` = local convention or helper.
- `match` (anti_pattern only): `audit` then reports every use of `target` (optionally only from `from_area`) as `wrong_usage`. Add it only when the anti-pattern is exactly "using X (from area Y)", e.g. `intrinsic:button` outside the design system, `external:moment`, a deprecated component id. The tool rejects an unknown symbol target. Otherwise leave it off (prose only).
- Update/retire existing entries by `id`; do not duplicate.
  - update: `{"area":"cart","op":"update","entry":{"id":"cart-3","text":"..."}}`
  - retire: `{"area":"cart","op":"retire","entry":{"id":"cart-3"}}`

## Procedure
1. `reindex` with `full: true`.
2. Design system: read `.react_atlas/config.json` (absent = default `src/components/ui`). Locate the real design system (a `ui`/`design-system`/`components` dir, or a package such as `@org/ui`, shadcn, MUI wrappers). If the default guess is wrong, edit `designSystem.paths` / `designSystem.packages` in `.react_atlas/config.json` (keep other keys), then `reindex`. Record which DS components wrap which intrinsics (Button for `button`, Input for `input`, ...) as `_global` rules, with measured prevalence of raw intrinsic use vs DS use (grep count).
3. Enumerate symbols: use `find_reusable` with broad phrasings per kind, `state_map` for stores/contexts, `component` / `callers` for usage; grep `src/` for file listing. Derive areas by the area rule above; rank areas by exported component/hook count.
4. Write `_global` first, each rule with measured prevalence:
   - styling approach (tokens / CSS modules / tailwind / styled): the one to use, grep count of each
   - global state libraries (zustand, redux, context) and their wrapper hooks (from `state_map`): read via the wrapper, not the base store/context; allowed areas
   - data fetching layer (react-query / SWR / custom hooks): where fetches live
   - forms (library, field wrappers, validation)
   - routing (router, route/guard helpers)
   - error boundaries (where, which component)
   - i18n (hook/function for strings)
5. Then one pass per area, ordered by exported component/hook count descending. Per area record:
   - public API: exported components/hooks (`kind: api`, `audience: external`), with props worth knowing
   - local conventions (`rule`, `internal`)
   - go-to helpers (`helper`), prefer ones with high caller counts
   - anti-patterns (`anti_pattern`) seen in the code, with evidence; add `match` when mechanically detectable (see Entry shape)
6. Purpose lines (`set_purpose`, args `area`, `id`, `text`). Write one for every exported component or hook that has `callers >= 3` and no doc comment (JSDoc/TSDoc), or whose doc does not state, in task words, what a caller uses it for (docs that explain mechanics, constraints or internals do not count; nor does a doc that only restates the name, e.g. "Renders a button." on `Button`; nor one that only lists props or the return shape: say what a caller uses it for, with the key props/inputs and what it renders or returns).
   - Describe caller intent in task words, the way a developer would search a task. Never mechanics or implementation.
   - Read the source before using a side-effect verb (fetch, submit, persist, navigate, subscribe, track). If the component or hook only renders or returns something, say "render"/"return". State loading/error/empty states, required providers (context, router, query client), required props, and controlled vs uncontrolled behavior when the caller must handle them.
   - Shape: "render a primary/secondary action button with loading state"; "return the current cart items and totals; needs CartProvider".
   - Why: natural task queries only find a symbol if some text states what callers use it for.
   - Skip private and rarely used symbols, and symbols whose doc already states caller intent.
   - Every purpose line is later checked against the code by an independent verifier: no claims you have not confirmed (behavior, provider requirements, states).
7. Budget: keep each area file <= 1500 tokens. Estimate it as the byte size of the area JSON file under `.react_atlas/patterns/` divided by 4. (`context_for_task` `tokens` is area + `_global` + neighbours' external view, not the area file alone; use it only as a sanity check.) Over budget: merge or drop low-value entries (fewest callers, weakest evidence).
8. Run `audit` once (no args) at the end. Report the baseline count per check (`duplicate_component`, `ds_bypass`, `state_misuse`, `wrong_usage`). Do not edit anything to reduce the counts.

## Rules
- No evidence in the index, no entry.
- Prevalence is grep- or index-measured; state the measurement scope. Never estimate.
- Respect project conventions over generic React advice (AGENTS.md/CLAUDE.md wins on conflict).
- No unmeasured absolutes: "only"/"never"/"always" needs a grep proving zero exceptions; otherwise state the measured ratio.
- Before recommending a component or hook, check what it requires (provider, router, query client, required props) and say so in the entry.
- A `match` makes `audit` flag every use; add it only when the measured exceptions are zero or already intentional (scope with `from_area`).
- Drop duplicates (same rule, different words).

## Report format (exact; no extra prose)
```
# react_atlas discover · <root> · <YYYY-MM-DD>
reindex: ok
config: designSystem paths=<..> packages=<..> (edited|unchanged)
areas: <area>=entries/tokens ...   # include _global
matches: <N entries with match>
purposes: set=N
audit baseline: duplicate_component=N ds_bypass=N state_misuse=N wrong_usage=N
## Gaps
- <area or topic you could not cover, why>
```
Empty section -> `none`.
