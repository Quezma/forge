# Elixir/Phoenix rule catalogue

Cite IDs in findings. Project conventions override these. `EX-*` follow the official Elixir anti-patterns guide (hexdocs.pm/elixir/what-anti-patterns.html).

## ARCH — architecture & boundaries
- ARCH-01 Domain (`MyApp.*`) references web (`MyAppWeb.*`). Dependency must point web → domain only.
- ARCH-02 Web layer calls `Repo`, builds `Ecto.Query`, or uses schemas' internals. Go through a context function.
- ARCH-03 Context reaches into another context's `Repo` queries or private schemas. Call the other context's public API.
- ARCH-04 God context (unrelated responsibilities, very large module). Split by domain concept.
- ARCH-05 Business rules inside schema modules, controllers, LiveViews, or templates. Move to context/domain module.
- ARCH-06 External services (HTTP, mailer, payments, storage) called directly from domain logic. Define a behaviour (port) + adapter, inject via config.
- ARCH-07 Compile-time dependency cycles (`xref cycles`) or modules that recompile half the app.
- ARCH-08 Context public API leaks implementation (returns `Ecto.Query`, `Ecto.Multi`, raw maps from Repo) or accepts web params with string keys deep into the domain.
- ARCH-09 Inconsistent return contracts across a context (`{:ok,_}|{:error,_}` vs nil vs raise mixed for the same kind of operation).
- ARCH-10 New feature placed in the wrong layer/context, or duplicates an existing context function.

## PHX — Phoenix
- PHX-01 Fat controller: logic beyond parse params → call context → render.
- PHX-02 Authorization missing or done only in UI; must live in plug/context/on_mount and per action.
- PHX-03 Not using `action_fallback` while repeating error handling across actions.
- PHX-04 Pattern matching on params trusts shape/keys without validation (use changeset or embedded schema).
- PHX-05 `live_session` without `on_mount` auth for protected LiveViews; router pipelines mixing concerns.
- PHX-06 Business data computed in templates/components instead of assigns prepared beforehand.
- PHX-07 Verified routes not used (`~p`) / hardcoded paths.
- PHX-08 Components: function components missing `attr`/`slot` declarations; logic-heavy HEEx.

## ECTO — Ecto & data
- ECTO-01 N+1: Repo call inside `Enum.*`/comprehension or per-row lazy access. Use `preload`/join/batch.
- ECTO-02 `cast` includes privileged fields (`role`, `*_id` owner, `admin`, `confirmed_at`). Separate changesets per use case.
- ECTO-03 Validation without matching DB constraint (`unique_constraint` w/o unique index, FK w/o `foreign_key_constraint`), or constraint in DB not mapped in changeset.
- ECTO-04 Filtering/sorting/counting in Elixir after `Repo.all` instead of in the query.
- ECTO-05 Side effects (email, HTTP, PubSub broadcast, jobs) inside `Repo.transaction`; broadcast before commit.
- ECTO-06 Multi-step writes without `Ecto.Multi`/transaction (partial state on failure).
- ECTO-07 Bang functions (`insert!`, `get!`) on user-driven paths where `{:error, _}` is expected.
- ECTO-08 Migration issues: missing index on FK/lookup column, non-reversible `change`, data backfill in schema migration, unsafe lock on large table (`create index` without `concurrently` in prod-size tables).
- ECTO-09 Schema used as both persistence and form/API shape with divergent needs; use embedded schema/schemaless changeset.
- ECTO-10 `fragment` with interpolated user input (SQL injection); `String.to_atom` for dynamic fields.

## LV — LiveView
- LV-01 Expensive work or subscriptions in `mount/3` not guarded by `connected?/1` (runs twice).
- LV-02 Large collections in assigns instead of `stream/3`.
- LV-03 Slow I/O in `mount`/`handle_event` blocking the process; use `assign_async`/`start_async`.
- LV-04 `handle_event` trusts client values (ids, roles) without re-authorizing against `current_user`/scope.
- LV-05 DB queries or heavy computation in `render`/HEEx.
- LV-06 Using `@` assigns inside helper functions / passing whole `assigns` to non-components (breaks change tracking).
- LV-07 LiveComponent used where a function component suffices, or stateful component duplicating parent state.
- LV-08 PubSub messages carrying full structs/large payloads or broadcast topics without tenant/user scoping.
- LV-09 `push_navigate`/`push_patch` misuse (patch across LiveViews, navigate within same LV losing state needlessly).

## OTP — processes
- OTP-01 GenServer/Agent used for code organization with no concurrency/state need (= EX-P1). Use plain modules.
- OTP-02 Single GenServer as a bottleneck for hot reads; use ETS / `:persistent_term` / partitioning.
- OTP-03 Unsupervised processes: `spawn`, `Task.async` fire-and-forget, `Task.start` in request path. Use `Task.Supervisor`/Oban.
- OTP-04 Long or blocking work inside `handle_call` (blocks callers, timeouts); default 5s `call` timeouts on slow ops.
- OTP-05 `Process.sleep` in production code for coordination/retries.
- OTP-06 Wrong restart strategy / child order in supervision tree; dynamic children without `DynamicSupervisor`/`Registry`.
- OTP-07 Rescuing everything to avoid crashes instead of let-it-crash + supervision.
- OTP-08 Background jobs not idempotent or missing uniqueness when re-enqueue is possible (Oban).

