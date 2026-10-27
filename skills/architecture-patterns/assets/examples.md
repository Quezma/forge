# Examples (good/bad)

TypeScript-flavoured pseudocode; intent is language-agnostic. `db`, `http`, `broker`, `redis` are placeholders. Rule text and sources: `assets/checklist.md`.

## MSV-02 (blocker) database per service
Bad:
```ts
// orders-service
const rows = await billingDb.query("SELECT * FROM invoices WHERE order_id=$1", [id]); // another service's tables
```
Good:
```ts
const invoice = await billingClient.getInvoiceByOrder(id, { timeoutMs: 800 }); // via billing's API
```
Why: a shared schema couples deploys and lets any service break another's data invariants.

## RES-01 (blocker) timeout on every remote call
Bad:
```ts
const res = await fetch(`${PAYMENTS_URL}/charge`, { method: "POST", body });
```
Good:
```ts
const res = await fetch(`${PAYMENTS_URL}/charge`, { method: "POST", body, signal: AbortSignal.timeout(2000) });
```
Why: without a deadline one slow dependency pins threads/connections and cascades. Pick the value from the dependency's observed p99, not a guess.

## RES-02, RES-03, RES-04 retry only transient, with backoff + jitter, at one layer
Bad:
```ts
for (;;) { try { return await call(); } catch { /* retry immediately, forever, on any error */ } }
```
Good:
```ts
async function withRetry<T>(fn: () => Promise<T>, { max = 3, baseMs = 100, capMs = 2000 } = {}) {
  for (let attempt = 1; ; attempt++) {
    try { return await fn(); }
    catch (e) {
      if (!isTransient(e) || attempt >= max) throw e;            // timeout, 5xx, 429, ECONNRESET only
      const exp = Math.min(capMs, baseMs * 2 ** attempt);
      await sleep(Math.random() * exp);                           // full jitter
    }
  }
}
// call it only in the outermost caller; inner clients are configured with retries: 0
```
Why: immediate or uncapped retries amplify load on a struggling service; stacked layers multiply (3 retries over 5 layers = 243x).

## RES-05 + IDM-01 (blockers) retry of a non-idempotent call needs an idempotency key
Bad:
```ts
await withRetry(() => http.post("/charges", { amount, customerId })); // timeout after success => double charge
```
Good:
```ts
const key = crypto.randomUUID();                       // generated once per logical operation, reused on every retry
await withRetry(() => http.post("/charges", { amount, customerId }, { headers: { "Idempotency-Key": key } }));
```
Why: a timeout does not mean the server did nothing; the key makes the retry return the first outcome.

## IDM-01, IDM-02, IDM-04 idempotency-key middleware (server side)
Bad:
```ts
app.post("/orders", async (req, res) => res.json(await createOrder(req.body))); // retry creates a second order
```
Good:
```ts
app.post("/orders", async (req, res) => {
  const key = req.header("Idempotency-Key"); if (!key) return res.status(400).end();
  const scope = `${req.auth.tenantId}:POST:/orders:${key}`;
  const hash = sha256(canonical(req.body));
  const out = await db.tx(async (tx) => {
    const ins = await tx.q("INSERT INTO idempotency(scope,req_hash,status) VALUES($1,$2,'started') ON CONFLICT DO NOTHING RETURNING 1", [scope, hash]);
    if (!ins.rowCount) {
      const prev = await tx.q("SELECT req_hash,status,response FROM idempotency WHERE scope=$1", [scope]);
      if (prev.req_hash !== hash) return { code: 422, body: { error: "key reused with different payload" } };
      if (prev.status === "started") return { code: 409, body: { error: "in progress" } };
      return { code: 200, body: prev.response };                 // replay stored response
    }
    const order = await createOrder(tx, req.body);               // effect + key in ONE transaction
    await tx.q("UPDATE idempotency SET status='done', response=$2 WHERE scope=$1", [scope, order]);
    return { code: 201, body: order };
  });
  res.status(out.code).json(out.body);
});
// a job prunes rows older than the documented TTL (e.g. 24h)
```
Why: scoped key, payload check, stored response, and atomic recording make retries safe.

