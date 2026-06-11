// Circular countdown ring: live MM:SS in the middle, stroke drains with time,
// color shifts green -> amber -> red as expiry approaches.
import { useEffect, useState } from 'react';

export default function ProgressRing({ expiresAt, totalSeconds = 480, size = 52, onExpire }) {
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    let fired = false;
    const compute = () => Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
    setRemaining(compute());
    const id = setInterval(() => {
      const r = compute();
      setRemaining(r);
      if (r <= 0 && !fired) {
        fired = true;
        clearInterval(id);
        onExpire?.();
      }
    }, 1000);
    return () => clearInterval(id);
  }, [expiresAt, onExpire]);

  const frac = Math.max(0, Math.min(1, remaining / totalSeconds));
  const stroke = remaining < 60 ? '#fb7185' : remaining < 150 ? '#fbbf24' : '#34d399';
  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  const mm = String(Math.floor(remaining / 60)).padStart(2, '0');
  const ss = String(remaining % 60).padStart(2, '0');

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="4" />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke={stroke} strokeWidth="4" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - frac)}
          style={{ transition: 'stroke-dashoffset 1s linear, stroke 0.4s' }}
        />
      </svg>
      <span className="absolute font-mono text-[11px] font-bold" style={{ color: stroke }}>
        {mm}:{ss}
      </span>
    </div>
  );
}
