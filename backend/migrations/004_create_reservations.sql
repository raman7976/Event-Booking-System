-- 004_create_reservations.sql
CREATE TABLE IF NOT EXISTS reservations (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seat_id      UUID REFERENCES seats(id),
  user_id      UUID REFERENCES users(id),
  event_id     UUID REFERENCES events(id),
  status       VARCHAR(20),             -- held, confirmed, expired, cancelled
  hold_token   VARCHAR(100) UNIQUE,
  held_at      TIMESTAMP,
  expires_at   TIMESTAMP,
  confirmed_at TIMESTAMP,
  created_at   TIMESTAMP DEFAULT NOW()
);

-- The expiry sweeper scans only currently-held reservations by expiry time.
CREATE INDEX IF NOT EXISTS idx_reservations_expires
  ON reservations(expires_at) WHERE status = 'held';

-- "my bookings" lookups
CREATE INDEX IF NOT EXISTS idx_reservations_user
  ON reservations(user_id, status);
