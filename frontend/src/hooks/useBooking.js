// Hold / release / confirm, with optimistic patches to the seat cache so the
// acting user sees their own hold as "mine" immediately.
import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { holdSeat, releaseHold, confirmBooking } from '../services/api.js';

export function useBooking(eventId) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const patchSeat = useCallback(
    (seatId, patch) =>
      qc.setQueryData(['seats', eventId], (prev) =>
        prev ? prev.map((s) => (s.id === seatId ? { ...s, ...patch } : s)) : prev),
    [qc, eventId],
  );

  const hold = useCallback(
    async (seatId) => {
      const res = await holdSeat(seatId, eventId);
      patchSeat(seatId, { status: 'held', heldByMe: true });
      return res; // { holdToken, expiresAt, ttl }
    },
    [eventId, patchSeat],
  );

  const release = useCallback(
    async (seatId, holdToken) => {
      try { await releaseHold(seatId, holdToken); } catch { /* may already be gone */ }
      patchSeat(seatId, { status: 'available', heldByMe: false });
    },
    [patchSeat],
  );

  const confirm = useCallback(async (holdToken, paymentMethod) => {
    setBusy(true);
    try {
      return await confirmBooking(holdToken, paymentMethod);
    } finally {
      setBusy(false);
    }
  }, []);

  return { hold, release, confirm, busy };
}
