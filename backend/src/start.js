// Container entrypoint. One image, two roles selected by the SERVICE_ROLE env so
// platforms (Railway) that set the start command via env can run web + worker
// from the same build:
//   SERVICE_ROLE=web    -> run migrations (with retry for cold private DNS) then the API/WS server
//   SERVICE_ROLE=worker -> run the BullMQ worker process
//   SERVICE_ROLE=all    -> migrate, then run the API + worker together in one container
//   (unset)             -> web
import { spawn } from 'node:child_process';

const role = (process.env.SERVICE_ROLE || 'web').toLowerCase();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const run = (args) =>
  new Promise((resolve) => {
    const p = spawn('node', args, { stdio: 'inherit' });
    p.on('exit', (code) => resolve(code ?? 0));
  });

// On a fresh Railway container the private-network DNS can lag the process by a
// beat, so the first migrate may not reach Postgres — retry a few times.
async function migrateWithRetry(attempts = 5) {
  for (let i = 1; i <= attempts; i += 1) {
    const code = await run(['src/scripts/migrate.js']);
    if (code === 0) return;
    if (i === attempts) process.exit(code);
    console.log(`[start] migrate failed (attempt ${i}/${attempts}); retrying in 3s…`);
    await sleep(3000);
  }
}

async function main() {
  if (role === 'worker') {
    process.exit(await run(['src/workers/index.js']));
  }
  if (role === 'all') {
    // Free single-service tiers (Render): API + worker in one container. If either
    // child exits, take the whole container down so the platform restarts it clean.
    await migrateWithRetry();
    const server = spawn('node', ['src/server.js'], { stdio: 'inherit' });
    const worker = spawn('node', ['src/workers/index.js'], { stdio: 'inherit' });
    const bail = (code) => { server.kill(); worker.kill(); process.exit(code ?? 0); };
    server.on('exit', bail);
    worker.on('exit', bail);
    ['SIGTERM', 'SIGINT'].forEach((sig) => process.on(sig, () => { server.kill(sig); worker.kill(sig); }));
    return;
  }
  await migrateWithRetry();
  process.exit(await run(['src/server.js']));
}

main();
