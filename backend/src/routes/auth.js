import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { z } from 'zod';
import { writePool } from '../config/db.js';
import { redis, isRedisReady } from '../config/redis.js';
import { config } from '../config/env.js';
import { validate } from '../middleware/validate.js';
import { rateLimiter } from '../middleware/rateLimiter.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { Errors } from '../utils/errors.js';

const router = Router();

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6, 'password must be at least 6 characters'),
  name: z.string().min(1).max(100).optional(),
});
const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// Issue a JWT and cache a server-side session (session:{sid}).
async function issueSession(user) {
  const sid = crypto.randomUUID();
  const token = jwt.sign(
    { sub: user.id, email: user.email, name: user.name, sid },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn },
  );
  if (isRedisReady()) {
    try {
      await redis.set(
        `session:${sid}`,
        JSON.stringify({ userId: user.id, email: user.email, name: user.name }),
        'EX',
        config.sessionTtlSeconds,
      );
    } catch {
      /* session cache is best-effort */
    }
  }
  return token;
}

const authLimiter = rateLimiter({ max: 20, windowSeconds: 60, keyPrefix: 'auth' });

router.post(
  '/register',
  authLimiter,
  validate(registerSchema),
  asyncHandler(async (req, res) => {
    const { email, password, name } = req.body;
    const exists = await writePool.query('SELECT 1 FROM users WHERE email = $1', [email]);
    if (exists.rowCount) throw Errors.conflict('Email already registered');

    const passwordHash = await bcrypt.hash(password, 10);
    const { rows } = await writePool.query(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, $2, $3)
       RETURNING id, email, name, no_show_count, created_at`,
      [email, passwordHash, name || null],
    );
    const user = rows[0];
    const token = await issueSession(user);
    res.status(201).json({ token, user });
  }),
);

router.post(
  '/login',
  authLimiter,
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    const { rows } = await writePool.query(
      'SELECT id, email, name, password_hash, no_show_count, created_at FROM users WHERE email = $1',
      [email],
    );
    if (!rows.length) throw Errors.unauthorized('Invalid email or password');

    const user = rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) throw Errors.unauthorized('Invalid email or password');

    delete user.password_hash;
    const token = await issueSession(user);
    res.json({ token, user });
  }),
);

export default router;
