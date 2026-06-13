-- 005_create_waitlist.sql
CREATE TABLE IF NOT EXISTS waitlist (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id       UUID REFERENCES events(id),
  user_id        UUID REFERENCES users(id),
  priority_score FLOAT,                 -- lower = higher priority
  joined_at      TIMESTAMP DEFAULT NOW(),
  notified_at    TIMESTAMP,
  UNIQUE (event_id, user_id)
);

-- Pop the next person to notify (lowest priority_score first).
CREATE INDEX IF NOT EXISTS idx_waitlist_event_priority
  ON waitlist(event_id, priority_score);
