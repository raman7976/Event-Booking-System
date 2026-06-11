// MM:SS countdown. Amber under 2.5 min, red + heartbeat under 60s; fires
// onExpire exactly once at zero. `tones` overrides the color classes when the
// timer sits on a dark/colored surface (e.g. inside a held seat tile).
import { useEffect, useRef, useState } from 'react';

const LIGHT_TONES = {
  normal: 'text-slate-700',
  warn: 'text-amber-600',
  urgent: 'text-rose-600 animate-pulse',
};

export default function CountdownTimer({ expiresAt, onExpire, className = '', tones = LIGHT_TONES }) {
  const [remaining, setRemaining] = useState(0);
  const cb = useRef(onExpire);
  cb.current = onExpire;

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
        cb.current?.();
      }
    }, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  const mm = String(Math.floor(remaining / 60)).padStart(2, '0');
  const ss = String(remaining % 60).padStart(2, '0');
  const tone = remaining < 60 ? tones.urgent : remaining < 150 ? tones.warn : tones.normal;

  return (
    <span className={`font-mono font-semibold tabular-nums ${tone} ${className}`}>
      {mm}:{ss}
    </span>
  );
}

/** Tones for use on dark or saturated backgrounds (seat tiles, image banners). */
export const DARK_SURFACE_TONES = {
  normal: 'text-white',
  warn: 'text-amber-200',
  urgent: 'text-rose-200 animate-pulse',
};
