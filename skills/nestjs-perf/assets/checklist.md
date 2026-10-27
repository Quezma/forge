# NestJS/TypeScript/PostgreSQL perf catalogue

Cite IDs in findings. Line format: `ID (severity) rule. Probe: how to prove/refute. Src: url [tag]`. Tags: `[doc]` primary source fetched, `[3p]` third-party, `[unverified]` not fetched. Severity is the default; the brief's thresholds decide. Project conventions override these.

## Q — Queries (ORM / raw pg)
- Q-01 (blocker) N+1: awaited query inside a loop/`map`, lazy relation accessed per row, per-row resolver fetch, or Prisma query per item. Probe: query count at n=10/100/1000 via ORM logger or pg hook. Src: https://www.prisma.io/docs/orm/prisma-client/queries/query-optimization-performance [doc]
- Q-02 (major) Lazy relations / `eager: true` relations loaded by default on every `find*`. Probe: query count + bytes loaded vs fields used. Src: https://typeorm.io/docs/relations/eager-and-lazy-relations [doc]
- Q-03 (minor) Over-fetching: `SELECT *`, full entities, large text/jsonb when few columns are used (Prisma `select`, TypeORM `select`/QueryBuilder). Probe: row bytes returned vs used. Src: https://www.prisma.io/docs/orm/prisma-client/queries/query-optimization-performance [doc]
- Q-04 (major) List query without `LIMIT`/pagination or page-size cap. Probe: rows, ms, response bytes at 1k/10k rows. Src: https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop [doc]
- Q-05 (major) OFFSET pagination on large/deep pages; prefer keyset. Probe: EXPLAIN ANALYZE offset 10k+ vs keyset on the same table. Src: https://use-the-index-luke.com/no-offset [3p]
- Q-06 (minor) Large `IN (...)` lists built per request, or many single-id lookups instead of one batched query/`ANY($1)`. Probe: query count and plan at 10/1000 ids. Src: https://www.prisma.io/docs/orm/prisma-client/queries/query-optimization-performance [doc]
- Q-07 (blocker) GraphQL field resolver hits the DB per parent without DataLoader (per-request instance). Probe: queries for a list of n parents. Src: https://github.com/graphql/dataloader [doc]
- Q-08 (major) Transaction scope too wide/long: external calls, HTTP, or slow work inside a transaction holding a connection/locks. Probe: ms inside transaction; pool wait at c=10/50. Src: https://www.postgresql.org/docs/current/using-explain.html [doc]
- Q-09 (major) Per-row inserts/updates in a loop instead of bulk (`insert` many, `createMany`, `UNNEST`, `update ... WHERE id = ANY`). Probe: queries + ms at n=100/1000. Src: https://www.prisma.io/docs/orm/prisma-client/queries/query-optimization-performance [doc]
- Q-10 (major) `COUNT(*)`/aggregate on a large table per request (count for pagination, totals). Probe: EXPLAIN ANALYZE on >=10k rows; ms. Src: https://www.postgresql.org/docs/current/using-explain.html [doc]
- Q-11 (major) Large export/batch loads the full result into memory instead of cursor/stream/chunked. Probe: `heapUsed` delta at 10k+ rows. Src: https://nodejs.org/api/stream.html [doc]

## DB — PostgreSQL schema & plans
- DB-01 (major) Missing index on FK, `WHERE`, `JOIN`, or `ORDER BY` column of a growing table. Probe: EXPLAIN (ANALYZE, BUFFERS) on >=10k ANALYZEd rows shows Seq Scan/Sort. Src: https://www.postgresql.org/docs/current/using-explain.html [doc]
- DB-02 (major) Index unusable: function/cast on column, `ILIKE '%x'`, mismatched type, wrong composite order. Probe: EXPLAIN shows Seq Scan despite index. Src: https://www.postgresql.org/docs/current/using-explain.html [doc]
- DB-03 (major) `jsonb` filtered (`@>`, `->>`) without a GIN/expression index. Probe: EXPLAIN on >=10k rows. Src: https://www.postgresql.org/docs/current/datatype-json.html [doc]
- DB-04 (minor) No partial index where queries filter a constant (`deleted_at IS NULL`, status). Probe: EXPLAIN. Src: https://www.postgresql.org/docs/current/indexes-partial.html [doc]
- DB-05 (blocker) `synchronize: true` (TypeORM) or schema auto-sync outside local dev. Probe: static, config at `file:line` (mark unverified). Src: https://typeorm.io/docs/data-source/data-source-options [doc]
- DB-06 (major) Migration builds an index on a hot table without `CONCURRENTLY` (blocks writes until done). Probe: static only (unverified, cite migration line). Src: https://www.postgresql.org/docs/current/sql-createindex.html [doc]
- DB-07 (major) Pool misconfigured: `max` far below concurrency with long queries, or above DB `max_connections` budget across instances. Probe: concurrency c=1/10/50 vs pool size, `pool.waitingCount`. Src: https://node-postgres.com/features/pooling [doc]
- DB-08 (blocker) Connection leak: `pool.connect()` without `release()` in `finally`, or query runner not released. Probe: `pool.totalCount/idleCount` after n calls incl. error path. Src: https://node-postgres.com/features/pooling [doc]
- DB-09 (minor) Hot-row counter updates (`SET n = n + 1` on one row per request) → lock contention. Probe: concurrency c=1/10/50 throughput. Src: https://www.postgresql.org/docs/current/using-explain.html [doc]
- DB-10 (minor) Repeated slow statements visible in `pg_stat_statements` (only if already enabled; read-only). Probe: `calls`, `total_exec_time` for the statement. Src: https://www.postgresql.org/docs/current/pgstatstatements.html [doc]

