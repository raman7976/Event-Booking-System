// Unit tests for the deterministic bus-insights tiering/advice. busInsightsService
// imports only config + db (no top-level Redis), and db's pg Pool opens no
// connection until queried, so these pure functions need no mocks.
import { describe, it, expect } from 'vitest';
import { heuristicFlags, heuristicAdvice } from '../../src/services/busInsightsService.js';

describe('heuristicFlags', () => {
  it('flags a high-risk rider (>=50% miss rate, >=3 misses) for cooldown', () => {
    const [f] = heuristicFlags([
      { missRate: 0.6, misses: 3, total: 5, blockedWaiters: 2, recent: 'no_show' },
    ]);
    expect(f.tier).toBe('high');
    expect(f.action).toBe('cooldown');
    expect(f.rationale).toContain('blocking 2');
  });

  it('warns a medium-risk rider (>=30% miss rate, >=2 misses)', () => {
    const [f] = heuristicFlags([
      { missRate: 0.4, misses: 2, total: 5, blockedWaiters: 0, recent: 'confirmed' },
    ]);
    expect(f.tier).toBe('medium');
    expect(f.action).toBe('warn');
  });

  it('leaves an occasional misser as low risk', () => {
    const [f] = heuristicFlags([
      { missRate: 0.1, misses: 1, total: 10, blockedWaiters: 0, recent: 'confirmed' },
    ]);
    expect(f.tier).toBe('low');
    expect(f.action).toBe('none');
  });
});

describe('heuristicAdvice', () => {
  it('recommends increasing a route that fills and has a waitlist', () => {
    const [a] = heuristicAdvice([
      { avgFill: 0.98, avgWaitlist: 4, trips: 10, peakBooked: 40, capacity: 40 },
    ]);
    expect(a.recommendation).toBe('increase');
    expect(a.suggestedCapacity).toBe(44);
  });

  it('recommends decreasing a persistently underused route', () => {
    const [a] = heuristicAdvice([
      { avgFill: 0.2, avgWaitlist: 0, trips: 8, peakBooked: 12, capacity: 40 },
    ]);
    expect(a.recommendation).toBe('decrease');
  });

  it('keeps a healthily-utilized route unchanged', () => {
    const [a] = heuristicAdvice([
      { avgFill: 0.7, avgWaitlist: 0, trips: 10, peakBooked: 35, capacity: 40 },
    ]);
    expect(a.recommendation).toBe('keep');
    expect(a.suggestedCapacity).toBeNull();
  });
});
