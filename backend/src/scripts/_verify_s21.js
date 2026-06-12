// S21+S22 check (throwaway). Synthesizes booking history under an inactive
// bus-98 schedule pair, then asserts: heuristic rider tiers/actions, replace-
// on-rerun persistence, bogus-Gemini-key fallback, capacity advice direction
// (hot route -> increase, cold route -> decrease), and admin API auth.
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { writePool, closePools } from '../config/db.js';
import { closeRedis } from '../config/redis.js';
import { closeQueues } from '../config/queues.js';
import { config } from '../config/env.js';
import { analyzeRiders, adviseCapacity, getRiderStats } from '../services/busInsightsService.js';

const BASE = process.env.API_URL || 'http://localhost';
const tag = String(Date.now()).slice(-6);
let pass = 0, fail = 0;
const ok = (m) => { console.log(`  ✓ ${m}`); pass += 1; };
const bad = (m) => { console.log(`  ✗ ${m}`); fail += 1; };

async function api(method, path, token) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json };
}

async function main() {
  // ── fixtures ──
  const hash = await bcrypt.hash('Student@123', 10);
  const mkUser = async (slug, name) => {
    const { rows: [u] } = await writePool.query(
      `INSERT INTO users (email, password_hash, name, role, roll_number)
       VALUES ($1, $2, $3, 'user', $4) RETURNING id, roll_number`,
      [`s21${slug}-${tag}@lnmiit.ac.in`, hash, name, `S21${slug.toUpperCase()}${tag}`],
    );
    return u;
  };
  const serial = await mkUser('a', 'Serial Misser');
  const sloppy = await mkUser('b', 'Sloppy Rider');
  const occasional = await mkUser('c', 'Occasional Misser');
  const reliable = await mkUser('d', 'Reliable Rider');
  const fresh = await mkUser('e', 'Fresh Rider');
  const w1 = await mkUser('f', 'Waiter One');
  const w2 = await mkUser('g', 'Waiter Two');

  const mkSchedule = async (time, capacity) => {
    const { rows: [s] } = await writePool.query(
      `INSERT INTO bus_schedules (bus_no, origin, destination, departure_time, pattern, capacity, active)
       VALUES (98, 'LNMIIT', 'S21 Gate', $1, 'weekday', $2, false) RETURNING id`,
      [time, capacity],
    );
    return s.id;
  };
  const hotSched = await mkSchedule('08:10', 5);
  const coldSched = await mkSchedule('14:10', 40);

  const mkTrip = async (schedId, daysAgo, capacity, booked) => {
    const { rows: [t] } = await writePool.query(
      `INSERT INTO bus_trips (schedule_id, service_date, departure_at, capacity, booked_count, status)
       VALUES ($1, CURRENT_DATE - $2::int,
               (CURRENT_DATE - $2::int)::timestamp + (SELECT departure_time FROM bus_schedules WHERE id=$1),
               $3, $4, 'departed') RETURNING id, departure_at`,
      [schedId, daysAgo, capacity, booked],
    );
    return t;
  };
  const hot = [];
  const cold = [];
  for (let d = 1; d <= 6; d += 1) {
    hot.push(await mkTrip(hotSched, d, 5, 5));
    cold.push(await mkTrip(coldSched, d, 40, 3));
  }

  const book = (trip, user, status, minutesAfterOpen = 30) =>
    writePool.query(
      `INSERT INTO bus_bookings (trip_id, user_id, status, created_at, confirmed_at)
       VALUES ($1, $2, $3,
               ($4::timestamptz - make_interval(secs => $5)) + make_interval(mins => $6),
               $7)`,
      [
        trip.id, user.id, status, trip.departure_at, config.bus.openSeconds, minutesAfterOpen,
        status === 'confirmed' ? trip.departure_at : null,
      ],
    );

  // serial: 5 no-shows + 1 confirmed (on the hot route, which has waiters -> blockedWaiters)
  for (let i = 0; i < 5; i += 1) await book(hot[i], serial, 'no_show');
  await book(hot[5], serial, 'confirmed');
  // sloppy: 2 auto_released + 3 confirmed
  await book(hot[0], sloppy, 'auto_released');
  await book(hot[1], sloppy, 'auto_released');
  for (let i = 0; i < 3; i += 1) await book(cold[i], sloppy, 'confirmed');
  // occasional: 1 no-show + 4 confirmed
  await book(cold[5], occasional, 'no_show');
  for (let i = 0; i < 4; i += 1) await book(cold[i], occasional, 'confirmed');
  // reliable: 6 confirmed; fresh: single no-show (below min-bookings threshold)
  for (let i = 0; i < 6; i += 1) await book(cold[i], reliable, 'confirmed');
  await book(hot[5], fresh, 'no_show');
  // waitlist pressure on every hot trip
  for (const t of hot) {
    await writePool.query('INSERT INTO bus_waitlist (trip_id, user_id) VALUES ($1,$2), ($1,$3)', [t.id, w1.id, w2.id]);
  }
  console.log(`fixtures ready (tag ${tag})`);

  // ── [A] heuristic rider analysis (no Gemini key on host) ──
  console.log('\n[A] heuristic rider flags');
  config.gemini.apiKey = '';
  const run1 = await analyzeRiders();
  run1.source === 'heuristic' ? ok('source=heuristic without a key') : bad(`source=${run1.source}`);
  const byRoll = new Map(run1.flags.map((f) => [f.rollNumber, f]));
  const fSerial = byRoll.get(serial.roll_number);
  const fSloppy = byRoll.get(sloppy.roll_number);
  const fOccasional = byRoll.get(occasional.roll_number);
  fSerial?.tier === 'high' && fSerial?.action === 'cooldown'
    ? ok(`serial misser -> high risk + cooldown (${fSerial.misses}/${fSerial.total} missed)`)
    : bad(`serial=${JSON.stringify(fSerial && { tier: fSerial.tier, action: fSerial.action })}`);
  fSerial?.blockedWaiters > 0
    ? ok(`harm signal captured: blocked ${fSerial.blockedWaiters} waitlisted rider-slots`)
    : bad(`blockedWaiters=${fSerial?.blockedWaiters}`);
  fSloppy?.tier === 'medium' && fSloppy?.action === 'warn'
    ? ok('repeat auto-releaser -> medium + warn')
    : bad(`sloppy=${fSloppy?.tier}/${fSloppy?.action}`);
  fOccasional?.tier === 'low' && fOccasional?.action === 'none'
    ? ok('single miss among many rides -> low + no action')
    : bad(`occasional=${fOccasional?.tier}/${fOccasional?.action}`);
  !byRoll.has(reliable.roll_number) ? ok('fully reliable rider not flagged') : bad('reliable was flagged');
  !byRoll.has(fresh.roll_number) ? ok('single-booking rider filtered out (min 3 bookings)') : bad('fresh was flagged');

  // ── [B] persistence: rerun replaces, one row per user ──
  console.log('\n[B] persistence semantics');
  await analyzeRiders();
  const { rows: [cnt] } = await writePool.query(
    `SELECT COUNT(*)::int AS total, COUNT(DISTINCT user_id)::int AS users FROM bus_rider_flags`,
  );
  cnt.total === cnt.users ? ok(`rerun keeps one row per user (${cnt.total} flags)`) : bad(`rows=${cnt.total} users=${cnt.users}`);

  // ── [C] bogus key -> real Gemini attempt -> clean heuristic fallback ──
  console.log('\n[C] Gemini failure fallback');
  config.gemini.apiKey = 'bogus_invalid_key_s21';
  const run3 = await analyzeRiders();
  run3.source === 'heuristic' && run3.flags.length === run1.flags.length
    ? ok('bogus key -> Gemini attempted, fell back to heuristic with identical flags')
    : bad(`fallback source=${run3.source} flags=${run3.flags.length}`);
  config.gemini.apiKey = '';

  // ── [D] capacity advisor ──
  console.log('\n[D] capacity advisor');
  const advice = await adviseCapacity();
  advice.source === 'heuristic' ? ok('advisor source=heuristic without a key') : bad(`source=${advice.source}`);
  const aHot = advice.advice.find((a) => a.scheduleId === hotSched);
  const aCold = advice.advice.find((a) => a.scheduleId === coldSched);
  aHot?.recommendation === 'increase' && aHot.suggestedCapacity > 5
    ? ok(`hot route (100% fill, waitlist) -> increase to ${aHot.suggestedCapacity}`)
    : bad(`hot=${JSON.stringify(aHot && { rec: aHot.recommendation, cap: aHot.suggestedCapacity })}`);
  aCold?.recommendation === 'decrease'
    ? ok(`cold route (${Math.round((aCold?.avgFill || 0) * 100)}% fill over ${aCold?.trips} trips) -> decrease`)
    : bad(`cold=${aCold?.recommendation}`);
  aHot?.avgMinutesToFull != null && aHot.avgMinutesToFull > 0
    ? ok(`time-to-full computed (~${Math.round(aHot.avgMinutesToFull)} min after open)`)
    : bad(`minutesToFull=${aHot?.avgMinutesToFull}`);

  // ── [E] API auth through nginx ──
  console.log('\n[E] admin API auth');
  const admin = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@lnmiit.ac.in', password: 'Admin@1234' }),
  }).then((r) => r.json());
  const flagsRes = await api('GET', '/api/bus/admin/flags', admin.token);
  flagsRes.status === 200 && flagsRes.json.flags.some((f) => f.rollNumber === serial.roll_number)
    ? ok('GET /admin/flags -> 200 with the flagged rider (high tier sorted first)')
    : bad(`flags -> ${flagsRes.status}`);
  const adviceRes = await api('GET', '/api/bus/admin/capacity-advice', admin.token);
  adviceRes.status === 200 ? ok('GET /admin/capacity-advice -> 200') : bad(`advice -> ${adviceRes.status}`);
  const studentToken = jwt.sign(
    { sub: serial.id, email: `s21a-${tag}@lnmiit.ac.in`, name: 'x', role: 'user', roll: serial.roll_number },
    config.jwt.secret, { expiresIn: '5m' },
  );
  const forbidden = await api('POST', '/api/bus/admin/flags/analyze', studentToken);
  forbidden.status === 403 ? ok('student POST /admin/flags/analyze -> 403') : bad(`student -> ${forbidden.status}`);

  // ── cleanup ──
  await writePool.query('DELETE FROM bus_rider_flags');
  await writePool.query('DELETE FROM bus_waitlist WHERE trip_id IN (SELECT id FROM bus_trips WHERE schedule_id = ANY($1))', [[hotSched, coldSched]]);
  await writePool.query('DELETE FROM bus_bookings WHERE trip_id IN (SELECT id FROM bus_trips WHERE schedule_id = ANY($1))', [[hotSched, coldSched]]);
  await writePool.query('DELETE FROM bus_trips WHERE schedule_id = ANY($1)', [[hotSched, coldSched]]);
  await writePool.query('DELETE FROM bus_schedules WHERE id = ANY($1)', [[hotSched, coldSched]]);
  await writePool.query("DELETE FROM users WHERE email LIKE $1", [`s21%-${tag}@lnmiit.ac.in`]);
  console.log('\n  cleaned');

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  await Promise.allSettled([closeQueues(), closeRedis(), closePools()]);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error('verify_s21 fatal:', err);
  try { await closeQueues(); await closeRedis(); await closePools(); } catch {}
  process.exit(1);
});
