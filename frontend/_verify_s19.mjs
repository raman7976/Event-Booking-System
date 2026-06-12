// S19 check (throwaway). Adapter-era realtime + idempotency + read-your-writes.
//  A: socket via nginx (least_conn) receives seat-update after an API hold
//     (delivery through the Socket.IO redis-adapter, any-node).
//  B: a bare @socket.io/redis-emitter emit (the worker's path) reaches the client.
//  C: Idempotency-Key — replaying a confirm returns the stored response and
//     exactly one completed payment row exists.
//  D: read-your-writes flag is set after the write.
// Run from frontend/ (has socket.io-client); backend deps resolved via path.
import { io } from 'socket.io-client';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../backend/package.json', import.meta.url));
const { Emitter } = require('@socket.io/redis-emitter');
const Redis = require('ioredis');
const { Pool } = require('pg');

const API = 'http://localhost';
const tag = Date.now();
let pass = 0, fail = 0;
const ok = (m) => { console.log(`  ✓ ${m}`); pass += 1; };
const bad = (m) => { console.log(`  ✗ ${m}`); fail += 1; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const redis = new Redis({ host: 'localhost', port: 6379 });
const pg = new Pool({ host: 'localhost', port: 5432, user: 'booking', password: 'booking_pass', database: 'booking' });

async function api(method, path, { token, body, headers } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json, headers: res.headers };
}

function connect() {
  return new Promise((resolve, reject) => {
    const socket = io(API, { path: '/ws', transports: ['websocket'], reconnection: false });
    let info = {};
    socket.on('connected', (d) => { info = d; });
    socket.on('connect', () => resolve({ socket, node: () => info.instance }));
    socket.on('connect_error', (e) => reject(new Error(e.message)));
    setTimeout(() => reject(new Error('socket timeout')), 9000);
  });
}

const waitForEvent = (socket, event, match, ms) =>
  new Promise((resolve) => {
    const h = (u) => { if (match(u)) { socket.off(event, h); resolve(u); } };
    socket.on(event, h);
    setTimeout(() => { socket.off(event, h); resolve(null); }, ms);
  });

async function main() {
  // fixtures: event + 2 seats + user
  const { rows: [ev] } = await pg.query(
    `INSERT INTO events(name,venue,event_date,total_seats,available_seats,base_price)
     VALUES('S19 Test','Lab',NOW()+interval '9 day',2,2,75) RETURNING id`);
  const { rows: [seat] } = await pg.query(
    `INSERT INTO seats(event_id,row_label,seat_number,category,price,status)
     VALUES($1,'A',1,'GENERAL',75,'available') RETURNING id`, [ev.id]);
  const reg = await api('POST', '/api/auth/register', {
    body: { email: `s19-${tag}@lnmiit.ac.in`, password: 'Scale123A', name: 'S19' },
  });
  const token = reg.json.token;
  const userId = reg.json.user.id;

  console.log('[A] adapter delivery from an API-node emit');
  const { socket, node } = await connect();
  await wait(200);
  ok(`socket connected via nginx least_conn (node=${node()})`);
  socket.emit('join-event', ev.id);
  await wait(300);

  const liveP = waitForEvent(socket, 'seat-update', (u) => u.seatId === seat.id, 8000);
  const hold = await api('POST', `/api/seats/${seat.id}/hold`, { token, body: { eventId: ev.id } });
  hold.status === 201 ? ok('hold -> 201') : bad(`hold -> ${hold.status}`);
  const live = await liveP;
  live?.status === 'held'
    ? ok('seat-update delivered through the redis-adapter (no manual bridge)')
    : bad(`no live update: ${JSON.stringify(live)}`);

  console.log('\n[B] worker-path: bare redis-emitter emit reaches the client');
  const emitter = new Emitter(redis);
  const sentinelP = waitForEvent(socket, 'seat-update', (u) => u.seatId === 'emitter-sentinel', 5000);
  emitter.to(`event:${ev.id}`).emit('seat-update', { seatId: 'emitter-sentinel', status: 'available', timestamp: Date.now() });
  (await sentinelP) ? ok('external-process emit (worker pattern) delivered to the room') : bad('sentinel not delivered');

  console.log('\n[D] read-your-writes flag');
  (await redis.exists(`ryw:${userId}`)) === 1
    ? ok('ryw:{user} flag set after the hold (next reads pinned to primary)')
    : bad('ryw flag missing');

  console.log('\n[C] idempotent confirm');
  const key = `s19-key-${tag}`;
  const c1 = await api('POST', '/api/bookings/confirm', {
    token, body: { holdToken: hold.json.holdToken, paymentMethod: 'card' },
    headers: { 'Idempotency-Key': key },
  });
  c1.status === 201 ? ok(`confirm -> 201 (txn ${c1.json.booking.payment.transactionId.slice(0, 12)}…)`) : bad(`confirm -> ${c1.status}`);

  const c2 = await api('POST', '/api/bookings/confirm', {
    token, body: { holdToken: hold.json.holdToken, paymentMethod: 'card' },
    headers: { 'Idempotency-Key': key },
  });
  const replayed = c2.headers.get('idempotency-replayed') === 'true';
  c2.status === 201 && replayed && c2.json.booking.payment.transactionId === c1.json.booking.payment.transactionId
    ? ok('replay with same key -> stored 201 response, same transaction, Idempotency-Replayed header')
    : bad(`replay -> ${c2.status} replayed=${replayed}`);

  const c3 = await api('POST', '/api/bookings/confirm', {
    token, body: { holdToken: hold.json.holdToken, paymentMethod: 'card' },
    headers: { 'Idempotency-Key': `${key}-different` },
  });
  c3.status === 409 ? ok('same hold with a NEW key -> 409 (state machine, not a double-charge)') : bad(`new-key retry -> ${c3.status}`);

  const { rows: [pay] } = await pg.query(
    `SELECT COUNT(*)::int AS n FROM payments p JOIN reservations r ON r.id = p.reservation_id
      WHERE r.hold_token = $1 AND p.status = 'completed'`, [hold.json.holdToken]);
  pay.n === 1 ? ok('exactly ONE completed payment row (unique index backstop holds)') : bad(`payments=${pay.n}`);

  socket.close();

  // cleanup
  await pg.query('DELETE FROM payments WHERE reservation_id IN (SELECT id FROM reservations WHERE event_id=$1)', [ev.id]);
  await pg.query('DELETE FROM reservations WHERE event_id=$1', [ev.id]);
  await pg.query('DELETE FROM seats WHERE event_id=$1', [ev.id]);
  await pg.query('DELETE FROM events WHERE id=$1', [ev.id]);
  await pg.query('DELETE FROM users WHERE id=$1', [userId]);
  const keys = await redis.keys(`seat:${ev.id}:*`);
  if (keys.length) await redis.del(keys);
  await redis.del(`event:${ev.id}:seats`, `idem:${userId}:${key}`, `idem:${userId}:${key}-different`, `ryw:${userId}`);
  console.log('\n  cleaned');

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  await redis.quit();
  await pg.end();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error('verify_s19 fatal:', e); process.exit(1); });
