// S16 check (throwaway). Part A: timetable->trip generation rules (direct).
// Part B: a full time-warped lifecycle on a synthetic capacity-5 trip driven
// through nginx + the REAL containerized worker: booking race, gates, FIFO
// waitlist promotion, confirm/decline, T-release sweep (no-shows), departure.
// Runtime ~90s. Requires JWT_SECRET to match the containers.
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { writePool, closePools } from '../config/db.js';
import { closeRedis } from '../config/redis.js';
import { busQueue, scheduleBusJob, closeQueues } from '../config/queues.js';
import { generateTripsForDate } from '../services/busService.js';
import { config } from '../config/env.js';

const BASE = process.env.API_URL || 'http://localhost';
const tag = String(Date.now()).slice(-6);
let pass = 0, fail = 0;
const ok = (m) => { console.log(`  ✓ ${m}`); pass += 1; };
const bad = (m) => { console.log(`  ✗ ${m}`); fail += 1; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const signToken = (u) =>
  jwt.sign({ sub: u.id, email: u.email, name: u.name, role: 'user', roll: u.roll || null }, config.jwt.secret, { expiresIn: '15m' });

async function api(method, path, token) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json };
}

async function cleanupTrips(tripIds) {
  for (const id of tripIds) {
    for (const name of ['open', 'confirm', 'release', 'depart']) {
      try { const j = await busQueue.getJob(`${name}-${id}`); if (j) await j.remove(); } catch { /* gone */ }
    }
  }
  if (tripIds.length) {
    await writePool.query('DELETE FROM bus_waitlist WHERE trip_id = ANY($1)', [tripIds]);
    await writePool.query('DELETE FROM bus_bookings WHERE trip_id = ANY($1)', [tripIds]);
    await writePool.query('DELETE FROM bus_trips WHERE id = ANY($1)', [tripIds]);
  }
}

async function partA() {
  console.log('[A] trip generation rules');
  // Future fixed dates: Mon 2026-07-06, Tue 07-07, Wed 07-08(holiday), Fri 07-10, Sat 07-11
  await writePool.query("INSERT INTO holidays (day, label) VALUES ('2026-07-08','Test Holiday') ON CONFLICT DO NOTHING");

  const expect = [
    ['2026-07-06', 16, 'Monday = 14 base + 2 Monday-only'],
    ['2026-07-07', 14, 'Tuesday = 14 base weekday rows'],
    ['2026-07-10', 16, 'Friday = 14 base + 2 Friday-only'],
    ['2026-07-11', 14, 'Saturday = 14 weekend rows'],
    ['2026-07-08', 14, 'holiday Wednesday uses the weekend timetable'],
  ];
  for (const [date, want, label] of expect) {
    const created = await generateTripsForDate(date);
    created === want ? ok(`${date}: ${created} trips (${label})`) : bad(`${date}: got ${created}, want ${want}`);
  }
  const again = await generateTripsForDate('2026-07-06');
  again === 0 ? ok('re-generation is idempotent (0 new)') : bad(`re-gen created ${again}`);

  const { rows } = await writePool.query(
    "SELECT id FROM bus_trips WHERE service_date BETWEEN '2026-07-06' AND '2026-07-11'",
  );
  await cleanupTrips(rows.map((r) => r.id));
  await writePool.query("DELETE FROM holidays WHERE day = '2026-07-08'");
  console.log('  (generation fixtures cleaned)\n');
}

