// Integration-test helpers. Deliberately imports NO app infra modules at the top
// level (importing config/redis.js would open a live connection), so when
// integration is disabled the test file can import this without side effects.
// The app modules (db/redis/seatService) are imported lazily by the test itself.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Integration tests need a real Postgres + Redis. Off by default so `npm test`
// in a bare environment stays green; CI and local docker runs opt in.
export const integrationEnabled =
  process.env.RUN_INTEGRATION === '1' || process.env.CI === 'true';

export function runMigrations() {
  const res = spawnSync('node', ['src/scripts/migrate.js'], {
    cwd: path.resolve(__dirname, '../..'),
    stdio: 'inherit',
    env: process.env,
  });
  if (res.status !== 0) throw new Error(`migrations failed (exit ${res.status})`);
}
