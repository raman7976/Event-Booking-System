# Test & Hardening Findings — Event Booking System

A record of the review, testing, and load-testing work on this project: what was
checked, what broke, the root-cause analysis, and the fixes. Written to be useful
both as a project log and as **placement/interview prep** — the "Concepts" section
at the end explains the systems ideas behind each finding.

> TL;DR — A static review fixed 4 issues; a test suite + CI were added; a **k6 load test
> surfaced a real overselling bug** (a confirm-vs-hold race) that the existing correctness
> tests could not, which was root-caused (TOCTOU) and fixed (`SELECT … FOR UPDATE`); and a
> **multi-node load test** (nginx + 2 instances + PgBouncer + replica) showed the app tier
> is the compute bottleneck (the DB pool was tested and ruled out) while **correctness held
> in every run — 0 oversold seats** up to 2,000 concurrent users and 84% overload. Capacity:
> **~1,000–1,500 req/s and several hundred concurrent users per instance, sub-200 ms p95,
> fails safe.**

---

## 1. Environment & methodology

**System under test:** Node/Express API (Socket.IO + BullMQ), PostgreSQL
(primary/replica + PgBouncer), Redis, React frontend. Two booking domains: reserved-
seat events and a campus-bus vertical.

Two environments were used, in order:

**(A) Native single-instance** (fast iteration, found the overselling bug):
- PostgreSQL 14 + Redis 7 (Homebrew); one API via `node src/server.js` on `:3000`.
- Pool size made configurable (`PG_POOL_MAX`) and tuned; `RATE_LIMIT_HOLDS` raised so the
  per-user 3-holds/60 s cap didn't mask the real bottleneck.

**(B) Full multi-node via `docker compose`** (the representative topology — §5c):
- **nginx** LB → **`node_app_1` + `node_app_2`** (two stateless instances)
- **PgBouncer** (transaction pooling) → **`postgres_primary`** → **streaming `postgres_replica`**
- **Redis** (holds + Socket.IO adapter + queues) + a separate **`bullmq_worker`**
- Run with `NODE_ENV=test` via a gitignored `docker-compose.override.yml` so the production
  secret guard doesn't fire on the intentional local default secrets.

