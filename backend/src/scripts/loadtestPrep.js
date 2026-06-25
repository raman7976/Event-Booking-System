// Load-test prep. Creates one big dedicated event + a pool of users, mints an
// access token for each user (reusing signAccessToken so k6 can skip the login
// endpoint and its 20/min/IP limiter), and writes everything k6 needs to
// loadtest/data.json. Safe to re-run: it wipes the previous load-test event and
// its users first. Targets the PRIMARY.
//
// Env knobs: LT_SEATS (default 5000), LT_USERS (default 2000).
// IMPORTANT: run with the SAME JWT_SECRET as the running stack, or the tokens
// it signs won't verify against the API.
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { writePool, withTransaction, closePools } from '../config/db.js';
import { signAccessToken } from '../services/authService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, '../../../loadtest');
const OUT_FILE = path.join(OUT_DIR, 'data.json');

const int = (v, d) => (Number.isFinite(parseInt(v, 10)) ? parseInt(v, 10) : d);

const EVENT_NAME = 'LOADTEST — Mega Event';
const USER_EMAIL_LIKE = 'lt-user-%@loadtest.local';
const SEATS = int(process.env.LT_SEATS, 5000);
const USERS = int(process.env.LT_USERS, 2000);
const SEATS_PER_ROW = 50; // row_label is VARCHAR(5): 'R1'..'R100' fits

async function wipePrevious(client) {
  // Remove the prior load-test event (FK-safe order: payments -> reservations ->
  // waitlist -> seats -> event), then its users.
  const { rows: prior } = await client.query('SELECT id FROM events WHERE name = $1', [EVENT_NAME]);
  for (const e of prior) {
    await client.query(
      'DELETE FROM payments WHERE reservation_id IN (SELECT id FROM reservations WHERE event_id = $1)',
      [e.id],
    );
    await client.query('DELETE FROM reservations WHERE event_id = $1', [e.id]);
    await client.query('DELETE FROM waitlist WHERE event_id = $1', [e.id]);
    await client.query('DELETE FROM seats WHERE event_id = $1', [e.id]);
    await client.query('DELETE FROM events WHERE id = $1', [e.id]);
  }
  // Any leftover rows owned by previous load-test users, then the users.
  await client.query(
    'DELETE FROM payments WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [USER_EMAIL_LIKE],
  );
  await client.query(
    'DELETE FROM reservations WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [USER_EMAIL_LIKE],
  );
  await client.query(
    'DELETE FROM waitlist WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [USER_EMAIL_LIKE],
  );
  await client.query('DELETE FROM users WHERE email LIKE $1', [USER_EMAIL_LIKE]);
}

async function createEvent(client) {
  const { rows: [ev] } = await client.query(
    `INSERT INTO events (name, venue, event_date, total_seats, available_seats, base_price)
     VALUES ($1, 'Load Test Arena', NOW() + make_interval(days => 7), $2, $2, 100) RETURNING id`,
    [EVENT_NAME, SEATS],
  );
  // Bulk-insert all seats in one round trip via UNNEST.
  const rowLabels = [];
  const seatNums = [];
  for (let i = 0; i < SEATS; i += 1) {
    rowLabels.push(`R${Math.floor(i / SEATS_PER_ROW) + 1}`);
    seatNums.push((i % SEATS_PER_ROW) + 1);
  }
  await client.query(
    `INSERT INTO seats (event_id, row_label, seat_number, category, price, status)
     SELECT $1, r, n, 'GENERAL', 100, 'available'
       FROM unnest($2::text[], $3::int[]) AS t(r, n)`,
    [ev.id, rowLabels, seatNums],
  );
  const { rows: seats } = await client.query('SELECT id FROM seats WHERE event_id = $1', [ev.id]);
  return { eventId: ev.id, seatIds: seats.map((s) => s.id) };
}

async function createUsers(client) {
  // One hash reused for everyone — these accounts never log in (we mint tokens),
  // the hash only satisfies the NOT NULL column.
  const hash = await bcrypt.hash('loadtest', 8);
  const emails = Array.from({ length: USERS }, (_, i) => `lt-user-${i}@loadtest.local`);
  const { rows } = await client.query(
    `INSERT INTO users (email, password_hash, name, role)
     SELECT e, $2, 'LoadTest User', 'user' FROM unnest($1::text[]) AS u(e)
     RETURNING id, email, name, role, roll_number`,
    [emails, hash],
  );
  return rows.map((u) => signAccessToken(u));
}

async function main() {
  const t0 = Date.now();
  const { eventId, seatIds, tokens } = await withTransaction(async (client) => {
    await wipePrevious(client);
    const { eventId: id, seatIds: ids } = await createEvent(client);
    const toks = await createUsers(client);
    return { eventId: id, seatIds: ids, tokens: toks };
  });

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_FILE, JSON.stringify({ eventId, capacity: SEATS, seatIds, tokens }));

  console.log('[loadtest:prep] done in', Date.now() - t0, 'ms');
  console.log(`  event   : ${eventId} ("${EVENT_NAME}")`);
  console.log(`  seats   : ${seatIds.length}`);
  console.log(`  users   : ${tokens.length} (access tokens minted)`);
  console.log(`  written : ${OUT_FILE}`);
  console.log('  NOTE: tokens were signed with this run\'s JWT_SECRET — it must match the API.');
  await closePools();
}

main().catch(async (err) => {
  console.error('[loadtest:prep] failed:', err);
  await closePools().catch(() => {});
  process.exit(1);
});
