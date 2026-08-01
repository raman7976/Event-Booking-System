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
    // Managed Postgres (Neon) exposes a single connection URL; when set, the pools
    // build from it with SSL. DIRECT_URL is Neon's unpooled endpoint for migrations.
    url: process.env.DATABASE_URL || '',
    directUrl: process.env.DIRECT_URL || process.env.DATABASE_URL || '',
    ssl: process.env.PG_SSL === 'true' || Boolean(process.env.DATABASE_URL),
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

  // Agentic-RAG (bus vertical). Generation via Groq (free, OpenAI-compatible,
  // supports tool calling); embeddings run locally via transformers.js (no key).
  groq: {
    apiKey: process.env.GROQ_API_KEY || '',
    model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
  },
  ai: {
    embeddingModel: process.env.EMBEDDING_MODEL || 'Xenova/all-MiniLM-L6-v2',
    assistantMaxSteps: int(process.env.AI_ASSISTANT_MAX_STEPS, 5),
    ragTopK: int(process.env.AI_RAG_TOP_K, 4),
    sqlTimeoutMs: int(process.env.AI_SQL_TIMEOUT_MS, 5000),
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
