// Tiny leveled logger (no dependency). LOG_LEVEL=error|warn|info|debug
const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const current = LEVELS[process.env.LOG_LEVEL] ?? LEVELS.info;

function emit(level, args) {
  if (LEVELS[level] > current) return;
  const ts = new Date().toISOString();
  const line = `[${ts}] [${level.toUpperCase()}]`;
  const sink = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  sink(line, ...args);
}

export const logger = {
  error: (...a) => emit('error', a),
  warn: (...a) => emit('warn', a),
  info: (...a) => emit('info', a),
  debug: (...a) => emit('debug', a),
};
