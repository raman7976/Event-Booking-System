// Seat list via React Query, kept live by the WebSocket sync in useSocket.
import { useQuery } from '@tanstack/react-query';
import { getSeats } from '../services/api.js';
import { useSocket } from './useSocket.js';

export function useSeats(eventId, socketOpts = {}) {
  useSocket(eventId, socketOpts);
  return useQuery({
    queryKey: ['seats', eventId],
    queryFn: () => getSeats(eventId),
    enabled: Boolean(eventId),
  });
}