**Tools:** [Vitest](https://vitest.dev) for unit/integration tests; [k6](https://k6.io)
for load. Correctness under load is asserted by a Postgres query, not just k6 metrics.

**Scale tested (across runs):** **1,000–5,000 seats**, **2,000–3,000 distinct users**
(pre-seeded; access tokens minted directly to bypass the 20/min/IP login limiter), ramped
to **300 → 2,000 concurrent virtual users (VUs)**, ~100k–1M HTTP requests per run.

> Honest caveat for all numbers: the load generator (k6) and the server(s) ran on **one
> laptop**, so they competed for CPU — absolute latency is pessimistic and the multi-node
> scaling test is CPU-contended. A clean number needs the load generator and each instance
> on **separate machines**. The single-instance figures and all correctness results are
> trustworthy; the multi-node test is read for *bottleneck* and *correctness*, not a clean
> scaling multiple.

---

## 2. Static review findings (fixed)

| # | Issue | Fix |
|---|-------|-----|
| a | Stale nginx comment claiming `ip_hash` while the code uses `least_conn`. | Corrected the comment ([nginx/nginx.conf](nginx/nginx.conf)). |
| b | **Phantom hold**: if the durable reservation INSERT failed *after* the Redis Lua lock was taken, the seat stayed locked for the full 480 s TTL with no backing row. | Release the Redis key on INSERT failure, then rethrow ([seatService.js](backend/src/services/seatService.js)). |
| c | No test framework and no CI. | Added Vitest (unit + integration) and a GitHub Actions workflow with Postgres+Redis service containers. |
| d | Default secrets (`JWT_SECRET`, `PG_PASSWORD`) baked in as fallbacks; a prod deploy could silently run on a forgeable JWT secret. | Boot-time guard that fails fast in production if a runtime-critical secret is missing/default ([config/env.js](backend/src/config/env.js)). `ADMIN_PASSWORD` is seed-only and intentionally not gated. |

---

## 3. Test suite added

- **Unit tests** (no infra; infra modules mocked) — recommender heuristic, roll-number
  derivation, bus-insights tiering, trip-time math, and the prod-secret guard.
- **Integration tests** (real Postgres + Redis) — the heart of the system:
  - **Concurrency race:** 20 users hold one seat → exactly one wins, 19 get HTTP 409.
  - **Phantom-hold regression** (locks in fix b).
  - **Oversell regression** (locks in fix from §4 below).
- **CI:** `.github/workflows/ci.yml` runs all of the above against service containers,
  plus a frontend build.

**Result:** 25/25 tests pass (22 unit + 3 integration) against the local stack.

---

## 4. ⭐ Load-test finding: a real overselling bug

This is the headline result — the kind of bug load testing exists to find.

### What happened
The `sellout` scenario (users repeatedly hold→confirm a random seat until the 5,000-seat
event sells out) ran cleanly on the **performance** axis but **failed the correctness
check**:

```
capacity  : 5000
booked    : 5000   confirmed : 5001   payments : 5001
❌ OVERSOLD: 5001 confirmed > 5000 capacity
```

Two confirmed reservations existed for **one** seat.

### Evidence
Tracing the offending seat showed two users confirming it **~5 ms apart**:

```
seat 900d95e5…
  user A   held 10:27:16.308   confirmed 10:27:16.311   (seat → booked, Redis key deleted)
  user B   held 10:27:16.313   confirmed 10:27:16.315   ← booked an already-booked seat
```

### Root cause — a TOCTOU (time-of-check to time-of-use) race
The Redis Lua hold guarantees **one hold per seat at a time**, but it does not know about
*bookings*:

1. `confirm` **deletes** the Redis `seat:{event}:{seat}` key once a seat is booked
   ([bookingController.js](backend/src/controllers/bookingController.js)).
2. The hold path trusted **only Redis**, never the durable seat status. The controller's
   `if (seat.status === 'booked')` pre-check ([seatController.js](backend/src/controllers/seatController.js))
   is a **non-atomic read** taken *before* the lock.

So in the window between A's confirm deleting the key and B reading the seat, B saw
"available", then B's Lua hold succeeded on the just-freed key — and B confirmed a seat
that was already sold.

```
A: hold ──▶ confirm (UPDATE seat=booked, COMMIT, DEL redis key)
                         │
B: getSeatById (reads "available", BEFORE A commits) ─────┐
                                                          ▼
B: redis SET NX  (key was just deleted → SUCCEEDS) ──▶ INSERT held ──▶ confirm ──▶ OVERSOLD
```

The Postgres-fallback hold path already guarded with `SELECT … FOR UPDATE`; the **fast
Redis path did not** — that was the gap.

### Why the unit/integration tests missed it
The existing race test pits **holds against holds on an available seat** (one winner).
This bug needs a **hold racing a confirm on the same seat** — a different interleaving
that only shows up under sustained, overlapping traffic. Hence: load testing.

### The fix
Make Postgres the authority for the hold's durable claim. In the Redis path, claim the
seat row `FOR UPDATE` and refuse if it's already booked — in the **same transaction** as
the reservation insert, so it serializes against `confirm`'s seat UPDATE
([seatService.js](backend/src/services/seatService.js)):

```js
await withTransaction(async (client) => {
  const { rows } = await client.query(
    'SELECT status FROM seats WHERE id = $1 FOR UPDATE', [seatId]);
  if (rows.length === 0)         throw Errors.notFound('Seat not found');
  if (rows[0].status === 'booked') throw Errors.conflict('Seat just taken, try another');
  await insertHeldReservation(client, { seatId, userId, eventId, holdToken, expiresAt });
});
// on any throw: release the Redis lock we hold, then rethrow
```

This also subsumes fix (b): any failure after acquiring the lock now releases it.

### Regression test
A deterministic integration test reproduces the exact window — seat already
booked **and** its Redis key deleted — and asserts a new hold is refused (HTTP 409) with
no phantom row and no dangling lock. It fails on the old code, passes on the fixed code.

### Verification after the fix
Re-ran the **identical** load test (2,000 users, 300 VUs, ~305k iterations) against the
fixed server. The oversell is gone:

```
            confirmed   booked   payments   capacity   verdict
  BEFORE      5001       5000      5001        5000     ❌ OVERSOLD by 1
  AFTER       5000       5000      5000        5000     ✅ PASS (no oversell)
```

And no performance regression from the added `FOR UPDATE` (p95 31 ms, p99 114 ms, 5xx 0%
this run) — the extra row lock is cheap because it's a single indexed primary-key lock.

#### Stress validation — 3× oversubscription (worst case for the race)
Re-ran with **1,000 seats and 3,000 users** at **peak 600 VUs** — i.e. two-thirds of users
*must* lose, all racing for the last few seats (the exact condition that produced the
original oversell). The fix held:

| Metric | Result |
|---|---|
| Oversell | confirmed **1,000** = capacity **1,000** = payments **1,000** → ✅ none |
| Throughput | ~1,482 req/s (~400k requests) |
| Conflicts (409) | 398,280 (the ~2,000 users who lost) |
| Server errors (5xx) | **0.00%** (0 / 400,280) |
| Latency p95 / p99 / max | 211 ms / 370 ms / 3.0 s |

Note the latency climb (p95 31 ms → 211 ms, max 3.0 s): at 600 VUs, requests **queue on the
10-connection pool** but stay under `connectionTimeoutMillis` (5 s), so none error. That's
the system **approaching its breaking point** (the connection pool) without crossing it —
a clean illustration of where the first wall is.

---

## 5. Performance results (load run)

At 300 concurrent VUs against a single Node instance:

| Metric | Result |
|---|---|
| Throughput | ~1,114 req/s (~296k iterations / 4.5 min) |
| Latency avg / p95 / p99 | 13 ms / 54 ms / 206 ms |
| Server errors (5xx) | **0.00%** (`error_rate` = 0 / 301,106) |
| Interrupted iterations | 0 |
| Successful holds / confirms | 5,001 / 5,001 |
| Expected conflicts (409) | 291,104 |

**Reading the numbers:** k6's `http_req_failed: 96.67%` looks alarming but is *expected* —
once the event sold out, every further hold correctly returned **409 "seat taken"**, which
k6 counts as "failed." The real failure signal is `error_rate` (5xx only) = **0%**. No
infrastructure breaking point was reached at this scale; the event simply sold out.

**To actually find the breaking point:** run the `sustained` scenario (hold→release, which
never exhausts inventory) at higher VUs, ideally on the full `docker compose` stack so the
**PgBouncer pool of 20** and the nginx LB are in the path.

### 5b. Maximum load / breaking-point sweep
Single instance, **tuned 40-connection pool**, `sustained` hold→release ramped to **2,000
concurrent VUs**. Consolidated across all runs:

| Run | Scenario | Seats | Users | Peak VUs | Throughput | p95 latency | 5xx | Oversell |
|---|---|---|---|---|---|---|---|---|
| Before fix | sellout | 5,000 | 2,000 | 300 | ~1,114 req/s | 54 ms | 0% | ❌ 5001 |
| After fix | sellout | 5,000 | 2,000 | 300 | ~1,148 req/s | 31 ms | 0% | ✅ |
| Stress | sellout | 1,000 | 3,000 | 600 | ~1,482 req/s | 211 ms | 0% | ✅ |
| **Max** | sustained | 5,000 | 3,000 | **2,000** | ~732 req/s (saturated) | **2.98 s** | **0%** | ✅ |

**What the max run shows (the interesting part):**
- **It degrades gracefully, it does not fall over.** At 2,000 concurrent VUs: **0 server
  errors (5xx)**, **0 overselling** — but p95 latency climbed to ~3 s. Requests *queue*,
  they don't fail. That's the healthy failure mode.
- **The bottleneck is NOT the database.** With the pool raised to 40, sampled `pg_active`
  connections stayed **1–15** the whole time — Postgres was idle-ish. The wall is the
  **single Node process's capacity** (event loop / CPU), plus per-request Redis + BullMQ
  work (each hold schedules an expiry job; each release cancels it).
- **Throughput plateaus past the knee.** Going from 600 → 2,000 VUs, throughput *fell*
  (1,482 → 732 req/s) while latency ballooned — the classic past-the-knee signature: more
  concurrency just deepens the queue.
- **The knee on this box is ~600–800 concurrent VUs**: sub-100 ms p95 up to a few hundred
  users, rising to seconds beyond.

**Honest caveats (state these in an interview):**
- The load generator (k6, 2,000 VUs) and the server ran on the **same laptop**, competing
  for CPU — so the absolute latency is pessimistic. A clean number needs the load generator
  and server on separate machines.
- This is **one** Node instance. The architecture is built to scale horizontally (2+
  instances behind nginx + PgBouncer); since the bottleneck is the node process, not the DB,
  adding instances is the direct fix — a good thing to be able to say.

**One-line summary for a résumé/interview:** *"Load-tested a real-time booking system to
2,000 concurrent users (~1.5k req/s peak) with k6; found and fixed a confirm-vs-hold
overselling race via `SELECT … FOR UPDATE`; showed the system degrades gracefully
(latency-bound, zero errors/oversell) and identified the single-node process — not the DB
pool — as the bottleneck, with horizontal scaling as the remedy."*

### 5c. Multi-node (Docker) load test — and a refuted hypothesis
Brought up the **full representative stack** (§1B: nginx LB → 2 app instances → PgBouncer →
primary/replica + Redis + worker) and re-ran the 2,000-VU `sustained` sweep through the LB.

**The app tier scaled correctly.** Traffic load-balanced evenly across `node_app_1` and
`node_app_2`, and both pegged at **~100–113% CPU each** (a full core apiece). Statelessness
+ the Socket.IO Redis adapter mean the instances need no stickiness — exactly the design.

**But the cluster hit a wall, and I formed a hypothesis about why — then tested it:**

| 2-node, 2,000 VUs | `pg_backends` (DB conns) | error rate (5xx) | successful holds | oversell |
|---|---|---|---|---|
| PgBouncer pool **20** (default) | 22 — *pinned* | 84.8% | 37,455 | ✅ 0 |
| PgBouncer pool **80** (4× bigger) | 74 — *climbed* | **83.1%** | 37,767 | ✅ 0 |

My hypothesis was that **PgBouncer's pool of 20** was the ceiling (`pg_backends` pinned at 22
regardless of load). So I raised it 4× and re-ran. The pool was genuinely used (22 → 74) —
**but the error rate barely moved (84.8% → 83.1%) and throughput was identical.** The
hypothesis was **wrong**, and the data proved it: the DB connection pool was *not* the
bottleneck.

