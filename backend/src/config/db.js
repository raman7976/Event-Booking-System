// Postgres connection pools:
//   writePool -> PRIMARY  (all writes + read-your-write reads)
//   readPool  -> REPLICA  (heavy / eventually-consistent reads)
import pg from 'pg';
import { config } from './env.js';
import { logger } from '../utils/logger.js';

const { Pool } = pg;

// SSL for managed Postgres (Neon). rejectUnauthorized:false accepts the provider
// cert without shipping a CA bundle; false disables SSL for local/Railway.
const ssl = config.pg.ssl ? { rejectUnauthorized: false } : false;
const base = { max: 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000, ssl };

// A managed URL (Neon) drives both pools from one pooled endpoint — pickReadPool +
// the RYW flag still apply. Otherwise use discrete primary/replica host+port.
function makePool(appName, replica = false) {
  if (config.pg.url) {
    return new Pool({ ...base, connectionString: config.pg.url, application_name: appName });
  }
  return new Pool({
    ...base,
    host: replica ? config.pg.replicaHost : config.pg.primaryHost,
    port: replica ? config.pg.replicaPort : config.pg.primaryPort,
    database: config.pg.database,
    user: config.pg.user,
    password: config.pg.password,
    application_name: appName,
  });
}

export const writePool = makePool(`${config.instanceId}-write`);
export const readPool = makePool(`${config.instanceId}-read`, true);

// Pools must have an error handler or an idle-client error crashes the process.
writePool.on('error', (err) => logger.error('[db] writePool idle error:', err.message));
readPool.on('error', (err) => logger.error('[db] readPool idle error:', err.message));

// Convenience helpers
export const query = (text, params) => writePool.query(text, params);
export const readQuery = (text, params) => readPool.query(text, params);

/**
 * Read-your-writes pool selection: user-scoped reads go to the PRIMARY for a
 * short window after that user wrote (flag set via cacheService.markUserWrite),
 * so replica lag can never show someone stale own-state. Falls back to the
 * replica when Redis is unavailable (availability over freshness).
 */
export async function pickReadPool(userId) {
  if (!userId) return readPool;
  try {
    const { redis, isRedisReady } = await import('./redis.js');
    if (!isRedisReady()) return readPool;
    return (await redis.exists(`ryw:${userId}`)) ? writePool : readPool;
  } catch {
    return readPool;
  }
}

/** Run `fn(client)` inside a BEGIN/COMMIT on the PRIMARY; auto ROLLBACK on throw. */
export async function withTransaction(fn) {
  const client = await writePool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rbErr) {
      logger.error('[db] rollback failed:', rbErr.message);
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function closePools() {
  await Promise.allSettled([writePool.end(), readPool.end()]);
}
