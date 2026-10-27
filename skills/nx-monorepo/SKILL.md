---
name: nx-monorepo
description: "Trigger: nx workspace, monorepo, new library/app in Nx, where does this code go, module boundaries, tags, depConstraints, nx audit, before merging in an Nx repo. Guides placement/structure in an Nx workspace, runs a report-only architecture audit, and (on request) sets up tags + module-boundary rules."
license: Apache-2.0
metadata:
  author: "quezma"
  version: "1.0"
---

## Activation Contract

Load when `nx.json` exists at the repo root and the user (a) is about to create, move, or wire code, apps, or libs (Guide), (b) asks to audit/review the workspace or a branch, or before merging in an Nx repo (Audit), or (c) explicitly asks to set up tags / module boundaries (Setup).

## Hard Rules

- Rules are written for an Nx 22/23 baseline. Run `nx report` first and note the version; mark any rule that may not apply to older versions.
- The workspace's own conventions win: existing tags, type names (e.g. `type:domain` instead of `type:feature`), folder layout, `CLAUDE.md`/`AGENTS.md`, `CODEOWNERS`. Map the defaults onto them; do not rename them.
- No paid features assumed. Conformance/Powerpack and Nx Cloud (Nx Agents, remote cache, self-healing CI) are optional; label them paid and never make a finding depend on them.
- Never run `nx migrate`, package installs, `nx reset`, or anything that rewrites files/config without asking. Audit mode runs check-only commands.
- Do not guess flags: if unsure of a command, run `nx <cmd> --help` first. Rules tagged `[unverified]` in the checklist are stated as unverified.
- Do not mix TS project references with `paths` aliases (Nx does not support both in one workspace).
- Audit is REPORT ONLY: the only write is the report file. Every finding cites `file:line` (or project name) and a rule ID from `assets/checklist.md`; no evidence, no finding.
- Findings on code the diff did not touch are tagged `pre-existing`; they never raise the verdict.
- Terse, machine-oriented output: no prose intros, no praise.

## Decision Gates

| Situation | Mode |
|-----------|------|
| Implementing/creating/moving code in an Nx workspace (default) | Guide |
| "audit", "review", "check the work", before merge | Audit |
| "set up tags", "add module boundaries", "add depConstraints" | Setup (only on explicit ask) |
| Audit, default scope | Branch diff vs base (`git merge-base HEAD <default>`) plus the projects it touches and their graph neighbours |
| Audit, "full"/"whole workspace" | All projects + root config |
| Workspace has no tags / no boundary rule | Guide: follow the checklist defaults, suggest Setup once; Audit: report `BND-01`/`BND-02`, do not set up |
| Nx version below the baseline or `nx report` fails | Say so; downgrade version-specific rules to `[unverified]` |

## Execution Steps

### Guide
1. `nx report` (version, plugins). Read `nx.json`; list `nx show projects`. Learn existing tags/conventions.
2. Before creating or moving code decide, in order: app vs lib (apps stay thin); scope folder (domain, not tech type); lib type (feature/ui/data-access/util, or the workspace's equivalents); tags (`scope:*`, `type:*`); allowed deps from the matrix in `assets/checklist.md`; public API = the lib's single `index.ts`.
3. Prefer the workspace's generators (local plugin in `tools/`, `nx g ...`) over hand-made projects; check `nx g <gen> --help` and `--dry-run`.
4. After changes: `nx show project <name> --json` to see effective tags/targets/inputs; run lint for the project to prove boundaries hold.
5. Report the decisions made (one line each) in the reply; do not write a file.

### Audit
1. Resolve root (`git rev-parse --show-toplevel`), base ref, scope, Nx version, intent text.
2. Fill `assets/audit-brief.md` and dispatch ONE `general-purpose` subagent (model `opus`); source reads must not flood the parent context.
3. Subagent writes `<root>/.audit/<YYYY-MM-DD>-<branch>-nx.md` and returns the same content.
4. Show the user the header (verdict + counts) and the path. Do not fix. Offer to hand the report to the implementer.
5. Pre-merge: `FIX_REQUIRED` blocks the merge; fix, then re-audit once scoped to the fix diff. No loop-until-clean.

### Setup
1. Only on explicit request. Follow `assets/boundaries-setup.md`.
2. Inventory projects, propose the tag map (project -> scope, type) and the `depConstraints`; WAIT for approval before editing any file.
3. Detect flat (`eslint.config.*`) vs legacy (`.eslintrc*`) config; edit the one in use.
4. Verify with `nx run-many -t lint`; report results, do not commit.

## Output Contract

- Guide: short list of decisions (app/lib, scope, type, tags, allowed deps, generator used).
- Audit: report format in `assets/audit-brief.md` (`## Report format`). Verdict `FIX_REQUIRED` if any blocker/major caused by the diff, else `PASS`.
- Setup: the approved tag map, files changed, lint result.

## References

- `assets/checklist.md` - rule catalogue with IDs, checks, sources, dependency matrix.
- `assets/audit-brief.md` - subagent brief: procedure, allowed commands, report format.
- `assets/boundaries-setup.md` - Setup mode procedure.
