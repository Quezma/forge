---
name: architecture-patterns
description: "Trigger: architecture, design pattern, layering, hexagonal/clean architecture, DDD, bounded context, aggregate, microservices, saga, outbox, idempotency, retry/backoff, circuit breaker, timeout, distributed lock, transaction boundary, race condition, design a new service/project, architecture audit, before merging. Stack-agnostic: guides placement/design with documented patterns, designs new services, and runs a report-only architecture audit."
license: Apache-2.0
metadata:
  author: "quezma"
  version: "1.0"
---

## Activation Contract

Load when the user (a) is about to write or place code that crosses a boundary: layering, remote calls, DB writes with side effects, messaging, locks, retries (Guide), (b) starts a new project, service, or major feature (Design), or (c) asks to audit/review architecture or a branch, or before merging (Audit).

## Hard Rules

- The project's own conventions win: `CLAUDE.md`/`AGENTS.md`, existing layering and naming. Map the catalogue onto them; do not restructure to match it.
- Stack-specific rules defer to sibling skills: `nestjs` when `@nestjs/core` is present, `nx-monorepo` when `nx.json` exists, `elixir-audit`/`elixir-perf` for Elixir/Phoenix. This skill covers cross-cutting architecture only; when both apply, run both, no duplicated findings.
- A pattern is recommended only for a stated, observed need. No speculative circuit breakers, CQRS, event sourcing, sagas, or microservices. Monolith first (modular monolith) unless evidenced forces justify splitting (`assets/design.md` step 2).
- Rule preconditions apply: no remote call, no RES finding; no DB write, no TXN finding.
- Do not guess APIs or flags of the project's libraries; check their docs or `--help`. Rules tagged `[unverified]` are stated as unverified and capped at `minor` in Audit.
- Audit is REPORT ONLY: the only write is the report file. Every finding cites `file:line` and a rule ID from `assets/checklist.md`; no evidence, no finding.
- Never install packages, run migrations, start services, or touch databases/brokers in any mode without asking.
- Findings on code the diff did not touch are tagged `pre-existing`; they never raise the verdict.
- Terse, machine-oriented output: no prose intros, no praise.

## Decision Gates

| Situation | Mode |
|-----------|------|
| Writing/placing/changing code across a boundary (default) | Guide |
| New project, new service, major feature, "how should I structure/split" | Design |
| "audit", "review architecture", "check the work", before merge | Audit |
| Audit, default scope | Branch diff vs base (`git merge-base HEAD <default>`) plus callers/callees of touched boundaries |
| Audit, "full"/"whole repo" | All source roots + root config |
| Request for a pattern with no stated need | Ask for the observed need once; else do not add it |
| Rule conflicts with a project convention | Convention wins; list under `## Waived` (Audit) or note it (Guide) |

## Execution Steps

### Guide
1. Read the project conventions, the layer/folder structure, and the code around the change. Identify remote calls, DB writes, handlers, and locks the change adds or touches.
2. Place the code by the layer matrix in `assets/checklist.md` (ARC). Keep the domain free of IO and framework types.
3. For each remote call apply RES/IDM; for each write apply TXN/LCK/DDD; for each message handler apply MSG/IDM. Use `assets/examples.md` for the good shape of each blocker rule.
4. Do not add a pattern without its need (DES-01, RES-07, DAT-03, DAT-05).
5. Run the project's lint/typecheck/tests if present; report decisions as one line each (rule ID, choice). Do not write a file.

### Design
1. Follow `assets/design.md` in order: forces, monolith vs split, bounded contexts, sync/async, consistency per operation, call and write checklists, pattern table.
2. Ask the user only for forces not readable from the repo; one question at a time.
3. Produce the decision record (template in `assets/design.md`). Offer to save it (e.g. `docs/adr/`); write it only if asked.

### Audit
1. Resolve root (`git rev-parse --show-toplevel`), base ref, scope, stack, sibling skills in use, intent text.
2. Fill `assets/audit-brief.md` and dispatch ONE `general-purpose` subagent (model `opus`); source reads must not flood the parent context.
3. Subagent writes `<root>/.audit/<YYYY-MM-DD>-<branch>-arch.md` and returns the same content.
4. Show the user the header (verdict + counts) and the path. Do not fix. Offer to hand the report to the implementer.
5. Pre-merge: `FIX_REQUIRED` blocks the merge; fix, then re-audit once scoped to the fix diff. No loop-until-clean.

## Output Contract

- Guide: short list of decisions (layer, boundary handling, rule IDs applied, patterns added or declined with reason, checks run).
- Design: decision record per `assets/design.md`.
- Audit: report format in `assets/audit-brief.md` (`## Report format`). Verdict `FIX_REQUIRED` if any blocker/major is caused by the diff, else `PASS`.

## References

- `assets/checklist.md` - rule catalogue with IDs, severities, checks, sources, layer matrix.
- `assets/examples.md` - good/bad pairs for every blocker and the common majors.
- `assets/design.md` - new project/service/feature decision procedure and pattern selection table.
- `assets/audit-brief.md` - subagent brief: procedure, allowed commands, grep probes, report format.
