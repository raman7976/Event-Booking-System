// S15 check (throwaway): bus schema + seeds + roll-number auth + campus gates.
// Runs against the live stack through nginx + direct DB checks.
import { writePool, readPool, closePools } from '../config/db.js';
import { closeRedis } from '../config/redis.js';
import { closeQueues } from '../config/queues.js';
import jwt from 'jsonwebtoken';
import { config } from '../config/env.js';
import { requireCampusEmail, requireRollNumber } from '../middleware/auth.js';

const BASE = process.env.API_URL || 'http://localhost';
const tag = Date.now();
let pass = 0, fail = 0;
const ok = (m) => { console.log(`  ✓ ${m}`); pass += 1; };
const bad = (m) => { console.log(`  ✗ ${m}`); fail += 1; };

async function api(method, path, { token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json };
}

// Run an express middleware against a fake req; resolves with the error (or null).
const runMw = (mw, user) =>
  new Promise((resolve) => mw({ user }, {}, (err) => resolve(err || null)));

async function main() {
  // ── schema + seeds ──
  console.log('[schema & seeds]');
  const { rows: tables } = await readPool.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema='public' AND table_name IN ('bus_schedules','bus_trips','bus_bookings','bus_waitlist','holidays')`,
  );
  tables.length === 5 ? ok('5 bus tables exist (visible on the replica)') : bad(`tables=${tables.length}`);

  const { rows: [cnt] } = await readPool.query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE pattern='weekday')::int AS wd,
            COUNT(*) FILTER (WHERE pattern='weekend_holiday')::int AS we,
            COUNT(*) FILTER (WHERE weekday_only IS NOT NULL)::int AS specific,
            COUNT(*) FILTER (WHERE capacity = 40)::int AS cap40
       FROM bus_schedules`,
  );
  cnt.total === 32 && cnt.wd === 18 && cnt.we === 14
    ? ok(`timetable seeded: 32 rows (18 weekday / 14 weekend-holiday)`)
    : bad(`timetable rows: ${JSON.stringify(cnt)}`);
  cnt.specific === 4 ? ok('4 single-weekday rows (2× Monday, 2× Friday)') : bad(`specific=${cnt.specific}`);
  cnt.cap40 === 32 ? ok('default capacity 40 on every row') : bad(`cap40=${cnt.cap40}`);

  const { rows: campus } = await readPool.query(
    "SELECT email, role, roll_number FROM users WHERE email LIKE '%@lnmiit.ac.in' ORDER BY email",
  );
  campus.length >= 3 && campus.some((u) => u.roll_number === '23UCS101')
    ? ok(`campus accounts seeded (${campus.map((u) => u.email).join(', ')})`)
    : bad(`campus accounts: ${JSON.stringify(campus)}`);

  // ── auth: register with roll number ──
  console.log('\n[roll-number auth]');
  const reg = await api('POST', '/api/auth/register', {
    body: { email: `s15-${tag}@lnmiit.ac.in`, password: 'BusRider1', name: 'S15 Rider', rollNumber: `99zzz${String(tag).slice(-4)}` },
  });
  const claims = reg.json?.token ? jwt.decode(reg.json.token) : {};
  reg.status === 201 && reg.json.user.rollNumber === `99ZZZ${String(tag).slice(-4)}`
    ? ok('register with rollNumber -> 201, uppercased')
    : bad(`register -> ${reg.status} ${JSON.stringify(reg.json?.user)}`);
  claims.roll === `99ZZZ${String(tag).slice(-4)}` ? ok('access token carries roll claim') : bad(`claims=${JSON.stringify(claims)}`);

  const dup = await api('POST', '/api/auth/register', {
    body: { email: `s15b-${tag}@lnmiit.ac.in`, password: 'BusRider1', name: 'Dup', rollNumber: `99zzz${String(tag).slice(-4)}` },
  });
  dup.status === 409 ? ok('duplicate roll number -> 409') : bad(`dup roll -> ${dup.status}`);

  // ── PATCH /me: set-once ──
  const reg2 = await api('POST', '/api/auth/register', {
    body: { email: `s15c-${tag}@lnmiit.ac.in`, password: 'BusRider1', name: 'NoRoll' },
  });
  const patch = await api('PATCH', '/api/auth/me', { token: reg2.json.token, body: { rollNumber: `88yyy${String(tag).slice(-4)}` } });
  const patchedClaims = patch.json?.token ? jwt.decode(patch.json.token) : {};
  patch.status === 200 && patchedClaims.roll === `88YYY${String(tag).slice(-4)}`
    ? ok('PATCH /me sets roll + returns fresh token with claim')
    : bad(`patch -> ${patch.status}`);
  const patchAgain = await api('PATCH', '/api/auth/me', { token: patch.json.token, body: { rollNumber: 'OTHER123' } });
  patchAgain.status === 409 ? ok('roll number is set-once -> second PATCH 409') : bad(`re-patch -> ${patchAgain.status}`);

  // ── campus gates (middleware-level until bus routes land in S16) ──
  console.log('\n[campus gates]');
  const outsider = await runMw(requireCampusEmail, { email: 'someone@gmail.com' });
  outsider?.statusCode === 403 ? ok(`non-@${config.bus.emailDomain} email -> 403 (${outsider.message.slice(0, 40)}…)`) : bad(`outsider -> ${outsider?.statusCode}`);
  const insider = await runMw(requireCampusEmail, { email: `x@${config.bus.emailDomain}` });
  insider === null ? ok('campus email passes the gate') : bad(`insider -> ${insider?.statusCode}`);
  const noRoll = await runMw(requireRollNumber, { email: 'x@lnmiit.ac.in', rollNumber: null });
  noRoll?.statusCode === 403 ? ok('missing roll number -> 403 with guidance') : bad(`noRoll -> ${noRoll?.statusCode}`);
  const hasRoll = await runMw(requireRollNumber, { rollNumber: '23UCS101' });
  hasRoll === null ? ok('roll number present passes the gate') : bad(`hasRoll -> ${hasRoll?.statusCode}`);

  // ── campus login ──
  const login = await api('POST', '/api/auth/login', { body: { email: '23ucs101@lnmiit.ac.in', password: 'Student@123' } });
  login.status === 200 && login.json.user.rollNumber === '23UCS101'
    ? ok('seeded campus student logs in, roll on profile')
    : bad(`campus login -> ${login.status}`);

  // ── cleanup ──
  await writePool.query('DELETE FROM users WHERE email LIKE $1', [`s15%-${tag}@lnmiit.ac.in`]);
  console.log('\n  cleaned');

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  await Promise.allSettled([closeQueues(), closeRedis(), closePools()]);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error('verify_s15 fatal:', err);
  try { await closeQueues(); await closeRedis(); await closePools(); } catch {}
  process.exit(1);
});
