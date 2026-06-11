const ITEMS = [
  ['bg-gradient-to-b from-emerald-400 to-emerald-600', 'Available'],
  ['bg-gradient-to-b from-amber-400 to-amber-600', 'Held by others'],
  ['bg-gradient-to-b from-blue-400 to-violet-600', 'Your hold'],
  ['bg-gradient-to-b from-rose-500 to-rose-800', 'Booked'],
];

export default function SeatLegend() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {ITEMS.map(([cls, label]) => (
        <span key={label} className="chip text-slate-300">
          <span className={`h-3 w-3 rounded ${cls}`} />
          {label}
        </span>
      ))}
      <span className="chip text-cyan-300">
        <span className="h-2 w-2 rounded-full bg-cyan-400 animate-pulse-dot" />
        live updates
      </span>
    </div>
  );
}
