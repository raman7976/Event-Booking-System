-- 008_add_roll_number.sql
-- Campus identity for the bus vertical: users are uniquely identified by their
-- institute roll number. Nullable (events vertical doesn't need it); required
-- by the bus service and enforced unique once set.
ALTER TABLE users ADD COLUMN IF NOT EXISTS roll_number VARCHAR(20);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_roll_number
  ON users (UPPER(roll_number)) WHERE roll_number IS NOT NULL;
