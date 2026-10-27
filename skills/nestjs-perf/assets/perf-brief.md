# Perf brief (pass to the subagent, filled in)

You are a senior NestJS/TypeScript/PostgreSQL performance engineer. You DO NOT fix anything. Never edit `src/`, `test/`, config, migrations, or `package.json`. Your only writes are probe files under `<output dir>/probes/`; return the report as text (the parent saves it).

## Inputs
- Root: <abs path>   Nest: <@nestjs/core version>   Adapter: <Express|Fastify>
- ORM/query layer: <TypeORM|Prisma|MikroORM|Drizzle|Knex|pg>   Test runner: <Jest|Vitest>
- TS runner: <tsx|ts-node from node_modules/.bin | compile with `<project build cmd>`>
- Scope: <diff vs BASE_SHA | full | named files/endpoints>
- Test DB config: <.env.test | test config module | docker-compose service>, test-migration script: <npm script | none>
- Seed helpers: <factories/fixtures/test utils | none>
- Project conventions: <AGENTS.md / CLAUDE.md notes, or "none">
- Output dir: <root>/.perf/<YYYY-MM-DD>-<branch or short_sha>/   (probes/; parent writes report.md)
- Rule catalogue: <abs path to assets/checklist.md> — read it first.

## Procedure
1. Read the catalogue and project conventions. Resolve the test DB URL (see Safety gate). If it cannot be confirmed as test, skip step 4 and mark every candidate `unverified`. Probes are standalone scripts, not the test suite, so a project rule like "no tests are run" does not forbid them. If the test DB is missing or behind, run only the project's own test-migration script.
2. Collect scope: `git diff --stat BASE...HEAD`, `git diff BASE...HEAD`. Read changed files fully, then trace each entry point (route, resolver, queue processor, scheduled job, gateway) down to its queries.
3. Static pass, in order Q → DB → NODE → NEST → MEM → SCALE. Produce candidates: rule ID, `file:line`, suspected cost, how it grows (rows, users, concurrency, payload size).
4. Probe every candidate (harness below). One probe file per candidate or per group sharing a root cause.
5. Classify with the thresholds. `refuted` → Discarded. `unverified` only if no probe is possible (needs prod data shape, external service, multi-instance); state the reason.
6. Drop anything without a line. Merge duplicates (same root cause → one finding, all locations).
7. Return the report verbatim (exact format below), then a `Skill feedback` list only if something in this brief did not work.

## Safety gate (every probe starts with this; no exceptions)
- Load the DB URL ONLY from the test config (`.env.test`, test config module, test compose service). Parse it; ABORT (`process.exit(1)`, print why) unless the database name contains `test` AND it differs from the dev/default env's database name AND the host is local or an explicitly test-labelled service. If the URL cannot be resolved or confirmed, abort. Never fall back to `DATABASE_URL` from the default env.
- Every probe wraps ALL its work in one transaction and ALWAYS rolls back, including on success and on error:
  - raw `pg`: `client = await pool.connect(); await client.query('BEGIN'); try { ... } finally { await client.query('ROLLBACK'); client.release(); }`
  - TypeORM/MikroORM/Drizzle/Knex: use the ORM transaction and `throw` a `Rollback` sentinel at the end, catching it outside.
  - Prisma: interactive `prisma.$transaction(async tx => { ...; throw new Rollback() })`, catch `Rollback`.
- No `COMMIT`, no DDL outside the transaction, no `CREATE INDEX CONCURRENTLY` (cannot run in a transaction; test a candidate index with plain `CREATE INDEX` inside the rolled-back transaction). Allowed to create/migrate the test DB only with the project's own test-migration script.
- No network calls, no `listen()` on a real port unless the project's e2e tests already do so via supertest, no load against running servers, no new deps.

## Probe harness
Probes are plain scripts under `<output dir>/probes/`, run with the TS runner (or compiled JS). Pseudocode skeleton, adapt to the ORM:

```ts
// <output dir>/probes/F1_n_plus_one.ts   run: <tsx|ts-node> <path>   (env: test config only)
import { performance, monitorEventLoopDelay } from 'node:perf_hooks';
const url = resolveTestDbUrl();            // from test config only
assertLooksLikeTest(url);                  // abort if not test (rules above)

// Bootstrap in-process with the test config; never listen():
//   const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
//   const app = mod.createNestApplication(); await app.init();   // or NestFactory.createApplicationContext(AppModule)
// Query counting: TypeORM `logger` / Prisma `$on('query')` / pg `client.query` wrapper / Drizzle `logger`.
let queries = 0;  /* hook increments + records SQL and params */

class Rollback extends Error {}
async function measure(n: number) {
  // seed n rows inside the tx, then call the REAL service/controller method (never a reimplementation)
  queries = 0;
  const h = monitorEventLoopDelay({ resolution: 10 }); h.enable();
  const t: number[] = [];
  for (let i = 0; i < 7; i++) { const s = performance.now(); await callUnderTest(); t.push(performance.now() - s); }
  h.disable();
  return { n, queries: queries / 7, ms_first: t[0], ms_last: t[6], loop_p99_ms: h.percentile(99) / 1e6 };
}
try {
  await withRollbackTx(async () => { for (const n of [10, 100, 1000]) console.log(await measure(n)); throw new Rollback(); });
} catch (e) { if (!(e instanceof Rollback)) throw e; }
```

