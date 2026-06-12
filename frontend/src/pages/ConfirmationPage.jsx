import { useLocation, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import Confetti from '../components/ui/Confetti.jsx';
import { eventMedia, coverErrorHandler } from '../lib/eventMedia.js';
import Icon from '../components/ui/Icon.jsx';
import { inr } from '../lib/money.js';

// Real client-side "Add to calendar": builds an .ics VEVENT data URI.
function icsHref(event, seat) {
  const start = new Date(event.date);
  const end = new Date(start.getTime() + 2 * 3600e3);
  const fmt = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const body = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//SeatLive//EN', 'BEGIN:VEVENT',
    `UID:seatlive-${event.id}-${seat.row}${seat.number}`,
    `DTSTAMP:${fmt(new Date())}`, `DTSTART:${fmt(start)}`, `DTEND:${fmt(end)}`,
    `SUMMARY:${event.name} — seat ${seat.row}${seat.number}`,
    `LOCATION:${event.venue || ''}`,
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(body)}`;
}

// Decorative deterministic "scan code" for the ticket stub. Each cell hashes
// (seed, x, y) independently — a plain seed*x*y product goes all-zero whenever
// the seed is divisible by the modulus, which blanked 1-in-11 tickets.
function FauxQR({ seedStr }) {
  const seed = [...seedStr].reduce((a, c) => a + c.charCodeAt(0), 7);
  const cells = [];
  for (let y = 0; y < 9; y += 1) {
    for (let x = 0; x < 9; x += 1) {
      const h = (Math.imul(seed + x * 9 + y, 2654435761) >>> 0) % 11;
      if (h > 4) cells.push([x, y]);
    }
  }
  return (
    <svg viewBox="0 0 9 9" className="h-20 w-20 rounded bg-white p-1 ring-1 ring-slate-200">
      {cells.map(([x, y]) => <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill="#0a0a12" />)}
    </svg>
  );
}

function Row({ label, value, mono }) {
  return (
    <div className="flex items-baseline justify-between gap-6">
      <span className="text-xs uppercase tracking-wider text-slate-400">{label}</span>
      <span className={`text-right text-sm font-medium text-slate-800 ${mono ? 'font-mono text-xs' : ''}`}>{value}</span>
    </div>
  );
}

export default function ConfirmationPage() {
  const { state } = useLocation();
  const booking = state?.booking;

  if (!booking) {
    return (
      <div className="glass mx-auto mt-16 max-w-md p-10 text-center">
        <p className="text-slate-400">No booking to show.</p>
        <Link to="/" className="btn-ghost mt-4">Back to events</Link>
      </div>
    );
  }

  const { seat, event, payment } = booking;
  const media = eventMedia(event);
  const date = new Date(event.date);

  return (
    <div className="mx-auto max-w-lg">
      <Confetti />

      <motion.p
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-5 text-center font-display text-2xl font-extrabold text-slate-900 sm:text-3xl"
      >
        You&apos;re going! <span className="text-gradient">Seat locked.</span>
      </motion.p>

      {/* ticket */}
      <motion.div
        initial={{ opacity: 0, scale: 0.92, rotate: -1.2 }}
        animate={{ opacity: 1, scale: 1, rotate: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 19, delay: 0.1 }}
        className="overflow-hidden rounded-3xl bg-white shadow-card">
        {/* media header */}
        <div className="relative h-36 overflow-hidden">
          <div className={`absolute inset-0 bg-gradient-to-br ${media.gradient}`} />
          <img src={media.image} onError={coverErrorHandler(media.fallback)} alt="" className="h-full w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
          <div className="absolute bottom-3 left-5 right-5">
            <h1 className="font-display text-xl font-bold text-white drop-shadow">{event.name}</h1>
            <p className="text-xs text-slate-200"><Icon name="pin" size={11} className="-mt-0.5 mr-1" />{event.venue}</p>
          </div>
          <span className="chip-onmedia absolute right-4 top-4 !text-emerald-200">✓ CONFIRMED</span>
        </div>

        {/* perforation */}
        <div className="ticket-notch relative flex items-center px-6">
          <div className="w-full border-t-2 border-dashed border-slate-200" />
        </div>

        {/* stub */}
        <div className="flex gap-6 p-6">
          <div className="flex-1 space-y-2.5">
            <Row label="Date" value={date.toLocaleDateString([], { dateStyle: 'medium' })} />
            <Row label="Time" value={date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} />
            <Row label="Seat" value={`${seat.row}${seat.number} · ${seat.category}`} />
            <Row label="Paid" value={`${inr(payment.amount)} · ${payment.method}`} />
            <Row label="Txn" value={payment.transactionId} mono />
          </div>
          <div className="flex flex-col items-center justify-center gap-1.5">
            <FauxQR seedStr={payment.transactionId || event.id} />
            <span className="font-display text-2xl font-extrabold text-gradient">{seat.row}{seat.number}</span>
          </div>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.45 }}
        className="mt-6 flex flex-wrap justify-center gap-3"
      >
        <a href={icsHref(event, seat)} download={`seatlive-${seat.row}${seat.number}.ics`} className="btn-primary">
          <Icon name="calendar" size={15} /> Add to calendar
        </a>
        <Link to="/my-bookings" className="btn-ghost">My bookings</Link>
        <Link to={`/events/${event.id}`} className="btn-ghost">Back to seat map</Link>
      </motion.div>

      <p className="mt-4 text-center text-xs text-slate-500">
        A confirmation email was queued — check the worker logs for the Ethereal preview link.
      </p>
    </div>
  );
}
