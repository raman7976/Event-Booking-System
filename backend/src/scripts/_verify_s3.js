// S3 integration check (throwaway). Exercises the core hold logic against the
// live Dockerized Redis + Postgres: conflict (409), rate limit (429), and the
// Redis-down -> Postgres fallback. Creates and cleans up its own fixtures.
import { redis, isRedisReady } from '../config/redis.js';
import { writePool, closePools } from '../config/db.js';
import { closeRedis } from '../config/redis.js';
import { closeQueues } from '../config/queues.js';
import { holdSeat } from '../services/seatService.js';
import { AppError } from '../utils/errors.js';

const tag = Date.now();
let pass = 0;
let fail = 0;
const ok = (m) => { console.log(`  ✓ ${m}`); pass += 1; };
const bad = (m) => { console.log(`  ✗ ${m}`); fail += 1; };

async function waitForRedis(ms = 5000) {
  const start = Date.now();
  while (!isRedisReady() && Date.now() - start < ms) await new Promise((r) => setTimeout(r, 100));
}

async function expectStatus(fn, status, label) {
  try {
    await fn();
    bad(`${label} — expected ${status} but call succeeded`);
  } catch (err) {
    if (err instanceof AppError && err.statusCode === status) ok(`${label} — got ${status} (${err.code})`);
    else bad(`${label} — expected ${status}, got ${err.statusCode || '?'} ${err.message}`);
  }
}

async function main() {
  await waitForRedis();
  console.log(`redis ready: ${isRedisReady()}`);

  // ── fixtures ──
  const { rows: [u1] } = await writePool.query(
    `INSERT INTO users(email,password_hash,name) VALUES($1,'x','U1') RETURNING id`, [`s3-u1-${tag}@t.local`]);
  const { rows: [u2] } = await writePool.query(
    `INSERT INTO users(email,password_hash,name) VALUES($1,'x','U2') RETURNING id`, [`s3-u2-${tag}@t.local`]);
  const { rows: [u3] } = await writePool.query(
    `INSERT INTO users(email,password_hash,name) VALUES($1,'x','U3') RETURNING id`, [`s3-u3-${tag}@t.local`]);
  const { rows: [u4] } = await writePool.query(
    `INSERT INTO users(email,password_hash,name) VALUES($1,'x','U4') RETURNING id`, [`s3-u4-${tag}@t.local`]);
  const { rows: [ev] } = await writePool.query(
    `INSERT INTO events(name,venue,event_date,total_seats,available_seats,base_price)
     VALUES('S3 Test','Hall',NOW()+interval '10 day',10,10,100) RETURNING id`);
  const seatIds = [];
  for (let i = 1; i <= 6; i += 1) {
    const { rows: [s] } = await writePool.query(
      `INSERT INTO seats(event_id,row_label,seat_number,category,price,status)
       VALUES($1,'A',$2,'GENERAL',100,'available') RETURNING id`, [ev.id, i]);
    seatIds.push(s.id);
  }
  console.log(`fixtures: event=${ev.id} seats=${seatIds.length}`);

  // ── Test A: conflict (409) ──
  console.log('\n[A] conflict');
  const h1 = await holdSeat({ userId: u1.id, seatId: seatIds[0], eventId: ev.id });
  h1.holdToken ? ok(`u1 held seat[0] token=${h1.holdToken.slice(0, 8)}…`) : bad('u1 hold returned no token');
  await expectStatus(() => holdSeat({ userId: u2.id, seatId: seatIds[0], eventId: ev.id }), 409, 'u2 holds same seat');

  // ── Test B: rate limit (429) — 4th hold by u3 within window ──
  console.log('\n[B] rate limit');
  await holdSeat({ userId: u3.id, seatId: seatIds[1], eventId: ev.id });
  await holdSeat({ userId: u3.id, seatId: seatIds[2], eventId: ev.id });
  await holdSeat({ userId: u3.id, seatId: seatIds[3], eventId: ev.id });
  ok('u3 held 3 seats (within limit)');
  await expectStatus(() => holdSeat({ userId: u3.id, seatId: seatIds[4], eventId: ev.id }), 429, 'u3 4th hold');

  // ── Test C: Redis-down -> Postgres fallback ──
  console.log('\n[C] redis-down fallback');
  redis.disconnect();
  await new Promise((r) => setTimeout(r, 200));
  console.log(`  redis ready now? ${isRedisReady()} (expect false)`);
  const hc = await holdSeat({ userId: u4.id, seatId: seatIds[5], eventId: ev.id });
  hc.fallback ? ok(`fallback hold succeeded token=${hc.holdToken.slice(0, 8)}… (Postgres path)`) : bad('expected fallback:true');
  // seat row should be 'held' in Postgres after fallback
  const { rows: [seatRow] } = await writePool.query('SELECT status FROM seats WHERE id=$1', [seatIds[5]]);
  seatRow.status === 'held' ? ok('fallback set seats.status=held in Postgres') : bad(`seat status=${seatRow.status}`);
  redis.connect().catch(() => {});

  // ── cleanup ──
  console.log('\n[cleanup]');
  await writePool.query('DELETE FROM reservations WHERE event_id=$1', [ev.id]);
  await writePool.query('DELETE FROM seats WHERE event_id=$1', [ev.id]);
  await writePool.query('DELETE FROM events WHERE id=$1', [ev.id]);
  await writePool.query('DELETE FROM users WHERE id = ANY($1)', [[u1.id, u2.id, u3.id, u4.id]]);
  await waitForRedis(2000);
  if (isRedisReady()) {
    const keys = await redis.keys(`seat:${ev.id}:*`);
    if (keys.length) await redis.del(keys);
    await redis.del(`ratelimit:${u1.id}:holds`, `ratelimit:${u3.id}:holds`, `event:${ev.id}:seats`);
  }
  console.log('  cleaned fixtures + redis keys');

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  await closeQueues();
  await closeRedis();
  await closePools();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error('verify_s3 fatal:', err);
  try { await closeQueues(); await closeRedis(); await closePools(); } catch {}
  process.exit(1);
});
