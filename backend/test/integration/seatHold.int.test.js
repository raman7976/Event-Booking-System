// Integration tests for the seat-hold engine against a real Postgres + Redis.
//   1. Concurrency: N users race for one seat — exactly one wins, the rest get 409.
//   2. Phantom-hold regression: if the durable INSERT fails after the Redis lock
//      is taken, the lock must be released (not left dangling for the full TTL).
//
// Self-skips unless RUN_INTEGRATION=1 (or CI=true). App infra is imported lazily
// inside beforeAll so the disabled path opens no connections.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { integrationEnabled, runMigrations } from '../helpers/db.js';

const d = integrationEnabled ? describe : describe.skip;

d('seat hold — concurrency & phantom-hold', () => {
  let writePool;
  let redis;
  let holdSeat;
  let closeRedis;
  let closeQueues;
  let closePools;

  const seatKey = (eventId, seatId) => `seat:${eventId}:${seatId}`;

  async function waitForRedis() {
    if (redis.status === 'ready') return;
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('redis not ready in 10s')), 10_000);
      redis.once('ready', () => { clearTimeout(t); resolve(); });
    });
  }

  async function resetState() {
    await writePool.query(
      `TRUNCATE payments, reservations, waitlist, seats, events,
                bus_waitlist, bus_bookings, bus_trips, bus_rider_flags, users
        RESTART IDENTITY CASCADE`,
    );
    await redis.flushdb();
  }

  async function seedOneSeat() {
    const { rows: ev } = await writePool.query(
      `INSERT INTO events (name, venue, event_date, total_seats, available_seats, base_price)
       VALUES ('Race Test', 'Arena', NOW() + interval '1 day', 1, 1, 100) RETURNING id`,
    );
    const eventId = ev[0].id;
    const { rows: st } = await writePool.query(
      `INSERT INTO seats (event_id, row_label, seat_number, category, price, status)
       VALUES ($1, 'A', 1, 'GEN', 100, 'available') RETURNING id`,
      [eventId],
    );
    return { eventId, seatId: st[0].id };
  }

  async function seedUsers(n) {
    const ids = [];
    for (let i = 0; i < n; i += 1) {
      const { rows } = await writePool.query(
        `INSERT INTO users (email, password_hash, name, role)
         VALUES ($1, 'x', $2, 'user') RETURNING id`,
        [`racer${i}-${Date.now()}@test.local`, `Racer ${i}`],
      );
      ids.push(rows[0].id);
    }
    return ids;
  }

  beforeAll(async () => {
    runMigrations();
    ({ writePool, closePools } = await import('../../src/config/db.js'));
    ({ redis, closeRedis } = await import('../../src/config/redis.js'));
    ({ closeQueues } = await import('../../src/config/queues.js'));
    ({ holdSeat } = await import('../../src/services/seatService.js'));
    await waitForRedis();
  });

  afterAll(async () => {
    await Promise.allSettled([closeQueues?.(), closeRedis?.(), closePools?.()]);
  });

  beforeEach(async () => {
    await resetState();
  });

  it('lets exactly one of N concurrent holds win the seat', async () => {
    const { eventId, seatId } = await seedOneSeat();
    const users = await seedUsers(20);

    const results = await Promise.allSettled(
      users.map((userId) => holdSeat({ userId, seatId, eventId })),
    );
    const won = results.filter((r) => r.status === 'fulfilled');
    const lost = results.filter((r) => r.status === 'rejected');

    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(19);
    // losers fail cleanly with a 409 conflict, not an unexpected crash
    for (const r of lost) expect(r.reason.statusCode).toBe(409);

    // exactly one durable 'held' reservation row backs the winning lock
    const { rows } = await writePool.query(
      "SELECT COUNT(*)::int AS n FROM reservations WHERE seat_id = $1 AND status = 'held'",
      [seatId],
    );
    expect(rows[0].n).toBe(1);
    expect(await redis.exists(seatKey(eventId, seatId))).toBe(1);
  });

  it('releases the Redis lock when the durable INSERT fails (phantom-hold regression)', async () => {
    const { eventId, seatId } = await seedOneSeat();
    const [userId] = await seedUsers(1);

    // Force the reservation INSERT (the only writePool.query in the redis path)
    // to throw, simulating a DB hiccup after the lock was acquired.
    const spy = vi.spyOn(writePool, 'query').mockRejectedValueOnce(new Error('boom'));
    await expect(holdSeat({ userId, seatId, eventId })).rejects.toThrow('boom');
    spy.mockRestore();

    // The fix must have cleaned up our lock instead of leaving it for 480s.
    expect(await redis.exists(seatKey(eventId, seatId))).toBe(0);
  });
});
