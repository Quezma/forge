## react_atlas (code index and project patterns)

Use the `react_atlas` MCP tools on every change in this project.

1. Before implementing, call `context_for_task` with `task` and `areas` (the areas you expect to touch: the first directory under `src/`, lowercase, e.g. `cart`). Follow the returned rules.
2. Before creating any component or hook, call `find_reusable` with a description of what it does. Reuse a match, or state in one line why not.
3. After the change, call `reindex`.
4. If the result has `pattern_review_needed`, compare the change with the patterns. Use `record_pattern` / `set_purpose` for a new or changed pattern, or for a new reusable component or hook without a doc comment. Retire stale entries you touched.
5. Before finishing, call `audit` with the paths you touched and fix every error finding.
6. Before merging a branch, run the `react-atlas-learn` skill.

Use `component`, `callers` and `state_map` to inspect a symbol or shared state.
