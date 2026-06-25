# Load testing (k6)

Drives the real booking hot path — browse → hold → confirm/release — against the
**local stack** to measure throughput, latency, and where the system breaks, then
verifies the seat locking never oversold **under load**.

> ⚠️ **Local only.** Never point `BASE_URL` at the deployed Railway site — a
> breaking-point run would burn cost and could trip rate limits on production.

## What's here
- `../backend/src/scripts/loadtestPrep.js` — seeds a big dedicated event + a pool of
  users and mints an access token per user (so k6 skips the login endpoint and its
  20/min/IP limiter). Writes `data.json`.
- `hold-confirm.js` — the k6 script (scenarios: `sustained`, `sellout`, `both`).
- `../backend/src/scripts/loadtestVerify.js` — post-run correctness check
  (no oversell; booked = confirmed = payments).
- `data.json` — generated, **git-ignored** (contains signed tokens).

## 1. Install k6
```bash
brew install k6          # macOS
# or: docker run --rm -i grafana/k6 run - < hold-confirm.js
```

## 2. Bring up the local stack
```bash
docker compose up -d
```
For a clean **infra** breaking-point (so the per-user 3-holds/60s cap doesn't mask the
real DB/Redis bottleneck), start the app instances with the cap raised:
```bash
RATE_LIMIT_HOLDS=100000 docker compose up -d node_app_1 node_app_2 bullmq_worker
```

## 3. Prep data
Run with the **same `JWT_SECRET` as the running stack** (the tokens are signed with it):
```bash
cd backend
JWT_SECRET=dev_super_secret_change_me_in_production \
PG_PRIMARY_HOST=localhost PG_PRIMARY_PORT=5432 \
LT_SEATS=5000 LT_USERS=2000 \
npm run loadtest:prep
```
(The defaults above match `docker-compose.yml`. If you overrode `JWT_SECRET`/`PG_*`,
use those values.)

## 4. Run the load test
```bash
cd loadtest
k6 run -e BASE_URL=http://localhost:80 -e PEAK_VUS=1500 -e SCENARIO=both hold-confirm.js
```
- `PEAK_VUS` — peak virtual users (the heavy default is 1000; bump to find the knee).
- `SCENARIO` — `sustained` (hold→release throughput), `sellout` (hold→confirm, drives
  to sellout), or `both`.
- **Tip:** do a `PEAK_VUS=50` smoke run first to confirm everything is wired before the
  heavy run.

### Reading the output
- `http_reqs` / RPS, and `http_req_duration` **p95/p99** — your throughput and latency.
- `holds_ok`, `confirms_ok` — successful work done.
- `conflicts_409` (seat already taken) and `rate_limited_429` (per-user hold cap) are
  **expected** under contention, not failures.
- `server_errors_5xx` / `error_rate` — the real failures. The **VU level where these
  start climbing and p99 spikes is your breaking point.**
- **What to watch first:** the write path runs through **PgBouncer (pool size 20**, in
  `docker-compose.yml`) — that pool is the most likely first bottleneck. Redis (Lua
  holds) and the BullMQ workers come next.

## 5. Verify correctness under load
```bash
cd backend
PG_PRIMARY_HOST=localhost PG_PRIMARY_PORT=5432 npm run loadtest:verify
```
Passes only if `confirmed ≤ capacity` and booked seats = confirmed reservations =
payment rows. **Exits non-zero on any oversell** — that's the proof the locking held.

## Cleanup
Re-running `loadtest:prep` wipes the previous load-test event and its users. To remove
everything, re-run the normal seed (`npm run seed`) or drop the load-test event/users
(name `LOADTEST — Mega Event`, users `lt-user-%@loadtest.local`).
