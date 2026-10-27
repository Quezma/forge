## react_atlas (React/TypeScript projects with the `react_atlas` MCP)

Applies when the project is React/TypeScript and the `react_atlas` MCP tools are available.

1. First use in a project (`.react_atlas/patterns/` empty): run the `react-atlas-discover` skill.
2. Before implementing, call `context_for_task` with `task` and `areas` (first directory under `src/`, lowercase, e.g. `cart`). Follow the returned rules.
3. Before creating a component or hook, call `find_reusable` with what it does. Reuse a match, or state in one line why not.
4. After the change, call `reindex`. If the result has `pattern_review_needed`, compare with the patterns and use `record_pattern` / `set_purpose`; retire stale entries you touched.
5. Before finishing, call `audit` on the paths you touched and fix every error finding.
6. Before merging a branch, run the `react-atlas-learn` skill.

Inspect with `component`, `callers`, `state_map`.
