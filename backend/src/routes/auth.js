// Auth endpoints.
//   POST /register  -> create account (role 'user'), return access token + set refresh cookie
//   POST /login     -> verify credentials (with lockout), same returns
//   POST /refresh   -> rotate the refresh cookie, return a fresh access token
//   POST /logout    -> revoke the refresh token + clear the cookie
//   GET  /me        -> current user (fresh from DB)
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { writePool } from '../config/db.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { rateLimiter } from '../middleware/rateLimiter.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { Errors } from '../utils/errors.js';
import {
  publicUser,
  signAccessToken,
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  assertNotLocked,
  recordLoginFailure,
  clearLoginFailures,
  setRefreshCookie,
  clearRefreshCookie,
  REFRESH_COOKIE,
} from '../services/authService.js';

const router = Router();

const passwordSchema = z
  .string()
  .min(8, 'password must be at least 8 characters')
  .regex(/[A-Za-z]/, 'password must contain a letter')
  .regex(/[0-9]/, 'password must contain a number');

const rollSchema = z
  .string()
  .trim()
  .min(4, 'roll number looks too short')
  .max(20)
  .regex(/^[A-Za-z0-9-]+$/, 'roll number may only contain letters, digits and dashes')
  .transform((v) => v.toUpperCase());

const registerSchema = z.object({
  email: z.string().email().max(255),
  password: passwordSchema,
  name: z.string().min(1).max(100),
  rollNumber: rollSchema.optional(),
});
const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
const patchMeSchema = z.object({
  rollNumber: rollSchema,
});

async function respondWithSession(res, user, status = 200) {
  const token = signAccessToken(user);
  setRefreshCookie(res, await issueRefreshToken(user));
  res.status(status).json({ token, user: publicUser(user) });
}

const authLimiter = rateLimiter({ max: 20, windowSeconds: 60, keyPrefix: 'auth' });

router.post(
  '/register',
  authLimiter,
  validate(registerSchema),
  asyncHandler(async (req, res) => {
    const { email, password, name, rollNumber } = req.body;
    const exists = await writePool.query('SELECT 1 FROM users WHERE email = $1', [email]);
    if (exists.rowCount) throw Errors.conflict('Email already registered');
    if (rollNumber) {
      const rollTaken = await writePool.query(
        'SELECT 1 FROM users WHERE UPPER(roll_number) = $1',
        [rollNumber],
      );
      if (rollTaken.rowCount) throw Errors.conflict('Roll number already registered');
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const { rows } = await writePool.query(
      `INSERT INTO users (email, password_hash, name, role, roll_number)
       VALUES ($1, $2, $3, 'user', $4)
       RETURNING id, email, name, role, roll_number, no_show_count`,
      [email, passwordHash, name, rollNumber || null],
    );
    await respondWithSession(res, rows[0], 201);
  }),
);

router.post(
  '/login',
  authLimiter,
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    await assertNotLocked(email);

    const { rows } = await writePool.query(
      'SELECT id, email, name, role, roll_number, password_hash, no_show_count FROM users WHERE email = $1',
      [email],
    );
    // Hash even when the user doesn't exist so response time doesn't leak
    // which emails are registered.
    const hash = rows[0]?.password_hash || '$2a$10$invalidsaltinvalidsaltinvalidsa';
    const match = await bcrypt.compare(password, hash);
    if (!rows.length || !match) {
      await recordLoginFailure(email);
      throw Errors.unauthorized('Invalid email or password');
    }

    await clearLoginFailures(email);
    await respondWithSession(res, rows[0]);
  }),
);

router.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const refreshJwt = req.cookies?.[REFRESH_COOKIE];
    if (!refreshJwt) throw Errors.unauthorized('No refresh token');
    const user = await rotateRefreshToken(refreshJwt); // consumes the old jti
    await respondWithSession(res, user);
  }),
);

router.post(
  '/logout',
  asyncHandler(async (req, res) => {
    const refreshJwt = req.cookies?.[REFRESH_COOKIE];
    if (refreshJwt) await revokeRefreshToken(refreshJwt);
    clearRefreshCookie(res);
    res.json({ ok: true });
  }),
);

router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { rows } = await writePool.query(
      'SELECT id, email, name, role, roll_number, no_show_count FROM users WHERE id = $1',
      [req.user.id],
    );
    if (!rows.length) throw Errors.unauthorized('User no longer exists');
    res.json({ user: publicUser(rows[0]) });
  }),
);

// Set the roll number once (campus identity for the bus service). Returns a
// fresh access token so the new roll claim is usable immediately.
router.patch(
  '/me',
  requireAuth,
  validate(patchMeSchema),
  asyncHandler(async (req, res) => {
    const { rollNumber } = req.body;

    const { rows: me } = await writePool.query(
      'SELECT id, email, name, role, roll_number, no_show_count FROM users WHERE id = $1',
      [req.user.id],
    );
    if (!me.length) throw Errors.unauthorized('User no longer exists');
    if (me[0].roll_number) throw Errors.conflict('Roll number is already set on this account');

    const taken = await writePool.query(
      'SELECT 1 FROM users WHERE UPPER(roll_number) = $1 AND id <> $2',
      [rollNumber, req.user.id],
    );
    if (taken.rowCount) throw Errors.conflict('Roll number already registered');

    const { rows } = await writePool.query(
      `UPDATE users SET roll_number = $1 WHERE id = $2
       RETURNING id, email, name, role, roll_number, no_show_count`,
      [rollNumber, req.user.id],
    );
    res.json({ token: signAccessToken(rows[0]), user: publicUser(rows[0]) });
  }),
);

export default router;
