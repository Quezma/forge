---
name: ex-atlas-discover
description: "Trigger: map patterns, discover patterns, ex_atlas discover, ex_atlas refresh purposes, first ex_atlas use in a project (.ex_atlas/patterns/ empty). Pattern scan of an Elixir project via the ex_atlas MCP tools, independently verified; refresh mode redoes only purpose lines. Writes pattern entries and purpose lines, never source."
license: Apache-2.0
metadata:
  author: "quezma"
  version: "1.1"
---

## Activation Contract

Load when the user asks to map or discover patterns of an Elixir project (`mix.exs` present, `.ex_atlas/` present), or on first ex_atlas use when `.ex_atlas/patterns/` is empty.

Precondition: the `mcp__ex_atlas__*` tools are available (`context_for_task`, `find_reusable`, `module`, `callers`, `reindex`, `record_pattern`, `set_purpose`). If not: STOP. Tell the user to run `mix ex_atlas.install` and the printed `claude mcp add ex_atlas -- mix ex_atlas.server` command, then restart Claude Code. Do not scan without the tools.

## Hard Rules

- Delegate the scan to ONE `general-purpose` subagent (model `opus`) with `assets/discover-brief.md` filled in.
- Verification is mandatory and done by a SEPARATE `general-purpose` opus subagent (never the discovery one) with `assets/verify-brief.md`. Discovery without verification is not done.
- The only writes are `record_pattern` / `set_purpose` / `reindex` (derived data). No source edits, no `mix format`, no deps/migrations.
- Every entry needs evidence that exists in the index (function ids or module names).
- Prevalence counts are measured (grep or index), never estimated.
- Terse, machine-oriented entries. No prose, no praise.

## Execution Steps

1. Resolve root (`git rev-parse --show-toplevel`), app namespace from `mix.exs`, and project conventions (`AGENTS.md`, `CLAUDE.md`).
2. Fill `assets/discover-brief.md` and dispatch the discovery subagent.
3. Subagent writes patterns through the MCP tools, then runs `mix ex_atlas.acceptance` and returns the report.
4. Dispatch the verifier (separate opus `general-purpose` subagent) with `assets/verify-brief.md` filled in: it checks every entry and a sample of >= 1/3 of purpose lines (all root-context ones) against the code; verdicts OK/WRONG/MISLEADING/WEAK with evidence.
5. Apply corrections only through `record_pattern` (update/retire) and `set_purpose` (the verifier proposes, you or a writer subagent applies; the verifier does not write). Then `reindex`: `stale` must be empty; `context_for_task` / `mix ex_atlas.acceptance` output: `warnings` must be empty. Re-run acceptance.
6. Show the user: areas written, entry counts, purposes set, verifier verdict counts and corrections applied, acceptance results (pass/fail per case). Do not fix acceptance failures; list them.

## Refresh Mode (purpose lines only)

Trigger: "ex_atlas refresh purposes". Entries are not rewritten.

1. Run only discover-brief step 1 (`reindex` full) and step 5 (purpose lines, new rule), via one opus subagent. Retire purposes that are now wrong; do not touch pattern entries.
2. Run the verifier on the purpose lines only (all root-context ones plus >= 1/3 sample of the rest); apply corrections via `set_purpose`.
3. `reindex` (`stale` empty), run `mix ex_atlas.acceptance`, report purposes set/changed and acceptance results.

## Output Contract

Report format is in `assets/discover-brief.md` (`## Report format`).

## References

- `assets/discover-brief.md` — discovery subagent brief: procedure, entry shape, purpose-line guidance, report format.
- `assets/verify-brief.md` — verifier subagent brief: checks, verdicts, report format.
