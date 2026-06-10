-- 003_create_seats.sql
CREATE TABLE IF NOT EXISTS seats (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    UUID REFERENCES events(id),
  row_label   VARCHAR(5),               -- A, B, C ...
  seat_number INT,
  category    VARCHAR(20),              -- VIP, PREMIUM, GENERAL
  price       DECIMAL(10,2),
  status      VARCHAR(20) DEFAULT 'available',
  version     INT DEFAULT 0,            -- optimistic lock
  UNIQUE (event_id, row_label, seat_number)
);

-- Fast lookups of "all seats of this event in status X"
CREATE INDEX IF NOT EXISTS idx_seats_event_status ON seats(event_id, status);
