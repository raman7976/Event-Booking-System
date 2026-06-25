// Unit test for the bus trip-time math. busService transitively imports Redis
// (via queues / cacheService / emitter), so those are factory-mocked; tripTimes
// itself only reads config window sizes.
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/config/redis.js', () => ({
  redis: {}, publisher: {}, subscriber: {}, isRedisReady: () => false,
}));
vi.mock('../../src/config/queues.js', () => ({
  scheduleBusJob: vi.fn(),
  enqueueEmail: vi.fn(),
}));
vi.mock('../../src/services/cacheService.js', () => ({
  publishWaitlistNotify: vi.fn(),
  markUserWrite: vi.fn(),
}));
vi.mock('../../src/lib/emitter.js', () => ({
  emitTripUpdate: vi.fn(),
}));
vi.mock('../../src/config/metrics.js', () => ({
  busActions: { inc: vi.fn() },
  waitlistPromotions: { inc: vi.fn() },
}));

const { tripTimes } = await import('../../src/services/busService.js');

describe('tripTimes', () => {
  it('derives open/confirm/release offsets from departure (defaults: 60/20/10 min)', () => {
    const departure = new Date('2026-06-24T18:00:00.000Z');
    const t = tripTimes(departure);
    expect(t.departureAt.getTime()).toBe(departure.getTime());
    expect(t.opensAt.getTime()).toBe(departure.getTime() - 3600 * 1000);
    expect(t.confirmAt.getTime()).toBe(departure.getTime() - 1200 * 1000);
    expect(t.releaseAt.getTime()).toBe(departure.getTime() - 600 * 1000);
  });
});
