-- 002_create_events.sql
CREATE TABLE IF NOT EXISTS events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            VARCHAR(255) NOT NULL,
  venue           VARCHAR(255),
  event_date      TIMESTAMP NOT NULL,
  total_seats     INT NOT NULL,
  available_seats INT NOT NULL,
  base_price      DECIMAL(10,2),
  created_at      TIMESTAMP DEFAULT NOW()
);
