// Unit tests for roll-number derivation from an institute email. Redis is
// factory-mocked so importing authService opens no connection.
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/config/redis.js', () => ({
  redis: { set: vi.fn(), get: vi.fn(), del: vi.fn(), getdel: vi.fn(), incr: vi.fn(), expire: vi.fn() },
  isRedisReady: () => false,
}));

const { deriveRollFromEmail } = await import('../../src/services/authService.js');

describe('deriveRollFromEmail', () => {
  it('extracts and uppercases the roll from a student address', () => {
    expect(deriveRollFromEmail('23ucs689@lnmiit.ac.in')).toBe('23UCS689');
  });

  it('returns null for staff addresses that are not roll-shaped', () => {
    expect(deriveRollFromEmail('admin@lnmiit.ac.in')).toBeNull();
    expect(deriveRollFromEmail('transport.office@lnmiit.ac.in')).toBeNull();
  });

  it('returns null for non-institute domains', () => {
    expect(deriveRollFromEmail('23ucs689@gmail.com')).toBeNull();
  });
});
