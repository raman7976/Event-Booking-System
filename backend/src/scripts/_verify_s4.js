// S4 check (throwaway). Runs the workers live: hold a seat with a tiny TTL, let
// the expiry worker auto-release it, hand off to a waitlisted user, and send an
// email (Ethereal). Run with HOLD_TTL_SECONDS=3.
import { redis, isRedisReady, closeRedis } from '../config/redis.js';
import { writePool, closePools } from '../config/db.js';
import { closeQueues, emailQueue, enqueueEmail } from '../config/queues.js';
import { config } from '../config/env.js';
import { holdSeat } from '../services/seatService.js';
import { joinWaitlist } from '../services/waitlistService.js';
import { startExpiryWorker } from '../workers/expiryWorker.js';
import { startEmailWorker } from '../workers/emailWorker.js';
import { startWaitlistWorker } from '../workers/waitlistWorker.js';

const tag = Date.now();
let pass = 0, fail = 0;
const ok = (m) => { console.log(`  ✓ ${m}`); pass += 1; };
const bad = (m) => { console.log(`  ✗ ${m}`); fail += 1; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, ms = 12000, every = 250) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (await fn()) return true;
    await sleep(every);
  }
  return false;
}

async function main() {
  await waitFor(() => isRedisReady(), 5000);
  console.log(`redis ready: ${isRedisReady()}  | HOLD_TTL=${config.holdTtlSeconds}s`);
  const workers = [startExpiryWorker(), startEmailWorker(), startWaitlistWorker()];

  // fixtures
  const { rows: [u1] } = await writePool.query(
    `INSERT INTO users(email,password_hash,name) VALUES($1,'x','Holder') RETURNING id`, [`s4-u1-${tag}@t.local`]);
  const { rows: [u2] } = await writePool.query(
    `INSERT INTO users(email,password_hash,name) VALUES($1,'x','Waiter') RETURNING id`, [`s4-u2-${tag}@t.local`]);
  const { rows: [ev] } = await writePool.query(
    `INSERT INTO events(name,venue,event_date,total_seats,available_seats,base_price)
     VALUES('S4 Test','Arena',NOW()+interval '5 day',1,1,50) RETURNING id`);
  const { rows: [seat] } = await writePool.query(
    `INSERT INTO seats(event_id,row_label,seat_number,category,price,status)
     VALUES($1,'A',1,'VIP',50,'available') RETURNING id`, [ev.id]);
  console.log(`fixtures: event=${ev.id} seat=${seat.id}`);

  // u2 waits in line; u1 grabs the only seat (short TTL)
  await joinWaitlist(ev.id, u2.id);
  const hold = await holdSeat({ userId: u1.id, seatId: seat.id, eventId: ev.id });
  console.log(`u1 held seat token=${hold.holdToken.slice(0, 8)}…; waiting for auto-expiry…`);

  // ── expiry assertions ──
  console.log('\n[A] auto-expiry');
  const expired = await waitFor(async () => {
    const { rows } = await writePool.query('SELECT status FROM reservations WHERE hold_token=$1', [hold.holdToken]);
    return rows[0]?.status === 'expired';
  });
  expired ? ok('reservation -> expired') : bad('reservation did not expire');

  const { rows: [s] } = await writePool.query('SELECT status FROM seats WHERE id=$1', [seat.id]);
  s.status === 'available' ? ok('seat -> available') : bad(`seat status=${s.status}`);

  const keyGone = (await redis.exists(`seat:${ev.id}:${seat.id}`)) === 0;
  keyGone ? ok('redis hold key deleted') : bad('redis hold key still present');

  const { rows: [nu] } = await writePool.query('SELECT no_show_count FROM users WHERE id=$1', [u1.id]);
  nu.no_show_count === 1 ? ok('holder no_show_count -> 1') : bad(`no_show_count=${nu.no_show_count}`);

  // ── waitlist handoff ──
  console.log('\n[B] waitlist handoff');
  const notified = await waitFor(async () => {
    const { rows } = await writePool.query('SELECT notified_at FROM waitlist WHERE event_id=$1 AND user_id=$2', [ev.id, u2.id]);
    return rows[0]?.notified_at != null;
  });
  notified ? ok('waitlisted user notified_at set') : bad('waitlist user not notified');
  const wlSize = await redis.zcard(`waitlist:${ev.id}`);
  wlSize === 0 ? ok('waitlist ZSET drained (ZPOPMIN)') : bad(`waitlist zcard=${wlSize}`);

  // ── email (Ethereal) ──
  // emailQueue uses removeOnComplete, so a *missing* job == completed-and-removed;
  // a failed job is retained. The preview URL is printed by the worker's logger.
  console.log('\n[C] email (Ethereal)');
  try {
    const job = await enqueueEmail({
      to: `s4-u1-${tag}@t.local`, type: 'confirmation', userName: 'Holder',
      eventName: 'S4 Test', venue: 'Arena',
      seats: [{ row: 'A', number: 1, category: 'VIP', price: 50 }], total: 50, transactionId: `txn_${tag}`,
    });
    const gone = await waitFor(async () => !(await emailQueue.getJob(job.id)), 15000);
    if (gone) ok('confirmation email completed (preview URL printed above)');
    else bad(`email not completed (state=${await (await emailQueue.getJob(job.id))?.getState()})`);
  } catch (e) {
    bad(`email step error: ${e.message}`);
  }

  // cleanup
  console.log('\n[cleanup]');
  await writePool.query('DELETE FROM waitlist WHERE event_id=$1', [ev.id]);
  await writePool.query('DELETE FROM reservations WHERE event_id=$1', [ev.id]);
  await writePool.query('DELETE FROM seats WHERE event_id=$1', [ev.id]);
  await writePool.query('DELETE FROM events WHERE id=$1', [ev.id]);
  await writePool.query('DELETE FROM users WHERE id = ANY($1)', [[u1.id, u2.id]]);
  if (isRedisReady()) await redis.del(`waitlist:${ev.id}`, `event:${ev.id}:seats`, `ratelimit:${u1.id}:holds`);
  console.log('  cleaned');

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  await Promise.allSettled(workers.map((w) => w.close()));
  await Promise.allSettled([closeQueues(), closeRedis(), closePools()]);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error('verify_s4 fatal:', err);
  try { await closeQueues(); await closeRedis(); await closePools(); } catch {}
  process.exit(1);
});
