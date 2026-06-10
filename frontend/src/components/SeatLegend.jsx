const ITEMS = [
  ['#22c55e', 'Available'],
  ['#eab308', 'Held by others'],
  ['#3b82f6', 'Your hold'],
  ['#ef4444', 'Booked'],
  ['#6b7280', 'Unavailable'],
];

export default function SeatLegend() {
  return (
    <div className="flex flex-wrap gap-4 text-sm text-slate-300">
      {ITEMS.map(([color, label]) => (
        <div key={label} className="flex items-center gap-1.5">
          <span className="inline-block w-4 h-4 rounded" style={{ background: color }} />
          {label}
        </div>
      ))}
    </div>
  );
}
