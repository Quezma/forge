# nestjs-perf-skill

Objective: a report-only performance audit for NestJS + TypeScript + PostgreSQL that proves each finding with a probe and drops false positives, mirroring `elixir-perf`.
Why: `nestjs` covers structure, `architecture-patterns` covers reliability; nothing measures N+1s, missing indexes, event-loop blocking, or memory growth in Nest services.
Scope: `skills/nestjs-perf/` (SKILL.md, assets/checklist.md, assets/perf-brief.md) + its row in `rules/skills.md`. Sources: docs.nestjs.com (performance/Fastify, caching, queues, compression), Node.js docs (event loop, `perf_hooks`, worker threads, streams), PostgreSQL docs (EXPLAIN, indexes, pg_stat_statements, locking), ORM docs (TypeORM, Prisma, MikroORM, Drizzle), node-postgres pooling.
Constraints: same format and hard rules as elixir-perf; probes run only against a test DB (from `.env.test`/test config) inside a transaction that is always rolled back, never dev/staging/prod; no new deps (use `tsx`/`ts-node` only if installed, else compiled JS via the project's build); no load against running servers; English; terse.
TDD: n/a for prose skill content; checks = tests/run.sh green (routing test requires the rules row) + structural readback.

## Tasks
- [x] T1 Research + write SKILL.md, assets/checklist.md (IDs, probe method, Src, tag), assets/perf-brief.md (probe harness, thresholds, report format). — route: delegated research+writer (3 files, preparation trigger) Evidence: skills/nestjs-perf (220 lines), 42 rules all with severity+Probe+Src (33 [doc] / 1 [3p] / 8 [unverified]), safety gate aborts on non-test DB + always-rollback, tests 34/34, setup --dry-run symlinks it.
- [x] T2 Add `nestjs-perf` to the NestJS row of `rules/skills.md` (merge column). — route: inline (one mechanical line) Evidence: rules/skills.md NestJS row; routing test green.

## Acceptance
- Every checklist rule has an ID, a probe method, and a source URL.
- Probe harness cannot write outside a rolled-back transaction on a test DB; aborts otherwise.
- tests/run.sh green; `./setup --only skills --dry-run` symlinks it.
