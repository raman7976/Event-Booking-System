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

  mail: {
    host: process.env.SMTP_HOST || '',
    port: int(process.env.SMTP_PORT, 0),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.MAIL_FROM || 'Event Booking <no-reply@booking.local>',
  },

  workerHealthPort: int(process.env.WORKER_HEALTH_PORT, 3002),
};
