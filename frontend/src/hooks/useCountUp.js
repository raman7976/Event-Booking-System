// Animates a number from 0 to `value` (ease-out) whenever `value` changes.
import { useEffect, useRef, useState } from 'react';

export function useCountUp(value, duration = 900) {
  const [display, setDisplay] = useState(0);
  const frame = useRef(null);

  useEffect(() => {
    const target = Number(value) || 0;
    const start = performance.now();
    cancelAnimationFrame(frame.current);

    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - t) ** 3;
      setDisplay(Math.round(target * eased));
      if (t < 1) frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame.current);
  }, [value, duration]);

  return display;
}