## IDM-03 (blocker) idempotent consumer with a dedup table
Bad:
```ts
broker.on("AccountDebited", async (m) => { await db.q("UPDATE accounts SET balance = balance - $1 WHERE id=$2", [m.amount, m.accountId]); });
```
Good:
```ts
broker.on("AccountDebited", async (m) => db.tx(async (tx) => {
  const ins = await tx.q("INSERT INTO processed_messages(consumer,message_id) VALUES('ledger',$1) ON CONFLICT DO NOTHING", [m.id]);
  if (!ins.rowCount) return;                                      // duplicate: ack and skip
  await tx.q("UPDATE accounts SET balance = balance - $1 WHERE id=$2", [m.amount, m.accountId]);
}));
```
Why: brokers deliver at least once; the dedup row and the effect commit or roll back together.

## TXN-02 (blocker) no remote call inside a DB transaction
Bad:
```ts
await db.tx(async (tx) => {
  await tx.q("INSERT INTO orders ...");
  await paymentsApi.charge(order);          // holds a connection and locks while waiting on the network
});
```
Good:
```ts
const order = await db.tx((tx) => tx.q("INSERT INTO orders(status) VALUES('PENDING') RETURNING *"));
await paymentsApi.charge(order, { idempotencyKey: order.id });    // outside the transaction
await db.q("UPDATE orders SET status='PAID' WHERE id=$1 AND status='PENDING'", [order.id]);
```
Why: remote latency inside a transaction exhausts pools and holds locks; a rollback cannot undo the remote effect. Use a saga/outbox for the follow-up.

## TXN-03, TXN-04 (blockers) transactional outbox instead of dual write
Bad:
```ts
await db.q("INSERT INTO orders ...");
await broker.publish("OrderCreated", order);   // crash between the two lines loses the event
```
Good:
```ts
await db.tx(async (tx) => {
  await tx.q("INSERT INTO orders ...", [...]);
  await tx.q("INSERT INTO outbox(id,aggregate_id,type,payload) VALUES($1,$2,'OrderCreated',$3)", [uuid(), order.id, order]);
});
// relay (separate process): poll or CDC; publish in order per aggregate_id; mark published after broker ack
async function relay() {
  const rows = await db.q("SELECT * FROM outbox WHERE published_at IS NULL ORDER BY seq LIMIT 100 FOR UPDATE SKIP LOCKED");
  for (const r of rows) { await broker.publish(r.type, r.payload, { key: r.aggregate_id, messageId: r.id }); await db.q("UPDATE outbox SET published_at=now() WHERE id=$1", [r.id]); }
}
```
Why: the message exists iff the business transaction committed; the relay may publish twice, so consumers dedupe (IDM-03).

## TXN-05, TXN-06 saga with compensation
Bad:
```ts
await inventory.reserve(o); await payments.charge(o); await shipping.create(o); // failure at step 3 leaves stock and money taken
```
Good:
```ts
const steps = [
  { do: () => inventory.reserve(o.id), undo: () => inventory.release(o.id) },   // undo is idempotent, keyed by o.id
  { do: () => payments.charge(o.id),   undo: () => payments.refund(o.id) },
  { do: () => shipping.create(o.id),   undo: () => shipping.cancel(o.id) },
];
const done = [];
try { for (const s of steps) { await s.do(); done.push(s); await saga.record(o.id, done.length); } }
catch { for (const s of done.reverse()) await retryForever(s.undo); await saga.fail(o.id); alertIfStuck(o.id); }
// order stays PENDING until the saga ends (TXN-07); use an orchestrator persisted in the DB so it can resume after a crash
```
Why: no automatic rollback across services; compensation must be explicit, repeatable, and recorded.

## TXN-09 optimistic locking with a version column
Bad:
```ts
const a = await db.q("SELECT balance FROM accounts WHERE id=$1", [id]);
await db.q("UPDATE accounts SET balance=$1 WHERE id=$2", [a.balance - amt, id]); // lost update under concurrency
```
Good:
```ts
const a = await db.q("SELECT balance, version FROM accounts WHERE id=$1", [id]);
const r = await db.q("UPDATE accounts SET balance=$1, version=version+1 WHERE id=$2 AND version=$3", [a.balance - amt, id, a.version]);
if (r.rowCount === 0) throw new ConflictError();   // caller reloads and retries, or returns 409
```
Why: the version predicate turns a silent overwrite into a detectable conflict.

