---
name: nestjs-perf
description: "Trigger: performance review, check performance, slow endpoint, N+1, slow query, missing index, event loop blocked, memory leak, will this scale, perf audit, before merging a slice/feature branch in a Nest repo. NestJS/TypeScript/PostgreSQL performance audit that proves each finding with a probe and drops false positives; writes an agent-ready report, never fixes."
license: Apache-2.0
metadata:
  author: "quezma"
  version: "1.0"
---

## Activation Contract

Load when the user asks to check performance, bottlenecks, or scalability of work in a NestJS project (`@nestjs/core` in `package.json`), usually after an implementation is done and before QA or merge. Also load before merging a feature/slice branch into the default branch when the project's AGENTS.md/CLAUDE.md requires it. Structure findings belong to `nestjs`; reliability findings (timeouts, retries, locks) belong to `architecture-patterns`; perf only here.

## Hard Rules

- REPORT ONLY. Never edit `src/`, `test/`, config, migrations, `package.json`, or `.gitignore`. Writes are limited to `<root>/.perf/` (subagent writes probes; parent writes `report.md`, since subagents may not write report files).
- Delegate to ONE `general-purpose` subagent (model `opus`) with `assets/perf-brief.md` filled in.
- Every finding must be PROBED before it is reported. Probe result decides status: `confirmed` (reported as a finding), `refuted` (moved to Discarded, one line), `unverified` (only when a probe is impossible; say why).
- Probes connect ONLY to the test database and ALWAYS roll back. Abort probing if the DB URL/host/name does not look like test (name lacks `test`, or equals the dev/default env) or cannot be confirmed. Never dev, staging, or prod data.
- No network calls, no load against running servers, no new deps. `autocannon`/`clinic`/`0x` only if already installed, and never against a running server; measure in-process with `performance.now()`.
- Every finding cites `file:line`, a rule ID from `assets/checklist.md` (or `X-<slug>`), and the probe metric. No evidence, no finding.
- Findings outside the diff are tagged `pre-existing`; they never raise the verdict.
- Report is terse and machine-oriented: no intros, no praise, no restating code.

## Decision Gates

| Situation | Scope |
|-----------|-------|
| Default / "check the work" | Branch diff vs base (`git merge-base HEAD main`) plus the call paths it feeds (controller/resolver → service → query) |
| Before merging a slice/feature branch | `git merge-base <default> HEAD`..`HEAD` (the whole slice, not one commit) |
| User says "full" / "whole project" | Hot paths: list endpoints, resolvers, queue processors, global interceptors/pipes/guards |
| User names files/modules/endpoints | Exactly those + their query paths |
| Test DB missing | Subagent may create/migrate it only with the project's own test-migration script |

## Execution Steps

1. Resolve root, base ref, scope, `@nestjs/core` version, HTTP adapter (Express/Fastify), ORM/query layer, test runner, TS runner, test DB config (`.env.test`, test config module, docker-compose) and seed helpers from config + AGENTS.md.
2. Fill `assets/perf-brief.md` and dispatch the subagent.
3. Subagent writes `<root>/.perf/<YYYY-MM-DD>-<branch or short_sha>/probes/*.ts|*.js` and returns the report; parent saves it as `report.md` in the same dir. Relay any `Skill feedback` it returns to the user.
4. Show the user the header (verdict + counts) and the report path. Do not fix. Offer to hand the report to the implementation agent; the probes double as its before/after check.
5. Pre-merge: `FIX_REQUIRED` blocks the merge. The implementation agent applies the fixes and reruns each finding's `verify:` probe; then re-run the perf audit once scoped to the fix diff. No loop-until-clean; anything still open goes to the user. Can run in parallel with the `nestjs` Audit and `architecture-patterns` Audit (independent reports).

## Output Contract

Format is defined in `assets/perf-brief.md` (`## Report format`). Verdict: `FIX_REQUIRED` if any confirmed blocker/major caused by the diff, else `PASS`.

## References

- `assets/perf-brief.md` — subagent brief: procedure, probe harness, thresholds, report format.
- `assets/checklist.md` — rule catalogue with IDs, how to probe each one, and sources.
