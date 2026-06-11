// MM:SS countdown. Amber under 2.5 min, red + heartbeat under 60s; fires
// onExpire exactly once at zero.
import { useEffect, useRef, useState } from 'react';

export default function CountdownTimer({ expiresAt, onExpire, className = '' }) {
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
  const tone =
    remaining < 60 ? 'text-rose-300 animate-pulse' : remaining < 150 ? 'text-amber-300' : 'text-blue-100';

  return (
    <span className={`font-mono font-semibold tabular-nums ${tone} ${className}`}>
      {mm}:{ss}
    </span>
  );
}
