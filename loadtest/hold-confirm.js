// k6 load test for the seat-booking hot path. Drives the real user journey
// against the LOCAL stack only. Two scenarios (pick with -e SCENARIO):
//
//   sustained  — browse seats -> hold a random seat -> release it. Measures read +
//                lock throughput without exhausting inventory.
//   sellout    — hold a random seat -> confirm it (unique Idempotency-Key). Drives
//                toward sellout to exercise the no-oversell path under load.
//   both (default) — runs sustained, then sellout staggered after it.
//
// Tokens + seat ids come from loadtest/data.json (produced by `npm run loadtest:prep`).
//
// Env: BASE_URL (default http://localhost:80, i.e. nginx), PEAK_VUS (default 1000),
//      SCENARIO (sustained|sellout|both).
//
// ⚠️  LOCAL ONLY. Never point BASE_URL at the deployed Railway site.
import http from 'k6/http';
import { sleep } from 'k6';
import { SharedArray } from 'k6/data';
import { Counter, Rate } from 'k6/metrics';

const BASE = __ENV.BASE_URL || 'http://localhost:80';
const PEAK = Number(__ENV.PEAK_VUS || 1000);
const SCENARIO = __ENV.SCENARIO || 'both';

// open() is cached, so parsing per SharedArray init is one-time and cheap.
const EVENT_ID = JSON.parse(open('./data.json')).eventId;
const tokens = new SharedArray('tokens', () => JSON.parse(open('./data.json')).tokens);
const seatIds = new SharedArray('seatIds', () => JSON.parse(open('./data.json')).seatIds);

// Custom metrics. 409 (seat taken) and 429 (per-user hold cap) are EXPECTED
// outcomes under contention — tracked separately so they don't look like failures.
const holdsOk = new Counter('holds_ok');
const confirmsOk = new Counter('confirms_ok');
const conflicts = new Counter('conflicts_409');
const rateLimited = new Counter('rate_limited_429');
const serverErrors = new Counter('server_errors_5xx');
const errorRate = new Rate('error_rate'); // 5xx only

function tokenFor() {
  // Random user per iteration so the whole seeded user pool participates (not
  // just one user per VU). The per-user hold cap is raised for load runs, so reuse
  // is fine; this lets e.g. 3000 users compete even at a few hundred VUs.
  return tokens[Math.floor(Math.random() * tokens.length)];
}
function randomSeat() {
  return seatIds[Math.floor(Math.random() * seatIds.length)];
}
function idemKey() {
  return `lt-${Date.now()}-${__VU}-${__ITER}-${Math.floor(Math.random() * 1e9)}`;
}

function classifyHold(res) {
  if (res.status === 201) { holdsOk.add(1); errorRate.add(false); return res.json('holdToken'); }
  if (res.status === 409) { conflicts.add(1); errorRate.add(false); return null; }
  if (res.status === 429) { rateLimited.add(1); errorRate.add(false); return null; }
  if (res.status >= 500) { serverErrors.add(1); errorRate.add(true); return null; }
  errorRate.add(false);
  return null;
}

function authHeaders() {
  return { Authorization: `Bearer ${tokenFor()}`, 'Content-Type': 'application/json' };
}

export function sustained() {
  const headers = authHeaders();
  // Real users fetch the seat map once per visit, not on every action — sample
  // it ~10% of the time so the load reflects the booking path, not a repeated
  // full seat-map dump.
  if (Math.random() < 0.1) http.get(`${BASE}/api/events/${EVENT_ID}/seats`, { headers });
  const seatId = randomSeat();
  const holdToken = classifyHold(
    http.post(`${BASE}/api/seats/${seatId}/hold`, JSON.stringify({ eventId: EVENT_ID }), { headers }),
  );
  if (holdToken) {
    // Release so inventory isn't exhausted — this scenario measures throughput.
    http.del(`${BASE}/api/seats/${seatId}/hold`, JSON.stringify({ holdToken }), { headers });
  }
  sleep(Math.random() * 0.5);
}

export function sellout() {
  const headers = authHeaders();
  const seatId = randomSeat();
  const holdToken = classifyHold(
    http.post(`${BASE}/api/seats/${seatId}/hold`, JSON.stringify({ eventId: EVENT_ID }), { headers }),
  );
  if (holdToken) {
    const res = http.post(
      `${BASE}/api/bookings/confirm`,
      JSON.stringify({ holdToken, paymentMethod: 'card' }),
      { headers: { ...headers, 'Idempotency-Key': idemKey() } },
    );
    if (res.status === 201) { confirmsOk.add(1); errorRate.add(false); }
    else if (res.status >= 500) { serverErrors.add(1); errorRate.add(true); }
    else { errorRate.add(false); }
  }
  sleep(Math.random() * 0.3);
}

// Ramping-VUs profile that climbs to PEAK to find the knee, then drains.
const ramp = (mult = 1) => ({
  executor: 'ramping-vus',
  startVUs: 0,
  stages: [
    { duration: '30s', target: Math.ceil(PEAK * 0.1 * mult) },
    { duration: '1m', target: Math.ceil(PEAK * 0.5 * mult) },
    { duration: '1m30s', target: Math.ceil(PEAK * mult) },
    { duration: '1m', target: Math.ceil(PEAK * mult) },
    { duration: '30s', target: 0 },
  ],
  gracefulRampDown: '20s',
});

const scenarios = {};
if (SCENARIO === 'sustained' || SCENARIO === 'both') {
  scenarios.sustained = { ...ramp(1), exec: 'sustained', startTime: '0s' };
}
if (SCENARIO === 'sellout' || SCENARIO === 'both') {
  // In "both", stagger sellout to start after sustained finishes (~4m30s).
  scenarios.sellout = { ...ramp(0.6), exec: 'sellout', startTime: SCENARIO === 'both' ? '4m40s' : '0s' };
}

export const options = {
  scenarios,
  // Thresholds are observational for a breaking-point run — they flag where it
  // degrades (non-zero exit) but do not abort the test.
  thresholds: {
    http_req_duration: ['p(95)<2000', 'p(99)<5000'],
    error_rate: ['rate<0.05'],
  },
};