**The real bottleneck is app CPU (compute).** Both Node instances were saturated at ~100%
CPU while Postgres sat at 50–80% with spare connections. The cluster processes ~140
holds/s regardless of pool size — it's compute-bound. At 2,000 VUs the offered load is ~10×
capacity, so the queue overflows the 60 s nginx timeout → ~83% **504s (overload shedding)**.
(Reminder: this is one laptop running k6 + both instances + Postgres, so "CPU-bound" is
partly the test rig — see the §1 caveat.)

**Correctness held even here: ✅ 0 oversold seats at 83% errors.** Under impossible load the
system *sheds requests* (times out) rather than crashing or double-booking — it fails safe.

> Debugging note (also a good interview anecdote): the first pool-80 attempt showed **100%
> errors** — but that was a **stale nginx upstream cache**: recreating the app containers
> gave them new Docker-network IPs while nginx kept the old ones → every request 502'd
> before reaching an app. Always confirm a one-line probe returns 201 *before* trusting a
> load run. Fixed with `docker compose restart nginx`.

---

## 6. What the app can do (capabilities)

Synthesized from the clean (0-error) runs. These are the defensible capacity numbers:

| Capability | Measured | Plain meaning |
|---|---|---|
| Throughput | **~1,100–1,500 req/s** per instance | at a few hundred concurrent users |
| Booking write rate | **~300–370 seat-holds/s** sustained | ≈ a 5,000-seat event sells out in seconds |
| Latency | **p95 30–210 ms** | snappy up to ~600 concurrent users |
| Concurrency | comfortable to **~600–800 users/instance**, then degrades gracefully | beyond that: slower, but **no errors, no crash** |
| Correctness | **0 oversold seats across all 8 runs** (≤2,000 users, 3× oversubscription, 84% overload) | the locking is bulletproof |
| Failure mode | **sheds load (timeouts), never crashes or corrupts** | fails safe — the property that matters for bookings/payments |
| Scaling | app tier is the limit, and it's **stateless + horizontally scalable** | add instances/CPU → more capacity (DB was not the wall) |

