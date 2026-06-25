// Central, parsed configuration. Reads .env once and exposes typed values.
import dotenv from 'dotenv';
dotenv.config();

const int = (v, d) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
};

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: int(process.env.PORT, 3000),
  instanceId: process.env.INSTANCE_ID || `node-${process.pid}`,
  // CORS origins (comma-separated)
  clientUrls: (process.env.CLIENT_URL || 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  jwt: {
    secret: process.env.JWT_SECRET || 'dev_super_secret_change_me_in_production',
    accessTtl: process.env.ACCESS_TOKEN_TTL || '15m',
    refreshTtlDays: int(process.env.REFRESH_TOKEN_TTL_DAYS, 7),
  },
  // Set COOKIE_SECURE=true when serving over HTTPS (refresh cookie gets Secure).
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  // Refresh-cookie SameSite. Same-origin deploy -> 'lax'. Split frontend/backend
  // (e.g. Vercel + Railway) is cross-site, so the cookie must be 'none' (+Secure).
  cookieSameSite: (process.env.COOKIE_SAMESITE || 'lax').toLowerCase(),

  // First admin account created by the seed. Set ADMIN_PASSWORD to a real secret
  // in production; the defaults are only for local demos.
  admin: {
    email: (process.env.ADMIN_EMAIL || 'admin@demo.local').toLowerCase(),
    password: process.env.ADMIN_PASSWORD || 'Admin@1234',
  },

  pg: {
    primaryHost: process.env.PG_PRIMARY_HOST || 'localhost',
    primaryPort: int(process.env.PG_PRIMARY_PORT, 5432),
    replicaHost: process.env.PG_REPLICA_HOST || 'localhost',
    replicaPort: int(process.env.PG_REPLICA_PORT, 5433),
    database: process.env.PG_DATABASE || 'booking',
    user: process.env.PG_USER || 'booking',
    password: process.env.PG_PASSWORD || 'booking_pass',
  },

  redis: {
    // Managed providers (Railway/Upstash) give one REDIS_URL (redis:// or rediss://
    // with auth). If set it wins; otherwise fall back to discrete host/port for local.
    url: process.env.REDIS_URL || '',
    host: process.env.REDIS_HOST || 'localhost',
    port: int(process.env.REDIS_PORT, 6379),
  },

  holdTtlSeconds: int(process.env.HOLD_TTL_SECONDS, 480),
  rateLimit: {
    holds: int(process.env.RATE_LIMIT_HOLDS, 3),
    windowSeconds: int(process.env.RATE_LIMIT_WINDOW_SECONDS, 60),
  },
  sessionTtlSeconds: int(process.env.SESSION_TTL_SECONDS, 3600),

  gemini: {
    apiKey: process.env.GEMINI_API_KEY || '',
    model: process.env.GEMINI_MODEL || 'gemini-2.5-pro',
  },

  // Campus bus vertical. Windows are stored in seconds so tests can shrink the
  // whole lifecycle (BUS_*_SECONDS); production uses the minute-scale defaults.
  bus: {
    openSeconds: int(process.env.BUS_OPEN_SECONDS, 60 * 60),         // booking opens T-60m
    confirmSeconds: int(process.env.BUS_CONFIRM_SECONDS, 20 * 60),   // confirmation from T-20m
    autoReleaseSeconds: int(process.env.BUS_AUTORELEASE_SECONDS, 10 * 60), // sweep at T-10m
    defaultCapacity: int(process.env.BUS_DEFAULT_CAPACITY, 40),
    emailDomain: (process.env.BUS_EMAIL_DOMAIN || 'lnmiit.ac.in').toLowerCase(),
    timezone: process.env.TZ || 'Asia/Kolkata',
  },

  mail: {
    host: process.env.SMTP_HOST || '',
    port: int(process.env.SMTP_PORT, 0),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.MAIL_FROM || 'Event Booking <no-reply@booking.local>',
  },

  workerHealthPort: int(process.env.WORKER_HEALTH_PORT, 3002),
};

// ── Production secret guard ──
// The dev fallbacks above keep `docker compose up` and local dev one-command
// simple, but a production deploy that forgets to override them would silently
// run on a forgeable JWT secret / public DB password. So in production we refuse
// to boot until every *runtime-critical* secret is set to something other than
// its known default. Runs as an import-time side effect, so both the API server
// and the worker enforce it; migrate.js reads process.env directly (unaffected),
// and tests run under NODE_ENV=test so this never fires there.
//
// Only JWT_SECRET and PG_PASSWORD are gated — the server and worker need both to
// run securely. ADMIN_PASSWORD is deliberately NOT here: it's consumed only by
// the one-off seed script (src/scripts/seed.js), never at boot, so gating it
// would needlessly crash a perfectly healthy deployment that never seeds in prod.
const KNOWN_DEFAULTS = {
  JWT_SECRET: 'dev_super_secret_change_me_in_production',
  PG_PASSWORD: 'booking_pass',
};

export function validateProductionSecrets(env = process.env) {
  const offenders = Object.entries(KNOWN_DEFAULTS)
    .filter(([name, def]) => !env[name] || env[name] === def)
    .map(([name]) => name);
  if (offenders.length) {
    throw new Error(
      `[config] refusing to start in production: ${offenders.join(', ')} ` +
        'must be set to a non-default value. Configure these env vars and redeploy.',
    );
  }
}

if (config.env === 'production') {
  validateProductionSecrets();
}
