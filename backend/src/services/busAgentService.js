// Campus Bus Assistant — a read-only tool-calling agent. Its tools are the
// existing read-only busService reads plus a policy-RAG lookup. Groq drives the
// tool loop when configured; otherwise a deterministic intent router answers so
// the assistant still works with no API key (only local embeddings are needed).
//
// Security: every tool is scoped to the authenticated user here — the model
// supplies tool names/args, never identity. No write actions are exposed.
import * as llm from './ai/llm.js';
import * as rag from './ragService.js';
import { getSchedule, getTripDetail, getMyBusTrips } from './busService.js';
import { logger } from '../utils/logger.js';

const todayStr = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_schedule',
      description:
        "List bus trips for a date (YYYY-MM-DD; defaults to today). Returns route, times, seats booked/capacity, status, and the user's own booking/waitlist status.",
      parameters: { type: 'object', properties: { date: { type: 'string', description: 'YYYY-MM-DD; omit for today' } } },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_trip_detail',
      description: 'Details for one trip by its UUID, including the public FIFO waitlist.',
      parameters: { type: 'object', properties: { tripId: { type: 'string' } }, required: ['tripId'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_my_trips',
      description: "The current user's own recent/upcoming bus bookings and waitlist entries.",
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_policy',
      description:
        'Search the bus policy / timetable / FAQ knowledge base. Use for rules: no-show policy, confirmation windows, eligibility, cancellation, routes.',
      parameters: { type: 'object', properties: { question: { type: 'string' } }, required: ['question'] },
    },
  },
];

function buildSystem(user) {
  return [
    'You are the campus bus assistant for LNMIIT students.',
    `Today is ${todayStr()} (Asia/Kolkata). The user's roll number is ${user.rollNumber || 'unknown'}.`,
    'Routes: LNMIIT <-> Raja Park and LNMIIT <-> Ajmeri Gate, with weekday and weekend/holiday timetables.',
    'Answer ONLY campus-bus questions. Use tools to get live schedule/booking data and to look up policy — never invent times, seat counts, or rules.',
    'You are READ-ONLY: you cannot book, cancel, or confirm. If asked to, explain how to do it in the app instead.',
    'Be concise, use 24-hour times, and briefly cite policy when you rely on it.',
  ].join('\n');
}

async function dispatch(user, name, args) {
  switch (name) {
    case 'get_schedule':
      return getSchedule(args.date || todayStr(), user.id);
    case 'get_trip_detail':
      return getTripDetail(args.tripId, user.id);
    case 'get_my_trips':
      return getMyBusTrips(user.id);
    case 'search_policy': {
      const chunks = await rag.retrieve(args.question || '', { kind: 'bus_doc' });
      return chunks.map((c) => ({ source: c.source, title: c.title, text: c.content }));
    }
    default:
      return { error: `unknown tool ${name}` };
  }
}

function sourcesFromTrace(toolTrace) {
  const seen = new Set();
  const out = [];
  for (const t of toolTrace) {
    if (t.name !== 'search_policy' || !Array.isArray(t.result)) continue;
    for (const r of t.result) {
      const key = `${r.source}::${r.title}`;
      if (!seen.has(key)) { seen.add(key); out.push({ source: r.source, title: r.title }); }
    }
  }
  return out;
}

// ── deterministic fallback (no GROQ_API_KEY) ──
const fmtTime = (iso) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });

function formatTrips(trips, filter) {
  const list = filter
    ? trips.filter((t) => `${t.origin} ${t.destination}`.toLowerCase().includes(filter))
    : trips;
  if (!list.length) return 'No matching trips found for today. Try another date or destination.';
  return list
    .slice(0, 10)
    .map((t) => `Bus ${t.busNo} ${t.origin}→${t.destination} at ${fmtTime(t.departureAt)} — ${t.booked}/${t.capacity} booked (${t.status})${t.myStatus ? `, you: ${t.myStatus}` : ''}`)
    .join('\n');
}

async function fallback({ user, message }) {
  const q = message.toLowerCase();
  const POLICY = /(policy|rule|no.?show|cancel|confirm|waitlist|eligib|allowed|how (do|can)|charge|free|roll)/;
  const MINE = /(my |am i |do i have|my trips|my booking|my waitlist)/;
  const DEST = q.includes('raja') ? 'raja park' : q.includes('ajmeri') ? 'ajmeri' : null;

  if (MINE.test(q)) {
    const trips = await getMyBusTrips(user.id);
    if (!trips.length) return { answer: "You have no bus bookings or waitlist entries right now.", sources: [], source: 'fallback' };
    const lines = trips.slice(0, 10).map((t) => `Bus ${t.busNo} ${t.origin}→${t.destination} at ${fmtTime(t.departureAt)} — ${t.waitlisted ? 'waitlisted' : t.bookingStatus}`);
    return { answer: `Your bus activity:\n${lines.join('\n')}`, sources: [], source: 'fallback' };
  }
  if (DEST || /(next bus|schedule|time|when|trip)/.test(q)) {
    const trips = await getSchedule(todayStr(), user.id);
    return { answer: `Today's ${DEST ? `${DEST} ` : ''}trips:\n${formatTrips(trips, DEST)}`, sources: [], source: 'fallback' };
  }
  if (POLICY.test(q) || true) {
    const chunks = await rag.retrieve(message, { kind: 'bus_doc' });
    if (!chunks.length) return { answer: "I couldn't find that in the bus policy. Ask about schedules, bookings, waitlist, or no-show rules.", sources: [], source: 'fallback' };
    return {
      answer: chunks[0].content,
      sources: chunks.map((c) => ({ source: c.source, title: c.title })),
      source: 'fallback',
    };
  }
}

export async function ask({ user, message, history = [] }) {
  if (llm.isEnabled()) {
    try {
      const { answer, toolTrace } = await llm.runToolLoop({
        system: buildSystem(user),
        userMessage: message,
        history,
        tools: TOOLS,
        dispatch: (n, a) => dispatch(user, n, a),
      });
      return { answer, sources: sourcesFromTrace(toolTrace), toolTrace, source: 'groq' };
    } catch (err) {
      logger.warn(`[assistant] groq failed (${err.message}); using deterministic fallback`);
    }
  }
  return fallback({ user, message });
}
