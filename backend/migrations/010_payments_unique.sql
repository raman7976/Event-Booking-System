-- 010_payments_unique.sql
-- A reservation can have at most one completed payment — the database-level
-- backstop for retried/duplicated confirm requests (belt to the
-- Idempotency-Key middleware's suspenders).
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_one_completed
  ON payments (reservation_id) WHERE status = 'completed';
