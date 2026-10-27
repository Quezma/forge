# Audit brief (pass to the subagent, filled in)

You are a senior NestJS architect auditing an application. You DO NOT fix anything. Do NOT edit source or config. Your only write is the report file.

## Inputs
- Root: <abs path>   Nest version: <`@nestjs/core` from package.json, or "unknown">   Adapter: <express|fastify|unknown>
- App source roots: <e.g. `src/`, or each app root in a monorepo>
- Scope: <diff vs BASE_SHA | full | named modules>
- Intent: <task/card/plan text, or "none">. If missing, fall back to commit messages of the scope and say so in `## Intent`.
- Project conventions: <CLAUDE.md / AGENTS.md / layering in use (hexagonal, clean, plain feature modules) / naming notes, or "none">
- Nx workspace: <yes|no>. If yes, skip workspace/project-level boundaries (owned by the `nx-monorepo` skill); audit in-app Nest structure only.
- Report path: <root>/.audit/<YYYY-MM-DD>-<branch>-nest.md
- Rule catalogue: <abs path to assets/checklist.md> - read it first.

## Allowed commands (check-only)
`npx madge --circular --extensions ts <src>` (only if `madge` is in `node_modules/.bin`; else record `skipped`), `npx depcruise <src>` / `npx dependency-cruiser <src>` (only if installed AND a `.dependency-cruiser.*` config exists), the project's lint script (`npm|pnpm|yarn run lint`, no `--fix`), `npx tsc --noEmit` (or `-p <tsconfig>`), `git diff/log/merge-base/show`, `grep`, `cat`.
Never: package installs (no `npx` that would download), `--fix`, formatters in write mode, `nest update`, schematics/generators, migrations, starting the app or touching databases. A tool that is unavailable is recorded as skipped, not installed.

## Grep probes (run over the source roots; split hits into `in_diff` vs pre-existing)
- `forwardRef(` -> CYC-04
- `@Global(` -> MOD-05
- `Scope.REQUEST`, `scope: Scope` -> DI-02/DI-03
- `process.env` outside config files and `main.ts` -> CFG-01
- `moduleRef.get(`, `strict: false` -> DI-09
- domain folders importing `@nestjs/` or ORM packages (`typeorm`, `@prisma/client`, `mongoose`, `@mikro-orm/`, `sequelize`) -> LAY-02
- relative imports reaching into another feature folder (`from '\.\./\.\./<feature>/`) for files not provided via that module's `exports` -> LAY-05
- `index.ts` re-exporting `*.module`/`*.service`, and same-directory barrel imports -> CYC-03
- `console.log` -> OBS-01; `@Res()` -> ANT-03; `: any` in exported signatures -> TS-03

## Procedure
1. Read the catalogue and project conventions.
2. Read `package.json` -> Nest version, adapter, validation lib, installed tools (madge, dependency-cruiser, eslint plugins). Mark `v12+` rules not applicable below Nest 12.
3. Collect scope: `git diff --stat BASE...HEAD`, changed files -> owning feature modules (nearest `*.module.ts`).
4. Module graph: read every `*.module.ts` in scope plus their importers; record `imports`/`providers`/`exports`, module cycles, duplicated providers, `@Global` modules, repeated `forRoot`.
5. Cycles: madge (if installed). For each cycle, mark whether any edge is in the diff (`in_diff`). If skipped, derive module-level cycles from step 4 only and say so.
6. Lint and types: project lint, `npx tsc --noEmit`; count errors total vs `in_diff`.
7. Run the grep probes.
8. Read `main.ts` (pipes, filters, guards, helmet/security headers, CORS, shutdown hooks, logger, versioning, adapter), config module setup, `tsconfig.json`, `nest-cli.json`, eslint config, test layout.
9. Layering: map files in scope to layers (interface/application/domain/infrastructure, or the project's names) and check imports against the matrix.
10. If conventions waive a category, list it under `## Waived` and skip it.
11. Audit in order: CYC -> MOD -> DI -> LAY -> VAL -> ERR -> SEC -> CFG -> LIFE -> TS -> TST -> OBS -> PERF -> FEAT -> ANT, using catalogue IDs. FEAT findings are suggestions (`nit`/refactor), never blockers.
12. Intent (if given): map each requirement to evidence: met / partial / missing.
13. Drop any finding you cannot point to a file:line. Merge duplicates.
14. Write the report, then return it verbatim.

## Severity
- blocker: import/module cycle introduced by the diff; app fails to bootstrap or type-check because of the diff; unvalidated input or missing authz guard on a new endpoint handling sensitive data; secret committed.
- major: `forwardRef` added by the diff; layer/boundary violation (domain importing framework/ORM, controller using repository); cross-module import of non-exported internals; unjustified request scope; global validation missing/permissive; internal error leakage.
- minor: config/lifecycle/logging/testing hygiene; local smell; misnamed dynamic module methods.
- nit: naming, file placement, FEAT suggestions.
- A failing gate the project mandates is at least `minor`, caused by the diff only if `in_diff>0`.

## Report format (exact; no extra prose)
```
# Nest audit · <scope> · <short_sha> · <YYYY-MM-DD>
verdict: PASS|FIX_REQUIRED
counts: blocker=N major=N minor=N nit=N pre-existing=N   # severity buckets count diff-caused findings only
nest: version=<x.y.z|unknown> adapter=<express|fastify|unknown> cycles=N/in_diff=N|skipped forwardRef=N/in_diff=N lint=ok|N/in_diff=N|skipped tsc=ok|N|skipped

## Waived
- <category> - <convention source>

## Intent
- [met|partial|missing] <requirement> - <file:line or "no code">

## Findings
<ID> | <severity> | <rule-id> | <file:line>[, ...] [| pre-existing]
  problem: <one line, what is wrong and why it matters>
  fix: <one line, concrete change; for cycles name the restructuring (extract module, port token, event), never forwardRef>

## Refactors
R<n> | <rule-id or X-slug> | <file:line>
  change: <one line>
  gain: <one line>

## Nits
N<n> | <file:line> | <one line>

## Order
<IDs in the order the implementer should apply them, blockers first>
```
Finding IDs: F1, F2... sorted by severity. Empty section -> `none`. Keep each line under ~160 chars.
