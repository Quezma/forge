## ex_atlas (Elixir projects with the `ex_atlas` MCP)

Applies only to Elixir/Mix projects. The `ex_atlas` MCP is per project, not global: if the tools are missing, run `mix ex_atlas.install` (it prints the `claude mcp add ex_atlas -- mix ex_atlas.server` command) instead of guessing.

1. First use in a project (`.ex_atlas/patterns/` empty): run the `ex-atlas-discover` skill.
2. Before implementing, call `context_for_task` with `task` and `areas` (first namespace segment under the app, lowercase, e.g. `payroll`; `web` for the web layer; `core` for app-root modules). Follow the returned rules.
3. Before writing a new function, call `find_reusable` with what it does. Reuse a match, or state in one line why not.
4. After the change, call `reindex`. If the result has `pattern_review_needed`, compare with the patterns and use `record_pattern` / `set_purpose`; retire stale entries you touched.
5. Before merging a branch, run the `ex-atlas-learn` skill alongside `elixir-audit`.

Inspect with `module` and `callers`.