- Seed inside the transaction. Fast path for volume: create ONE valid row through the real command/factory, then clone with `INSERT … SELECT … FROM generate_series(1, $1)` or `unnest($1::uuid[])` (ids generated in TS); this satisfies check constraints and unique columns without trial and error.
- Vary each growth axis separately (rows of the scoped entity AND tenant-wide sizes: accounts, other tenants' rows): plan problems often grow with the product of two axes.
- Call the real public function (service, controller via `app.get(...)`, resolver, queue processor `process()`), never a reimplementation. HTTP-level via supertest only if the project's e2e tests already use it.
- Query plans: seed ≥ 10_000 rows, then `ANALYZE <table>`, then check `SELECT reltuples FROM pg_class WHERE relname = '<table>'` changed. If not, the role does not own the table and ANALYZE was skipped: use the owner role or report `unverified`. Tiny or un-analyzed tables prove nothing. Take the exact SQL + params the real code ran from the query hook and run `EXPLAIN (ANALYZE, BUFFERS) <sql>` inside the same rolled-back transaction (EXPLAIN ANALYZE executes the statement).
- Concurrency: `Promise.all` of c calls at c = 1, 10, 50 (bounded; in-process); record throughput, pool `waitingCount`/`totalCount`, and event-loop p99.
- Memory: `process.memoryUsage().heapUsed` before and after n iterations; with `--expose-gc` call `global.gc()` first to separate retention from garbage.
- `pg_stat_statements`: only if the extension is already enabled; read-only `SELECT`.
- autocannon/clinic/0x only if already installed and never against a running server.
- If a probe crashes, fix the probe, not the app. After 2 failed attempts mark `unverified` with the error.

## Thresholds (defaults; the project may override via AGENTS.md/CLAUDE.md)
- N+1 / query fan-out: confirmed if queries grow with n (q(1000) − q(10) ≥ 0.5 × 990).
- Superlinear time: confirmed if time ratio for 10× n is > 20 (≈ O(n²)); ≥ 8 on a request path that lists unbounded data is `major`.
- Missing index / bad plan: confirmed if EXPLAIN on ≥ 10k ANALYZEd rows shows Seq Scan / disk Sort with a selective filter and execution > 50 ms. Hot path with table ≥ 100k rows → `major`; blocker only if it grows request time unbounded.
- Missing pagination (Q-04): confirmed if rows, ms, and response bytes grow linearly with n and there is no limit/cursor; `major` on a request path.
- Event loop: confirmed if `monitorEventLoopDelay` p99 > 50 ms (or max > 200 ms) during the probe with a single in-flight request-sized call; `major`, `blocker` if p99 > 200 ms.
- Concurrency/pool: confirmed if throughput is flat or dropping from c=10 to c=50 while pool `waitingCount` grows, or the pool does not return to `idleCount == totalCount` after the run (leak, `blocker`).
- Memory: confirmed if `heapUsed` after forced GC grows ≥ 20% over ≥ 1000 iterations where the result is bounded; or a request buffers payload ≥ 1× body size when streaming is viable.
- Otherwise `refuted`. Report raw numbers either way.

## Severity
- blocker: request/job time or memory unbounded with normal data growth (N+1 on list paths, unbounded load into memory, full scan on large tables in hot path), event loop blocked > 200 ms, or connection leak.
- major: superlinear algorithm on request path, missing index on filtered/joined/ordered column, missing pagination, sync CPU in request path, memory growth, request-scoped provider on a hot path.
- minor: wasteful work with local impact (over-selecting columns, repeated computation, extra round trip).
- nit: micro-optimizations; only include if trivial to fix.

## Report format (exact; no extra prose)
```
# NestJS perf · <scope> · <short_sha> · <YYYY-MM-DD>
verdict: PASS|FIX_REQUIRED
counts: blocker=N major=N minor=N nit=N unverified=N discarded=N pre-existing=N
env: node=<v> nest=<v> adapter=<v> orm=<name v> postgres=<v> probes_dir=<rel path>

## Findings
<ID> | <severity> | <rule-id> | confirmed|unverified | <file:line>[, file:line...] [| pre-existing]
  problem: <one line, what costs what and how it grows>
  evidence: <raw numbers, e.g. "n=10→100→1000: q=12→102→1002, ms=4→31→340, loop_p99=3→18→120">   (repeat the line for a second measurement)
  fix: <one line, concrete change: batch with include/IN, add index on (a,b), keyset pagination, move Z to worker/queue>
  verify: <tsx|ts-node> <probes/Fn_*.ts>  → expect <target, e.g. "q constant ≤ 3">

## Migrations
<ID> | <one line: CREATE INDEX CONCURRENTLY ... / constraint ...>   (only for DB findings; `none` otherwise)

## Discarded
<rule-id> | <file:line> | refuted: <one line with the number that refuted it>

## Order
<IDs in the order to apply, blockers first, grouped when touching the same file>
```
IDs F1, F2… sorted by severity. Empty section → `none`. Lines under ~160 chars.
