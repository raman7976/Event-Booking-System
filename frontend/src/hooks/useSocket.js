// WebSocket sync: joins the event room and patches the React Query seat cache
// directly on each 'seat-update' (NO API refetch). Auto-reconnects via socket.io.
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getSocket } from '../services/socket.js';

export function useSocket(eventId, { onWaitlistAvailable } = {}) {
  const qc = useQueryClient();

  useEffect(() => {
    if (!eventId) return undefined;
    const socket = getSocket();

    const join = () => socket.emit('join-event', eventId);
    if (socket.connected) join();

    // Patch the cached seat list in place — instant UI update, no refetch.
    // changedAt drives a one-shot flash so live updates are visible.
    const onSeatUpdate = (u) => {
      qc.setQueryData(['seats', eventId], (prev) =>
        prev
          ? prev.map((s) =>
              s.id === u.seatId
                ? {
                    ...s,
                    status: u.status,
                    heldByMe: u.status === 'held' ? s.heldByMe : false,
                    changedAt: u.timestamp || Date.now(),
                  }
                : s,
            )
          : prev,
      );
    };
    const onWaitlist = (d) => onWaitlistAvailable?.(d);

    socket.on('connect', join);
    socket.on('seat-update', onSeatUpdate);
    socket.on('waitlist-available', onWaitlist);

    return () => {
      socket.emit('leave-event', eventId);
      socket.off('connect', join);
      socket.off('seat-update', onSeatUpdate);
      socket.off('waitlist-available', onWaitlist);
    };
  }, [eventId, qc, onWaitlistAvailable]);
}
