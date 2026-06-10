// S7 check (throwaway). Exercises the Smart Seat Recommender heuristic across
// preferences/budget, the exclusion of held seats, and (if API_URL is set) the
// HTTP route. With no GEMINI_API_KEY -> source 'heuristic'; with a bogus key the
// Gemini call fails and it still falls back to 'heuristic'. Cleans up its data.
import { writePool, readPool, closePools } from '../config/db.js';
import { redis, isRedisReady, closeRedis } from '../config/redis.js';
import { closeQueues } from '../config/queues.js';
import { config } from '../config/env.js';
import { recommendSeats } from '../services/seatService.js';

const API_URL = process.env.API_URL || '';
let pass = 0, fail = 0;
const ok = (m) => { console.log(`  ✓ ${m}`); pass += 1; };
const bad = (m) => { console.log(`  ✗ ${m}`); fail += 1; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const consecutive = (seats) => seats.slice().sort((a, b) => a.number - b.number).every((s, i, a) => i === 0 || s.number === a[i - 1].number + 1);

async function main() {
  await (async () => { const t = Date.now(); while (!isRedisReady() && Date.now() - t < 4000) await sleep(100); })();
  console.log(`gemini key set: ${Boolean(config.gemini.apiKey)} | model: ${config.gemini.model}`);

  // fixtures: row A (VIP $200) A1..A5, row B (GENERAL $80) B1..B5
  const { rows: [ev] } = await writePool.query(
    `INSERT INTO events(name,venue,event_date,total_seats,available_seats,base_price)
     VALUES('S7 Show','Hall',NOW()+interval '12 day',10,10,100) RETURNING id`);
  const idByLabel = {};
  for (const [row, price] of [['A', 200], ['B', 80]]) {
    for (let n = 1; n <= 5; n += 1) {
      const { rows: [s] } = await writePool.query(
        `INSERT INTO seats(event_id,row_label,seat_number,category,price,status)
         VALUES($1,$2,$3,$4,$5,'available') RETURNING id`,
        [ev.id, row, n, row === 'A' ? 'VIP' : 'GENERAL', price]);
      idByLabel[`${row}${n}`] = s.id;
    }
  }
  // wait for the seats to reach the replica (recommender reads the replica)
  const replicated = await (async () => { const t = Date.now(); while (Date.now() - t < 6000) { const { rows } = await readPool.query('SELECT COUNT(*)::int c FROM seats WHERE event_id=$1', [ev.id]); if (rows[0].c === 10) return true; await sleep(200); } return false; })();
  console.log(`fixtures: event=${ev.id} (10 seats; replicated=${replicated})`);

  // T1: together x3, budget 300 -> 3 consecutive GENERAL (row B, 3*80=240)
  console.log('\n[T1] together, groupSize=3, budget=300');
  const r1 = await recommendSeats({ eventId: ev.id, groupSize: 3, maxBudget: 300, preferences: ['together'] });
  const sameRow1 = r1.seats.length === 3 && r1.seats.every((s) => s.row === r1.seats[0].row);
  (r1.seats.length === 3 && sameRow1 && consecutive(r1.seats)) ? ok(`3 consecutive seats in row ${r1.seats[0]?.row} (${r1.source})`) : bad(`T1 -> ${JSON.stringify(r1.recommendedSeatIds)}`);
  (r1.seats.reduce((a, s) => a + s.price, 0) <= 300) ? ok('within budget 300') : bad('over budget');
  console.log(`     reason: ${r1.reason}`);

  // T2: front + together x2 -> row A consecutive (A1,A2)
  console.log('\n[T2] front+together, groupSize=2, budget=500');
  const r2 = await recommendSeats({ eventId: ev.id, groupSize: 2, maxBudget: 500, preferences: ['front', 'together'] });
  (r2.seats.length === 2 && r2.seats.every((s) => s.row === 'A') && consecutive(r2.seats)) ? ok(`front row A consecutive: ${r2.seats.map((s) => s.row + s.number).join(',')}`) : bad(`T2 -> ${JSON.stringify(r2.seats?.map((s) => s.row + s.number))}`);

  // T3: back x2 -> row B
  console.log('\n[T3] back, groupSize=2');
  const r3 = await recommendSeats({ eventId: ev.id, groupSize: 2, preferences: ['back'] });
  (r3.seats.length === 2 && r3.seats.every((s) => s.row === 'B')) ? ok(`back picked row B: ${r3.seats.map((s) => s.row + s.number).join(',')}`) : bad(`T3 -> ${JSON.stringify(r3.seats?.map((s) => s.row + s.number))}`);

  // T4: budget too low for 4
  console.log('\n[T4] groupSize=4, budget=100 (cannot fit)');
  const r4 = await recommendSeats({ eventId: ev.id, groupSize: 4, maxBudget: 100, preferences: [] });
  (r4.recommendedSeatIds.length < 4) ? ok(`returned ${r4.recommendedSeatIds.length} (<4) with explanation`) : bad(`T4 -> ${r4.recommendedSeatIds.length}`);

  // T5: held seat is excluded
  console.log('\n[T5] exclusion of a held seat');
  if (isRedisReady()) {
    await redis.set(`seat:${ev.id}:${idByLabel.A1}`, 'someuser:tok', 'EX', 60);
    const r5 = await recommendSeats({ eventId: ev.id, groupSize: 2, maxBudget: 500, preferences: ['front', 'together'] });
    (!r5.recommendedSeatIds.includes(idByLabel.A1)) ? ok(`held A1 excluded; picked ${r5.seats.map((s) => s.row + s.number).join(',')}`) : bad('held A1 was recommended');
    await redis.del(`seat:${ev.id}:${idByLabel.A1}`);
  } else {
    console.log('  (redis down — skipped)');
  }

  // source should be heuristic (no real key here; bogus key must fall back too)
  (r1.source === 'heuristic') ? ok(`source=heuristic (gemini ${config.gemini.apiKey ? 'attempted+fell back' : 'not configured'})`) : bad(`source=${r1.source}`);

  // HTTP route (optional)
  if (API_URL) {
    console.log('\n[HTTP] POST /api/seats/recommend');
    const res = await fetch(`${API_URL}/api/seats/recommend`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ eventId: ev.id, groupSize: 3, maxBudget: 300, preferences: ['together'] }),
    });
    const body = await res.json().catch(() => ({}));
    (res.status === 200 && Array.isArray(body.recommendedSeatIds) && body.recommendedSeatIds.length === 3)
      ? ok(`route 200, ${body.recommendedSeatIds.length} seats (${body.source})`)
      : bad(`route -> ${res.status} ${JSON.stringify(body)}`);
  }

  // cleanup
  console.log('\n[cleanup]');
  await writePool.query('DELETE FROM seats WHERE event_id=$1', [ev.id]);
  await writePool.query('DELETE FROM events WHERE id=$1', [ev.id]);
  if (isRedisReady()) { const k = await redis.keys(`seat:${ev.id}:*`); if (k.length) await redis.del(k); await redis.del(`event:${ev.id}:seats`); }
  console.log('  cleaned');

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  await Promise.allSettled([closeQueues(), closeRedis(), closePools()]);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (err) => { console.error('verify_s7 fatal:', err); try { await closeQueues(); await closeRedis(); await closePools(); } catch {} process.exit(1); });
