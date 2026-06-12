// Split-screen auth shell: near-black brand panel (desktop) + white form panel.
// Mirrors the site's light theme — slate-950 surfaces, uppercase kickers,
// hairline borders — instead of shouting with color.
import { motion } from 'framer-motion';
import Icon from './ui/Icon.jsx';

const PERKS = [
  ['bolt', 'Live seat maps', 'Holds and bookings land in real time over WebSockets — no refreshes.'],
  ['lock', 'Fair by design', 'Atomic Redis locks: two people can never book the same seat.'],
  ['bus', 'Campus bus, built in', 'LNMIIT emails get their roll number detected automatically.'],
];

const STATS = [
  ['8 min', 'seat hold'],
  ['2', 'app nodes'],
  ['0', 'double bookings'],
];

export default function AuthLayout({ title, subtitle, children }) {
  return (
    <div className="mx-auto mt-4 grid max-w-4xl overflow-hidden rounded-3xl border border-slate-200/60 bg-white shadow-[0_24px_60px_-28px_rgba(15,23,42,0.25)] lg:grid-cols-[1.05fr_1fr]">
      {/* brand panel */}
      <div className="relative hidden flex-col justify-between overflow-hidden bg-slate-950 p-10 lg:flex">
        {/* faint depth glows — monochrome, matching the site's slate accents */}
        <div className="animate-float-slow absolute -right-16 top-8 h-64 w-64 rounded-full bg-slate-500/15 blur-3xl" aria-hidden="true" />
        <div className="animate-float-slower absolute -left-12 bottom-20 h-52 w-52 rounded-full bg-slate-400/10 blur-3xl" aria-hidden="true" />
        <div
          aria-hidden="true"
          className="absolute inset-0 opacity-[0.13]"
          style={{
            backgroundImage: 'radial-gradient(rgba(255,255,255,0.5) 1px, transparent 1px)',
            backgroundSize: '26px 26px',
          }}
        />

        <div className="relative">
          <span className="font-display text-xl font-bold text-white">
            <Icon name="ticket" size={18} className="-mt-1 mr-1.5 text-slate-300" />Seat<span className="text-slate-400">Live</span>
          </span>
          <p className="mt-8 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.3em] text-slate-500">
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse-dot" />
            Real-time booking platform
          </p>
          <h2 className="mt-3 font-display text-3xl font-extrabold leading-tight text-white">
            The seat you tap is yours in milliseconds.
          </h2>
        </div>

        <ul className="relative space-y-5">
          {PERKS.map(([icon, head, body], i) => (
            <motion.li
              key={head}
              initial={{ opacity: 0, x: -16 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.15 + i * 0.12 }}
              className="flex gap-3"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5">
                <Icon name={icon} size={17} className="text-slate-300" />
              </span>
              <div>
                <div className="font-display text-sm font-semibold text-white">{head}</div>
                <div className="text-xs leading-relaxed text-slate-400">{body}</div>
              </div>
            </motion.li>
          ))}
        </ul>

        <div className="relative mt-8 grid grid-cols-3 divide-x divide-white/10 rounded-2xl border border-white/10 bg-white/[0.04] py-3 text-center">
          {STATS.map(([num, label]) => (
            <div key={label}>
              <div className="font-display text-lg font-extrabold text-white">{num}</div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* form panel */}
      <div className="bg-white p-8 sm:p-10">
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
          <h1 className="font-display text-2xl font-bold text-slate-900">{title}</h1>
          <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
          <div className="mt-7">{children}</div>
        </motion.div>
      </div>
    </div>
  );
}
