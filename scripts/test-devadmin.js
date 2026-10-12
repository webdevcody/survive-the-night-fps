// `npm run dev` gives every player the admin chat commands; a production server (`npm start`, every deploy) never
// does, whatever DEV_ADMIN says. The rule (server/devadmin.js) and the environment the dev script starts the server
// with (scripts/dev-env.js), then both for real: a guest joins a server started each way and reads its WELCOME.
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { C2S, S2C, WELCOMEF, PROTOCOL_VERSION, Writer, Reader } from '../shared/protocol.js';
import { devAdminAllowed } from '../server/devadmin.js';
import { devServerEnv } from './dev-env.js';

let failed = 0;
function check(name, ok, detail = '') {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${ok ? '' : detail}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// the shell, as someone who set nothing has it
const shell = { ...process.env };
delete shell.NODE_ENV;
delete shell.DEV_ADMIN;

// ---------------------------------------------------------------- the rule
check('npm run dev with nothing set: admin commands on', devAdminAllowed(devServerEnv(shell)));
check('...the dev server is a development one', devServerEnv(shell).NODE_ENV === 'development' && devServerEnv(shell).DEV_ADMIN === '1');
check('...DEV_ADMIN=0 npm run dev turns them off', !devAdminAllowed(devServerEnv({ ...shell, DEV_ADMIN: '0' })));
check('...NODE_ENV=production npm run dev keeps the production rule', !devAdminAllowed(devServerEnv({ ...shell, NODE_ENV: 'production' })));
check('production ignores DEV_ADMIN=1', !devAdminAllowed({ NODE_ENV: 'production', DEV_ADMIN: '1' }));
check('...so does a server with no NODE_ENV at all', !devAdminAllowed({ DEV_ADMIN: '1' }));
check('...and one with any other NODE_ENV', !devAdminAllowed({ NODE_ENV: 'staging', DEV_ADMIN: '1' }));
check('a test server still needs DEV_ADMIN=1 to have them', devAdminAllowed({ NODE_ENV: 'test', DEV_ADMIN: '1' }) && !devAdminAllowed({ NODE_ENV: 'test' }));

// ---------------------------------------------------------------- on the wire
const freePort = () =>
  new Promise((res) => {
    const s = createServer().listen(0, () => {
      const { port } = s.address();
      s.close(() => res(port));
    });
  });
const procs = [];
async function startServer(env) {
  const port = await freePort();
  // no database, no handoff, no leaderboard file: the admin rule is all this looks at
  const proc = spawn(process.execPath, ['server/index.js'], { env: { ...env, PORT: String(port), DATABASE_URL: '', HANDOFF_DIR: '', HANDOFF: '0', STATS_FILE: '', CLUSTER: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  procs.push(proc);
  let log = '';
  proc.stdout.on('data', (d) => (log += d));
  proc.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 200 && !log.includes('listening') && proc.exitCode === null; i++) await sleep(50);
  return { port, proc, log: () => log };
}
// a guest joins and reads its WELCOME: { admin } or null (no WELCOME)
const guest = (port) =>
  new Promise((resolve) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws`);
    ws.binaryType = 'arraybuffer';
    const done = (v) => {
      clearTimeout(timer);
      ws.close();
      resolve(v);
    };
    const timer = setTimeout(() => done(null), 8000);
    ws.onopen = () => {
      const w = new Writer(128);
      w.u8(C2S.JOIN);
      w.u8(PROTOCOL_VERSION);
      w.str('Guest');
      w.str(randomUUID());
      ws.send(w.bytes());
    };
    ws.onmessage = (m) => {
      const r = new Reader(m.data);
      if (r.u8() !== S2C.WELCOME) return;
      r.u16();
      r.u32();
      r.u32();
      r.u8();
      r.u8();
      done({ admin: !!(r.u8() & WELCOMEF.ADMIN) });
    };
    ws.onerror = () => done(null);
  });

try {
  const dev = await startServer(devServerEnv(shell));
  const got = await guest(dev.port);
  check('a guest on the server npm run dev starts is an admin', got?.admin === true, JSON.stringify(got) + dev.log().slice(-800));
  // what `npm start` (every deploy) runs: NODE_ENV=production, here with DEV_ADMIN=1 too
  const prod = await startServer({ ...shell, NODE_ENV: 'production', DEV_ADMIN: '1' });
  const got2 = await guest(prod.port);
  check('a guest on a production server is not, even with DEV_ADMIN=1', got2?.admin === false, JSON.stringify(got2) + prod.log().slice(-800));
} catch (err) {
  failed++;
  console.log('FAIL  threw', err);
}

for (const p of procs) p.kill('SIGTERM');
await Promise.all(procs.map((p) => (p.exitCode === null ? new Promise((r) => p.on('exit', r)) : null)));
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