## NODE — Event loop & concurrency
- NODE-01 (blocker) Sync CPU/IO in request path: `*Sync` fs/crypto/zlib, `bcrypt` sync, `execSync`. Probe: `monitorEventLoopDelay` p99 during n calls. Src: https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop [doc]
- NODE-02 (major) Large `JSON.parse/stringify`, big regex (ReDoS), or heavy loop on request-sized input. Probe: ms and event-loop p99 at 1x/10x payload. Src: https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop [doc]
- NODE-03 (major) CPU-heavy or long work inline instead of worker threads (pooled) or a queue (`@nestjs/bullmq`). Probe: request ms + event-loop p99 under c=10. Src: https://nodejs.org/api/worker_threads.html [doc]
- NODE-04 (minor) Sequential `await` in a loop over independent I/O that could run in a bounded `Promise.all`. Probe: ms at n=10/100 sequential vs bounded. Src: https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop [doc]
- NODE-05 (major) Unbounded `Promise.all` over user-sized input (pool exhaustion, memory). Probe: pool waiting + heap at n=10k. Src: https://node-postgres.com/features/pooling [doc]
- NODE-06 (major) Large payloads buffered in memory instead of streamed (uploads, downloads, exports). Probe: `heapUsed`/`rss` per request at 10MB/100MB. Src: https://nodejs.org/api/stream.html [doc]
- NODE-07 (minor) Long work on the libuv pool without bounds (huge `readFile`, large `randomBytes`). Probe: ms under c=10. Src: https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop [doc]

## NEST — Framework path
- NEST-01 (major) Request/transient-scoped provider on a hot path (new DI subtree per request; scope bubbles up). Probe: ms/req and allocations, scoped vs default. Src: https://docs.nestjs.com/fundamentals/injection-scopes [doc]
- NEST-02 (major) Heavy global interceptor/pipe/guard (e.g. `ValidationPipe` `transform` on huge payloads, DB call per request). Probe: ms per layer at 1x/100x payload. Src: https://docs.nestjs.com/techniques/performance [doc]
- NEST-03 (minor) Express adapter on a throughput-critical service where Fastify is viable. Probe: static; note compat cost (unverified). Src: https://docs.nestjs.com/techniques/performance [doc]
- NEST-04 (minor) App-level compression in production instead of the reverse proxy. Probe: static config at `file:line` (unverified). Src: https://docs.nestjs.com/techniques/compression [doc]
- NEST-05 (major) Hot, rarely changing read hits DB every request with no cache; or cache without invalidation/TTL. Probe: queries per request; stale read after write. Src: https://docs.nestjs.com/techniques/caching [doc]
- NEST-06 (minor) Verbose logging in hot paths (per-row/per-query logs, large objects, sync transports). Probe: log bytes and ms per request. Src: https://docs.nestjs.com/techniques/performance [doc]
- NEST-07 (major) `ClassSerializerInterceptor`/`class-transformer` over large entity graphs. Probe: ms + event-loop p99 at 1k nested rows. Src: https://docs.nestjs.com/techniques/serialization [unverified]
- NEST-08 (minor) Queue jobs enqueued per row instead of batched, or no concurrency/limiter on processors. Probe: jobs inserted per action; static. Src: https://docs.nestjs.com/techniques/queues [doc]

## MEM — Memory
- MEM-01 (major) Unbounded in-memory cache/`Map`/array keyed by user input, no max or TTL. Probe: `heapUsed` after n iterations with distinct keys. Src: https://docs.nestjs.com/techniques/caching [doc]
- MEM-02 (major) Event listeners added per request and never removed. Probe: `listenerCount` and `heapUsed` growth over n iterations. Src: https://nodejs.org/api/events.html [doc]
- MEM-03 (minor) Closures or request objects retained across requests (module-level refs, singleton holding `req`/results). Probe: heap growth after forced GC (`--expose-gc`) over n iterations. Src: https://betterstack.com/community/guides/scaling-nodejs/high-performance-nodejs/nodejs-memory-leaks/ [3p]

## SCALE — Growth & horizontal
- SCALE-01 (major) Work proportional to total users/rows per request (global counts, full-table reads). Probe: ms at 1k vs 10k rows. Src: https://www.postgresql.org/docs/current/using-explain.html [doc]
- SCALE-02 (major) Node-local state (in-memory cache, `@nestjs/schedule` cron, in-process queue) assumed global; duplicates or breaks with >1 instance. Probe: static (unverified). Src: https://docs.nestjs.com/techniques/queues [doc]
- SCALE-03 (minor) No limits on user-controlled sizes (page size, batch size, body size). Probe: static + max-param probe. Src: https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop [doc]
