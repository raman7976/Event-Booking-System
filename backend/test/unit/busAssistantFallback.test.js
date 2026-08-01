// Unit tests for the assistant's deterministic fallback (used when GROQ_API_KEY
// is unset). Infra + LLM are mocked so no connections open.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/services/ai/llm.js', () => ({
  isEnabled: () => false,
  runToolLoop: vi.fn(),
}));
vi.mock('../../src/services/ragService.js', () => ({
  retrieve: vi.fn(),
  toContextBlock: vi.fn(),
}));
vi.mock('../../src/services/busService.js', () => ({
  getSchedule: vi.fn(),
  getTripDetail: vi.fn(),
  getMyBusTrips: vi.fn(),
}));

const rag = await import('../../src/services/ragService.js');
const bus = await import('../../src/services/busService.js');
const { ask } = await import('../../src/services/busAgentService.js');

const user = { id: 'u1', rollNumber: '23UCS101' };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('assistant fallback (no GROQ key)', () => {
  it('routes "my trips" questions to getMyBusTrips', async () => {
    bus.getMyBusTrips.mockResolvedValue([
      { busNo: 1, origin: 'LNMIIT', destination: 'Raja Park', departureAt: '2026-06-25T12:30:00Z', bookingStatus: 'confirmed', waitlisted: false },
    ]);
    const res = await ask({ user, message: 'what are my bus bookings?' });
    expect(bus.getMyBusTrips).toHaveBeenCalledWith('u1');
    expect(res.answer).toMatch(/Raja Park/);
    expect(res.source).toBe('fallback');
  });

  it('routes destination/schedule questions to getSchedule', async () => {
    bus.getSchedule.mockResolvedValue([
      { busNo: 2, origin: 'LNMIIT', destination: 'Raja Park', departureAt: '2026-06-25T12:30:00Z', booked: 10, capacity: 40, status: 'open', myStatus: null },
      { busNo: 3, origin: 'LNMIIT', destination: 'Ajmeri Gate', departureAt: '2026-06-25T13:00:00Z', booked: 5, capacity: 40, status: 'open', myStatus: null },
    ]);
    const res = await ask({ user, message: 'next bus to Raja Park?' });
    expect(bus.getSchedule).toHaveBeenCalled();
    expect(res.answer).toMatch(/Raja Park/);
    expect(res.answer).not.toMatch(/Ajmeri/); // filtered to the requested destination
  });

  it('routes policy questions to RAG retrieval', async () => {
    rag.retrieve.mockResolvedValue([
      { source: 'policy.md', title: 'Policy', content: 'A no-show means you booked but never boarded.' },
    ]);
    const res = await ask({ user, message: 'what is the no-show policy?' });
    expect(rag.retrieve).toHaveBeenCalledWith('what is the no-show policy?', { kind: 'bus_doc' });
    expect(res.answer).toMatch(/no-show/);
    expect(res.sources[0].source).toBe('policy.md');
  });
});