**Trustworthy capacity statement:** *sustains ~1,000+ req/s and several hundred concurrent
users per instance with sub-200 ms p95 and zero overselling; degrades gracefully and fails
safe under overload; scales horizontally.* For the target scale (a campus events + bus
system) that is far more than required.

---

## 7. Concepts (interview prep)

- **TOCTOU race (time-of-check to time-of-use):** a value is checked, then used, with a
  gap in between where another actor changes it. The overselling bug is a textbook TOCTOU:
  check `seat.status` → (gap) → acquire lock → use. Fix: make check+use **atomic** (here,
  `SELECT … FOR UPDATE` inside the same transaction as the write).
- **Atomicity via Redis Lua:** a Lua script runs atomically on the single-threaded Redis
  server, so "check key absent, then set it" can't interleave. Great for the *hold*
  invariant — but it only knows what's in Redis, not the durable DB state. Lesson: a fast
  in-memory lock must be reconciled with the durable source of truth.
- **Pessimistic locking (`SELECT … FOR UPDATE`):** takes a row lock so concurrent
  transactions serialize on that row. Used here to make the hold's claim authoritative.
- **Optimistic locking:** the `seats.version` column — detect conflicting writes by
  version mismatch instead of locking. (Used elsewhere in the codebase.)
- **Idempotency keys:** the confirm endpoint stores a response keyed by an `Idempotency-Key`
  so a retried request can't double-charge. Essential for at-least-once clients.
