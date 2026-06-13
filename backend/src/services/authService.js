// Authentication core: short-lived access tokens + rotating refresh tokens.
//
//   access token   JWT, 15 min, carries { sub, email, name, role }; kept in
//                  memory on the client (never localStorage).
//   refresh token  JWT, 7 days, carries a one-time id (jti). The jti is stored
//                  in Redis (refresh:{jti} -> userId). Every /refresh consumes
//                  the old jti and issues a new one (rotation); presenting a
//                  consumed/unknown jti is rejected — stolen-token replay dies
//                  after the first legitimate refresh.
//   lockout        5 failed logins per email per 15 min -> 429.
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { redis, isRedisReady } from '../config/redis.js';
import { writePool } from '../config/db.js';
import { config } from '../config/env.js';
import { Errors } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

const refreshKey = (jti) => `refresh:${jti}`;
const lockKey = (email) => `lockout:${email.toLowerCase()}`;
const MAX_FAILED_LOGINS = 5;
const LOCK_WINDOW_SECONDS = 900; // 15 min

export const publicUser = (u) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  role: u.role,
  rollNumber: u.roll_number || null,
  noShowCount: u.no_show_count,
});

// LNMIIT student addresses embed the roll number as the local part
// (23ucs689@lnmiit.ac.in -> 23UCS689). The shape guard keeps staff addresses
// (admin@, transport.office@) from deriving a bogus roll.
const ROLL_LOCAL_RE = /^\d{2}[a-z]{2,4}\d{1,4}$/i;
export function deriveRollFromEmail(email) {
  const [local = '', domain = ''] = String(email).toLowerCase().split('@');
  if (domain !== config.bus.emailDomain) return null;
  return ROLL_LOCAL_RE.test(local) ? local.toUpperCase() : null;
}

export function signAccessToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      roll: user.roll_number || null,
    },
    config.jwt.secret,
    { expiresIn: config.jwt.accessTtl },
  );
}

/**
 * Issue a refresh token whose jti is registered in Redis. If Redis is down we
 * issue no refresh token at all — the session simply lasts one access-token
 * lifetime instead of silently granting an unrevocable 7-day credential.
 */
export async function issueRefreshToken(user) {
  if (!isRedisReady()) {
    logger.warn('[auth] redis down — refresh token not issued');
    return null;
  }
  const jti = crypto.randomUUID();
  try {
    await redis.set(
      refreshKey(jti),
      JSON.stringify({ userId: user.id }),
      'EX',
      config.jwt.refreshTtlDays * 86400,
    );
  } catch (err) {
    logger.warn('[auth] refresh store failed:', err.message);
    return null;
  }
  return jwt.sign({ sub: user.id, jti, type: 'refresh' }, config.jwt.secret, {
    expiresIn: `${config.jwt.refreshTtlDays}d`,
  });
}

/**
 * Validate + consume a refresh token (rotation). Returns the fresh user row
 * (so role/name changes take effect on the next refresh). Throws 401 on any
 * problem: bad signature, wrong type, revoked, or already-used jti.
 */
export async function rotateRefreshToken(refreshJwt) {
  let payload;
  try {
    payload = jwt.verify(refreshJwt, config.jwt.secret);
  } catch {
    throw Errors.unauthorized('Invalid or expired refresh token');
  }
  if (payload.type !== 'refresh' || !payload.jti) {
    throw Errors.unauthorized('Invalid refresh token');
  }
  if (!isRedisReady()) throw Errors.unauthorized('Session store unavailable, please log in again');

  // GETDEL = atomic consume; a second use of the same jti gets null.
  const stored = await redis.getdel(refreshKey(payload.jti));
  if (!stored) throw Errors.unauthorized('Refresh token revoked or already used');

  const { rows } = await writePool.query(
    'SELECT id, email, name, role, roll_number, no_show_count FROM users WHERE id = $1',
    [payload.sub],
  );
  if (!rows.length) throw Errors.unauthorized('User no longer exists');
  return rows[0];
}

/** Best-effort revoke (logout). Never throws. */
export async function revokeRefreshToken(refreshJwt) {
  try {
    const payload = jwt.verify(refreshJwt, config.jwt.secret, { ignoreExpiration: true });
    if (payload.jti && isRedisReady()) await redis.del(refreshKey(payload.jti));
  } catch {
    /* nothing to revoke */
  }
}

// ── Login lockout ──
export async function assertNotLocked(email) {
  if (!isRedisReady()) return;
  try {
    const count = Number(await redis.get(lockKey(email))) || 0;
    if (count >= MAX_FAILED_LOGINS) {
      throw Errors.rateLimited('Too many failed logins — account locked for 15 minutes');
    }
  } catch (err) {
    if (err.statusCode) throw err;
    logger.warn('[auth] lockout check failed:', err.message);
  }
}

export async function recordLoginFailure(email) {
  if (!isRedisReady()) return;
  try {
    const key = lockKey(email);
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, LOCK_WINDOW_SECONDS);
  } catch (err) {
    logger.warn('[auth] lockout record failed:', err.message);
  }
}

export async function clearLoginFailures(email) {
  if (!isRedisReady()) return;
  try {
    await redis.del(lockKey(email));
  } catch {
    /* best effort */
  }
}

// ── Refresh cookie helpers (httpOnly, path-scoped to the auth endpoints) ──
export const REFRESH_COOKIE = 'refresh_token';
const cookieOpts = () => {
  const sameSite = config.cookieSameSite; // 'lax' (same-origin) | 'none' (cross-site)
  return {
    httpOnly: true,
    sameSite,
    // Browsers reject SameSite=None without Secure, so force it for cross-site.
    secure: config.cookieSecure || sameSite === 'none',
    path: '/api/auth',
    maxAge: config.jwt.refreshTtlDays * 86400 * 1000,
  };
};

export function setRefreshCookie(res, token) {
  if (token) res.cookie(REFRESH_COOKIE, token, cookieOpts());
}

export function clearRefreshCookie(res) {
  res.clearCookie(REFRESH_COOKIE, { ...cookieOpts(), maxAge: undefined });
}
