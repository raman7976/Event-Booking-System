-- 001_create_users.sql
-- gen_random_uuid() is built into Postgres 13+, but pgcrypto guarantees it.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name          VARCHAR(100),
  no_show_count INT DEFAULT 0,
  created_at    TIMESTAMP DEFAULT NOW()
);
