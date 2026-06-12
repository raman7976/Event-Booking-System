-- 011_bus_rider_flags.sql
-- Latest AI reliability analysis per rider (advisory only — admins decide).
-- One row per user, upserted on each analysis run; `stats` keeps the exact
-- aggregates the verdict was based on, `source` records gemini vs heuristic.
CREATE TABLE IF NOT EXISTS bus_rider_flags (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL UNIQUE REFERENCES users(id),
  tier             VARCHAR(10) NOT NULL CHECK (tier IN ('low', 'medium', 'high')),
  rationale        TEXT,
  suggested_action VARCHAR(20) NOT NULL DEFAULT 'none'
                   CHECK (suggested_action IN ('none', 'warn', 'cooldown')),
  stats            JSONB NOT NULL DEFAULT '{}'::jsonb,
  source           VARCHAR(20) NOT NULL,
  model            VARCHAR(60),
  created_at       TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bus_rider_flags_tier ON bus_rider_flags (tier, created_at DESC);
