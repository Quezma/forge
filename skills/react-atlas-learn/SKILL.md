---
name: react-atlas-learn
description: "Trigger: react_atlas learn, self-learning review, before merging a branch in a project with .react_atlas/. Per-branch reviewer that finds missed reuse, pattern violations and audit misses, classifies cause (tool_miss, agent_ignored, knowledge_gap), records learnings; runs alongside other reviews and never blocks the merge."
license: Apache-2.0
metadata:
  author: "quezma"
  version: "1.0"
---

## Activation Contract

Load when the user asks for a react_atlas learning review, or before merging a feature/slice branch in a React project with `.react_atlas/`.

Precondition: the `mcp__react_atlas__*` tools are available (including `record_learning`). If not: STOP. Tell the user to run `react-atlas install` and the printed `claude mcp add react_atlas -- react-atlas server` command, then restart Claude Code.

## Hard Rules

- ONE `general-purpose` subagent (model `opus`) with `assets/learn-brief.md` filled in. Never the implementer's context.
- Report only. Allowed writes: the report file, `record_pattern` (for `knowledge_gap`), `record_learning` (for `tool_miss` / `agent_ignored`), and `reindex` (derived data). No source edits.
- A miss counts only when both sides were read and the equivalence is explained.
- The verdict is informational. It never blocks the merge.
- Report is terse and machine-oriented.

## Decision Gates

| Situation | Scope |
|-----------|-------|
| Default / pre-merge | `git merge-base <default> HEAD`..`HEAD` |
| User names a base | that base..`HEAD` |

## Execution Steps

1. Resolve root, branch (`git rev-parse --abbrev-ref HEAD`), default branch, base SHA, project name (`package.json` name sanitized to `[a-z0-9_-]`).
2. Sanitize branch for filenames (replace `/` and other non `[A-Za-z0-9._-]` with `-`).
3. Fill `assets/learn-brief.md` and dispatch the subagent.
4. Subagent writes `<root>/.react_atlas/learn-<branch>.md` (gitignored dir; intended) and returns it.
5. Show the user the header (counts by cause) and the report path. Offer to hand `agent_ignored`/`tool_miss` counts to the react_atlas improvement round (read `learnings/open.jsonl` in the react_atlas repo at `tools/react_atlas` of the claude-setup checkout).

## Output Contract

Report format is in `assets/learn-brief.md` (`## Report format`).

## References

- `assets/learn-brief.md` — subagent brief: procedure, classification, learning shape, report format.
