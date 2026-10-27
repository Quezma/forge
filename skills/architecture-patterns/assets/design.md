# Design procedure (new project / service / major feature)

Output: a short decision record (template at the end). Rule IDs refer to `assets/checklist.md`. Ask the user only for forces you cannot read from the repo or brief; one question at a time.

## 1. Gather forces
Record, with evidence or "unknown":
- Consistency: which operations need strong consistency (money, inventory, uniqueness) vs tolerate lag.
- Scale: request rates, data volume, read/write ratio, growth horizon.
- Team topology: teams, ownership, deploy cadence per area.
- Latency: user-facing budgets; which calls are on the critical path.
- Failure tolerance: what must keep working when a dependency is down; RPO/RTO.
- Compliance/data residency, existing platform (queue, DB, orchestrator), team experience.

## 2. Monolith first
Default: one deployable. Use a modular monolith (one module per bounded context, public API per module, own tables per module, no cross-module table access) so a later split is cheap. Src: MSV-01.
Split a module into a service only when at least one holds and is evidenced:
- It must deploy or scale independently at a different cadence from the rest.
- A separate team owns it and release coordination is the measured bottleneck.
- It needs fault isolation (its failure must not take down checkout/core).
- It needs a different technology/data store that cannot live in the monolith.
Not reasons: "it is cleaner", fashion, resume value, one big table. Every split pays: network failure modes (RES), data ownership (MSV-02), eventual consistency (TXN), operations (MSV-09/10).

## 3. Bounded contexts
1. List business capabilities and the nouns each team uses; the same noun with different rules = different contexts (DDD-01).
2. For each context: owned data, public API, events published, events consumed.
3. Draw the context map: upstream/downstream, and where an anti-corruption layer is needed (DDD-07).
4. Choose aggregates inside each context: smallest set of objects that must be consistent in one transaction; others by ID (DDD-02..04).

## 4. Sync vs async, per interaction
| Situation | Choose |
|---|---|
| Caller needs the answer to continue (query, validation, quote) | Sync call with timeout (RES-01), bounded retry only if idempotent, breaker if the dependency can fail for long |
| Notify others that something happened | Async event via outbox (TXN-03) |
| Ask another service to do work; result may come later | Async command + reply event; saga if multi-step (TXN-05) |
| Chain of 3+ sync hops | Redesign: merge services, cache, or make async (MSV-04) |

## 5. Consistency per operation
- Strong: inside one aggregate/one DB transaction (TXN-01, TXN-09, LCK rules). Choose isolation level deliberately (TXN-08).
- Eventual: across aggregates/services; state it in the UX (PENDING states), define compensation (TXN-06) and the stuck-state alert.
- Avoid 2PC/XA across services (TXN-05). If a rule truly needs cross-service strong consistency, merge those contexts.

## 6. Per remote call checklist
- [ ] Timeout (connect + request), value from dependency p99 (RES-01)
- [ ] Retry policy: transient only, capped exponential backoff + jitter, max attempts, single layer (RES-02..04)
- [ ] Idempotent or carries an idempotency key (RES-05, IDM-01)
- [ ] Breaker needed? Only with observed/credible sustained failure; define open-state behaviour (RES-06, RES-07)
- [ ] Bulkhead/pool isolation for critical vs best-effort (RES-08)
- [ ] Fallback explicit and exercised, or none (RES-10)
- [ ] Trace/correlation ID forwarded (MSV-09)

## 7. Per write checklist
- [ ] Transaction boundary = one aggregate; no remote call inside (DDD-03, TXN-02)
- [ ] Events leaving the service go through the outbox (TXN-03); consumers dedupe (IDM-03)
- [ ] Concurrency strategy: constraint first, then optimistic version, then `FOR UPDATE` with `lock_timeout` (LCK-01, LCK-02, TXN-09)
- [ ] Distributed lock needed? If correctness depends on it, fencing token (LCK-05); otherwise redesign
- [ ] Client-retryable endpoint accepts an idempotency key (IDM-01)
- [ ] Migration backward compatible (DAT-07)

## 8. Pattern selection table
| Need (observed/stated) | Pattern | Rules | Do NOT use when |
|---|---|---|---|
| Update DB and publish an event reliably | Transactional outbox | TXN-03, TXN-04 | No messaging; single DB write only |
| Business transaction across services | Saga (choreography <=3 steps, else orchestration) | TXN-05..07 | One DB can hold it; cannot tolerate temporary inconsistency |
| Safe client retries of mutations | Idempotency key | IDM-01, IDM-02, IDM-04 | Operation is naturally idempotent (PUT/upsert) |
| At-least-once consumer | Idempotent consumer / dedup table | IDM-03 | Effect is naturally idempotent |
| Dependency fails for long periods and callers pile up | Circuit breaker | RES-06, RES-07 | Local calls; message consumers with DLQ; platform/mesh already does it |
| Transient errors | Retry with backoff + jitter | RES-02..04 | Non-idempotent without key; permanent errors; already retried in a lower layer |
| One failing dependency exhausts shared pools | Bulkhead | RES-08 | Single dependency; isolation cost not justified |
| Protect service/dependency from overload | Rate limit / load shedding | RES-09 | Bottleneck is concurrency or CPU, not request rate |
| Lost updates on hot rows | Optimistic locking, else `FOR UPDATE` | TXN-09, LCK-02 | Unique constraint or atomic `UPDATE` expresses the rule |
| Mutual exclusion across processes | DB row/advisory lock; lease + fencing token if correctness | LCK-05, LCK-06 | A constraint or single-consumer-per-key queue works |
| Reads and writes diverge in shape/scale | CQRS | DAT-03, DAT-04 | Simple CRUD, simple rules |
| Audit/replay/intent is a requirement | Event sourcing (selectively) | DAT-05 | CRUD, MVP, no replay need, team unfamiliar |
| Isolate from legacy/foreign model | Anti-corruption layer | DDD-07 | Models already compatible |
| Single client entry, aggregation | API gateway / BFF | MSV-05 | One client, one service |
| Independent deploy/scale of a capability | Separate service | MSV-01..04 | No evidenced force (stay modular monolith) |

## 9. Decision record template
```
# ADR-<n> <title>
Status: proposed|accepted
Context: <forces from step 1, with evidence/unknowns>
Decision: <structure: monolith|modular monolith|services; contexts; sync/async per interaction; consistency per operation>
Patterns used: <pattern -> rule IDs -> the observed need that justifies it>
Patterns rejected: <pattern -> why not now -> trigger to revisit>
Risks / failure modes: <what fails, how detected, how it degrades>
Checks: <call checklist and write checklist results>
```
