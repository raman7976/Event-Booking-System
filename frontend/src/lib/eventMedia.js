// Deterministic cover art for events: keyword-matched, curated Unsplash photos
// with a seeded picsum fallback and a gradient base that always renders, so a
// failed image never leaves a gray hole.
const POOLS = {
  music: [
    'https://images.unsplash.com/photo-1501386761578-eac5c94b800a?auto=format&fit=crop&w=1280&q=70',
    'https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?auto=format&fit=crop&w=1280&q=70',
    'https://images.unsplash.com/photo-1459749411175-04bf5292ceea?auto=format&fit=crop&w=1280&q=70',
    'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=1280&q=70',
  ],
  travel: [
    'https://images.unsplash.com/photo-1544620347-c4fd4a3d5957?auto=format&fit=crop&w=1280&q=70',
    'https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?auto=format&fit=crop&w=1280&q=70',
  ],
  learn: [
    'https://images.unsplash.com/photo-1523580494863-6f3031224c94?auto=format&fit=crop&w=1280&q=70',
    'https://images.unsplash.com/photo-1517245386807-bb43f82c33c4?auto=format&fit=crop&w=1280&q=70',
  ],
  default: [
    'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?auto=format&fit=crop&w=1280&q=70',
    'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?auto=format&fit=crop&w=1280&q=70',
  ],
};

const GRADIENTS = [
  'from-violet-600/70 via-fuchsia-600/50 to-indigo-900/80',
  'from-cyan-500/60 via-blue-600/50 to-violet-900/80',
  'from-fuchsia-600/60 via-rose-600/40 to-purple-900/80',
  'from-emerald-500/50 via-teal-600/40 to-cyan-900/80',
];

// Order matters: travel/learn are checked before music so "Night Bus ..."
// doesn't get concert artwork via the looser music words.
const KEYWORDS = [
  { pool: 'travel', words: ['bus', 'coach', 'coast', 'trip', 'travel', 'express', 'shuttle', 'train'] },
  { pool: 'learn', words: ['intro', 'course', 'class', 'systems', 'workshop', 'bootcamp', 'lecture', '101'] },
  { pool: 'music', words: ['rock', 'live', 'concert', 'music', 'dj', 'band', 'festival', 'tour', 'night', 'show'] },
];

const hash = (str) =>
  [...String(str)].reduce((acc, ch) => ((acc << 5) - acc + ch.charCodeAt(0)) | 0, 7) >>> 0;

export function eventMedia(event) {
  const name = (event?.name || 'event').toLowerCase();
  const h = hash(event?.id || name);
  const match = KEYWORDS.find((k) => k.words.some((w) => name.includes(w)));
  const pool = POOLS[match?.pool || 'default'];
  return {
    image: pool[h % pool.length],
    fallback: `https://picsum.photos/seed/${encodeURIComponent(name.replace(/\s+/g, '-').slice(0, 24))}/1280/720`,
    gradient: GRADIENTS[h % GRADIENTS.length],
  };
}

/** Swap to the seeded fallback once; on a second failure just hide the img —
 *  the gradient base behind it keeps the layout rich. */
export function coverErrorHandler(fallback) {
  return (e) => {
    const img = e.currentTarget;
    if (img.dataset.fallback !== 'done') {
      img.dataset.fallback = 'done';
      img.src = fallback;
    } else {
      img.style.display = 'none';
    }
  };
}
