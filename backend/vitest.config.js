import { defineConfig } from 'vitest/config';

// Unit tests (test/unit) mock infra and need nothing running. Integration tests
// (test/integration) talk to a real Postgres (+pgvector) and self-skip on env.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.js'],
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
