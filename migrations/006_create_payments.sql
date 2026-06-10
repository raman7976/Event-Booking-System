-- 006_create_payments.sql
CREATE TABLE IF NOT EXISTS payments (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id UUID REFERENCES reservations(id),
  user_id        UUID REFERENCES users(id),
  amount         DECIMAL(10,2),
  status         VARCHAR(20),           -- pending, completed, refunded
  payment_method VARCHAR(50),
  transaction_id VARCHAR(100),
  created_at     TIMESTAMP DEFAULT NOW()
);
