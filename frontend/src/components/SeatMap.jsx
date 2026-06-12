// Immersive seat picker: curved glowing stage, staggered row entrance, hover
// tooltips, per-status gradients, live countdowns on your own holds, and a
// one-shot white flash whenever a seat changes state over the WebSocket.
import { useMemo } from 'react';
import { motion } from 'framer-motion';
import CountdownTimer, { DARK_SURFACE_TONES } from './CountdownTimer.jsx';

const SEAT_STYLE = {
  available:
    'bg-gradient-to-b from-emerald-400/90 to-emerald-600/90 text-emerald-950 hover:shadow-[0_0_18px_-2px_rgba(52,211,153,0.8)] hover:!scale-125 hover:z-10 cursor-pointer',
  heldOthers: 'bg-gradient-to-b from-amber-400/80 to-amber-600/80 text-amber-950 cursor-not-allowed',
  mine:
    'bg-gradient-to-b from-blue-400 to-violet-600 text-white ring-2 ring-blue-300/60 shadow-[0_0_18px_-2px_rgba(96,165,250,0.8)] cursor-pointer',
  booked: 'bg-gradient-to-b from-rose-500/80 to-rose-700/80 text-rose-50 cursor-not-allowed',
  disabled: 'bg-slate-300 text-slate-500 cursor-not-allowed',
};

function seatVariant(seat) {
  if (seat.status === 'booked') return 'booked';
  if (seat.status === 'held') return seat.heldByMe ? 'mine' : 'heldOthers';
  if (seat.status === 'available') return 'available';
  return 'disabled';
}

function Stage() {
  return (
    <div className="relative mx-auto mb-7 w-full max-w-xl">
      <svg viewBox="0 0 600 64" className="w-full" aria-hidden="true">
        <defs>
          <linearGradient id="stage-g" x1="0" x2="1">
            <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.1" />
            <stop offset="50%" stopColor="#d946ef" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#22d3ee" stopOpacity="0.1" />
          </linearGradient>
        </defs>
        <path d="M30,58 Q300,-26 570,58" fill="none" stroke="url(#stage-g)" strokeWidth="3" strokeLinecap="round" />
      </svg>
      <span className="absolute inset-x-0 -bottom-1 text-center text-[10px] font-semibold uppercase tracking-[0.5em] text-slate-400">
        Stage
      </span>
      <div className="absolute inset-x-1/4 top-3 h-8 rounded-[100%] bg-fuchsia-400/20 blur-2xl" aria-hidden="true" />
    </div>
  );
}

export default function SeatMap({ seats = [], onSeatClick, holdsBySeat = {}, onHoldExpire }) {
  const rows = useMemo(() => {
    const m = {};
    for (const s of seats) (m[s.row] ||= []).push(s);
    for (const r of Object.keys(m)) m[r].sort((a, b) => a.number - b.number);
    return Object.entries(m).sort(([a], [b]) => a.localeCompare(b));
  }, [seats]);

  if (!seats.length) {
    return <div className="py-14 text-center text-slate-400">No seats for this event.</div>;
  }

  return (
    <div>
      <Stage />
      <div className="space-y-2.5">
        {rows.map(([row, list], rowIdx) => (
          <motion.div
            key={row}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.06 * rowIdx, duration: 0.45, ease: 'easeOut' }}
            className="flex items-center justify-center gap-2"
          >
            <span className="w-6 text-right font-display text-xs font-semibold text-slate-400">{row}</span>
            <div className="flex flex-wrap justify-center gap-1.5">
              {list.map((seat) => {
                const variant = seatVariant(seat);
                const clickable = variant === 'available' || variant === 'mine';
                const hold = holdsBySeat[seat.id];
                const flashing = seat.changedAt && Date.now() - seat.changedAt < 1600;
                return (
                  <button
                    key={seat.id}
                    type="button"
                    disabled={!clickable}
                    onClick={() => clickable && onSeatClick?.(seat)}
                    aria-label={`Seat ${seat.row}${seat.number}, ${seat.category}, ₹${seat.price}, ${seat.heldByMe ? 'your hold' : seat.status}`}
                    className={`group relative flex h-9 w-9 items-center justify-center rounded-lg text-[10px] font-bold transition-all duration-150 ${SEAT_STYLE[variant]}`}
                  >
                    {variant === 'mine' && hold ? (
                      <CountdownTimer expiresAt={hold.expiresAt} onExpire={() => onHoldExpire?.(seat.id)} className="text-[8.5px]" tones={DARK_SURFACE_TONES} />
                    ) : (
                      seat.number
                    )}

                    {flashing && <span key={seat.changedAt} className="seat-flash-overlay" />}

                    {/* tooltip */}
                    <span className="pointer-events-none absolute -top-12 left-1/2 z-20 hidden -translate-x-1/2 whitespace-nowrap rounded-lg border border-white/10 bg-[#16161f] px-2.5 py-1.5 text-[10px] font-medium text-slate-200 opacity-0 shadow-card transition-opacity duration-150 group-hover:opacity-100 md:block">
                      <b className="font-display">{seat.row}{seat.number}</b>
                      <span className="mx-1.5 text-slate-500">·</span>{seat.category}
                      <span className="mx-1.5 text-slate-500">·</span>₹{seat.price}
                      <span className="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-[#16161f]" />
                    </span>
                  </button>
                );
              })}
            </div>
            <span className="w-6 font-display text-xs font-semibold text-slate-400">{row}</span>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
