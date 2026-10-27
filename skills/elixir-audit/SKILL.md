---
name: elixir-audit
description: "Trigger: audit, architecture review, review my elixir/phoenix code, check the work, anti-patterns, code smells, before merging a slice/feature branch. Report-only architectural audit of Elixir/Phoenix code; writes an agent-ready report, never fixes."
license: Apache-2.0
metadata:
  author: "quezma"
  version: "1.0"
---

## Activation Contract

Load when the user asks to audit, review, or verify implementation work in an Elixir/Phoenix project (`mix.exs` present). Also load before merging a feature/slice branch into the default branch (when the project's AGENTS.md/CLAUDE.md requires it), and after an implementation agent finishes and the user wants the work checked before QA or merge.

## Hard Rules

- REPORT ONLY. Never edit, format, or fix source. The only write is the report file.
- Delegate the audit to ONE `general-purpose` subagent (model `opus`) with `assets/audit-brief.md` filled in; source reads must not flood the parent context.
- Only check-only commands. Never `mix format` (mutates), `mix deps.get`, migrations, or anything that touches the DB or network.
- Run a tool only if it is in `mix.exs` deps (`credo`, `sobelow`, `dialyxir`, `boundary`). A missing tool is noted, not installed.
- Every finding cites `file:line` and a rule ID from `assets/checklist.md` (or `X-<slug>` for something not in the catalogue). No evidence, no finding.
- Findings on code the diff did not touch are tagged `pre-existing`; they never raise the verdict.
- Respect the project's own conventions (`AGENTS.md`, `CLAUDE.md`, `.credo.exs`, existing context layout) over generic rules.
- Report is terse and machine-oriented: no prose intros, no praise, no restating the code.

## Decision Gates

| Situation | Scope |
|-----------|-------|
| Default / "check the work" | Branch diff vs base (`git merge-base HEAD main`) plus direct callers/callees of changed functions |
| Before merging a slice/feature branch | `git merge-base <default> HEAD`..`HEAD` (the whole slice, not one commit) |
| User says "full", "whole project", "architecture" | Whole `lib/` + `test/`; architecture sections first |
| User names files/contexts | Exactly those + their boundaries |
| Intent/task text available (card, plan, prompt) | Also verify intent: each requirement → met / partial / missing |

## Execution Steps

1. Resolve root (`git rev-parse --show-toplevel`), base ref, scope, intent text, and `app`/`app_web` namespaces from `mix.exs`.
2. Fill `assets/audit-brief.md` and dispatch the subagent.
3. Subagent writes `<root>/.audit/<YYYY-MM-DD>-<branch>.md` and returns the same content.
4. Show the user the header (verdict + counts) and the report path. Do not fix. Offer to hand the report to the implementation agent.
5. Pre-merge: `FIX_REQUIRED` blocks the merge. The implementation agent fixes the findings, then re-audit once scoped to the fix diff. No loop-until-clean; anything still open goes to the user.

## Output Contract

The report format is defined in `assets/audit-brief.md` (`## Report format`). Verdict: `FIX_REQUIRED` if any blocker/major caused by the diff, else `PASS`.

## References

- `assets/audit-brief.md` — subagent brief: procedure, commands, report format.
- `assets/checklist.md` — rule catalogue with IDs (architecture, Phoenix, Ecto, LiveView, OTP, Elixir anti-patterns, idioms, tests).
