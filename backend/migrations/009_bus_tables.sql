-- 009_bus_tables.sql
-- Campus bus vertical: recurring timetable rows -> daily trip instances ->
-- counter-based bookings (no seat selection) + FIFO public waitlist.

-- One row per timetable entry (from the published bus time-table).
--   pattern      'weekday'         -> runs Mon-Fri (unless weekday_only narrows it)
--                'weekend_holiday' -> runs Sat, Sun and dates in holidays
--   weekday_only 1=Mon .. 5=Fri    -> weekday rows that run on a single weekday
CREATE TABLE IF NOT EXISTS bus_schedules (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bus_no         INT NOT NULL,
  origin         VARCHAR(100) NOT NULL,
  destination    VARCHAR(100) NOT NULL,
  departure_time TIME NOT NULL,
  pattern        VARCHAR(20) NOT NULL CHECK (pattern IN ('weekday', 'weekend_holiday')),
  weekday_only   SMALLINT CHECK (weekday_only BETWEEN 1 AND 5),
  capacity       INT NOT NULL DEFAULT 40 CHECK (capacity > 0),
  active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMP DEFAULT NOW()
);

-- Dates on which the weekend/holiday timetable applies (besides Sat/Sun).
CREATE TABLE IF NOT EXISTS holidays (
  day   DATE PRIMARY KEY,
  label VARCHAR(120)
);

-- A concrete bus run on a concrete date.
CREATE TABLE IF NOT EXISTS bus_trips (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id  UUID NOT NULL REFERENCES bus_schedules(id),
  service_date DATE NOT NULL,
  departure_at TIMESTAMPTZ NOT NULL,
  capacity     INT NOT NULL,
  booked_count INT NOT NULL DEFAULT 0 CHECK (booked_count >= 0 AND booked_count <= capacity),
  status       VARCHAR(20) NOT NULL DEFAULT 'scheduled'
               CHECK (status IN ('scheduled', 'open', 'confirming', 'departed', 'cancelled')),
  UNIQUE (schedule_id, service_date)
);
CREATE INDEX IF NOT EXISTS idx_bus_trips_date ON bus_trips (service_date, departure_at);

-- Seat assignments (one per user per trip; counter-based, no seat numbers).
CREATE TABLE IF NOT EXISTS bus_bookings (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id      UUID NOT NULL REFERENCES bus_trips(id),
  user_id      UUID NOT NULL REFERENCES users(id),
  status       VARCHAR(20) NOT NULL DEFAULT 'assigned'
               CHECK (status IN ('assigned', 'confirmed', 'declined', 'cancelled', 'auto_released', 'no_show')),
  created_at   TIMESTAMP DEFAULT NOW(),
  confirmed_at TIMESTAMP,
  UNIQUE (trip_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_bus_bookings_user ON bus_bookings (user_id, status);

-- Public FIFO waitlist (position = order of joined_at among un-promoted rows).
CREATE TABLE IF NOT EXISTS bus_waitlist (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id     UUID NOT NULL REFERENCES bus_trips(id),
  user_id     UUID NOT NULL REFERENCES users(id),
  joined_at   TIMESTAMP DEFAULT NOW(),
  promoted_at TIMESTAMP,
  UNIQUE (trip_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_bus_waitlist_trip ON bus_waitlist (trip_id, joined_at)
  WHERE promoted_at IS NULL;
