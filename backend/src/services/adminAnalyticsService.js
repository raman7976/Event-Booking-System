// Admin analytics — natural language to guarded, read-only SQL over the replica.
// Grounding: a fixed schema card + few-shot examples retrieved from rag_chunks
// (kind='sql_example'). The generated SQL is validated by guardSql() and run
// inside a READ ONLY transaction with a statement timeout on the read pool.
//
// Defense in depth (a regex guard is not a full SQL parser): SELECT-only +
// single-statement + keyword denylist + table allowlist + forced LIMIT +
// BEGIN READ ONLY + statement_timeout + replica pool. Any write is rejected at
// the DB by the read-only transaction even if the guard were bypassed.
import { readPool } from '../config/db.js';
import { config } from '../config/env.js';
import * as llm from './ai/llm.js';
import * as rag from './ragService.js';
import { Errors } from '../utils/errors.js';

const ALLOWED_TABLES = new Set([
  'bus_schedules', 'bus_trips', 'bus_bookings', 'bus_waitlist', 'bus_rider_flags',
  'users', 'holidays',
]);

const FORBIDDEN = /\b(insert|update|delete|drop|alter|create|grant|revoke|truncate|copy|vacuum|call|merge|into|reindex|refresh|lock|listen|notify|do|execute)\b/i;

const SCHEMA_CARD = `Read-only Postgres. Tables and key columns (bus vertical only):
- bus_schedules(id, bus_no int, origin text, destination text, departure_time time, pattern 'weekday'|'weekend_holiday', weekday_only smallint 1..5, capacity int, active bool)
- bus_trips(id, schedule_id -> bus_schedules.id, service_date date, departure_at timestamptz, capacity int, booked_count int, status 'scheduled'|'open'|'confirming'|'departed'|'cancelled')
- bus_bookings(id, trip_id -> bus_trips.id, user_id -> users.id, status 'assigned'|'confirmed'|'declined'|'cancelled'|'auto_released'|'no_show', created_at, confirmed_at)
- bus_waitlist(id, trip_id -> bus_trips.id, user_id -> users.id, joined_at, promoted_at)  -- waiting rows have promoted_at IS NULL
- bus_rider_flags(user_id -> users.id, tier 'low'|'medium'|'high', suggested_action 'none'|'warn'|'cooldown', rationale, stats jsonb, created_at)
- users(id, name, email, roll_number, no_show_count int, role)
A "no-show" is bus_bookings.status = 'no_show'. Fill rate = booked_count::numeric / capacity.`;

/**
 * Validate a model-generated SQL string. Returns { ok, sql } (LIMIT appended if
 * missing) or { ok:false, reason }. Pure function — unit tested.
 */
export function guardSql(raw) {
  if (!raw || typeof raw !== 'string') return { ok: false, reason: 'empty query' };
  let sql = raw.trim().replace(/;\s*$/, ''); // drop a single trailing semicolon
  if (!sql) return { ok: false, reason: 'empty query' };
  if (sql.includes(';')) return { ok: false, reason: 'multiple statements are not allowed' };
  if (!/^\s*(with|select)\b/i.test(sql)) return { ok: false, reason: 'only SELECT / WITH queries are allowed' };
  if (FORBIDDEN.test(sql)) return { ok: false, reason: 'query contains a forbidden keyword' };

  // Names introduced as CTEs / subquery aliases ("name AS (") are allowed table refs.
  const cteNames = new Set();
  for (const m of sql.matchAll(/\b([a-z_]\w*)\s+as\s*\(/gi)) cteNames.add(m[1].toLowerCase());

  for (const m of sql.matchAll(/\b(?:from|join)\s+([a-z_]\w*)/gi)) {
    const t = m[1].toLowerCase();
    if (!ALLOWED_TABLES.has(t) && !cteNames.has(t)) {
      return { ok: false, reason: `table not allowed: ${t}` };
    }
  }

  if (!/\blimit\b/i.test(sql)) sql = `${sql} LIMIT 100`;
  return { ok: true, sql };
}

export async function runReadOnly(sql) {
  const client = await readPool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    await client.query(`SET LOCAL statement_timeout = ${Number(config.ai.sqlTimeoutMs)}`);
    const { rows } = await client.query(sql);
    await client.query('COMMIT');
    return rows.slice(0, 200);
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }
}

export async function query({ question }) {
  if (!llm.isEnabled()) {
    return {
      source: 'disabled',
      sql: null,
      rows: [],
      summary: 'Ad-hoc analytics needs GROQ_API_KEY. Use the standard reports (rider flags, capacity advice) meanwhile.',
    };
  }

  const examples = await rag.retrieve(question, { kind: 'sql_example' });
  const fewShot = examples
    .map((e) => `Q: ${e.title}\nSQL: ${e.metadata?.sql}`)
    .join('\n\n');

  const system = [
    'You translate a question into ONE read-only Postgres SELECT query.',
    SCHEMA_CARD,
    'Rules: output a single SELECT (or WITH ... SELECT). No writes. Always include a LIMIT.',
    'Only use the tables/columns above. Respond as JSON: {"sql":"..."}.',
    fewShot ? `Examples:\n${fewShot}` : '',
  ].filter(Boolean).join('\n\n');

  const parsed = await llm.chatJson({ system, user: question });
  const guard = guardSql(parsed.sql);
  if (!guard.ok) throw Errors.validation(`Could not run a safe query: ${guard.reason}`);

  const rows = await runReadOnly(guard.sql);

  // Short natural-language summary of the result.
  let summary = `Returned ${rows.length} row(s).`;
  try {
    const s = await llm.chatJson({
      system: 'Summarize the SQL result for an admin in one or two sentences. Respond as JSON: {"summary":"..."}.',
      user: `Question: ${question}\nRows (JSON, truncated): ${JSON.stringify(rows).slice(0, 3000)}`,
    });
    if (s.summary) summary = String(s.summary);
  } catch { /* keep the templated summary */ }

  return { source: 'groq', sql: guard.sql, rows, summary };
}
