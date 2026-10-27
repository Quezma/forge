# Elixir/Phoenix/PostgreSQL perf catalogue

Cite IDs in findings. `probe:` says how to confirm. Project conventions override these.

## Q — Ecto queries
- Q-01 N+1: Repo call inside `Enum.*`/comprehension, or association loaded per row. probe: query count at n=10/100/1000.
- Q-02 Preload of large/unbounded associations when only a count or a few fields are needed. probe: rows/memory loaded vs used.
- Q-03 `Repo.all` without `limit`/pagination on a list path. probe: time + memory at 1k/10k rows.
- Q-04 Filtering, sorting, counting, or aggregating in Elixir (`Enum.filter/sort/count/sum`) after loading rows. probe: rows fetched vs rows returned.
- Q-05 Selecting full rows/embeds/large text/jsonb when few columns are needed. probe: bytes via `:erlang.term_size`.
- Q-06 Several sequential queries that could be one join/subquery/`Repo.preload` batch. probe: query count per call.
- Q-07 Per-row inserts/updates in a loop instead of `insert_all`/`update_all`/`Ecto.Multi`. probe: queries + ms at n=100/1000.
- Q-08 `Repo.aggregate(:count)`/`exists?` misuse (count when `exists?` suffices, count on huge tables per request). probe: EXPLAIN analyze.
- Q-09 OFFSET pagination on large/deep pages. probe: EXPLAIN on offset 10k vs keyset.
- Q-10 Long transaction holding locks or doing external/slow work inside `Repo.transaction`/`Multi`. probe: time inside transaction.
- Q-11 Large export/batch loads entire result set instead of `Repo.stream` in a transaction / chunked. probe: memory at 10k+ rows.

## DB — PostgreSQL schema & plans
- DB-01 Missing index on FK, `where`, `join`, or `order_by` column on a growing table. probe: EXPLAIN ≥ 10k rows.
- DB-02 Wrong composite index order, or index unusable (function on column, `ilike '%x'`, cast, mismatched type). probe: EXPLAIN shows seq scan despite index.
- DB-03 Missing partial/unique index where the query filters a constant (`where deleted_at is null`, status). probe: EXPLAIN.
- DB-04 Migration that locks a hot table: `create index` without `concurrently`, adding a column with volatile default, changing type, adding FK without `validate: false`. probe: static only (mark unverified, cite migration line).
- DB-05 Text search with `like '%..%'` without trigram/GIN; jsonb queried without GIN. probe: EXPLAIN.
- DB-06 Counter/hot-row updates (`update ... set count = count + 1` on one row per request) → row lock contention. probe: concurrency c=1/10/50.
- DB-07 Unbounded table growth with no retention/partitioning for event/log tables. probe: static (unverified).
- DB-09 Query whose cached generic plan (after 5 executions of an Ecto prepared statement) is far worse than the custom plan: joins/filters on `coalesce()`, `OR`, optional params, skewed tenant data. probe: generic vs custom plan (`force_generic_plan`), `ms_last` vs `ms_first`.
- DB-08 Pool sizing or `queue_target`/`timeout` mismatched with concurrency (e.g. long queries + small pool). probe: concurrency vs pool size.

## PHX — Phoenix request path
- PHX-01 Expensive work synchronous in the request that could be a background job (emails, external APIs, file processing). probe: ms per request.
- PHX-02 Same data loaded repeatedly per request (in plugs + controller + view). probe: query count per request via ConnTest.
- PHX-03 Large JSON rendered without pagination or with deep nested preloads. probe: response bytes + ms at 1k rows.
- PHX-04 Missing caching for hot, rarely changing reads (config, permissions, lookups) hitting DB every request. probe: query count per request.
- PHX-05 Uploads/downloads read fully into memory instead of streamed. probe: memory per request.

## LV — LiveView
- LV-01 Large/unbounded lists in assigns instead of `stream/3`. probe: `:erlang.term_size` of socket assigns at n=1000.
- LV-02 DB queries in `mount/3` executed twice (disconnected + connected) when one would do, or in `render`/components. probe: query count per mount.
- LV-03 `handle_info`/PubSub broadcast triggers full reload of a list per event per subscriber. probe: queries per broadcast × subscribers.
- LV-04 Broadcasting whole structs/lists over PubSub instead of IDs/diffs. probe: message size.
- LV-05 `assign` of changing big maps causing large diffs; missing `temporary_assigns`/streams. probe: rendered diff size.
- LV-06 `phx-change`/keyup without `phx-debounce` triggering queries per keystroke. probe: static + query count per event.

## OTP — processes
- OTP-01 Single GenServer on the hot path serializing all callers (cache, counter, rate limiter, registry). probe: throughput at c=1/10/50 + mailbox length.
- OTP-02 Slow work (DB, HTTP, heavy CPU) inside `handle_call`, blocking the server. probe: call latency under concurrency.
- OTP-03 Large state in a process copied on every `call`/`get`. Use ETS (`read_concurrency: true`) or `:persistent_term` for read-mostly. probe: term_size + latency.
- OTP-04 Unbounded mailbox / no backpressure (casts faster than processing). probe: mailbox length over time.
- OTP-05 `Task.async` without limit over user-sized input instead of `Task.async_stream(max_concurrency:)`. probe: process count at n=10k.
- OTP-06 Oban/job queues: unbounded `limit`, missing `unique`, jobs that enqueue per row instead of batching. probe: jobs inserted per action.
- OTP-07 `:persistent_term.put` on frequently changing data (global GC on update). probe: static.

## BEAM — CPU & memory
- BEAM-01 Quadratic list ops: `++` in loops, `Enum.at`/`length` in loops, `List.last` repeatedly, nested `Enum.find`. probe: time ratio for 10× n.
- BEAM-02 String concatenation in loops instead of iodata. probe: time + memory at 10k.
- BEAM-03 Large binaries kept alive by sub-binary references (refc binary leaks), `binary_part` of big payloads stored long-term. probe: `:binary.referenced_byte_size`.
- BEAM-04 Repeated `Map`/`Enum` passes that could be one `reduce`; `Enum` on huge collections where `Stream` avoids materializing. probe: memory.
- BEAM-05 Regex compiled at runtime in hot path; `String.to_atom` on input (atom table). probe: time per call / static.
- BEAM-06 JSON encode/decode of large payloads repeatedly in a request. probe: ms.

## SCALE — horizontal & growth
- SCALE-01 Node-local state (ETS, GenServer, Agent) assumed global; breaks or duplicates with >1 node. probe: static (unverified).
- SCALE-02 Scheduled/cron work that runs on every node (Quantum/`:timer`) instead of once (Oban cron / leader). probe: static.
- SCALE-03 Work proportional to total users/rows per request (global counts, full-table reads) — grows with tenant/user base. probe: time at 1k vs 10k rows.
- SCALE-04 No timeouts/limits on external calls or user-controlled sizes (page size, batch size, upload size). probe: static + max param probe.
