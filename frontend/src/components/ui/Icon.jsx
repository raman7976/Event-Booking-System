// Minimal inline icon set (24x24, stroke-based, inherits currentColor).
// Used instead of emoji glyphs so symbols render consistently across
// platforms and can be colored/sized like text.
const STROKE = {
  ticket: (
    <>
      <path d="M3 9V7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a3 3 0 0 0 0 6v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a3 3 0 0 0 0-6Z" />
      <path d="M13 5v2M13 11v2M13 17v2" strokeDasharray="0.1 3.4" />
    </>
  ),
  bus: (
    <>
      <rect x="3.5" y="4" width="17" height="13" rx="2.5" />
      <path d="M3.5 11h17M8 4v7M16 4v7" />
      <circle cx="8" cy="19.5" r="1.4" />
      <circle cx="16" cy="19.5" r="1.4" />
    </>
  ),
  pin: (
    <>
      <path d="M20 10.4C20 16 12 22 12 22S4 16 4 10.4a8 8 0 1 1 16 0Z" />
      <circle cx="12" cy="10.4" r="2.8" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M16 3v4M8 3v4M3 11h18" />
    </>
  ),
  chart: <path d="M4 4v16h16M9 16v-5M13.5 16V8M18 16v-3" />,
  trash: (
    <>
      <path d="M4 7h16M9.5 7V5a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 14.5 5v2" />
      <path d="M18.5 7 17.6 19a2 2 0 0 1-2 1.9H8.4a2 2 0 0 1-2-1.9L5.5 7" />
      <path d="M10 11.5v5M14 11.5v5" />
    </>
  ),
  pause: <path d="M9 5v14M15 5v14" strokeWidth="2.6" />,
  refresh: (
    <>
      <path d="M21 12a9 9 0 1 1-2.6-6.4" />
      <path d="M21 3.5v5h-5" />
    </>
  ),
  shield: <path d="M12 2.5 19.5 6v5.6c0 4.7-3.2 8.1-7.5 9.9-4.3-1.8-7.5-5.2-7.5-9.9V6Z" />,
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3.5 7.5 8.5 6 8.5-6" />
    </>
  ),
  sparkles: (
    <>
      <path d="m12 3.5 1.8 4.7L18.5 10l-4.7 1.8L12 16.5l-1.8-4.7L5.5 10l4.7-1.8Z" />
      <path d="m19 15 .7 1.8 1.8.7-1.8.7L19 20l-.7-1.8-1.8-.7 1.8-.7Z" />
    </>
  ),
  alert: (
    <>
      <path d="M10.3 4.2 2.5 17.5A2 2 0 0 0 4.2 20.5h15.6a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9.5v4M12 17h.01" />
    </>
  ),
  'check-circle': (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m8.3 12.4 2.6 2.6 4.8-5.8" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  lock: (
    <>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    </>
  ),
  id: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="8.5" cy="10.5" r="2" />
      <path d="M14 9.5h4.5M14 13h4.5M5.8 15.8c.6-1.4 1.6-2 2.7-2s2.1.6 2.7 2" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="3.8" />
      <path d="M4.5 20.5c1.4-3.6 4.2-5 7.5-5s6.1 1.4 7.5 5" />
    </>
  ),
  timer: (
    <>
      <circle cx="12" cy="13.5" r="7.5" />
      <path d="M12 9.8v3.7l2.4 2.4M9.5 2.5h5" />
    </>
  ),
  ban: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m5.8 5.8 12.4 12.4" />
    </>
  ),
};

const FILL = {
  play: <path d="M7.5 4.8 19 12 7.5 19.2Z" />,
  bolt: <path d="M13 2 4.5 13.5h5.5L10 22l9-12h-6Z" />,
  pointer: <path d="M4.5 3.5 11 20.5l2.2-6.4 6.3-2.4Z" />,
};

export default function Icon({ name, size = 18, className = '', strokeWidth = 2 }) {
  const filled = FILL[name];
  const stroked = STROKE[name];
  if (!filled && !stroked) return null;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`inline-block shrink-0 ${className}`}
      aria-hidden="true"
    >
      {filled || stroked}
    </svg>
  );
}
