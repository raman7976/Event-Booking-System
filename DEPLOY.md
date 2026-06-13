# Deploying SeatLive (Railway backend + Vercel frontend)

Production split: the **backend** (API + WebSockets + worker) runs on **Railway** with managed
Postgres + Redis; the **React frontend** is a static SPA on **Vercel**.

REST traffic is **proxied through Vercel** (a `vercel.json` rewrite forwards `/api/*` → Railway),
so the browser only ever talks to the Vercel origin. This keeps the refresh cookie **first-party**
(works in Safari) and — crucially — makes the API reachable on **mobile networks**: Railway's
`*.up.railway.app` is IPv4-only, and IPv6-first carriers (e.g. Jio) can't reach it directly, but
they reach Vercel fine. The **WebSocket can't be proxied by Vercel**, so it connects straight to
the Railway origin (`VITE_API_URL`) — live updates work on WiFi/desktop and degrade gracefully on
mobile data (REST still works everywhere). The complete fix for mobile live-updates is a custom
domain behind Cloudflare (dual-stack, proxies WS).

**Live deployment**
- Frontend: https://seatlive.vercel.app
- Backend:  https://web-production-b9cd.up.railway.app
- Railway project `seatlive` → services: `web`, `worker`, `Postgres`, `Redis`.

> Local development is unchanged — `docker compose up -d` still runs the full topology (nginx, 2
> nodes, primary+replica, PgBouncer). This guide is a separate, parallel deploy target.

## How one image runs two roles
Both `web` and `worker` build the same `backend/Dockerfile`; the entrypoint `src/start.js` branches
on the `SERVICE_ROLE` env var (`web` → migrate then serve, `worker` → BullMQ worker). So the two
services differ only by that one variable — no per-service start command needed.

## 0. One-time prerequisites
```bash
npm i -g @railway/cli vercel
railway login     # opens a browser
vercel login      # opens a browser
```

## 1. Railway: project + managed data stores
```bash
railway init --name seatlive
railway add --database postgres
railway add --database redis
```

## 2. Backend `web` service
```bash
railway add --service web                       # create empty service
railway variables --service web --skip-deploys \
  --set 'NODE_ENV=production' --set 'SERVICE_ROLE=web' \
  --set 'JWT_SECRET=…' --set 'COOKIE_SECURE=true' --set 'COOKIE_SAMESITE=none' \
  --set 'ADMIN_EMAIL=admin@seatlive.app' --set 'ADMIN_PASSWORD=…' \
  --set 'PG_PRIMARY_HOST=${{Postgres.PGHOST}}'  --set 'PG_PRIMARY_PORT=${{Postgres.PGPORT}}' \
  --set 'PG_DATABASE=${{Postgres.PGDATABASE}}'  --set 'PG_USER=${{Postgres.PGUSER}}' \
  --set 'PG_PASSWORD=${{Postgres.PGPASSWORD}}' \
  --set 'PG_REPLICA_HOST=${{Postgres.PGHOST}}'  --set 'PG_REPLICA_PORT=${{Postgres.PGPORT}}' \
  --set 'REDIS_URL=${{Redis.REDIS_URL}}'        --set 'TZ=Asia/Kolkata'
# deploy the backend/ dir AS the build root (so the Dockerfile is at the archive root):
railway up backend --service web --path-as-root --ci
railway domain --service web                     # -> BACKEND_URL
```
> `--path-as-root` matters: a plain `railway up` uploads the whole git repo root and Railpack
> can't find a build. `railway up backend --path-as-root` roots the upload at `backend/`.

