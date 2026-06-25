// Unit tests for the deterministic seat-recommender heuristic. The infra modules
// pulled in transitively by seatService are factory-mocked so importing the
// service never opens a Redis/PG connection — these functions are pure.
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/config/redis.js', () => ({
  redis: { incr: vi.fn(), expire: vi.fn(), holdSeat: vi.fn(), get: vi.fn(), del: vi.fn(), mget: vi.fn() },
  isRedisReady: () => false,
}));
vi.mock('../../src/config/queues.js', () => ({
  scheduleExpiry: vi.fn(),
  cancelExpiry: vi.fn(),
}));
vi.mock('../../src/services/cacheService.js', () => ({
  publishSeatUpdate: vi.fn(),
  markUserWrite: vi.fn(),
}));
vi.mock('../../src/config/metrics.js', () => ({
  seatHolds: { inc: vi.fn() },
}));

const { heuristicRecommend, normalizePrefs, buildReason } = await import('../../src/services/seatService.js');

const seats = [
  { id: 'a1', row: 'A', number: 1, category: 'GEN', price: 100, status: 'available' },
  { id: 'a2', row: 'A', number: 2, category: 'GEN', price: 100, status: 'available' },
  { id: 'b1', row: 'B', number: 1, category: 'GEN', price: 50, status: 'available' },
  { id: 'b2', row: 'B', number: 2, category: 'GEN', price: 50, status: 'available' },
];

describe('normalizePrefs', () => {
  it('parses a comma string into a lowercased set', () => {
    const s = normalizePrefs('Front, Together');
    expect(s.has('front')).toBe(true);
    expect(s.has('together')).toBe(true);
  });
  it('handles arrays and trims/normalizes', () => {
    const s = normalizePrefs(['Aisle', ' BACK ']);
    expect([...s].sort()).toEqual(['aisle', 'back']);
  });
  it('returns an empty set for null/undefined', () => {
    expect(normalizePrefs(null).size).toBe(0);
    expect(normalizePrefs(undefined).size).toBe(0);
  });
});

describe('heuristicRecommend — together', () => {
  it('picks the cheapest consecutive run in one row', () => {
    const r = heuristicRecommend(seats, 2, null, normalizePrefs('together'));
    expect(r.recommendedSeatIds).toEqual(['b1', 'b2']); // 100 total < the A-row run (200)
  });

  it('honors a front preference when choosing among runs', () => {
    const r = heuristicRecommend(seats, 2, null, normalizePrefs('together,front'));
    expect(r.recommendedSeatIds).toEqual(['a1', 'a2']); // front rows rank first
  });
});

describe('heuristicRecommend — budget', () => {
  it('fills within budget cheapest-first', () => {
    const r = heuristicRecommend(seats, 2, 120, normalizePrefs(''));
    expect(r.recommendedSeatIds).toEqual(['b1', 'b2']); // 100 <= 120
  });

  it('excludes over-budget seats and returns a partial set', () => {
    const r = heuristicRecommend(seats, 2, 90, normalizePrefs(''));
    expect(r.recommendedSeatIds).toEqual(['b1']); // only one 50-seat fits under 90
    expect(r.reason).toMatch(/Only 1 of 2/);
  });
});

describe('buildReason', () => {
  it('mentions the seat labels and a rupee total', () => {
    const reason = buildReason([seats[2], seats[3]], normalizePrefs('together'), 100);
    expect(reason).toContain('B1');
    expect(reason).toContain('B2');
    expect(reason).toContain('₹100');
  });
});
