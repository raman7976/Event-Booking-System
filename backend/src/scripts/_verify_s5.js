// S5 API check (throwaway). Drives the running server over HTTP: register/login,
// events, seats, hold, confirm, my-bookings, plus 400/401/409/429. Creates and
// cleans up its own event+seats. Requires the server at API_URL (default :3000).
import { writePool, closePools } from '../config/db.js';
import { redis, isRedisReady, closeRedis } from '../config/redis.js';
import { closeQueues } from '../config/queues.js';

const BASE = process.env.API_URL || 'http://localhost:3000';
const tag = Date.now();
let pass = 0, fail = 0;
const ok = (m) => { console.log(`  ✓ ${m}`); pass += 1; };
const bad = (m) => { console.log(`  ✗ ${m}`); fail += 1; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, path, { token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* no body */ }
  return { status: res.status, json };
}

async function waitFor(fn, ms = 6000, every = 200) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (await fn()) return true;
    await sleep(every);
  }
  return false;
}

async function main() {
  await waitFor(() => isRedisReady(), 4000);
  if (isRedisReady()) {
    const stale = await redis.keys('ratelimit:auth:*');
    if (stale.length) await redis.del(stale);
  }

  // fixtures: one event, three seats
  const { rows: [ev] } = await writePool.query(
    `INSERT INTO events(name,venue,event_date,total_seats,available_seats,base_price)
     VALUES('S5 Concert','Dome',NOW()+interval '20 day',3,3,120) RETURNING id`);
  const seatIds = [];
  for (let i = 1; i <= 3; i += 1) {
    const cat = i === 1 ? 'VIP' : 'GENERAL';
    const { rows: [s] } = await writePool.query(
      `INSERT INTO seats(event_id,row_label,seat_number,category,price,status)
       VALUES($1,'A',$2,$3,$4,'available') RETURNING id`, [ev.id, i, cat, i === 1 ? 200 : 100]);
    seatIds.push(s.id);
  }
  console.log(`fixtures: event=${ev.id} seats=${seatIds.length}  base=${BASE}`);

  // ── auth ──
  console.log('\n[auth]');
  const reg = await api('POST', '/api/auth/register', { body: { email: `s5-a-${tag}@t.local`, password: 'secret123', name: 'Alice' } });
  reg.status === 201 && reg.json.token ? ok('register -> 201 + token') : bad(`register -> ${reg.status}`);
  const tokenA = reg.json?.token;

  const login = await api('POST', '/api/auth/login', { body: { email: `s5-a-${tag}@t.local`, password: 'secret123' } });
  login.status === 200 && login.json.token ? ok('login -> 200 + token') : bad(`login -> ${login.status}`);

  const reg2 = await api('POST', '/api/auth/register', { body: { email: `s5-b-${tag}@t.local`, password: 'secret123', name: 'Bob' } });
  const tokenB = reg2.json?.token;

  // ── events ──
  console.log('\n[events]');
  const list = await api('GET', '/api/events?page=1&limit=5');
  list.status === 200 && Array.isArray(list.json.events) ? ok(`GET /events -> 200 (${list.json.events.length} shown, ${list.json.pagination.total} total)`) : bad(`GET /events -> ${list.status}`);

  const gotEvent = await waitFor(async () => (await api('GET', `/api/events/${ev.id}`)).status === 200);
  gotEvent ? ok('GET /events/:id -> 200 (replicated)') : bad('GET /events/:id never became 200');

  const seatsRes = await waitFor(async () => {
    const r = await api('GET', `/api/events/${ev.id}/seats`, { token: tokenA });
    return r.status === 200 && r.json.seats?.length === 3;
  });
  seatsRes ? ok('GET /events/:id/seats -> 3 seats') : bad('seats not visible (replication?)');

  // ── hold ──
  console.log('\n[hold/confirm]');
  const hold = await api('POST', `/api/seats/${seatIds[0]}/hold`, { token: tokenA, body: { eventId: ev.id } });
  hold.status === 201 && hold.json.holdToken ? ok('hold -> 201 + holdToken') : bad(`hold -> ${hold.status} ${JSON.stringify(hold.json)}`);
  const holdToken = hold.json?.holdToken;

  const seatsHeld = await api('GET', `/api/events/${ev.id}/seats`, { token: tokenA });
  const s0 = seatsHeld.json?.seats?.find((s) => s.id === seatIds[0]);
  s0?.status === 'held' && s0?.heldByMe ? ok('held seat shows status=held + heldByMe=true (Redis overlay)') : bad(`held seat=${JSON.stringify(s0)}`);

  // 409: Bob tries the same seat
  const dup = await api('POST', `/api/seats/${seatIds[0]}/hold`, { token: tokenB, body: { eventId: ev.id } });
  dup.status === 409 ? ok('Bob holds same seat -> 409') : bad(`dup hold -> ${dup.status}`);

  // confirm
  const confirm = await api('POST', '/api/bookings/confirm', { token: tokenA, body: { holdToken, paymentMethod: 'card' } });
  confirm.status === 201 && confirm.json.booking?.payment?.transactionId
    ? ok(`confirm -> 201 (txn ${confirm.json.booking.payment.transactionId.slice(0, 12)}…, $${confirm.json.booking.payment.amount})`)
    : bad(`confirm -> ${confirm.status} ${JSON.stringify(confirm.json)}`);

  const booked = await waitFor(async () => {
    const r = await api('GET', `/api/events/${ev.id}/seats`, { token: tokenA });
    return r.json?.seats?.find((s) => s.id === seatIds[0])?.status === 'booked';
  });
  booked ? ok('seat -> booked after confirm') : bad('seat not booked');

  const mine = await api('GET', '/api/bookings/mine', { token: tokenA });
  mine.status === 200 && mine.json.bookings?.some((b) => b.status === 'confirmed')
    ? ok(`GET /bookings/mine -> ${mine.json.bookings.length} booking(s), 1 confirmed`)
    : bad(`bookings/mine -> ${mine.status}`);

  // ── error codes ──
  console.log('\n[errors]');
  const noAuth = await api('POST', `/api/seats/${seatIds[1]}/hold`, { body: { eventId: ev.id } });
  noAuth.status === 401 ? ok('hold without token -> 401') : bad(`no-auth -> ${noAuth.status}`);

  const badBody = await api('POST', '/api/auth/register', { body: { email: 'not-an-email', password: '123' } });
  badBody.status === 400 && badBody.json.error?.details ? ok('invalid register -> 400 + field details') : bad(`bad register -> ${badBody.status}`);

  const badEvent = await api('POST', `/api/seats/${seatIds[1]}/hold`, { token: tokenA, body: { eventId: '00000000-0000-0000-0000-000000000000' } });
  badEvent.status === 400 || badEvent.status === 404 ? ok(`hold with mismatched eventId -> ${badEvent.status}`) : bad(`mismatched eventId -> ${badEvent.status}`);

  // 429: hammer login past the auth limiter (20/min)
  let got429 = false;
  for (let i = 0; i < 26; i += 1) {
    const r = await api('POST', '/api/auth/login', { body: { email: `s5-a-${tag}@t.local`, password: 'secret123' } });
    if (r.status === 429) { got429 = true; break; }
  }
  got429 ? ok('rapid logins -> 429 (rate limited)') : bad('never hit 429');

  // ── cleanup ──
  console.log('\n[cleanup]');
  await writePool.query('DELETE FROM payments WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1)', [`s5-%-${tag}@t.local`]);
  await writePool.query('DELETE FROM reservations WHERE event_id=$1', [ev.id]);
  await writePool.query('DELETE FROM seats WHERE event_id=$1', [ev.id]);
  await writePool.query('DELETE FROM events WHERE id=$1', [ev.id]);
  await writePool.query('DELETE FROM users WHERE email LIKE $1', [`s5-%-${tag}@t.local`]);
  if (isRedisReady()) {
    const keys = await redis.keys(`seat:${ev.id}:*`);
    if (keys.length) await redis.del(keys);
    const auth = await redis.keys('ratelimit:auth:*');
    if (auth.length) await redis.del(auth);
    await redis.del(`event:${ev.id}:seats`);
  }
  console.log('  cleaned');

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  await Promise.allSettled([closeQueues(), closeRedis(), closePools()]);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error('verify_s5 fatal:', err);
  try { await closeQueues(); await closeRedis(); await closePools(); } catch {}
  process.exit(1);
});
