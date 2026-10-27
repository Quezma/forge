---
name: nestjs
description: "Trigger: NestJS, Nest module/provider/controller/DTO, where does this Nest code go, forwardRef, circular dependency, Nest DI scope, ValidationPipe, nest audit, before merging in a Nest repo. Guides placement/structure and Nest feature choice from the official docs, runs a report-only architecture audit, and (on request) sets up cycle detection + import-boundary lint."
license: Apache-2.0
metadata:
  author: "quezma"
  version: "1.0"
---

## Activation Contract

Load when `@nestjs/core` is in `package.json` or `nest-cli.json` exists, and the user (a) is about to create, move, or wire Nest code: modules, providers, controllers, DTOs, guards, pipes, config (Guide), (b) asks to audit/review the app or a branch, or before merging in a Nest repo (Audit), or (c) explicitly asks to set up cycle detection / import boundaries (Setup).

## Hard Rules

- Rules are written for a Nest 12 baseline (docs.nestjs.com, migration guide v11 -> v12). Read `@nestjs/core` in `package.json` first; rules marked `v12+` in the checklist do not apply to older majors.
- The project's own conventions win: `CLAUDE.md`/`AGENTS.md`, existing folder layout, hexagonal/clean layering already in use, naming. Map the defaults onto them; do not restructure to match the checklist.
- Never install packages, run codemods, `nest update`, or schematics that rewrite files without asking. Audit mode runs check-only commands.
- `forwardRef` is a smell, never the fix. Fix a cycle by restructuring: extract the shared provider into its own lower-level module, invert the dependency via an interface + injection token (port), or decouple with events (`@nestjs/event-emitter`/CQRS). Never add `forwardRef` to make a cycle compile.
- Do not guess flags or APIs: if unsure, check `--help` or the docs page cited in the checklist. Rules tagged `[unverified]` are stated as unverified.
- Nx workspace too (`nx.json` at root): workspace/project-level boundaries belong to the `nx-monorepo` skill; this skill covers only in-app Nest structure.
- Audit is REPORT ONLY: the only write is the report file. Every finding cites `file:line` and a rule ID from `assets/checklist.md`; no evidence, no finding.
- Findings on code the diff did not touch are tagged `pre-existing`; they never raise the verdict.
- Terse, machine-oriented output: no prose intros, no praise.

## Decision Gates

| Situation | Mode |
|-----------|------|
| Writing/placing/wiring Nest code (default) | Guide |
| "audit", "review", "check the work", before merge | Audit |
| "set up cycle detection", "add import boundaries", "enforce layers" | Setup (only on explicit ask) |
| Audit, default scope | Branch diff vs base (`git merge-base HEAD <default>`) plus the modules it touches and their importers |
| Audit, "full"/"whole app" | All of `src/` (or each app root) + root config |
| No cycle check / no boundary lint present | Guide: follow the checklist, suggest Setup once; Audit: report `CYC-07`/`LAY-06`, do not set up |
| `@nestjs/core` below 12 or unreadable | Say so; treat `v12+` rules as not applicable, others `[unverified]` for that version |
| Cycle found or `forwardRef` requested | Guide: propose the restructuring (CYC rules), not `forwardRef` |

## Execution Steps

### Guide
1. Read `package.json` (`@nestjs/*` versions, adapter Express/Fastify, validation lib), `nest-cli.json`, `tsconfig.json`, and the module tree (`*.module.ts`). Learn existing layering and naming.
2. Before creating or moving code decide, in order: owning feature module (by domain, not tech type); layer (controller / application / domain / infrastructure) per the matrix in `assets/checklist.md`; what the module exports (its public API); provider scope (singleton unless proven otherwise); interface needs a token; DTO vs entity.
3. Pick the Nest feature that fits (FEAT rules): guard for authz, pipe for validation/transform, interceptor for cross-cutting response logic, filter for error mapping, events/queues for decoupling and offloading. Do not add one speculatively.
4. Prefer `nest g <schematic> --dry-run` (check `nest g --help`) over hand-made files when the project uses the CLI.
5. After changes: `npx tsc --noEmit` and the project's lint; if madge is installed, `npx madge --circular --extensions ts src`.
6. Report the decisions made (one line each) in the reply; do not write a file.

### Audit
1. Resolve root (`git rev-parse --show-toplevel`), base ref, scope, Nest version, intent text.
2. Fill `assets/audit-brief.md` and dispatch ONE `general-purpose` subagent (model `opus`); source reads must not flood the parent context.
3. Subagent writes `<root>/.audit/<YYYY-MM-DD>-<branch>-nest.md` and returns the same content.
4. Show the user the header (verdict + counts) and the path. Do not fix. Offer to hand the report to the implementer.
5. Pre-merge: `FIX_REQUIRED` blocks the merge; fix, then re-audit once scoped to the fix diff. No loop-until-clean.

### Setup
1. Only on explicit request. Follow `assets/boundaries.md`.
2. Inventory modules and layers, propose the boundary zones and the cycle check; WAIT for approval before editing any file or installing anything.
3. Detect flat (`eslint.config.*`) vs legacy (`.eslintrc*`) config; edit the one in use.
4. Introduce as `warn`, then `error`. Verify with the project's lint and the cycle script; report results, do not commit.

## Output Contract

- Guide: short list of decisions (module, layer, exports, scope, token, Nest feature used, checks run).
- Audit: report format in `assets/audit-brief.md` (`## Report format`). Verdict `FIX_REQUIRED` if any blocker/major caused by the diff, else `PASS`.
- Setup: the approved zones and cycle check, files changed, lint result.

## References

- `assets/checklist.md` - rule catalogue with IDs, checks, sources, layer dependency matrix.
- `assets/audit-brief.md` - subagent brief: procedure, allowed commands, report format.
- `assets/boundaries.md` - Setup mode procedure.
