# 🎟️ Real-Time Event Seat Booking System

A production-grade, horizontally scalable seat-booking platform for **any seated
inventory** — concerts, buses, course enrolment. Many users browse and book
concurrently, **no two users can ever book the same seat**, holds auto-expire
after **8 minutes**, and every client sees **live seat-status updates over
WebSockets** with no page refresh.

> **AI note:** the Smart Seat Recommender uses the **Google Gemini API (free
> tier)** via `@google/genai` instead of Claude (chosen for a free key), and
> falls back to a deterministic heuristic when no key is configured.

---

## Architecture

```
                         ┌──────────────────────────┐
   Browser (React/Vite)  │  Vite dev proxy / nginx   │
   Socket.io-client ─────┤  /api → least_conn        │
   React Query cache     │  /ws  → ip_hash (sticky)  │
                         └─────────┬────────────┬─────┘
                                   │            │
                       node_app_1:3000   node_app_2:3001     (Express + Socket.io)
                                   │   each node SUBSCRIBES to Redis "seat-updates"
                                   │   and emits to its local room  event:{eventId}
                                   ▼
   ┌─────────────────────────── Redis 7 ───────────────────────────┐
   │  hold keys (TTL 480s) · rate limit · waitlist ZSET · sessions  │
   │  pub/sub (seat-updates, waitlist-notify) · BullMQ queues       │
   └───────▲─────────────────────────────────────────────▲─────────┘
           │ writes                                       │ jobs
   Postgres PRIMARY (5432) ──streaming replication──► REPLICA (5433, reads)
           ▲
           │  bullmq_worker: expiryWorker (auto-release) · emailWorker · waitlistWorker
```

**Strong consistency.** A seat hold is granted by an **atomic Redis Lua script**
(`EXISTS` → `SET` + `EXPIRE`) so exactly one request wins; the reservation is
then written to Postgres. Confirming runs a single transaction on the primary
(reservation → `confirmed`, seat → `booked` + optimistic `version` bump, insert
payment, decrement `available_seats`). If Redis is unreachable, holds fall back
to `SELECT … FOR UPDATE` on the primary (logged, never crashes).

**Horizontal scale.** Two stateless Node instances sit behind nginx. Every seat
change is `PUBLISH`ed to Redis; **each node subscribes and fans out to its own
WebSocket rooms**, so a change on one node reaches clients on the other. nginx
uses `ip_hash` on `/ws` to keep a socket pinned to one node and `least_conn` on
`/api`.

---

## Tech stack

| Layer      | Tech |
|------------|------|
| Frontend   | React 18 (Vite), TailwindCSS, Socket.io-client, React Query, Recharts |
| Backend    | Node + Express, Socket.io, BullMQ, ioredis, pg, jsonwebtoken, zod, bcryptjs, nodemailer |
| AI         | Google Gemini (`@google/genai`, free tier) + heuristic fallback |
| Infra      | nginx (LB), Redis 7, PostgreSQL 15 (primary + replica), Docker Compose, BullMQ worker process |

---

## Prerequisites

- **Docker** engine + `docker compose`. On macOS without Docker Desktop, use Colima:
  ```bash
  brew install colima docker docker-compose
  colima start --cpu 4 --memory 6
  ```
- **Node 18+** (only to run the frontend dev server and the migrate/seed scripts from the host).

---

## Quick start

```bash
# 1) Bring up the whole backend stack (nginx, 2 nodes, worker, redis, pg x2)
docker compose up -d --build

# 2) Create the schema on the primary, then seed demo data
#    (run from the repo root; defaults target localhost:5432)
node backend/src/scripts/migrate.js
node backend/src/scripts/seed.js
#    …or inside a container:  docker compose exec node_app_1 node src/scripts/migrate.js

# 3) Start the frontend (proxies /api and /ws to nginx on :80)
cd frontend && npm install && npm run dev
# open http://localhost:5173
```

Demo accounts (seeded):

| Role | Email | Password | Sees |
|------|-------|----------|------|
| user | demo@demo.local | password123 | browse, book, waitlist, My Bookings |
| admin | admin@demo.local | Admin@1234 | everything + Admin panel, dashboards, event CRUD |

> **After rebuilding the app containers** (`docker compose up -d --build node_app_1 …`),
> restart nginx so it re-resolves the new container IPs: `docker compose restart nginx`.

---

## Environment variables

