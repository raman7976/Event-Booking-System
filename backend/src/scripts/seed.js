// Seeds demo data: a demo user + a few events (concert / bus / course) with seat
// maps. Resets all bookable data first so it's safe to re-run. Targets the PRIMARY.
import bcrypt from 'bcryptjs';
import { writePool, closePools } from '../config/db.js';

// layout: list of sections -> { rows: ['A','B'], cols: 10, category, price }
const EVENTS = [
  {
    name: 'Indie Rock Live',
    venue: 'The Fillmore',
    daysOut: 20,
    layout: [
      { rows: ['A', 'B'], cols: 10, category: 'VIP', price: 250 },
      { rows: ['C'], cols: 10, category: 'PREMIUM', price: 150 },
      { rows: ['D', 'E'], cols: 10, category: 'GENERAL', price: 80 },
    ],
  },
  {
    name: 'Night Bus to the Coast',
    venue: 'Central Station — Bay 7',
    daysOut: 3,
    layout: [
      { rows: ['A', 'B'], cols: 4, category: 'PREMIUM', price: 65 },
      { rows: ['C', 'D', 'E', 'F', 'G', 'H'], cols: 4, category: 'GENERAL', price: 45 },
    ],
  },
  {
    name: 'Intro to Distributed Systems',
    venue: 'Engineering Hall 3',
    daysOut: 30,
    layout: [
      { rows: ['A', 'B', 'C', 'D'], cols: 8, category: 'GENERAL', price: 20 },
    ],
  },
];

async function createEvent(client, ev) {
  const total = ev.layout.reduce((acc, s) => acc + s.rows.length * s.cols, 0);
  const basePrice = Math.min(...ev.layout.map((s) => s.price));
  const { rows: [row] } = await client.query(
    `INSERT INTO events (name, venue, event_date, total_seats, available_seats, base_price)
     VALUES ($1, $2, NOW() + make_interval(days => $3), $4, $4, $5) RETURNING id`,
    [ev.name, ev.venue, ev.daysOut, total, basePrice],
  );
  for (const sec of ev.layout) {
    for (const r of sec.rows) {
      for (let n = 1; n <= sec.cols; n += 1) {
        await client.query(
          `INSERT INTO seats (event_id, row_label, seat_number, category, price, status)
           VALUES ($1, $2, $3, $4, $5, 'available')`,
          [row.id, r, n, sec.category, sec.price],
        );
      }
    }
  }
  return { id: row.id, name: ev.name, seats: total };
}

async function seed() {
  const client = await writePool.connect();
  try {
    await client.query('BEGIN');

    // Reset bookable data (FK-safe order). Keeps existing users.
    await client.query('DELETE FROM payments');
    await client.query('DELETE FROM reservations');
    await client.query('DELETE FROM waitlist');
    await client.query('DELETE FROM seats');
    await client.query('DELETE FROM events');

    // Demo accounts:
    //   user  -> demo@demo.local  / password123
    //   admin -> admin@demo.local / Admin@1234
    const userHash = await bcrypt.hash('password123', 10);
    const adminHash = await bcrypt.hash('Admin@1234', 10);
    await client.query(
      `INSERT INTO users (email, password_hash, name, role)
       VALUES ('demo@demo.local', $1, 'Demo User', 'user'),
              ('admin@demo.local', $2, 'Admin', 'admin')
       ON CONFLICT (email) DO UPDATE
         SET password_hash = EXCLUDED.password_hash, role = EXCLUDED.role`,
      [userHash, adminHash],
    );

    const created = [];
    for (const ev of EVENTS) created.push(await createEvent(client, ev));

    await client.query('COMMIT');
    console.log('[seed] done.');
    console.log('  user : demo@demo.local  / password123');
    console.log('  admin: admin@demo.local / Admin@1234');
    created.forEach((c) => console.log(`  • ${c.name} — ${c.seats} seats (id ${c.id})`));
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await closePools();
  }
}

seed().catch((err) => { console.error('[seed] failed:', err); process.exit(1); });
