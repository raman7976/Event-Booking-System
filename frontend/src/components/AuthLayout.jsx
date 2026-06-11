// Split-screen auth shell: immersive brand panel (left, desktop only) + form.
import { motion } from 'framer-motion';
import Icon from './ui/Icon.jsx';

const PERKS = [
  ['bolt', 'Live seat maps', 'Watch holds and bookings land in real time over WebSockets.'],
  ['lock', 'Fair by design', 'Atomic Redis locks — two people can never book one seat.'],
  ['sparkles', 'AI seat finder', 'Tell it your group, budget and vibe; it picks the seats.'],
];

export default function AuthLayout({ title, subtitle, children }) {
  return (
    <div className="mx-auto mt-4 grid max-w-4xl overflow-hidden rounded-3xl shadow-card lg:grid-cols-2">
      {/* brand panel */}
      <div className="relative hidden flex-col justify-between overflow-hidden bg-gradient-to-br from-violet-950 via-[#14102a] to-fuchsia-950/70 p-10 lg:flex">
        <div className="animate-float-slow absolute -right-12 top-10 h-56 w-56 rounded-full bg-fuchsia-600/25 blur-3xl" aria-hidden="true" />
        <div className="animate-float-slower absolute -left-10 bottom-16 h-48 w-48 rounded-full bg-violet-600/25 blur-3xl" aria-hidden="true" />

        <div className="relative">
          <span className="font-display text-xl font-bold">
            <Icon name="ticket" size={18} className="-mt-1 mr-1.5 text-violet-200" />Seat<span className="text-gradient">Live</span>
          </span>
          <h2 className="mt-8 font-display text-3xl font-extrabold leading-tight">
            The seat you tap is <span className="text-gradient">yours in milliseconds.</span>
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
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/10"><Icon name={icon} size={17} className="text-violet-200" /></span>
              <div>
                <div className="font-display text-sm font-semibold">{head}</div>
                <div className="text-xs leading-relaxed text-slate-400">{body}</div>
              </div>
            </motion.li>
          ))}
        </ul>
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
