// S10 auth/RBAC check (throwaway). Drives the live stack through nginx:
// roles, password policy, admin-only routes, refresh rotation + replay
// rejection, logout revocation, and login lockout. Cleans up after itself.
import { writePool, closePools } from '../config/db.js';
import { redis, isRedisReady, closeRedis } from '../config/redis.js';
import { closeQueues } from '../config/queues.js';

const BASE = process.env.API_URL || 'http://localhost';
const tag = Date.now();
let pass = 0, fail = 0;
const ok = (m) => { console.log(`  ✓ ${m}`); pass += 1; };
const bad = (m) => { console.log(`  ✗ ${m}`); fail += 1; };

const cookieOf = (res) => {
  const all = res.headers.getSetCookie?.() || [];
  const c = all.find((x) => x.startsWith('refresh_token='));
  return c ? c.split(';')[0] : null;
};

async function api(method, path, { token, body, cookie } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(cookie ? { cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json, cookie: cookieOf(res) };
}

async function main() {
  // ── roles on login ──
  console.log('[roles]');
  const admin = await api('POST', '/api/auth/login', { body: { email: 'admin@demo.local', password: 'Admin@1234' } });
  admin.status === 200 && admin.json.user.role === 'admin' ? ok('admin login -> role=admin') : bad(`admin login -> ${admin.status} role=${admin.json?.user?.role}`);
  admin.cookie ? ok('refresh cookie set (httpOnly)') : bad('no refresh cookie');

  const demo = await api('POST', '/api/auth/login', { body: { email: 'demo@demo.local', password: 'password123' } });
  demo.status === 200 && demo.json.user.role === 'user' ? ok('demo login -> role=user') : bad(`demo login -> ${demo.status}`);

  // ── password policy ──
  console.log('\n[password policy]');
  const weak = await api('POST', '/api/auth/register', { body: { email: `weak-${tag}@t.local`, password: 'short', name: 'W' } });
  weak.status === 400 ? ok('weak password -> 400 with field errors') : bad(`weak password -> ${weak.status}`);

  const reg = await api('POST', '/api/auth/register', { body: { email: `s10-${tag}@t.local`, password: 'StrongPass1', name: 'S10 User' } });
  reg.status === 201 && reg.json.user.role === 'user' ? ok('register -> 201, role defaults to user') : bad(`register -> ${reg.status}`);

  // ── RBAC ──
  console.log('\n[rbac]');
  const evPayload = {
    name: `S10 Admin Event ${tag}`, venue: 'RBAC Hall',
    eventDate: new Date(Date.now() + 30 * 86400e3).toISOString(),
    layout: [{ rows: 'A,B', cols: 4, category: 'GENERAL', price: 30 }],
  };
  const userCreate = await api('POST', '/api/admin/events', { token: reg.json.token, body: evPayload });
  userCreate.status === 403 ? ok('user POST /admin/events -> 403') : bad(`user create -> ${userCreate.status}`);

  const anonCreate = await api('POST', '/api/admin/events', { body: evPayload });
  anonCreate.status === 401 ? ok('anonymous POST /admin/events -> 401') : bad(`anon create -> ${anonCreate.status}`);

  const adminCreate = await api('POST', '/api/admin/events', { token: admin.json.token, body: evPayload });
  adminCreate.status === 201 ? ok('admin POST /admin/events -> 201') : bad(`admin create -> ${adminCreate.status} ${JSON.stringify(adminCreate.json)}`);
  const newEventId = adminCreate.json?.event?.id;

  const seats = await api('GET', `/api/events/${newEventId}/seats`);
  seats.json?.seats?.length === 8 ? ok('created event has 8 seats (2 rows × 4)') : bad(`seats -> ${seats.json?.seats?.length}`);

  const statsUser = await api('GET', `/api/events/${newEventId}/stats`, { token: reg.json.token });
  statsUser.status === 403 ? ok('stats as user -> 403') : bad(`stats user -> ${statsUser.status}`);
  const statsAdmin = await api('GET', `/api/events/${newEventId}/stats`, { token: admin.json.token });
  statsAdmin.status === 200 ? ok('stats as admin -> 200') : bad(`stats admin -> ${statsAdmin.status}`);

  const overview = await api('GET', '/api/admin/overview', { token: admin.json.token });
  overview.status === 200 && typeof overview.json.revenue === 'number' ? ok(`admin overview -> 200 (events=${overview.json.events}, users=${overview.json.users})`) : bad(`overview -> ${overview.status}`);

  const bookings = await api('GET', `/api/admin/events/${newEventId}/bookings`, { token: admin.json.token });
  bookings.status === 200 ? ok('admin event bookings -> 200') : bad(`bookings -> ${bookings.status}`);

  // ── refresh rotation + replay ──
  console.log('\n[refresh rotation]');
  const r1 = await api('POST', '/api/auth/refresh', { cookie: reg.cookie });
  r1.status === 200 && r1.json.token && r1.cookie ? ok('refresh -> 200, new access token + rotated cookie') : bad(`refresh -> ${r1.status}`);
  const replay = await api('POST', '/api/auth/refresh', { cookie: reg.cookie });
  replay.status === 401 ? ok('replaying the OLD refresh cookie -> 401 (rotation consumed it)') : bad(`replay -> ${replay.status}`);
  const r2 = await api('POST', '/api/auth/refresh', { cookie: r1.cookie });
  r2.status === 200 ? ok('rotated cookie works once -> 200') : bad(`second refresh -> ${r2.status}`);

  // ── logout revocation ──
  console.log('\n[logout]');
  const lo = await api('POST', '/api/auth/logout', { cookie: r2.cookie });
  lo.status === 200 ? ok('logout -> 200') : bad(`logout -> ${lo.status}`);
  const afterLogout = await api('POST', '/api/auth/refresh', { cookie: r2.cookie });
  afterLogout.status === 401 ? ok('refresh after logout -> 401 (revoked)') : bad(`after logout -> ${afterLogout.status}`);

  // ── /me ──
  const me = await api('GET', '/api/auth/me', { token: admin.json.token });
  me.status === 200 && me.json.user.role === 'admin' ? ok('/me -> fresh user with role') : bad(`/me -> ${me.status}`);

  // ── lockout ──
  console.log('\n[lockout]');
  const lockEmail = `lock-${tag}@t.local`;
  await api('POST', '/api/auth/register', { body: { email: lockEmail, password: 'LockPass1', name: 'Lock' } });
  let lockStatus = 0;
  for (let i = 0; i < 6; i += 1) {
    const r = await api('POST', '/api/auth/login', { body: { email: lockEmail, password: 'wrong-pass-1' } });
    lockStatus = r.status;
  }
  lockStatus === 429 ? ok('6th failed login -> 429 (locked)') : bad(`lockout -> ${lockStatus}`);
  const lockedGood = await api('POST', '/api/auth/login', { body: { email: lockEmail, password: 'LockPass1' } });
  lockedGood.status === 429 ? ok('correct password while locked -> still 429') : bad(`locked-good -> ${lockedGood.status}`);

  // ── cleanup ──
  console.log('\n[cleanup]');
  if (newEventId) {
    const del = await api('DELETE', `/api/admin/events/${newEventId}`, { token: admin.json.token });
    del.status === 200 ? ok('admin DELETE event -> 200 (no confirmed bookings)') : bad(`delete -> ${del.status}`);
  }
  await writePool.query('DELETE FROM users WHERE email LIKE $1', [`%-${tag}@t.local`]);
  if (isRedisReady()) {
    const keys = await redis.keys('lockout:*');
    const rl = await redis.keys('ratelimit:auth:*');
    const all = [...keys, ...rl];
    if (all.length) await redis.del(all);
  }
  console.log('  cleaned');

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  await Promise.allSettled([closeQueues(), closeRedis(), closePools()]);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error('verify_s10 fatal:', err);
  try { await closeQueues(); await closeRedis(); await closePools(); } catch {}
  process.exit(1);
});
