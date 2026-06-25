import { defineConfig } from 'vitest/config';

// Unit tests (test/unit) mock the infra modules and need nothing running.
// Integration tests (test/integration) talk to a real Postgres + Redis and are
// gated on env (see test/helpers/db.js); they self-skip when those aren't set.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.js'],
    // Integration tests share one Postgres/Redis and TRUNCATE between cases, so
    // run files serially to avoid cross-file interference.
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
