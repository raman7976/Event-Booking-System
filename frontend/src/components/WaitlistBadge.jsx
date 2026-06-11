// Sold-out banner with live waitlist position + join/leave controls.
import { motion } from 'framer-motion';

export default function WaitlistBadge({ info, onJoin, onLeave, busy }) {
  if (!info) return null;
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="relative overflow-hidden rounded-2xl border border-amber-200 bg-amber-50 p-4"
    >
      <div className="absolute -left-8 -top-10 h-28 w-28 rounded-full bg-amber-200/50 blur-2xl" aria-hidden="true" />
      <div className="relative flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100 text-lg">⏳</span>
          <div className="text-sm">
            {info.onWaitlist ? (
              <>
                <div className="font-display font-semibold text-amber-900">
                  You&apos;re #{info.position ?? '—'} in line
                </div>
                <div className="text-amber-700">
                  {info.size} waiting · we&apos;ll ping you live the second a seat frees up
                </div>
              </>
            ) : (
              <>
                <div className="font-display font-semibold text-amber-900">Sold out — for now</div>
                <div className="text-amber-700">
                  {info.size} in the waitlist · holds expire after 8 min, seats do come back
                </div>
              </>
            )}
          </div>
        </div>
        {info.onWaitlist ? (
          <button type="button" onClick={onLeave} disabled={busy} className="btn-ghost shrink-0 !py-2">
            Leave waitlist
          </button>
        ) : (
          <button
            type="button"
            onClick={onJoin}
            disabled={busy}
            className="shrink-0 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 px-4 py-2 text-sm font-semibold text-white shadow-[0_8px_24px_-10px_rgba(245,158,11,0.8)] transition hover:-translate-y-0.5 disabled:opacity-50"
          >
            {busy ? 'Joining…' : 'Join waitlist'}
          </button>
        )}
      </div>
    </motion.div>
  );
}
