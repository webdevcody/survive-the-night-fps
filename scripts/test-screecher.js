// The screecher, in-process against a real Game and decoded as a client does: it joins the horde on its own night and
// not before; one that sees a survivor stops, rears back and screams, and the scream brings a horde of the dead running
// at that survivor from out of their sight (screamHorde, + screamHordeEach a survivor past the first); a survivor within
// ringRange is told their ears ring (EVT.SCREECH, its id and how long: longer the nearer), and one further off is not;
// it does not scream again before its screamRate is up; one shot dead in its windup brings nobody; and the client's
// audio rings until that screecher dies.
// usage: node scripts/test-screecher.js [seed]
import './clip/dom-stub.js';
import { Game } from '../server/game.js';
import { C2S, S2C, PROTOCOL_VERSION, Writer, Reader, qangle16, qpitch, writeInput } from '../shared/protocol.js';
import { ZTYPE, ZOMBIE_DEFS, ZANIM, SOUND } from '../shared/defs.js';
import { BESTIARY } from '../shared/bestiary.js';
import { readSnapshot } from '../client/net/decode.js';

const seed = +(process.argv[2] || 4242);
const game = new Game({ seed, godMode: true, dayLength: 3600, log: () => {} });
const fails = [];
const check = (name, ok, info = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${info}`);
  if (!ok) fails.push(name);
};
const def = ZOMBIE_DEFS[ZTYPE.SCREECHER];

// ---------------------------------------------------------------- the kind
check('the screecher is a special of its own, with its numbers', !!def && !def.boss && !def.common && def.screamRange > 0 && def.screamRate > 0 && def.screamHorde > 0 && def.ringRange > 0 && def.ringT > 0);
check('...in the bestiary with the specials', BESTIARY.some((e) => e.t === ZTYPE.SCREECHER && e.group === 'special'));
check('...and its own night, after every other kind has joined', Object.values(ZOMBIE_DEFS).every((d) => d.boss || d === def || d.minNight < def.minNight));
{
  const kinds = (n) => {
    game.day = n;
    game.startNight();
    return game.waves.flatMap((wv) => wv.queue);
  };
  const before = kinds(def.minNight - 1).filter((t) => t === ZTYPE.SCREECHER).length;
  const on = kinds(def.minNight).filter((t) => t === ZTYPE.SCREECHER).length;
  check(`none in the horde before night ${def.minNight}, at least one on it`, before === 0 && on >= 1, `${before} / ${on}`);
  // back to a long day: the night's waves would muddle the counts below
  game.waves = [];
  game.startDay?.();
  game.day = 1;
}

// ---------------------------------------------------------------- clients
function client(name) {
  const c = { name, id: 0, net: { tick: 0, ack: 0 }, global: null, self: {}, store: { ents: new Map(), onCreate() {}, onRemove() {}, onUpdate() {} }, seq: 0, screeches: [] };
  const nop = () => {};
  c.handler = new Proxy({ screech: (id, secs) => c.screeches.push({ id, secs }) }, { get: (t, k) => t[k] || nop });
  c.conn = {
    send(bytes) {
      const r = new Reader(bytes.slice ? bytes.slice().buffer : bytes);
      const t = r.u8();
      if (t === S2C.WELCOME) c.id = r.u16();
      else if (t === S2C.SNAPSHOT) readSnapshot(r, c);
    },
  };
  c.session = game.onOpen(c.conn);
  const w = new Writer(64);
  w.u8(C2S.JOIN);
  w.u8(PROTOCOL_VERSION);
  w.str(name);
  game.onMessage(c.session, w.bytes().slice());
  c.p = () => game.players.get(c.id);
  if (c.p()) c.p().admin = true;
  c.input = (yaw = 0) => {
    const w2 = new Writer(64);
    w2.u8(C2S.INPUT);
    w2.u16(game.tick & 0xffff);
    w2.u8(0);
    const cmds = [];
    for (let i = 0; i < 3; i++) {
      c.seq = (c.seq + 1) & 0xffff;
      cmds.push({ seq: c.seq, buttons: 0, qyaw: qangle16(yaw), qpitch: qpitch(0), slot: 255 });
    }
    writeInput(w2, cmds);
    game.onMessage(c.session, w2.bytes().slice());
  };
  c.tp = (x, z) => game.handleChat(c.p(), `/tp ${x} ${z}`);
  return c;
}

// ---------------------------------------------------------------- open, level ground: a screecher 14 m off in plain view
const w = game.world;
const open = (x, z) => Math.abs(x) < 250 && Math.abs(z) < 250 && !w.isDeepWater(x, z) && !game.nav.isBlocked(x, z);
let spot = null;
for (let x = -200; x <= 200 && !spot; x += 16) {
  for (let z = -200; z <= 200 && !spot; z += 16) {
    const h0 = w.heightAt(x, z);
    let ok = open(x, z) && game.nav.segClear(x, z, x, z - 20);
    for (let d = 0; d <= 20 && ok; d += 2) ok = open(x, z - d) && Math.abs(w.heightAt(x, z - d) - h0) < 1.5;
    if (ok) ok = game.zm.clearLine(x, h0 + 1.6, z, x, h0 + 1.6, z - 14);
    if (ok) spot = { x, z };
  }
}
check('found open level ground', !!spot, spot ? `(${spot.x}, ${spot.z})` : '');
if (!spot) {
  console.log('\nFAILED: no ground to test on');
  process.exit(1);
}

const A = client('Alice');
const B = client('Bob');
const a = A.p();
const s = a.state;
const run = (ticks, fn) => {
  for (let i = 0; i < ticks; i++) {
    fn?.(i);
    A.input();
    B.input();
    game.update();
  }
};
// clear the valley of the dead the day put about, so everything that comes is the scream's
const clear = () => {
  for (const z of game.zombies) game.combat.killZombie(z, null);
  run(40);
};
A.tp(spot.x, spot.z);
const farX = spot.x + (spot.x > 0 ? -1 : 1) * (def.ringRange + 8);
B.tp(farX, spot.z);
run(4);
clear();

// (ready to scream at once: a fresh one waits a few seconds first, by when it would be on top of them)
const put = () => {
  const z = game.zm.spawn(ZTYPE.SCREECHER, s.x, s.z - 14, { horde: true });
  if (z) z.specialCd = 0;
  return z;
};
const near = (z) => Math.hypot(z.x - s.x, z.z - s.z);
// what turned up within 90 m since `before` (the day keeps putting the dead about, far off across the valley)
const fresh = (before) => game.zombies.filter((z) => !before.has(z) && near(z) < 90);
let sc = put();
check('a screecher stands 14 m off', !!sc && Math.abs(near(sc) - 14) < 2, sc ? `${near(sc).toFixed(1)} m` : '');
const before = new Set(game.zombies);
let windup = -1;
let screamed = -1;
let dA = 0;
let heard = false;
const sounds = game.sound.bind(game);
game.sound = (snd, ...rest) => {
  if (snd === SOUND.SCREECHER_SCREAM) heard = true;
  return sounds(snd, ...rest);
};
for (let i = 0; i < 200 && screamed < 0; i++) {
  run(1);
  if (windup < 0 && sc.state === 1 && sc.anim === ZANIM.SPECIAL) windup = i;
  if (fresh(before).length) {
    screamed = i;
    dA = Math.hypot(s.x - sc.x, s.y - sc.y, s.z - sc.z); // (where it stood as it screamed)
  }
}
check('it sees the survivor, stops and rears back to scream, and the scream is heard', windup >= 0 && heard);
check(`...the horde comes once its windup (${def.screamWindup} s) is through`, screamed > windup && (screamed - windup) / 20 >= def.screamWindup - 0.15, `windup at tick ${windup}, horde at ${screamed}`);
const called = fresh(before);
const want = def.screamHorde + def.screamHordeEach; // two survivors
check(`it calls ${want} of the dead (two survivors)`, called.length === want, `${called.length}`);
check('...runners and walkers', called.every((z) => z.ztype === ZTYPE.RUNNER || z.ztype === ZTYPE.WALKER) && called.some((z) => z.ztype === ZTYPE.RUNNER));
check('...of the horde, all set on the one it screamed at', called.every((z) => z.horde && z.target === a.id && z.aggroId === a.id && z.aggroT > 10));
const dmin = Math.min(...called.map(near));
check('...coming from out of reach, 30 m off at the nearest', dmin >= 30, `${dmin.toFixed(1)} m`);
// they come running
const d0 = called.reduce((n, z) => n + near(z), 0) / called.length;
run(100);
const d1 = called.reduce((n, z) => n + near(z), 0) / called.length;
check('...and they close in', d1 < d0 - 15, `${d0.toFixed(1)} m -> ${d1.toFixed(1)} m on average in 5 s`);

// ---------------------------------------------------------------- ringing ears
const ringA = A.screeches.filter((e) => e.id === sc.id);
const wantSecs = def.ringT * (1 - 0.5 * (dA / def.ringRange));
check('the survivor it screamed at is told their ears ring, by its id', ringA.length === 1, JSON.stringify(A.screeches));
check(`...for longer the nearer it was (${wantSecs.toFixed(1)} s at ${dA.toFixed(1)} m)`, ringA.length === 1 && Math.abs(ringA[0].secs - wantSecs) < 0.11 && ringA[0].secs <= def.ringT, ringA[0] && `${ringA[0].secs} s`);
check(`one ${def.ringRange + 8} m off is not`, B.screeches.length === 0, JSON.stringify(B.screeches));

// ---------------------------------------------------------------- once a screamRate, for as long as it lives
const cd = sc.specialCd;
check(`it waits ${def.screamRate} s at the least before it screams again`, cd >= def.screamRate - 5 - 0.1, `${cd.toFixed(1)} s left after 5 s`); // (5 s run above)
const seen = new Set(game.zombies);
let again = false;
while (sc.specialCd > 0.1 && !sc.dead) {
  run(1);
  if (sc.state === 1 && sc.stateAct === 13) again = true;
}
check('...and does not', !again && !fresh(seen).length);
for (let i = 0; i < 100 && !again; i++) {
  run(1);
  if (sc.state === 1 && sc.stateAct === 13) again = true;
}
check('...and then it screams again: it keeps on until it is dead', again);

// ---------------------------------------------------------------- killed in its windup
clear();
A.screeches.length = 0;
sc = put();
const before2 = new Set(game.zombies);
for (let i = 0; i < 200 && sc.state !== 1; i++) run(1);
check('a fresh one rears back to scream', sc.state === 1 && sc.stateAct === 13);
game.combat.killZombie(sc, a);
run(Math.ceil(def.screamWindup * 20) + 10);
check('shot dead in its windup, it brings nobody and rings no ears', !fresh(before2).length && A.screeches.length === 0);

// ---------------------------------------------------------------- a valley full of the dead already
{
  clear();
  // the day's own dead (not the horde) do not count against it: the valley can hold well over a hundred of them
  for (let i = 0; i < 60; i++) game.zm.spawn(ZTYPE.WALKER, s.x + 150 + (i % 10) * 3, s.z + Math.floor(i / 10) * 3);
  let sc2 = put();
  let b = new Set(game.zombies);
  for (let i = 0; i < 200 && !fresh(b).length; i++) run(1);
  check('the dead of the day do not stop the scream calling its horde', fresh(b).length === want, `${fresh(b).length}`);
  game.combat.killZombie(sc2, null);
  // ...a hundred of the horde does
  for (let i = 0; game.hordeAlive() < 100 && i < 200; i++) game.zm.spawn(ZTYPE.WALKER, s.x - 150 - (i % 10) * 3, s.z + Math.floor(i / 10) * 3, { horde: true });
  sc2 = put();
  b = new Set(game.zombies);
  let rang = false;
  for (let i = 0; i < 200 && !rang; i++) {
    run(1);
    rang = A.screeches.some((e) => e.id === sc2.id);
  }
  check('with a hundred of the horde about it still screams, but calls nobody more', rang && !fresh(b).length, `${fresh(b).length}`);
}

// ---------------------------------------------------------------- the client's ears
{
  const { AudioEngine } = await import('../client/audio/audio.js').catch(() => ({}));
  check('the audio engine has a ringing to start and stop', !!AudioEngine && typeof AudioEngine.prototype.ring === 'function' && typeof AudioEngine.prototype.stopRing === 'function');
}

console.log(fails.length ? `\nFAILED: ${fails.length}\n  ${fails.join('\n  ')}` : '\nALL PASS');
process.exit(fails.length ? 1 : 0);
