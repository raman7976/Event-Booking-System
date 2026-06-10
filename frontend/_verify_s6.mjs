// S6 real-time check (throwaway). Run from the frontend dir.
//  Part 1: socket via nginx /ws + hold via nginx /api -> live seat-update.
//  Part 2: deterministic cross-node proof — PUBLISH straight to Redis (as any
//          other node would) and confirm this client receives it; Redis reports
//          the subscriber count (= number of node instances listening).
import net from 'node:net';
import { io } from 'socket.io-client';

const WS_URL = process.env.WS_URL || 'http://localhost';
const API_URL = process.env.API_URL || 'http://localhost';
const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = Number(process.env.REDIS_PORT || 6379);
const { EVENT_ID, SEAT_ID, TOKEN } = process.env;

let pass = 0, fail = 0;
const ok = (m) => { console.log(`  ✓ ${m}`); pass += 1; };
const bad = (m) => { console.log(`  ✗ ${m}`); fail += 1; };

function connect() {
  return new Promise((resolve, reject) => {
    const socket = io(WS_URL, { path: '/ws', transports: ['websocket'], reconnection: false });
    let info = {};
    socket.on('connected', (d) => { info = d; });
    socket.on('connect', () => resolve({ socket, info: () => info }));
    socket.on('connect_error', (e) => reject(new Error(`connect_error: ${e.message}`)));
    setTimeout(() => reject(new Error('socket connect timeout')), 9000);
  });
}

// Minimal RESP PUBLISH so we don't need a Redis client dependency here.
function redisPublish(channel, message) {
  return new Promise((resolve, reject) => {
    const c = net.createConnection({ host: REDIS_HOST, port: REDIS_PORT }, () => {
      const parts = ['PUBLISH', channel, message];
      let cmd = `*${parts.length}\r\n`;
      for (const p of parts) cmd += `$${Buffer.byteLength(p)}\r\n${p}\r\n`;
      c.write(cmd);
    });
    c.on('data', (d) => { resolve(d.toString()); c.end(); });
    c.on('error', reject);
    setTimeout(() => { c.end(); reject(new Error('redis publish timeout')); }, 3000);
  });
}

const waitForSeat = (socket, seatId, ms) =>
  new Promise((resolve) => {
    const h = (u) => { if (u.seatId === seatId) { socket.off('seat-update', h); resolve(u); } };
    socket.on('seat-update', h);
    setTimeout(() => { socket.off('seat-update', h); resolve(null); }, ms);
  });

async function main() {
  if (!EVENT_ID || !SEAT_ID || !TOKEN) { console.error('need EVENT_ID, SEAT_ID, TOKEN'); process.exit(2); }

  const { socket, info } = await connect();
  await new Promise((r) => setTimeout(r, 200));
  const socketNode = info().instance;
  ok(`socket connected via nginx /ws (node=${socketNode})`);
  socket.emit('join-event', EVENT_ID);
  await new Promise((r) => setTimeout(r, 300));

  // ── Part 1: real hold through nginx /api ──
  const realUpdate = waitForSeat(socket, SEAT_ID, 8000);
  const res = await fetch(`${API_URL}/api/seats/${SEAT_ID}/hold`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ eventId: EVENT_ID }),
  });
  const apiNode = res.headers.get('x-served-by');
  res.status === 201 ? ok(`hold via nginx /api -> 201 (node=${apiNode})`) : bad(`hold -> ${res.status}`);
  const u1 = await realUpdate;
  u1?.status === 'held' ? ok(`live seat-update {held} received over WS (api node=${apiNode}, socket node=${socketNode})`) : bad('no seat-update from hold');

  // ── Part 2: deterministic cross-node proof via direct Redis publish ──
  const sentinel = 'xnode-sentinel';
  const sentinelUpdate = waitForSeat(socket, sentinel, 5000);
  const payload = JSON.stringify({ eventId: EVENT_ID, seatId: sentinel, status: 'available', timestamp: Date.now() });
  const reply = await redisPublish('seat-updates', payload);
  const subs = reply.startsWith(':') ? parseInt(reply.slice(1), 10) : NaN;
  subs >= 2 ? ok(`Redis PUBLISH seat-updates -> ${subs} subscribers (both node instances listening)`) : bad(`expected >=2 subscribers, got ${subs} (reply ${JSON.stringify(reply)})`);
  const u2 = await sentinelUpdate;
  u2 ? ok('client received the directly-published update -> Redis pub/sub bridge delivers cross-node') : bad('sentinel update not received');

  socket.close();
  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('verify_s6 fatal:', e); process.exit(1); });