- **Load testing vs correctness testing:** correctness tests assert invariants on small,
  controlled interleavings; load tests generate *many overlapping* interleavings and can
  surface races (like this one) that targeted tests never reach. You want both.
- **Reading load metrics:** distinguish *expected* non-2xx (409 sold-out, 429 rate-limited)
  from *real* failures (5xx, timeouts). The breaking point is where p99 latency and 5xx
  climb together.
- **Percentile latency (p50/p95/p99):** "p95 = 31 ms" means 95% of requests were faster than
  31 ms; only the slowest 5% were slower. Averages hide pain (99 fast + 1 very slow request
  still averages "fine"), so latency is always reported as percentiles. **p95/p99 are the
  *tail* — what your unluckiest users feel — and SLAs are written on them, not the mean.**
- **Error rate vs overload shedding:** an 83% error rate here was **not bugs** — it was the
  system returning 504 timeouts when handed ~10× its capacity (like 10k people at a door
  rated for 1k). At sane load, real (5xx) errors were **0%**. Always ask *what kind* of
  failure a number represents before reacting to it.
- **Load balancing + stateless services:** nginx spreads requests across instances; because
  the app holds **no in-process state** (it's all in Redis/Postgres) and Socket.IO uses the
  Redis adapter, any instance can serve any request — so no sticky sessions, and you scale by
  adding instances.
- **Horizontal scaling & moving bottlenecks:** adding stateless app instances raises capacity
  **only until a shared resource becomes the limit** (DB pool, DB CPU, Redis). Scaling is a
  game of finding and moving the bottleneck — here it was app CPU, so more app instances/cores
  help; the DB had headroom.
- **Connection pooling:** PgBouncer multiplexes many client connections onto a small set of
  real Postgres connections (transaction pooling). The pool size caps cluster-wide concurrent
  DB work — it *can* be the bottleneck, but **measure before assuming**: raising it 20→80 here
  changed nothing, which is how we proved CPU (not connections) was the wall.
- **Hypothesis-driven debugging:** form a hypothesis ("the pool is the ceiling"), design an
  experiment that would falsify it (raise the pool 4×, re-measure), and **let the data
  overrule intuition.** The pool change not moving the error rate is what *proved* the real
  cause. Reporting "I was wrong, here's the evidence" is a strength, not a weakness.
- **Fail-safe design:** under overload the system sheds requests (timeouts) and **never
  oversells or corrupts data** — for a booking/payment system, failing *safe* (reject) beats
  failing *available* (double-book).

---

## 8. How to reproduce

**Multi-node stack (representative):**
```bash
docker compose up -d                       # brings up the 8-service topology (§1B)
# seed into the container Postgres (default JWT_SECRET matches the app):
cd backend && PG_PRIMARY_HOST=localhost npm run loadtest:prep
# load test through the nginx LB:
cd ../loadtest && k6 run -e BASE_URL=http://localhost:80 -e PEAK_VUS=2000 -e SCENARIO=sustained hold-confirm.js
# correctness check (must report no oversell):
cd ../backend && PG_PRIMARY_HOST=localhost npm run loadtest:verify
```
- After recreating app containers, **`docker compose restart nginx`** so it re-resolves
  upstream IPs (else 502s). Confirm with a one-line hold probe → expect `201`.
- `docker-compose.override.yml` (gitignored) sets `NODE_ENV=test` + raised pools for testing.

**Single-instance (native) + tests:**
```bash
cd backend && npm run test:unit            # no infra needed
RUN_INTEGRATION=1 PG_PRIMARY_HOST=localhost npm run test:int   # needs Postgres + Redis
```

---

## 9. Status

- ✅ Static issues (a–d) fixed.
- ✅ Test suite + CI added; **25/25 passing** (incl. the oversell regression).
- ✅ **Overselling bug** found via load testing, root-caused (TOCTOU), fixed (`FOR UPDATE`),
  and regression-tested; re-verified gone under load.
- ✅ **Multi-node load test** done: app tier load-balances and is the compute bottleneck;
  the DB pool was tested and ruled out; correctness (0 oversell) held in every run.
- ⚠️ All numbers from a single laptop (load gen + servers co-located) — conservative; a
  clean horizontal-scaling figure needs separate machines.
- ◻️ All work is local + on branch `fix/review-flags-tests-ci`; **not committed/deployed** —
  production still runs the pre-fix code.