Copy `.env.example` → `.env`. Compose supplies its own values per container
(service hostnames); the scripts default to `localhost`.

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | 3000 | API/WS port per instance (3000 / 3001) |
| `JWT_SECRET` | dev | Token signing secret |
| `ACCESS_TOKEN_TTL` / `REFRESH_TOKEN_TTL_DAYS` | 15m / 7 | Short-lived access JWT; rotating refresh token (httpOnly cookie) |
| `COOKIE_SECURE` | false | Set true behind HTTPS (Secure flag on the refresh cookie) |
| `PG_PRIMARY_HOST/PORT` | localhost / 5432 | Write pool |
| `PG_REPLICA_HOST/PORT` | localhost / 5433 | Read pool |
| `PG_USER/PASSWORD/DATABASE` | booking / booking_pass / booking | Postgres creds |
| `PG_REPLICATION_USER/PASSWORD` | replicator / replicator_pass | Streaming replication role |
| `REDIS_HOST/PORT` | localhost / 6379 | Redis |
| `HOLD_TTL_SECONDS` | 480 | Seat-hold lifetime (8 min) |
| `RATE_LIMIT_HOLDS` / `RATE_LIMIT_WINDOW_SECONDS` | 3 / 60 | Holds per user per window |
| `SESSION_TTL_SECONDS` | 3600 | Redis session TTL |
| `GEMINI_API_KEY` | _(empty)_ | Free key from https://aistudio.google.com/apikey — empty ⇒ heuristic |
| `GEMINI_MODEL` | gemini-2.5-pro | Recommender model (`gemini-2.5-flash` for higher limits) |
| `SMTP_*` / `MAIL_FROM` | _(empty)_ | Empty ⇒ Nodemailer Ethereal test inbox (preview URLs logged) |

---

## Core flows

- **Hold** — rate-limit check → atomic Lua hold (`seat:{eventId}:{seatId}`, TTL 480s)
  → insert `held` reservation → schedule BullMQ expiry job → publish `seat-updates`.
  409 if already held, 429 if over the rate limit.
- **Confirm** — validate hold token (Redis + owner) → transaction (reservation
  confirmed, seat booked, payment inserted, `available_seats--`) → delete Redis key
  → cancel expiry job → queue confirmation email → publish update.
- **Expire** (worker, after 480s) — if still held: reservation → `expired`, seat →
  `available`, delete Redis key, `no_show_count++`, **ZPOPMIN the waitlist** and
  notify the next person, publish update.
- **Real-time** — client joins room `event:{eventId}`; each node relays Redis
  `seat-updates` to its rooms as `{ seatId, status, timestamp }`; the client patches
  the React Query cache in place (no refetch).

## API

### Authentication model

- **Access token**: 15-minute JWT carrying `{ sub, email, name, role }`, kept **in memory** on the client (never localStorage).
- **Refresh token**: 7-day JWT whose one-time id (`jti`) lives in Redis. Delivered as an **httpOnly cookie** scoped to `/api/auth`. Every `/refresh` **rotates** it (atomic `GETDEL`) — replaying a consumed token returns 401, and logout revokes it server-side.
- **RBAC**: `user` vs `admin` role claim, enforced by `requireRole` middleware (`/api/admin/*`, stats) and mirrored by frontend route guards.
- **Login hardening**: lockout after 5 failed attempts per email per 15 min; bcrypt compare runs even for unknown emails; password policy (8+ chars, letter + number).

| Method | Route | Auth | Notes |
|--------|-------|------|-------|
| POST | `/api/auth/register` · `/api/auth/login` | — | `{ token, user }` + refresh cookie |
| POST | `/api/auth/refresh` · `/api/auth/logout` | cookie | rotate / revoke the session |
| GET | `/api/auth/me` | ✓ | current user (fresh from DB) |
| GET | `/api/admin/overview` | admin | cross-event totals |
| POST | `/api/admin/events` | admin | create event + seat layout |
| DELETE | `/api/admin/events/:id` | admin | blocked while confirmed bookings exist |
| GET | `/api/admin/events/:id/bookings` | admin | who booked what |
| GET | `/api/events?page&limit` | — | paginated |
| GET | `/api/events/:id` | — | event + seat summary |
| GET | `/api/events/:id/seats` | optional | live seat list (`heldByMe`) |
| GET | `/api/events/:id/stats` | admin | dashboard analytics |
| POST | `/api/seats/:id/hold` | ✓ | `{ eventId }` → hold token |
| DELETE | `/api/seats/:id/hold` | ✓ | `{ holdToken }` |
| POST | `/api/seats/recommend` | — | `{ eventId, groupSize, maxBudget, preferences }` |
| POST | `/api/bookings/confirm` | ✓ | `{ holdToken, paymentMethod }` |
| GET | `/api/bookings/mine` | ✓ | user's bookings |
| POST/DELETE | `/api/waitlist/:eventId` | ✓ | join / leave |

Errors are uniform: `{ error: { code, message, details? } }` with **400** (zod
field errors), **401**, **409** (“Seat just taken, try another”), **429**, **500**.

## Redis keys

