// Unit tests for the text-to-SQL safety guard. guardSql is a pure function;
// importing adminAnalyticsService opens no DB/LLM connections (all lazy).
import { describe, it, expect } from 'vitest';
import { guardSql } from '../../src/services/adminAnalyticsService.js';

describe('guardSql — allows safe read-only queries', () => {
  it('accepts a plain SELECT and appends a LIMIT when missing', () => {
    const r = guardSql('SELECT count(*) FROM bus_bookings');
    expect(r.ok).toBe(true);
    expect(r.sql).toMatch(/LIMIT 100$/);
  });

  it('keeps an existing LIMIT', () => {
    const r = guardSql('SELECT * FROM bus_trips LIMIT 5');
    expect(r.ok).toBe(true);
    expect(r.sql).toBe('SELECT * FROM bus_trips LIMIT 5');
  });

  it('strips a single trailing semicolon', () => {
    const r = guardSql('SELECT 1 FROM users LIMIT 1;');
    expect(r.ok).toBe(true);
    expect(r.sql).toBe('SELECT 1 FROM users LIMIT 1');
  });

  it('allows a WITH/CTE query and its CTE table reference', () => {
    const r = guardSql('WITH t AS (SELECT * FROM bus_trips) SELECT count(*) FROM t LIMIT 10');
    expect(r.ok).toBe(true);
  });

  it('allows a join across two allowed tables', () => {
    const r = guardSql('SELECT u.name FROM bus_bookings b JOIN users u ON u.id = b.user_id LIMIT 10');
    expect(r.ok).toBe(true);
  });
});

describe('guardSql — rejects unsafe queries', () => {
  it('rejects INSERT / UPDATE / DELETE / DROP', () => {
    for (const q of [
      "INSERT INTO users(name) VALUES ('x')",
      "UPDATE users SET role='admin'",
      'DELETE FROM bus_bookings',
      'DROP TABLE bus_trips',
    ]) {
      expect(guardSql(q).ok, q).toBe(false);
    }
  });

  it('rejects multiple statements', () => {
    expect(guardSql('SELECT 1 FROM users; DROP TABLE users').ok).toBe(false);
  });

  it('rejects non-SELECT leading statements', () => {
    expect(guardSql('TRUNCATE bus_bookings').ok).toBe(false);
    expect(guardSql('EXPLAIN ANALYZE SELECT 1').ok).toBe(false);
  });

  it('rejects SELECT ... INTO (creates a table)', () => {
    expect(guardSql('SELECT * INTO evil FROM users').ok).toBe(false);
  });

  it('rejects a table outside the bus allowlist', () => {
    const r = guardSql('SELECT * FROM pg_shadow');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/not allowed/);
  });

  it('rejects empty input', () => {
    expect(guardSql('').ok).toBe(false);
    expect(guardSql(null).ok).toBe(false);
  });
});
