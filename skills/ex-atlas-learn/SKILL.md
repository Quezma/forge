---
name: ex-atlas-learn
description: "Trigger: ex_atlas learn, self-learning review, before merging a branch in a project with .ex_atlas/. Per-branch reviewer that finds missed reuse/pattern violations, classifies cause (tool_miss, agent_ignored, knowledge_gap), records learnings; runs alongside elixir-audit and never blocks the merge."
license: Apache-2.0
metadata:
  author: "quezma"
  version: "1.0"
---

## Activation Contract

Load when the user asks for an ex_atlas learning review, or before merging a feature/slice branch in an Elixir project with `.ex_atlas/`. Runs alongside `elixir-audit` (can run in parallel).

Precondition: the `mcp__ex_atlas__*` tools are available. If not: STOP. Tell the user to run `mix ex_atlas.install` and the printed `claude mcp add ex_atlas -- mix ex_atlas.server` command, then restart Claude Code.

## Hard Rules

- ONE `general-purpose` subagent (model `opus`) with `assets/learn-brief.md` filled in. Never the implementer's context.
- Report only. Allowed writes: the report file, `record_pattern` (for `knowledge_gap`), `record_learning` (for `tool_miss` / `agent_ignored`), and `reindex` (derived data). No source edits.
- A miss counts only when both sides were read and the equivalence is explained.
- The verdict is informational. It never blocks the merge (blocking is `elixir-audit`'s job).
- Report is terse and machine-oriented.

## Decision Gates

| Situation | Scope |
|-----------|-------|
| Default / pre-merge | `git merge-base <default> HEAD`..`HEAD` |
| User names a base | that base..`HEAD` |

## Execution Steps

1. Resolve root, branch (`git rev-parse --abbrev-ref HEAD`), default branch, base SHA, project name, `app` namespace.
2. Sanitize branch for filenames (replace `/` and other non `[A-Za-z0-9._-]` with `-`).
3. Fill `assets/learn-brief.md` and dispatch the subagent.
4. Subagent writes `<root>/.ex_atlas/learn-<branch>.md` and returns it.
5. Show the user the header (counts by cause) and the report path. Offer to hand `agent_ignored`/`tool_miss` counts to the ex_atlas improvement round (read `learnings/open.jsonl` in the ex_atlas repo at `tools/ex_atlas` of the claude-setup checkout).

## Output Contract

Report format is in `assets/learn-brief.md` (`## Report format`).

## References

- `assets/learn-brief.md` — subagent brief: procedure, classification, learning shape, report format.
