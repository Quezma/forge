## ex_atlas (code index and project patterns)

Use the `ex_atlas` MCP tools on every change in this project.

1. Before implementing anything, call `context_for_task` with `task` and `areas` (the areas you expect to touch: the first namespace segment under the app, lowercase, e.g. `payroll`; `web` for the web layer; `core` for app-root modules; an unknown area returns `known_areas`). Follow the returned rules.
2. Before writing any new function, call `find_reusable` with a description of what it does. Reuse a match, or state in one line why not.
3. After the change, call `reindex`.
4. If the result has `pattern_review_needed`, compare the change with the patterns. Use `record_pattern` / `set_purpose` for a new or changed pattern, or for a new reusable function without `@doc`. Retire stale entries you touched.
5. Before merging a branch, run the `ex-atlas-learn` skill (alongside `elixir-audit`).

Use `module` and `callers` to inspect a module or a function id.
