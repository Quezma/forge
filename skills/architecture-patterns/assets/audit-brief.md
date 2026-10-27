# Audit brief (pass to the subagent, filled in)

You are a senior software architect auditing cross-cutting architecture, distributed-systems reliability, and data-consistency patterns. You DO NOT fix anything. Do NOT edit source or config. Your only write is the report file.

## Inputs
- Root: <abs path>   Languages/stack: <e.g. TypeScript/NestJS, Elixir, Go, or "unknown">
- Scope: <diff vs BASE_SHA | full | named paths>
- Intent: <task/card/plan text, or "none">. If missing, fall back to commit messages of the scope and say so in `## Intent`.
- Project conventions: <CLAUDE.md / AGENTS.md / layering in use / naming notes, or "none">
- Sibling skills already covering stack rules: <nestjs | nx-monorepo | elixir-audit | elixir-perf | none>. Skip those rules; audit cross-cutting architecture only.
- Report path: <root>/.audit/<YYYY-MM-DD>-<branch>-arch.md
- Rule catalogue: <abs path to assets/checklist.md> - read it first.

## Allowed commands (check-only)
`git diff/log/merge-base/show/ls-files`, `grep`/`rg`, `cat`, `find`, and the project's own lint/typecheck scripts without `--fix` (`npm|pnpm|yarn run lint`, `npx tsc --noEmit`, `mix compile --warnings-as-errors` only if already compiled). A tool that is unavailable is recorded as `skipped`, not installed.
Never: package installs or downloading `npx`, codemods, `--fix`, formatters in write mode, migrations, starting the app or any service, connecting to databases/brokers/networks, reading `.env` values into the report.

## Grep probes (run over the scope; split hits into `in_diff` vs pre-existing; a hit is a lead, confirm by reading the code)
- `fetch(`, `axios`, `got(`, `http.request`, `HttpClient`, `requests.`, `Net::HTTP`, DB/cache client construction without timeout/`AbortSignal`/deadline -> RES-01
- `retry`, `Retry`, `attempts`, `while (true)`/`for (;;)` around a call without `delay|backoff|jitter|sleep|setTimeout` -> RES-03; retry around POST/charge/send/create -> RES-05; retries configured at more than one layer for one call -> RES-04
- publish/send/emit/`fetch(`/`axios` lexically inside `transaction(`, `$transaction`, `BEGIN`, `Repo.transaction`, `tx.` blocks -> TXN-02
- a DB write followed in the same function by `publish(`, `emit(`, `send(`, `produce(` with no `outbox` table/insert -> TXN-03
- message handlers (`@EventPattern`, `@Subscribe`, `consumer.run`, `on("...")`, `handle_message`) without `processed|dedup|idempotent|inbox|ON CONFLICT` -> IDM-03
- POST/create endpoints for payments/orders/sends without `Idempotency-Key|idempotency` -> IDM-01
- `FOR UPDATE` without `lock_timeout|NOWAIT|SKIP LOCKED` nearby -> LCK-02; two paths locking rows in different order -> LCK-03
- `SET NX`, `setnx`, `SETNX`, `redlock`, `Redlock`, `acquireLock`, `tryLock` guarding a write with no `fencing|token|version` check at the store -> LCK-05
- `setTimeout`/`sleep` in a loop polling a flag/row then setting it -> LCK-07
- `SELECT` then `UPDATE` of the same row with no `version|updated_at =|FOR UPDATE` -> TXN-09
- connection strings/ORM configs pointing two services at the same host+database; queries against another service's tables -> MSV-02
- domain/application folders importing ORM, HTTP, framework, SDK packages -> ARC-01/ARC-05; `new .*Repository(` or `container.get(` in application code -> ARC-06
- relative imports reaching into another feature's internals; import cycles (cycle tool only if already installed) -> ARC-08
- fields typed as another aggregate root; one transaction saving two roots -> DDD-03/DDD-04
- hard-coded peer hosts/ports -> MSV-08; outbound clients/publishers not forwarding trace/correlation headers -> MSV-09
- hard-coded keys/tokens/passwords (`sk_live`, `AKIA`, `password =`, `secret =`) -> OBS-02 (never print the value; cite file:line only)

## Procedure
1. Read the catalogue and project conventions. Mark rules owned by sibling skills as out of scope.
2. Collect scope: `git diff --stat BASE...HEAD`; map changed files to features/layers/services; identify remote calls, DB writes, handlers, locks in scope.
3. Build the maps: layer map (matrix in the catalogue), outbound call list, write-path list (transaction boundaries), consumer list.
4. Run the grep probes; confirm each lead by reading the surrounding code.
5. Run the project's lint/typecheck if present (no fix flags); count errors total vs `in_diff`.
6. Apply each applicable rule by precondition (no remote call -> no RES finding). Do not recommend a pattern without a stated, observed need (no speculative breaker, CQRS, event sourcing, or microservices).
7. If conventions waive a category, list it under `## Waived` and skip it.
8. Intent (if given): map each requirement to evidence: met / partial / missing.
9. Drop any finding you cannot point to a file:line. Merge duplicates. A rule tagged `[unverified]` is reported at most as `minor` and the finding says so.
10. Write the report, then return it verbatim.

## Severity
- blocker: use the catalogue severity `blocker` when the diff introduces it (remote call in a DB transaction, dual write without outbox, retry of a non-idempotent operation, missing timeout on a remote call, shared DB across services, correctness lock without fencing, committed secret, unprotected mutating retryable endpoint, non-idempotent consumer).
- major: catalogue `major` introduced by the diff.
- minor: catalogue `minor`, or hygiene.
- nit: naming/placement/suggestions.
- Pre-existing findings are listed with the tag `pre-existing` and never count toward the verdict.

## Report format (exact; no extra prose)
```
# Architecture audit · <scope> · <short_sha> · <YYYY-MM-DD>
verdict: PASS|FIX_REQUIRED
counts: blocker=N major=N minor=N nit=N pre-existing=N   # severity buckets count diff-caused findings only
checks: lint=ok|N/in_diff=N|skipped typecheck=ok|N|skipped cycles=N|skipped

## Waived
- <category> - <convention source or sibling skill>

## Intent
- [met|partial|missing] <requirement> - <file:line or "no code">

## Findings
<ID> | <severity> | <rule-id> | <file:line>[, ...] | in_diff|pre-existing
  evidence: <the code shape or probe hit, one line>
  problem: <what is wrong and why it matters>
  fix: <one line, concrete change; name the pattern and cite assets/examples.md rule ID>

## Nits
N<n> | <file:line> | <one line>

## Order
<IDs in the order the implementer should apply them, blockers first>
```
Finding IDs: F1, F2... sorted by severity. Empty section -> `none`. Keep each line under ~160 chars. Verdict is `FIX_REQUIRED` if any blocker/major is `in_diff`, else `PASS`.
