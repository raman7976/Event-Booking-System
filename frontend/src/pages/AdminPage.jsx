// Admin panel: animated overview counters, event management table, and a
// create-event form with a dynamic seat-section builder.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  listEvents, adminOverview, adminCreateEvent, adminDeleteEvent, apiError,
} from '../services/api.js';
import { useCountUp } from '../hooks/useCountUp.js';
import { useToast } from '../components/ui/Toast.jsx';

const emptySection = () => ({ rows: 'A,B', cols: 8, category: 'GENERAL', price: 50 });

function Stat({ label, value, prefix = '', delay = 0 }) {
  const n = useCountUp(typeof value === 'number' ? value : 0);
  return (
    <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay }} className="glass p-4">
      <div className="text-[11px] font-medium uppercase tracking-wider text-slate-400">{label}</div>
      <div className="mt-0.5 font-display text-2xl font-extrabold text-slate-900">
        {value == null ? '—' : `${prefix}${n.toLocaleString()}`}
      </div>
    </motion.div>
  );
}

export default function AdminPage() {
  const qc = useQueryClient();
  const toast = useToast();

  const { data: overview } = useQuery({ queryKey: ['admin', 'overview'], queryFn: adminOverview });
  const { data: eventsData, isLoading } = useQuery({ queryKey: ['events'], queryFn: () => listEvents(1, 100) });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['events'] });
    qc.invalidateQueries({ queryKey: ['admin', 'overview'] });
  };

  const createMut = useMutation({
    mutationFn: adminCreateEvent,
    onSuccess: ({ event }) => {
      invalidate();
      toast.push(`Created "${event.name}" with ${event.total_seats} seats.`, 'success');
    },
    onError: (err) => toast.push(apiError(err), 'error', 6000),
  });

  const deleteMut = useMutation({
    mutationFn: adminDeleteEvent,
    onSuccess: () => { invalidate(); toast.push('Event deleted.', 'success'); },
    onError: (err) => toast.push(apiError(err), 'error', 6000),
  });

  const [name, setName] = useState('');
  const [venue, setVenue] = useState('');
  const [date, setDate] = useState('');
  const [sections, setSections] = useState([emptySection()]);

  const updateSection = (i, patch) =>
    setSections((s) => s.map((sec, j) => (j === i ? { ...sec, ...patch } : sec)));

  const submit = (e) => {
    e.preventDefault();
    createMut.mutate({
      name: name.trim(),
      venue: venue.trim(),
      eventDate: new Date(date).toISOString(),
      layout: sections.map((s) => ({ ...s, cols: Number(s.cols), price: Number(s.price) })),
    });
  };

  const events = eventsData?.events || [];

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-display text-2xl font-extrabold text-slate-900 sm:text-3xl">
          Admin <span className="text-gradient">panel</span>
        </h1>
        <span className="chip !border-violet-200 !bg-violet-50 !text-violet-700">👑 admin access</span>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="Events" value={overview?.events} />
        <Stat label="Users" value={overview?.users} delay={0.05} />
        <Stat label="Seats sold" value={overview?.seatsSold} delay={0.1} />
        <Stat label="Bookings" value={overview?.confirmedBookings} delay={0.15} />
        <Stat label="Revenue" value={overview?.revenue} prefix="$" delay={0.2} />
      </div>

      <div className="grid gap-5 lg:grid-cols-5">
        {/* events table */}
        <motion.div
          initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
          className="glass p-5 lg:col-span-3"
        >
          <h2 className="mb-4 font-display font-bold text-slate-900">Events</h2>
          {isLoading ? (
            <div className="space-y-2">{[...Array(3)].map((_, i) => <div key={i} className="skeleton h-12 rounded-xl" />)}</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wider text-slate-400">
                  <th className="py-2.5 pr-2 font-medium">Event</th>
                  <th className="py-2.5 pr-2 font-medium">Date</th>
                  <th className="py-2.5 pr-2 font-medium">Seats</th>
                  <th className="py-2.5 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {events.map((ev) => (
                  <tr key={ev.id} className="border-b border-slate-100 transition-colors hover:bg-slate-50">
                    <td className="py-3 pr-2">
                      <div className="font-medium text-slate-900">{ev.name}</div>
                      <div className="text-xs text-slate-400">{ev.venue}</div>
                    </td>
                    <td className="py-3 pr-2 text-slate-500">{new Date(ev.event_date).toLocaleDateString()}</td>
                    <td className="py-3 pr-2">
                      <span className={ev.available_seats === 0 ? 'text-rose-600' : 'text-emerald-600'}>
                        {ev.available_seats}
                      </span>
                      <span className="text-slate-400">/{ev.total_seats}</span>
                    </td>
                    <td className="py-3">
                      <div className="flex gap-1.5">
                        <Link to={`/events/${ev.id}/dashboard`} className="btn-ghost !rounded-lg !px-2 !py-1 text-[11px]">📊</Link>
                        <Link to={`/events/${ev.id}`} className="btn-ghost !rounded-lg !px-2 !py-1 text-[11px]">🪑</Link>
                        <button
                          type="button"
                          onClick={() => deleteMut.mutate(ev.id)}
                          disabled={deleteMut.isPending}
                          className="rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] text-rose-600 transition hover:bg-rose-100 disabled:opacity-50"
                        >
                          🗑
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {events.length === 0 && (
                  <tr><td colSpan={4} className="py-6 text-center text-slate-500">No events yet — create one →</td></tr>
                )}
              </tbody>
            </table>
          )}
        </motion.div>

        {/* create form */}
        <motion.form
          onSubmit={submit}
          initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.16 }}
          className="glass p-5 lg:col-span-2"
        >
          <h2 className="mb-4 font-display font-bold text-slate-900">Create event</h2>
          <div className="space-y-3">
            <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Event name" className="input-field" />
            <input required value={venue} onChange={(e) => setVenue(e.target.value)} placeholder="Venue" className="input-field" />
            <input required type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} className="input-field" />

            <div className="space-y-2.5">
              <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Seat sections</div>
              {sections.map((sec, i) => (
                <div key={i} className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                  <div className="grid grid-cols-2 gap-2.5">
                    <label className="text-[11px] text-slate-500">
                      Rows (comma sep)
                      <input value={sec.rows} onChange={(e) => updateSection(i, { rows: e.target.value })} className="input-field mt-1 !py-1.5 text-xs" />
                    </label>
                    <label className="text-[11px] text-slate-500">
                      Seats per row
                      <input type="number" min="1" max="50" value={sec.cols} onChange={(e) => updateSection(i, { cols: e.target.value })} className="input-field mt-1 !py-1.5 text-xs" />
                    </label>
                    <label className="text-[11px] text-slate-500">
                      Category
                      <select value={sec.category} onChange={(e) => updateSection(i, { category: e.target.value })} className="input-field mt-1 !py-1.5 text-xs">
                        <option>VIP</option><option>PREMIUM</option><option>GENERAL</option>
                      </select>
                    </label>
                    <label className="text-[11px] text-slate-500">
                      Price ($)
                      <input type="number" min="1" value={sec.price} onChange={(e) => updateSection(i, { price: e.target.value })} className="input-field mt-1 !py-1.5 text-xs" />
                    </label>
                  </div>
                  {sections.length > 1 && (
                    <button type="button" onClick={() => setSections((s) => s.filter((_, j) => j !== i))} className="mt-2 text-[11px] text-rose-300 hover:underline">
                      Remove section
                    </button>
                  )}
                </div>
              ))}
              <button type="button" onClick={() => setSections((s) => [...s, emptySection()])} className="btn-ghost w-full !py-2 text-xs">
                + Add section
              </button>
            </div>

            <button type="submit" disabled={createMut.isPending} className="btn-primary w-full !py-2.5">
              {createMut.isPending ? 'Creating…' : '🎪 Create event'}
            </button>
          </div>
        </motion.form>
      </div>
    </div>
  );
}
