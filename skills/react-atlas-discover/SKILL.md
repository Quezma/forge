---
name: react-atlas-discover
description: "Trigger: map patterns, discover patterns, react_atlas discover, react_atlas refresh purposes, first react_atlas use in a project (.react_atlas/patterns/ empty). Pattern scan of a React/TypeScript project via the react_atlas MCP tools, independently verified; refresh mode redoes only purpose lines. Writes pattern entries, purpose lines and (if the guess is wrong) config.json designSystem, never source."
license: Apache-2.0
metadata:
  author: "quezma"
  version: "1.0"
---

## Activation Contract

Load when the user asks to map or discover patterns of a React project (`package.json` with react, `.react_atlas/` present), or on first react_atlas use when `.react_atlas/patterns/` is empty.

Precondition: the `mcp__react_atlas__*` tools are available (`context_for_task`, `find_reusable`, `component`, `callers`, `reindex`, `record_pattern`, `set_purpose`, `audit`, `state_map`). If not: STOP. Tell the user to run `react-atlas install` and the printed `claude mcp add react_atlas -- react-atlas server` command, then restart Claude Code. Do not scan without the tools.

## Hard Rules

- Delegate the scan to ONE `general-purpose` subagent (model `opus`) with `assets/discover-brief.md` filled in.
- Verification is mandatory and done by a SEPARATE `general-purpose` opus subagent (never the discovery one) with `assets/verify-brief.md`. Discovery without verification is not done.
- The only writes are `record_pattern` / `set_purpose` / `reindex` (derived data) and, only when the default design-system guess is wrong, `.react_atlas/config.json` `designSystem` (edit the file). No source edits, no formatter runs, no dependency changes.
- Every entry needs evidence that exists in the index (symbol ids).
- Prevalence counts are measured (grep or index), never estimated.
- Terse, machine-oriented entries. No prose, no praise.

## Execution Steps

1. Resolve root (`git rev-parse --show-toplevel`), package name and framework from `package.json`, and project conventions (`AGENTS.md`, `CLAUDE.md`).
2. Fill `assets/discover-brief.md` and dispatch the discovery subagent.
3. Subagent writes patterns through the MCP tools, runs `audit` once, and returns the report.
4. Dispatch the verifier (separate opus `general-purpose` subagent) with `assets/verify-brief.md` filled in: it checks every entry and a sample of >= 1/3 of purpose lines (all of the most-called ones) against the code; verdicts OK/WRONG/MISLEADING/WEAK with evidence.
5. Apply corrections only through `record_pattern` (update/retire) and `set_purpose` (the verifier proposes, you or a writer subagent applies; the verifier does not write). Then `reindex`.
6. Show the user: areas written, entry counts, entries with `match`, purposes set, verifier verdict counts and corrections applied, audit baseline counts per check. Do not fix audit findings; they are the baseline.

## Refresh Mode (purpose lines only)

Trigger: "react_atlas refresh purposes". Entries and config are not rewritten.

1. Run only discover-brief step 1 (`reindex` full) and step 6 (purpose lines, new rule), via one opus subagent. Retire purposes that are now wrong; do not touch pattern entries.
2. Run the verifier on the purpose lines only (all most-called ones plus >= 1/3 sample of the rest); apply corrections via `set_purpose`.
3. `reindex`, report purposes set/changed.

## Output Contract

Report format is in `assets/discover-brief.md` (`## Report format`).

## References

- `assets/discover-brief.md` — discovery subagent brief: procedure, entry shape, purpose-line guidance, report format.
- `assets/verify-brief.md` — verifier subagent brief: checks, verdicts, report format.