## SEC — security (Elixir-specific)
- SEC-01 `String.to_atom/1` / `binary_to_term` on external input.
- SEC-02 Secrets or env-specific values in `config.exs`/`prod.exs` instead of `runtime.exs` + env.
- SEC-03 Raw HTML (`raw/1`, `Phoenix.HTML.raw`) with user content.
- SEC-04 Missing CSRF/`protect_from_forgery`, open CORS, or auth tokens in URLs/logs.
- SEC-05 Tenant/owner scoping missing in queries (IDOR): `Repo.get(Post, id)` without owner/scope filter.
- SEC-06 Logging params/PII without `filter_parameters`.

## EX — Elixir official anti-patterns
Code:
- EX-C1 Comments overuse (comment restates code; use names/`@doc`).
- EX-C2 Complex `else` clauses in `with` (can't tell which step failed). Normalize errors in private fns.
- EX-C3 Complex extractions in function heads (match only what selects the clause; extract the rest in body).
- EX-C4 Dynamic atom creation.
- EX-C5 Long parameter list (group into map/struct/keyword).
- EX-C6 Namespace trespassing (defining modules in another library's namespace).
- EX-C7 Non-assertive map access (`map[:key]` when key is required; use `map.key` / pattern match).
- EX-C8 Non-assertive pattern matching (code that silently accepts unexpected shapes).
- EX-C9 Non-assertive truthiness (`&&`/`||`/`!` with booleans; use `and`/`or`/`not`).
- EX-C10 Structs with 32+ fields.
Design:
- EX-D1 Alternative return types driven by options (`opts` changes return shape). Separate functions.
- EX-D2 Boolean obsession (several booleans encoding one state). Use an atom/enum.
- EX-D3 Exceptions for control flow. Return tuples; raise only for exceptional cases (offer `!` variant).
- EX-D4 Primitive obsession (strings/maps where a struct/type belongs).
- EX-D5 Unrelated multi-clause function (one name, unrelated behaviours).
- EX-D6 Using application config in a library-like module instead of function args.
Process:
- EX-P1 Code organization by process.
- EX-P2 Scattered process interfaces (`GenServer.call` to a module from many places; wrap in API module).
- EX-P3 Sending unnecessary data to processes (copying large terms / closures capturing big data).
- EX-P4 Unsupervised processes.
Meta-programming:
- EX-M1 Compile-time dependencies via macros/`use` without need.
- EX-M2 Large code generation in macros (move logic to functions called by the macro).
- EX-M3 Unnecessary macros (a function would do).
- EX-M4 `use` where `import`/`alias` suffices.

## IDIOM — idiomatic Elixir (mostly nit/minor)
- IDIOM-01 Nested `if`/`case` where multi-clause functions or `with` read better.
- IDIOM-02 `length(list) == 0` / `> 0` (O(n)); match `[]` or `Enum.empty?`.
- IDIOM-03 `++` accumulation in loops; prepend + `Enum.reverse` or `Enum.map`/`for`.
- IDIOM-04 Multiple `Enum` passes where one `Enum.reduce`/`for`/`Stream` suffices on large data.
- IDIOM-05 Pipes starting with a function call, single-step pipes, piping into `case`/anonymous fn obscurely.
- IDIOM-06 Missing `@impl true` on callbacks; missing `@spec`/`@doc` on context public API.
- IDIOM-07 `try/rescue` around code that returns tuples; `Map.get(m, k, nil)` noise.
- IDIOM-08 Naming: `get_*` returning nil vs `fetch_*` returning tuples vs `*!` raising — follow convention.
- IDIOM-09 `Application.get_env` in module attribute (compile-time); use `compile_env` or read at runtime.
- IDIOM-10 Reimplementing stdlib (`Enum`, `Map`, `Keyword`, `String`, `DateTime`) or an existing project helper.

## TEST — tests
- TEST-01 New/changed context public functions without tests (happy + error path).
- TEST-02 `async: false` without a shared-state reason.
- TEST-03 `Process.sleep` in tests; use `assert_receive`/`render_async`.
- TEST-04 Mocks without behaviours (use Mox against a behaviour, ARCH-06).
- TEST-05 Testing implementation (private fns, internal state) instead of public behaviour.
- TEST-06 LiveView behaviour tested only via context, not `Phoenix.LiveViewTest`, for UI-critical flows.
- TEST-07 Fixtures bypassing changesets (`Repo.insert!(%Struct{})`) hiding validation bugs.
