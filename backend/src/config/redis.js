// ioredis clients. We keep separate connections by responsibility:
//   redis       -> general commands (offline queue OFF so failures surface fast -> PG fallback)
//   publisher   -> PUBLISH only
//   subscriber  -> SUBSCRIBE only (a subscribed connection can't run normal commands)
//   bullConnection -> options object handed to BullMQ (needs maxRetriesPerRequest: null)
import Redis from 'ioredis';
import { config } from './env.js';
import { logger } from '../utils/logger.js';

// Build ioredis options from either a managed REDIS_URL (Railway/Upstash) or
// discrete host/port. `rediss://` enables TLS; Railway's private hostname
// (*.railway.internal) is IPv6-only, so `family: 0` lets Node resolve it.
function redisOptions(extra = {}) {
  const retryStrategy = (times) => Math.min(times * 200, 2000);
  if (config.redis.url) {
    const u = new URL(config.redis.url);
    return {
      host: u.hostname,
      port: Number(u.port || 6379),
      username: u.username ? decodeURIComponent(u.username) : undefined,
      password: u.password ? decodeURIComponent(u.password) : undefined,
      tls: u.protocol === 'rediss:' ? {} : undefined,
      family: u.hostname.endsWith('.railway.internal') ? 0 : undefined,
      retryStrategy,
      ...extra,
    };
  }
  return { host: config.redis.host, port: config.redis.port, retryStrategy, ...extra };
}

export const redis = new Redis(
  redisOptions({
    enableOfflineQueue: false, // reject immediately when down -> triggers Postgres fallback
    maxRetriesPerRequest: 2,
  }),
);
export const publisher = new Redis(redisOptions());
export const subscriber = new Redis(redisOptions());

// Plain options object for BullMQ (it manages its own connection internally).
export const bullConnection = redisOptions({ maxRetriesPerRequest: null });

for (const [name, client] of [
  ['command', redis],
  ['publisher', publisher],
  ['subscriber', subscriber],
]) {
  client.on('error', (err) => logger.warn(`[redis:${name}] ${err.message}`));
  client.on('ready', () => logger.info(`[redis:${name}] ready`));
}

// ── Atomic seat-hold Lua script (exactly as specified) ──
const HOLD_LUA = `
local key = KEYS[1]
local userId = ARGV[1]
local holdToken = ARGV[2]
local ttl = ARGV[3]
if redis.call('EXISTS', key) == 1 then
  return 0
end
redis.call('SET', key, userId .. ':' .. holdToken)
redis.call('EXPIRE', key, ttl)
return 1
`;
// Registers redis.holdSeat(key, userId, holdToken, ttl) -> 1 held / 0 already-held
redis.defineCommand('holdSeat', { numberOfKeys: 1, lua: HOLD_LUA });

export const isRedisReady = () => redis.status === 'ready';

export async function closeRedis() {
  await Promise.allSettled([redis.quit(), publisher.quit(), subscriber.quit()]);
}