## TXN-09, LCK-02, LCK-03 pessimistic lock with a bounded wait and fixed order
Bad:
```ts
await db.tx(async (tx) => { await tx.q("SELECT * FROM accounts WHERE id=$1 FOR UPDATE", [from]); /* may wait forever */ });
```
Good:
```ts
await db.tx(async (tx) => {
  await tx.q("SET LOCAL lock_timeout = '2s'");
  const [first, second] = [from, to].sort();                       // consistent order avoids deadlocks
  await tx.q("SELECT id FROM accounts WHERE id = ANY($1) ORDER BY id FOR UPDATE", [[first, second]]);
  await transfer(tx, from, to, amt);
});  // catch SQLSTATE 55P03 (lock timeout) / 40P01 (deadlock): retry whole tx a few times or return 409
```
Why: waits without a bound stall the pool; opposite lock order deadlocks.

## LCK-05 (blocker) fencing token for a correctness lock
Bad:
```ts
if (await redis.set("lock:invoice:42", me, "NX", "PX", 30000)) { await storage.write(doc); } // pause > 30s: two writers
```
Good:
```ts
const { token } = await lockService.acquire("invoice:42", { leaseMs: 30000 }); // strictly increasing token (e.g. ZooKeeper zxid/version)
await storage.write(doc, { fencingToken: token });
// storage: reject if token < last_seen_token for this resource
// UPDATE docs SET body=$1, last_token=$2 WHERE id=42 AND last_token < $2
```
Why: a paused client can resume after its lease expired; only the resource itself can refuse the stale writer. If the lock merely avoids duplicate work, a simple lock is acceptable (LCK-06).

## RES-06 circuit breaker wrapping a client
Bad:
```ts
async function getRates() { return http.get(RATES_URL); }   // every request waits out the timeout while rates is down
```
Good:
```ts
const breaker = new CircuitBreaker((signal) => http.get(RATES_URL, { signal }), {
  timeoutMs: 1000, failureThreshold: 5, windowMs: 10000, openMs: 15000, halfOpenProbes: 1,
  onStateChange: (s) => metrics.gauge("breaker.rates", s),
});
async function getRates() {
  try { return await breaker.fire(); }
  catch (e) { if (e instanceof OpenCircuitError) return lastKnownRates(); throw e; } // fallback is explicit and tested (RES-10)
}
```
Why: fail fast while the dependency is down, probe for recovery. Add only after sustained failures are observed or credible; not around local calls.

## ARC-01, ARC-03, ARC-05 port/adapter keeps the domain pure
Bad:
```ts
// domain/order.ts
import { PrismaClient } from "@prisma/client";
export class Order { async confirm() { await new PrismaClient().order.update({ ... }); } }
```
Good:
```ts
// domain/order.ts  - no imports from outside domain
export class Order { confirm() { if (this.lines.length === 0) throw new EmptyOrder(); this.status = "CONFIRMED"; } }
// application/confirm-order.ts
export interface OrderRepository { get(id: OrderId): Promise<Order>; save(o: Order): Promise<void> }  // port
export class ConfirmOrder { constructor(private repo: OrderRepository) {}
  async run(id: OrderId) { const o = await this.repo.get(id); o.confirm(); await this.repo.save(o); } }
// infrastructure/prisma-order-repository.ts implements OrderRepository; wired only in the composition root
```
Why: rules are testable without a DB and the framework can change without touching the domain.

## DDD-03, DDD-04 aggregates reference by ID, one per transaction
Bad:
```ts
class Order { customer: Customer; }                       // holds the other aggregate
await db.tx(async (tx) => { await orders.save(order, tx); await customers.save(order.customer, tx); });
```
Good:
```ts
class Order { constructor(readonly id: OrderId, readonly customerId: CustomerId) {} }
await db.tx((tx) => orders.save(order, tx));              // one aggregate per transaction
// cross-aggregate effect: Order raises OrderPlaced -> outbox -> Customer handler updates its own aggregate
```
Why: a small aggregate is the consistency boundary; larger graphs cause contention and hidden coupling.

## OBS-02 (blocker) no secrets in source
Bad:
```ts
const stripe = new Stripe("sk_live_51H...");
```
Good:
```ts
const stripe = new Stripe(requireEnv("STRIPE_SECRET_KEY")); // injected by the secret store / deployment
```
Why: committed secrets are leaked secrets; rotate any that reached history.
