// Postgres connection pools:
//   writePool -> PRIMARY  (all writes + read-your-write reads)
//   readPool  -> REPLICA  (heavy / eventually-consistent reads)
import pg from 'pg';
import { config } from './env.js';
import { logger } from '../utils/logger.js';

const { Pool } = pg;

const common = {
  database: config.pg.database,
  user: config.pg.user,
  password: config.pg.password,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
};

export const writePool = new Pool({
  ...common,
  host: config.pg.primaryHost,
  port: config.pg.primaryPort,
  application_name: `${config.instanceId}-write`,
});

export const readPool = new Pool({
  ...common,
  host: config.pg.replicaHost,
  port: config.pg.replicaPort,
  application_name: `${config.instanceId}-read`,
});

// Pools must have an error handler or an idle-client error crashes the process.
writePool.on('error', (err) => logger.error('[db] writePool idle error:', err.message));
readPool.on('error', (err) => logger.error('[db] readPool idle error:', err.message));

// Convenience helpers
export const query = (text, params) => writePool.query(text, params);
export const readQuery = (text, params) => readPool.query(text, params);

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
