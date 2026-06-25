// Load-test correctness check. After a k6 run, confirms the seat locking held up
// under load: confirmed bookings must never exceed capacity, and the three
// independent records of a sale (booked seats / confirmed reservations / payment
// rows) must agree. Reads the PRIMARY for an accurate, lag-free snapshot. Exits
// non-zero on any violation so it can gate a CI/load pipeline.
import { writePool, closePools } from '../config/db.js';

const EVENT_NAME = 'LOADTEST — Mega Event';

async function main() {
  const { rows: evRows } = await writePool.query(
    'SELECT id, total_seats FROM events WHERE name = $1',
    [EVENT_NAME],
  );
  if (!evRows.length) {
    console.error(`[loadtest:verify] no "${EVENT_NAME}" found — run loadtest:prep first.`);
    process.exit(1);
  }
  const { id: eventId, total_seats: capacity } = evRows[0];

  const { rows: [s] } = await writePool.query(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'booked')::int    AS booked,
       COUNT(*) FILTER (WHERE status = 'held')::int      AS held,
       COUNT(*) FILTER (WHERE status = 'available')::int AS available
     FROM seats WHERE event_id = $1`,
    [eventId],
  );
  const { rows: [r] } = await writePool.query(
    "SELECT COUNT(*)::int AS confirmed FROM reservations WHERE event_id = $1 AND status = 'confirmed'",
    [eventId],
  );
  const { rows: [p] } = await writePool.query(
    `SELECT COUNT(*)::int AS payments, COALESCE(SUM(amount), 0)::numeric AS revenue
       FROM payments WHERE reservation_id IN (SELECT id FROM reservations WHERE event_id = $1)`,
    [eventId],
  );

  console.log('── load-test correctness ──');
  console.log(`  event     : ${eventId}`);
  console.log(`  capacity  : ${capacity}`);
  console.log(`  booked    : ${s.booked}   held: ${s.held}   available: ${s.available}`);
  console.log(`  confirmed : ${r.confirmed}   payments: ${p.payments}   revenue: ₹${p.revenue}`);

  const problems = [];
  if (r.confirmed > capacity) problems.push(`OVERSOLD: ${r.confirmed} confirmed > ${capacity} capacity`);
  if (s.booked !== r.confirmed) problems.push(`booked seats (${s.booked}) != confirmed reservations (${r.confirmed})`);
  if (p.payments !== r.confirmed) problems.push(`payment rows (${p.payments}) != confirmed reservations (${r.confirmed})`);
  if (s.booked + s.held + s.available !== capacity) {
    problems.push(`seat states (${s.booked + s.held + s.available}) != capacity (${capacity})`);
  }

  await closePools();
  if (problems.length) {
    console.error('\n❌ FAILED:');
    for (const m of problems) console.error('   - ' + m);
    process.exit(1);
  }
  console.log('\n✅ PASS — no oversell, all sale records agree.');
}

main().catch(async (err) => {
  console.error('[loadtest:verify] failed:', err);
  await closePools().catch(() => {});
  process.exit(1);
});
