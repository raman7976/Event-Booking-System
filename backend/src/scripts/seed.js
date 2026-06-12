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
      { rows: ['A', 'B'], cols: 10, category: 'VIP', price: 2499 },
      { rows: ['C'], cols: 10, category: 'PREMIUM', price: 1499 },
      { rows: ['D', 'E'], cols: 10, category: 'GENERAL', price: 799 },
    ],
  },
  {
    name: 'Night Bus to the Coast',
    venue: 'Central Station — Bay 7',
    daysOut: 3,
    layout: [
      { rows: ['A', 'B'], cols: 4, category: 'PREMIUM', price: 649 },
      { rows: ['C', 'D', 'E', 'F', 'G', 'H'], cols: 4, category: 'GENERAL', price: 449 },
    ],
  },
  {
    name: 'Intro to Distributed Systems',
    venue: 'Engineering Hall 3',
    daysOut: 30,
    layout: [
      { rows: ['A', 'B', 'C', 'D'], cols: 8, category: 'GENERAL', price: 199 },
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

// ── Campus bus timetable (w.e.f. October 31, 2025) ──
// [bus_no, origin, destination, 'HH:MM', weekday_only(1=Mon..5=Fri)|null]
const WEEKDAY_SCHEDULES = [
  [1, 'LNMIIT', 'Raja Park', '06:00', null],
  [1, 'Raja Park', 'LNMIIT', '07:00', null],
  [2, 'LNMIIT', 'Ajmeri Gate', '07:00', null],
  [2, 'Ajmeri Gate', 'LNMIIT', '08:00', null],
  [3, 'LNMIIT', 'Ajmeri Gate', '07:00', 1], // Monday only
  [3, 'Ajmeri Gate', 'LNMIIT', '08:00', 1], // Monday only
  [4, 'LNMIIT', 'Raja Park', '10:00', null],
  [4, 'Raja Park', 'LNMIIT', '11:00', null],
  [2, 'LNMIIT', 'Raja Park', '14:00', null],
  [2, 'Raja Park', 'LNMIIT', '16:00', null],
  [3, 'LNMIIT', 'Raja Park', '16:30', null],
  [1, 'LNMIIT', 'Ajmeri Gate', '18:05', null],
  [2, 'LNMIIT', 'Ajmeri Gate', '18:45', null],
  [3, 'Raja Park', 'LNMIIT', '17:30', 5], // Friday only
  [3, 'LNMIIT', 'Raja Park', '19:30', 5], // Friday only
  [1, 'Ajmeri Gate', 'LNMIIT', '20:15', null],
  [3, 'Raja Park', 'LNMIIT', '21:00', null],
  [2, 'Ajmeri Gate', 'LNMIIT', '21:00', null],
];

// [bus_no, origin, destination, 'HH:MM'] — Saturday, Sunday & holidays
const WEEKEND_SCHEDULES = [
  [1, 'LNMIIT', 'Ajmeri Gate', '07:00'],
  [1, 'Ajmeri Gate', 'LNMIIT', '08:00'],
  [2, 'LNMIIT', 'Raja Park', '10:00'],
  [2, 'Raja Park', 'LNMIIT', '12:00'],
  [3, 'LNMIIT', 'Raja Park', '13:00'],
  [3, 'Raja Park', 'LNMIIT', '15:00'],
  [2, 'LNMIIT', 'Raja Park', '16:00'],
  [3, 'LNMIIT', 'Ajmeri Gate', '16:30'],
  [2, 'Raja Park', 'LNMIIT', '17:15'],
  [1, 'LNMIIT', 'Raja Park', '17:00'],
  [2, 'LNMIIT', 'Ajmeri Gate', '18:00'],
  [3, 'Ajmeri Gate', 'LNMIIT', '20:15'],
  [1, 'Raja Park', 'LNMIIT', '21:00'],
  [2, 'Ajmeri Gate', 'LNMIIT', '21:00'],
];

async function seedBusSchedules(client) {
  // FK-safe wipe of the bus vertical (idempotent re-seed).
  await client.query('DELETE FROM bus_waitlist');
  await client.query('DELETE FROM bus_bookings');
  await client.query('DELETE FROM bus_trips');
  await client.query('DELETE FROM bus_schedules');

  for (const [busNo, origin, destination, time, weekdayOnly] of WEEKDAY_SCHEDULES) {
    await client.query(
      `INSERT INTO bus_schedules (bus_no, origin, destination, departure_time, pattern, weekday_only)
       VALUES ($1, $2, $3, $4, 'weekday', $5)`,
      [busNo, origin, destination, time, weekdayOnly],
    );
  }
  for (const [busNo, origin, destination, time] of WEEKEND_SCHEDULES) {
    await client.query(
      `INSERT INTO bus_schedules (bus_no, origin, destination, departure_time, pattern)
       VALUES ($1, $2, $3, $4, 'weekend_holiday')`,
      [busNo, origin, destination, time],
    );
  }
  return WEEKDAY_SCHEDULES.length + WEEKEND_SCHEDULES.length;
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

    // Campus accounts for the bus vertical (@lnmiit.ac.in + roll numbers).
    const studentHash = await bcrypt.hash('Student@123', 10);
    await client.query(
      `INSERT INTO users (email, password_hash, name, role, roll_number)
       VALUES ('23ucs101@lnmiit.ac.in', $1, 'Aarav Sharma', 'user', '23UCS101'),
              ('23ucs102@lnmiit.ac.in', $1, 'Diya Patel', 'user', '23UCS102'),
              ('admin@lnmiit.ac.in', $2, 'Transport Admin', 'admin', NULL)
       ON CONFLICT (email) DO UPDATE
         SET password_hash = EXCLUDED.password_hash,
             role = EXCLUDED.role,
             roll_number = COALESCE(users.roll_number, EXCLUDED.roll_number)`,
      [studentHash, adminHash],
    );

    const created = [];
    for (const ev of EVENTS) created.push(await createEvent(client, ev));
    const busRows = await seedBusSchedules(client);

    await client.query('COMMIT');
    console.log('[seed] done.');
    console.log('  user : demo@demo.local  / password123');
    console.log('  admin: admin@demo.local / Admin@1234');
    console.log('  campus user : 23ucs101@lnmiit.ac.in / Student@123 (roll 23UCS101)');
    console.log('  campus user : 23ucs102@lnmiit.ac.in / Student@123 (roll 23UCS102)');
    console.log('  campus admin: admin@lnmiit.ac.in    / Admin@1234');
    console.log(`  • bus timetable — ${busRows} schedule rows (weekday + weekend/holiday)`);
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