## 3. Backend `worker` service (same image, `SERVICE_ROLE=worker`)
```bash
railway add --service worker
railway variables --service worker --skip-deploys \
  --set 'NODE_ENV=production' --set 'SERVICE_ROLE=worker' --set 'JWT_SECRET=…' \
  --set 'PG_PRIMARY_HOST=${{Postgres.PGHOST}}' --set 'PG_PRIMARY_PORT=${{Postgres.PGPORT}}' \
  --set 'PG_DATABASE=${{Postgres.PGDATABASE}}' --set 'PG_USER=${{Postgres.PGUSER}}' \
  --set 'PG_PASSWORD=${{Postgres.PGPASSWORD}}' \
  --set 'PG_REPLICA_HOST=${{Postgres.PGHOST}}' --set 'PG_REPLICA_PORT=${{Postgres.PGPORT}}' \
  --set 'REDIS_URL=${{Redis.REDIS_URL}}' --set 'TZ=Asia/Kolkata'
railway up backend --service worker --path-as-root --ci
```

## 4. Seed the production DB (once)
The private DB host isn't reachable from your laptop, so seed over Railway's **public TCP proxy**
(values from the Postgres service's `RAILWAY_TCP_PROXY_DOMAIN/PORT` + `PG*`):
```bash
cd backend
PG_PRIMARY_HOST=<proxy-domain> PG_PRIMARY_PORT=<proxy-port> \
PG_USER=postgres PG_PASSWORD=<PGPASSWORD> PG_DATABASE=railway \
ADMIN_EMAIL=admin@seatlive.app ADMIN_PASSWORD=<secret> npm run seed
```
Then create today's bus trips (the worker generated none before schedules existed):
`POST <BACKEND_URL>/api/bus/admin/generate` with an admin Bearer token.

## 5. Vercel: frontend
`frontend/vercel.json` proxies REST (`/api/* → <BACKEND_URL>/api/*`) and adds the SPA fallback.
`VITE_API_URL` is used *only* by the WebSocket client (direct to Railway); REST goes same-origin.
```bash
cd frontend
vercel project add seatlive
vercel link --yes --project seatlive
printf '%s' '<BACKEND_URL>' | vercel env add VITE_API_URL production   # socket origin
vercel --prod --yes                                  # -> FRONTEND_URL (https://seatlive.vercel.app)
```

## 6. Close the cross-origin loop
```bash
railway variables --service web --set 'CLIENT_URL=https://seatlive.vercel.app'   # triggers a web redeploy
```

## 7. Smoke test (all verified ✓)
- `GET  <BACKEND_URL>/health` → `{status:ok, db:ok, redis:ready}`
- `POST <BACKEND_URL>/api/auth/login` (admin) → returns a token, role `admin`
- `GET  <BACKEND_URL>/api/events` → 3 events
- Cross-origin `POST /api/auth/login` with `Origin: https://seatlive.vercel.app` →
  `access-control-allow-origin` + `allow-credentials: true` + `Set-Cookie … SameSite=None; Secure`
- `FRONTEND_URL` → 200, bundle embeds BACKEND_URL.

## Notes & caveats
- **Admin password** lives only in the Railway `ADMIN_PASSWORD` secret — never in git. Rotate by
  changing the var and re-running the seed.
- **Mobile data / Safari — solved by the Vercel REST proxy.** Because the browser only talks to
  Vercel (REST is rewritten to Railway server-side), the cookie is first-party (Safari OK) and the
  API is reachable on IPv6-first mobile carriers that can't hit Railway's IPv4-only host directly.
  Remaining gap: **live WebSocket updates on mobile data** (the socket connects straight to Railway).
  Fix that with a custom domain behind Cloudflare (dual-stack + WS proxy), e.g. `api.example.com`.
- **IPv6 private networking:** Railway's `*.railway.internal` hosts are IPv6. Both Redis (client sets
  `family:0`) and Postgres (Node 20) connect fine over private networking here. If Postgres ever
  fails on the private host, switch `PG_PRIMARY_*` to the public proxy values.
- **AI:** set `GEMINI_API_KEY` on both services to enable live Gemini; otherwise the deterministic
  heuristic fallback runs.
- **Cost:** Railway Hobby (~$5/mo + usage); Vercel hobby free for this SPA.