```
seat:{eventId}:{seatId}      "{userId}:{holdToken}"          TTL 480s
ratelimit:{userId}:holds     INCR                            TTL 60s
session:{sessionId}          {userId,email,name}             TTL 3600s
waitlist:{eventId}           ZSET  score=joinedAt member=userId
event:{eventId}:seats        HASH  field=seatId value=status
```

---

## Campus bus vertical (LNMIIT)

A second product vertical on the same platform: the institute's daily shuttle
(timetable w.e.f. Oct 31, 2025 — Mon–Fri + Sat/Sun/Holiday tables, seeded).

**Rules**
- Booking opens **60 min** before departure; free; **one seat per rider per trip**; no seat
  selection — the system assigns a seat or you join the queue.
- Requires an **@lnmiit.ac.in** account with a **roll number** on the profile (set once at
  registration or via `PATCH /api/auth/me`).
- From **T-20 min** riders must confirm boarding; an explicit "Not boarding" frees the seat
  immediately. At **T-10 min** unconfirmed seats are auto-released (holder gets a no-show) and
  handed to the **public FIFO waitlist** (visible to everyone: name + roll + position).
- Daily trips are generated from the timetable at 00:05 (holiday dates use the weekend table;
  Bus 3 has Monday-only and Friday-only runs). Admins manage rows/capacity/holidays and see
  per-trip manifests at `/admin/bus`.

**Env knobs** — `BUS_OPEN_SECONDS=3600`, `BUS_CONFIRM_SECONDS=1200`, `BUS_AUTORELEASE_SECONDS=600`,
`BUS_DEFAULT_CAPACITY=40`, `BUS_EMAIL_DOMAIN=lnmiit.ac.in`, `TZ=Asia/Kolkata`.
Campus demo accounts: `23ucs101@lnmiit.ac.in` / `Student@123` (and `23ucs102`),
admin `admin@lnmiit.ac.in` / `Admin@1234`.

**ADR — two concurrency strategies, on purpose.** The events vertical guards *individual seats*
with atomic Redis Lua locks (sub-ms holds, natural TTL expiry, horizontal fan-out). The bus
vertical guards a *capacity counter* with a single Postgres conditional update
(`SET booked_count = booked_count + 1 WHERE booked_count < capacity`) in the same transaction as
the booking upsert — no TTL semantics needed, the seat count and the booking commit or roll back
together, and `UNIQUE(trip_id, user_id)` + `FOR UPDATE SKIP LOCKED` (waitlist promotion) make
over-booking and queue-jumping impossible. Rule of thumb: per-resource locks + TTL ⇒ Redis;
transactional counters with relational invariants ⇒ Postgres.

## AI: Smart Seat Recommender

`POST /api/seats/recommend` reads available seats from the **replica**, sends them
to **Gemini** (`gemini-2.5-pro`, JSON response) asking for the best `groupSize`
seats matching `preferences` (`together`, `aisle`, `front`, `back`) under
`maxBudget`, and returns `{ recommendedSeatIds, reason }`. With **no
`GEMINI_API_KEY`** (or any failure) it uses a deterministic heuristic
(consecutive same-row for "together", row order for front/back, row-ends for
aisle, budget-aware). The frontend's **Smart Recommend** button shows the reason
and one-click holds the recommended seats atomically.

## Project structure

```
backend/   src/{config,routes,controllers,services,workers,middleware,scripts}/  server.js
frontend/  src/{components,pages,hooks,services}/  App.jsx main.jsx  vite/tailwind config
migrations/  001..006_*.sql
nginx/nginx.conf   docker/  docker-compose.yml   .env.example
```

## Verification

Each layer has a runnable check (against the live Docker services):

```bash
node backend/src/scripts/_verify_s3.js   # hold 409 / rate-limit 429 / Redis-down fallback
HOLD_TTL_SECONDS=3 node backend/src/scripts/_verify_s4.js   # auto-expiry + waitlist + email
node backend/src/scripts/_verify_s5.js   # full API flow + error codes (needs server on :3000)
node backend/src/scripts/_verify_s7.js   # recommender heuristic + Gemini fallback
node frontend/_verify_s6.mjs             # WebSocket cross-node fan-out (needs EVENT_ID/SEAT_ID/TOKEN)
```

## Troubleshooting

- **502 from nginx after `--build`** → app containers got new IPs; `docker compose restart nginx`.
- **`docker-credential-desktop not found`** (Colima) → remove `"credsStore": "desktop"` from `~/.docker/config.json`.
- **Replica not streaming** → `docker compose exec postgres_primary psql -U booking -d booking -c "select * from pg_stat_replication;"` should show one row; if not, `docker compose down -v && docker compose up -d`.
- **Recommender always heuristic** → set `GEMINI_API_KEY` (free at aistudio.google.com).
