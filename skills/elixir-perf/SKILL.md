---
name: elixir-perf
description: "Trigger: performance review, check performance, bottlenecks, will this scale, slow queries, N+1, perf audit, before merging a slice/feature branch. Elixir/Phoenix/PostgreSQL performance audit that proves each finding with a probe and drops false positives; writes an agent-ready report, never fixes."
license: Apache-2.0
metadata:
  author: "quezma"
  version: "1.1"
---

## Activation Contract

Load when the user asks to check performance, bottlenecks, or scalability of work in an Elixir/Phoenix project (`mix.exs` present), usually after an implementation is done and before QA or merge. Also load before merging a feature/slice branch into the default branch when the project's AGENTS.md/CLAUDE.md requires it.

## Hard Rules

- REPORT ONLY. Never edit `lib/`, `test/`, `config/`, migrations, or `.gitignore`. Writes are limited to `<root>/.perf/` (subagent writes probes; parent writes `report.md`, since subagents may not write report files).
- Delegate to ONE `general-purpose` subagent (model `opus`) with `assets/perf-brief.md` filled in.
- Every finding must be PROBED before it is reported. Probe result decides status: `confirmed` (reported as a finding), `refuted` (moved to Discarded, one line), `unverified` (only when a probe is impossible; say why).
- Probes run ONLY against the test database through the Ecto SQL Sandbox (`MIX_ENV=test`, every write rolled back). Never dev, staging, or prod data. Abort probing if `config/test.exs` does not use `Ecto.Adapters.SQL.Sandbox`.
- No network calls, no load against running servers, no new deps. Use `Benchee` only if it is already in `mix.exs`; otherwise `:timer.tc` and `:erlang.memory`.
- Every finding cites `file:line`, a rule ID from `assets/checklist.md` (or `X-<slug>`), and the probe metric. No evidence, no finding.
- Findings outside the diff are tagged `pre-existing`; they never raise the verdict.
- Report is terse and machine-oriented: no intros, no praise, no restating code.

## Decision Gates

| Situation | Scope |
|-----------|-------|
| Default / "check the work" | Branch diff vs base (`git merge-base HEAD main`) plus the call paths it feeds (controller/LiveView → context → query) |
| Before merging a slice/feature branch | `git merge-base <default> HEAD`..`HEAD` (the whole slice, not one commit) |
| User says "full" / "whole project" | Hot paths: list endpoints, LiveViews, background jobs, `handle_*` of shared GenServers |
| User names files/contexts/endpoints | Exactly those + their query paths |
| Test DB missing | Subagent may run `MIX_ENV=test mix ecto.create && MIX_ENV=test mix ecto.migrate` only |

## Execution Steps

1. Resolve root, base ref, scope, `app`/`app_web` namespaces, Repo module, factory/fixture modules (`test/support`), and DB roles/migrate alias from config + AGENTS.md (owner vs app role matters for ANALYZE).
2. Fill `assets/perf-brief.md` and dispatch the subagent.
3. Subagent writes `<root>/.perf/<YYYY-MM-DD>-<branch or short_sha>/probes/*.exs` and returns the report; parent saves it as `report.md` in the same dir. Relay any `Skill feedback` it returns to the user.
4. Show the user the header (verdict + counts) and the report path. Do not fix. Offer to hand the report to the implementation agent; the probes double as its before/after check.
5. Pre-merge: `FIX_REQUIRED` blocks the merge. The implementation agent applies the fixes and reruns each finding's `verify:` probe; then re-run the perf audit once scoped to the fix diff. No loop-until-clean; anything still open goes to the user. Can run in parallel with `elixir-audit` (independent reports).

## Output Contract

Format is defined in `assets/perf-brief.md` (`## Report format`). Verdict: `FIX_REQUIRED` if any confirmed blocker/major caused by the diff, else `PASS`.

## References

- `assets/perf-brief.md` — subagent brief: procedure, probe harness, thresholds, report format.
- `assets/checklist.md` — rule catalogue with IDs and how to probe each one.
