// MM:SS countdown. Turns red under 60s; fires onExpire once at zero.
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
  return (
    <span className={`font-mono font-semibold ${remaining < 60 ? 'text-red-300' : 'text-blue-100'} ${className}`}>
      {mm}:{ss}
    </span>
  );
}
