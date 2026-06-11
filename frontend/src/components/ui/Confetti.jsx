// Lightweight canvas confetti burst (no dependency). Fires once on mount,
// ~2.6s of particles, then removes itself from the render loop.
import { useEffect, useRef } from 'react';

const COLORS = ['#8b5cf6', '#d946ef', '#22d3ee', '#34d399', '#fbbf24', '#fb7185'];

export default function Confetti({ duration = 2600 }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = (canvas.width = window.innerWidth * dpr);
    const h = (canvas.height = window.innerHeight * dpr);

    const parts = Array.from({ length: 160 }, () => ({
      x: w / 2 + (Math.random() - 0.5) * w * 0.35,
      y: h * 0.3 + (Math.random() - 0.5) * h * 0.1,
      vx: (Math.random() - 0.5) * 16 * dpr,
      vy: (-7 - Math.random() * 9) * dpr,
      size: (5 + Math.random() * 6) * dpr,
      color: COLORS[(Math.random() * COLORS.length) | 0],
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3,
      shape: Math.random() > 0.5 ? 'rect' : 'circle',
    }));

    const start = performance.now();
    let raf;
    const tick = (now) => {
      const t = now - start;
      ctx.clearRect(0, 0, w, h);
      const fade = Math.max(0, 1 - t / duration);
      for (const p of parts) {
        p.vy += 0.32 * dpr; // gravity
        p.x += p.vx;
        p.y += p.vy;
        p.vx *= 0.992;
        p.rot += p.vr;
        ctx.save();
        ctx.globalAlpha = fade;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        if (p.shape === 'rect') ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        else { ctx.beginPath(); ctx.arc(0, 0, p.size / 2.4, 0, Math.PI * 2); ctx.fill(); }
        ctx.restore();
      }
      if (t < duration) raf = requestAnimationFrame(tick);
      else ctx.clearRect(0, 0, w, h);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [duration]);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none fixed inset-0 z-[80] h-full w-full"
      aria-hidden="true"
    />
  );
}
