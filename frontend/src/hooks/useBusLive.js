// Live sync for the bus vertical. Joins the schedule broadcast room (or a
// single trip room), patches the React Query cache on every 'trip-update',
// and surfaces waitlist promotions targeted at this user.
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getSocket } from '../services/socket.js';

const patchTrip = (trip, u) =>
  trip.id === u.tripId
    ? { ...trip, status: u.status, booked: u.booked, capacity: u.capacity, waitlistCount: u.waitlist }
    : trip;

/** Schedule page: keeps ['bus-schedule', date] counts/statuses live. */
export function useBusScheduleLive(date, { onPromoted } = {}) {
  const qc = useQueryClient();
  useEffect(() => {
    const socket = getSocket();
    const join = () => socket.emit('join-bus-schedule');
    if (socket.connected) join();

    const onUpdate = (u) => {
      qc.setQueryData(['bus-schedule', date], (prev) =>
        prev ? { ...prev, trips: prev.trips.map((t) => patchTrip(t, u)) } : prev,
      );
    };
    const onWaitlist = (d) => {
      onPromoted?.(d);
      qc.invalidateQueries({ queryKey: ['bus-schedule', date] });
    };

    socket.on('connect', join);
    socket.on('trip-update', onUpdate);
    socket.on('waitlist-available', onWaitlist);
    return () => {
      socket.emit('leave-bus-schedule');
      socket.off('connect', join);
      socket.off('trip-update', onUpdate);
      socket.off('waitlist-available', onWaitlist);
    };
  }, [date, qc, onPromoted]);
}

/** Trip page: refetches the detail (incl. the public waitlist) on every update. */
export function useBusTripLive(tripId, { onPromoted } = {}) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!tripId) return undefined;
    const socket = getSocket();
    const join = () => socket.emit('join-trip', tripId);
    if (socket.connected) join();

    const onUpdate = (u) => {
      if (u.tripId !== tripId) return;
      // The payload carries counts; the waitlist roster needs a refetch.
      qc.invalidateQueries({ queryKey: ['bus-trip', tripId] });
    };
    const onWaitlist = (d) => {
      if (d.eventId === tripId) onPromoted?.(d);
      qc.invalidateQueries({ queryKey: ['bus-trip', tripId] });
    };

    socket.on('connect', join);
    socket.on('trip-update', onUpdate);
    socket.on('waitlist-available', onWaitlist);
    return () => {
      socket.emit('leave-trip', tripId);
      socket.off('connect', join);
      socket.off('trip-update', onUpdate);
      socket.off('waitlist-available', onWaitlist);
    };
  }, [tripId, qc, onPromoted]);
}