async function partB() {
  console.log('[B] lifecycle on a synthetic capacity-5 trip (time-warped, real worker)');

  // fixtures: schedule + trip departing in 75s, confirm @+25s, sweep @+50s
  const { rows: [sched] } = await writePool.query(
    `INSERT INTO bus_schedules (bus_no, origin, destination, departure_time, pattern, capacity, active)
     VALUES (99, 'LNMIIT', 'Test Gate', '23:59', 'weekday', 5, false) RETURNING id`,
  );
  const departureAt = new Date(Date.now() + 75_000);
  const { rows: [trip] } = await writePool.query(
    `INSERT INTO bus_trips (schedule_id, service_date, departure_at, capacity, status)
     VALUES ($1, CURRENT_DATE, $2, 5, 'open') RETURNING id`,
    [sched.id, departureAt],
  );
  const tripId = trip.id;
  await scheduleBusJob('confirm-phase', { tripId }, 25_000, `confirm-${tripId}`);
  await scheduleBusJob('auto-release', { tripId }, 50_000, `release-${tripId}`);
  await scheduleBusJob('depart-trip', { tripId }, 75_000, `depart-${tripId}`);
  console.log(`  trip ${tripId.slice(0, 8)}… departs in 75s`);

  // 9 campus riders + 1 outsider + 1 roll-less campus account
  const hash = await bcrypt.hash('Student@123', 10);
  const users = [];
  for (let i = 1; i <= 9; i += 1) {
    const { rows: [u] } = await writePool.query(
      `INSERT INTO users (email, password_hash, name, role, roll_number)
       VALUES ($1, $2, $3, 'user', $4) RETURNING id, email, name, roll_number AS roll`,
      [`s16u${i}-${tag}@lnmiit.ac.in`, hash, `Rider ${i}`, `S16R${i}${tag}`],
    );
    users.push({ ...u, token: signToken(u) });
  }
  const { rows: [outsider] } = await writePool.query(
    `INSERT INTO users (email, password_hash, name, role) VALUES ($1,$2,'Outsider','user')
     RETURNING id, email, name`,
    [`s16out-${tag}@gmail.com`, hash],
  );
  const { rows: [noRoll] } = await writePool.query(
    `INSERT INTO users (email, password_hash, name, role) VALUES ($1,$2,'No Roll','user')
     RETURNING id, email, name`,
    [`s16nr-${tag}@lnmiit.ac.in`, hash],
  );

  // gates
  const g1 = await api('POST', `/api/bus/trips/${tripId}/book`, signToken(outsider));
  g1.status === 403 ? ok('non-campus email -> 403') : bad(`outsider -> ${g1.status}`);
  const g2 = await api('POST', `/api/bus/trips/${tripId}/book`, signToken(noRoll));
  g2.status === 403 ? ok('campus email without roll number -> 403') : bad(`no-roll -> ${g2.status}`);

  // booking race: 9 parallel for 5 seats
  const race = await Promise.all(users.map((u) => api('POST', `/api/bus/trips/${tripId}/book`, u.token)));
  const wins = race.filter((r) => r.status === 201);
  const fulls = race.filter((r) => r.status === 409);
  wins.length === 5 && fulls.length === 4
    ? ok('9 parallel bookings -> exactly 5 seats assigned, 4 told "full"')
    : bad(`race: ${race.map((r) => r.status).join(',')}`);
  const winners = users.filter((_, i) => race[i].status === 201);
  const losers = users.filter((_, i) => race[i].status !== 201);

  const { rows: [cnt1] } = await writePool.query('SELECT booked_count FROM bus_trips WHERE id=$1', [tripId]);
  Number(cnt1.booked_count) === 5 ? ok('booked_count is exactly 5 (no over-booking)') : bad(`count=${cnt1.booked_count}`);

  const dup = await api('POST', `/api/bus/trips/${tripId}/book`, winners[0].token);
  dup.status === 409 ? ok('double-booking same trip -> 409') : bad(`dup -> ${dup.status}`);

  // waitlist: all 4 losers join (sequential -> deterministic FIFO order)
  for (const [i, u] of losers.entries()) {
    const w = await api('POST', `/api/bus/trips/${tripId}/waitlist`, u.token);
    if (!(w.status === 201 && w.json.position === i + 1)) bad(`waitlist join ${i} -> ${w.status} pos=${w.json?.position}`);
  }
  ok('4 losers joined the waitlist in FIFO positions 1-4');
  const dupW = await api('POST', `/api/bus/trips/${tripId}/waitlist`, losers[0].token);
  dupW.status === 409 ? ok('duplicate waitlist join -> 409') : bad(`dupW -> ${dupW.status}`);
  await api('DELETE', `/api/bus/trips/${tripId}/waitlist`, losers[3].token); // last one leaves

  const pub = await api('GET', `/api/bus/trips/${tripId}`);
  pub.json?.waitlist?.length === 3 && pub.json.waitlist[0].rollNumber
    ? ok(`waitlist is public with names+rolls (${pub.json.waitlist.map((w) => w.rollNumber).join(', ')})`)
    : bad(`public waitlist: ${JSON.stringify(pub.json?.waitlist)}`);

  // cancel -> FIFO head promoted. NOTE: the container computes confirmAt with
  // the PRODUCTION window (20 min), so on a 75s time-warped trip the confirm
  // phase is already in effect and the promotion lands directly as 'confirmed'.
  await api('DELETE', `/api/bus/trips/${tripId}/book`, winners[0].token);
  const { rows: [promo1] } = await writePool.query(
    `SELECT b.status, w.promoted_at FROM bus_bookings b
       JOIN bus_waitlist w ON w.trip_id = b.trip_id AND w.user_id = b.user_id
      WHERE b.trip_id=$1 AND b.user_id=$2`,
    [tripId, losers[0].id],
  );
  ['assigned', 'confirmed'].includes(promo1?.status) && promo1.promoted_at
    ? ok(`cancel -> FIFO head promoted with an active seat (${promo1.status})`)
    : bad(`promo1=${JSON.stringify(promo1)}`);

  // direct booking while others wait -> refused
  const jump = await api('POST', `/api/bus/trips/${tripId}/book`, signToken(noRoll)); // gate fires first; use a fresh camper
  const { rows: [camper] } = await writePool.query(
    `INSERT INTO users (email, password_hash, name, role, roll_number)
     VALUES ($1,$2,'Camper','user',$3) RETURNING id, email, name, roll_number AS roll`,
    [`s16c-${tag}@lnmiit.ac.in`, hash, `S16C${tag}`],
  );
  const jump2 = await api('POST', `/api/bus/trips/${tripId}/book`, signToken(camper));
  jump2.status === 409 && /waitlist/i.test(jump2.json?.error?.message || '')
    ? ok('queue-jump blocked while people are waiting -> 409')
    : bad(`jump -> ${jump2.status} ${JSON.stringify(jump2.json)}`);
  void jump;

  // confirm too early -> 409 (confirm window = T-25s here, we're ~T-50s)
  const early = await api('POST', `/api/bus/trips/${tripId}/confirm`, winners[1].token);
  // NOTE: container computes confirmAt with PRODUCTION window (20 min) -> always past for a 75s trip.
  // So 'early' may legitimately succeed there; assert only that it doesn't 5xx.
  early.status < 500 ? ok(`confirm pre-phase handled (${early.status})`) : bad(`early confirm -> ${early.status}`);

  // wait for confirm phase job (+25s)
  console.log('  …waiting for confirm phase (T-50s→T-25s)');
  await sleep(30_000);
  const { rows: [t1] } = await writePool.query('SELECT status FROM bus_trips WHERE id=$1', [tripId]);
  t1.status === 'confirming' ? ok('worker flipped trip to confirming at T-25s') : bad(`status=${t1.status}`);

  // winner2 confirms; winner3 declines -> next waitlisted promoted as confirmed
  const c2 = await api('POST', `/api/bus/trips/${tripId}/confirm`, winners[1].token);
  c2.status === 200 ? ok('rider confirms boarding -> 200') : bad(`confirm -> ${c2.status}`);
  await api('POST', `/api/bus/trips/${tripId}/decline`, winners[2].token);
  const { rows: [promo2] } = await writePool.query(
    'SELECT status FROM bus_bookings WHERE trip_id=$1 AND user_id=$2', [tripId, losers[1].id],
  );
  promo2?.status === 'confirmed'
    ? ok('decline -> next in line promoted directly to confirmed (post-T-20 rule)')
    : bad(`promo2=${promo2?.status}`);

  // wait for the auto-release sweep (+50s)
  console.log('  …waiting for the T-release sweep');
  await sleep(25_000);
  const { rows: sweep } = await writePool.query(
    `SELECT b.status, COUNT(*)::int AS n FROM bus_bookings b WHERE b.trip_id=$1 GROUP BY b.status ORDER BY b.status`,
    [tripId],
  );
  const byStatus = Object.fromEntries(sweep.map((r) => [r.status, r.n]));
  (byStatus.assigned || 0) === 0 ? ok(`sweep left zero 'assigned' rows (${JSON.stringify(byStatus)})`) : bad(`post-sweep: ${JSON.stringify(byStatus)}`);
  (byStatus.auto_released || 0) >= 2 ? ok(`${byStatus.auto_released} silent holders auto-released`) : bad(`auto_released=${byStatus.auto_released}`);

  const { rows: [ns] } = await writePool.query(
    'SELECT no_show_count FROM users WHERE id=$1', [winners[3].id],
  );
  Number(ns.no_show_count) >= 1 ? ok('silent holder no_show_count incremented') : bad(`no_show=${ns.no_show_count}`);

  const { rows: [promo3] } = await writePool.query(
    'SELECT status FROM bus_bookings WHERE trip_id=$1 AND user_id=$2', [tripId, losers[2].id],
  );
  promo3?.status === 'confirmed' ? ok('sweep promoted the remaining waiter as confirmed') : bad(`promo3=${promo3?.status}`);

  const { rows: [cnt2] } = await writePool.query(
    `SELECT t.booked_count, (SELECT COUNT(*)::int FROM bus_bookings b WHERE b.trip_id=t.id AND b.status='confirmed') AS confirmed
       FROM bus_trips t WHERE t.id=$1`, [tripId],
  );
  Number(cnt2.booked_count) === Number(cnt2.confirmed)
    ? ok(`booked_count (${cnt2.booked_count}) == confirmed riders — counter never drifted`)
    : bad(`count=${cnt2.booked_count} confirmed=${cnt2.confirmed}`);

  // departure (+75s)
  console.log('  …waiting for departure');
  await sleep(28_000);
  const { rows: [t2] } = await writePool.query('SELECT status FROM bus_trips WHERE id=$1', [tripId]);
  t2.status === 'departed' ? ok('trip departed on time') : bad(`status=${t2.status}`);
  const late = await api('POST', `/api/bus/trips/${tripId}/book`, winners[0].token);
  late.status === 409 ? ok('booking a departed trip -> 409') : bad(`late -> ${late.status}`);

  // cleanup
  await cleanupTrips([tripId]);
  await writePool.query('DELETE FROM bus_schedules WHERE id=$1', [sched.id]);
  await writePool.query("DELETE FROM users WHERE email LIKE $1", [`s16%-${tag}@%`]);
  console.log('  (lifecycle fixtures cleaned)');
}

async function main() {
  await partA();
  await partB();
  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  await Promise.allSettled([closeQueues(), closeRedis(), closePools()]);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error('verify_s16 fatal:', err);
  try { await closeQueues(); await closeRedis(); await closePools(); } catch {}
  process.exit(1);
});
