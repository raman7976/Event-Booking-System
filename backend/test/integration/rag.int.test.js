// Integration tests for the bus RAG core against a real Postgres + pgvector.
// Requires the knowledge base to be ingested (npm run ingest:bus). Self-skips
// unless RUN_INTEGRATION=1 (or CI=true). Needs no API key — embeddings are local.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const enabled = process.env.RUN_INTEGRATION === '1' || process.env.CI === 'true';
const d = enabled ? describe : describe.skip;

d('bus RAG core (pgvector + local embeddings)', () => {
  let rag;
  let admin;
  let closePools;

  beforeAll(async () => {
    rag = await import('../../src/services/ragService.js');
    admin = await import('../../src/services/adminAnalyticsService.js');
    ({ closePools } = await import('../../src/config/db.js'));
  });

  afterAll(async () => {
    await closePools?.();
  });

  it('retrieves the no-show policy chunk for a natural-language query', async () => {
    const chunks = await rag.retrieve('what is the no-show policy?', { kind: 'bus_doc' });
    expect(chunks.length).toBeGreaterThan(0);
    const joined = chunks.map((c) => c.content).join(' ').toLowerCase();
    expect(joined).toMatch(/no-show/);
  });

  it('retrieves a matching SQL few-shot example', async () => {
    const ex = await rag.retrieve('how many no shows recently', { kind: 'sql_example' });
    expect(ex.length).toBeGreaterThan(0);
    expect(ex[0].metadata?.sql).toMatch(/select/i);
  });

  it('executes a guarded safe SELECT on the read pool', async () => {
    const guard = admin.guardSql('SELECT count(*) AS n FROM bus_trips');
    expect(guard.ok).toBe(true);
    const rows = await admin.runReadOnly(guard.sql);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveProperty('n');
  });

  it('refuses to run a write inside the read-only transaction', async () => {
    // Even if the guard were bypassed, BEGIN READ ONLY blocks writes at the DB.
    await expect(admin.runReadOnly('DELETE FROM bus_trips')).rejects.toThrow();
  });
});
