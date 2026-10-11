// Finding the car supplies (#287, shared/supplyhelp.js).
//   - the world tell: on every map, the crows over each spot a supply can be hidden at can be seen from CROWS.SEEN
//     metres off (a clear line from a survivor's eye to at least one bird, in at least MIN_DIRS of 16 directions)
//   - the help: the global state names the spot each hint is hidden at; a team that has found nothing gets the help
//     step by step at the SUPPLY_HELP_AT times, the radio once; a team that has found one never gets any, and finding
//     one takes back what was given
// In-process against a real Game, the global state read with the client's decoder.
// usage: node scripts/test-supplyhelp.js
import { createWorld } from '../shared/world.js';
import { createMainland } from '../shared/mainland.js';
import { raycastWorld, groundAt } from '../shared/collision.js';
import { WATER_LEVEL } from '../shared/constants.js';
import { ZONE_NAMES, ITEM_DEFS, NOTIFY } from '../shared/defs.js';
import { CROWS, crowsAt, SUPPLY_HELP, SUPPLY_HELP_AT, supplyHelpLevel, narrowedAt, NARROW_R } from '../shared/supplyhelp.js';
import { Game } from '../server/game.js';
import { C2S, S2C, PROTOCOL_VERSION, Writer, Reader } from '../shared/protocol.js';
import { readGlobal } from '../client/net/decode.js';

const fails = [];
const check = (name, ok, info = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${info}`);
  if (!ok) fails.push(name);
};

// ---------------------------------------------------------------- the crows, on every map
const DIRS = 16;
const MIN_DIRS = 4;
const EYE = 1.6;
const hit = { t: -1, col: null, terrain: false };
// in how many of DIRS directions a survivor CROWS.SEEN m off sees at least one of the birds
function seenFrom(w, sp) {
  const c = crowsAt(w, sp);
  let dirs = 0;
  for (let i = 0; i < DIRS; i++) {
    const a = (i / DIRS) * Math.PI * 2;
    const x = sp.x + Math.cos(a) * CROWS.SEEN;
    const z = sp.z + Math.sin(a) * CROWS.SEEN;
    if (Math.abs(x) > w.half - 2 || Math.abs(z) > w.half - 2) continue;
    const y = groundAt(w, x, z, 300, 0.2);
    if (y < WATER_LEVEL) continue; // (out at sea)
    for (let b = 0; b < 4; b++) {
      const bx = c.x + Math.cos((b * Math.PI) / 2) * CROWS.RADIUS;
      const bz = c.z + Math.sin((b * Math.PI) / 2) * CROWS.RADIUS;
      const dx = bx - x;
      const dy = c.y - (y + EYE);
      const dz = bz - z;
      const d = Math.hypot(dx, dy, dz);
      raycastWorld(w, x, y + EYE, z, dx / d, dy / d, dz / d, d, hit);
      if (hit.t < 0) {
        dirs++;
        break;
      }
    }
  }
  return { dirs, c };
}
const maps = [...[1, 2, 8, 9].map((s) => [`valley ${s}`, () => createWorld(s)]), ...[1, 2].map((s) => [`mainland ${s}`, () => createMainland(s)])];
for (const [name, make] of maps) {
  const w = make();
  const bad = [];
  let worst = DIRS;
  for (const sp of w.partSpots) {
    const { dirs, c } = seenFrom(w, sp);
    worst = Math.min(worst, dirs);
    if (dirs < MIN_DIRS) bad.push(`${ZONE_NAMES[sp.zone]} (${sp.x.toFixed(0)}, ${sp.z.toFixed(0)}): ${dirs}/${DIRS}`);
    if (c.y < sp.y + CROWS.MIN - 1e-6) bad.push(`${ZONE_NAMES[sp.zone]}: crows ${(c.y - sp.y).toFixed(1)} m up`);
  }
  check(`${name}: the crows over all ${w.partSpots.length} supply spots are seen from ${CROWS.SEEN} m in ${MIN_DIRS}+ of ${DIRS} directions`, w.partSpots.length > 0 && !bad.length, bad.length ? bad.join('; ') : `(fewest: ${worst})`);
}

// ---------------------------------------------------------------- the steps, as numbers
check('no help before the first step', supplyHelpLevel(SUPPLY_HELP_AT[0] - 0.01, false) === SUPPLY_HELP.NONE);
check('...one step at each time', SUPPLY_HELP_AT.every((t, i) => supplyHelpLevel(t, false) === i + 1));
check('...and none at all for a team that has found one', SUPPLY_HELP_AT.every((t) => supplyHelpLevel(t + 1000, true) === SUPPLY_HELP.NONE));
const sp0 = { x: 12.5, y: 0, z: -40 };
const nar = narrowedAt(sp0, 3);
const nd = Math.hypot(nar.x - sp0.x, nar.z - sp0.z);
check('the narrowed rumour points near the spot, not at it', nd > 1 && nd <= NARROW_R, `${nd.toFixed(1)} m`);

// ---------------------------------------------------------------- the server
const game = new Game({ seed: 4242, godMode: true, dayLength: 3600, log: () => {} });
function join(name) {
  const c = { id: 0 };
  const session = game.onOpen({
    send(bytes) {
      const r = new Reader(bytes.slice ? bytes.slice().buffer : bytes);
      if (r.u8() === S2C.WELCOME) c.id = r.u16();
    },
  });
  const w = new Writer(64);
  w.u8(C2S.JOIN);
  w.u8(PROTOCOL_VERSION);
  w.str(name);
  game.onMessage(session, w.bytes().slice());
  return game.players.get(c.id);
}
const global = () => {
  const w = new Writer(256);
  w.u8(1);
  game.writeGlobal(w);
  const r = new Reader(w.bytes().slice().buffer);
  const g = readGlobal(r, null);
  if (r.left) throw new Error(`${r.left} trailing bytes in the global state`);
  return g;
};
const said = [];
const notify = game.notify.bind(game);
game.notify = (msg, arg, to) => {
  if (msg === NOTIFY.SUPPLY_HINT) said.push(arg);
  return notify(msg, arg, to);
};
const tick = (n = 2) => {
  for (let i = 0; i < n; i++) game.update();
};

join('Alice');
join('Bob');
tick();
let g = global();
const hidden = game.items.filter((e) => ITEM_DEFS[e.item]?.cat === 'part' && e.hint >= 0);
const onSpot = hidden.every((e) => {
  const sp = game.world.partSpots[g.spots[e.hint]];
  return sp && Math.hypot(sp.x - e.x, sp.z - e.z) < 0.05;
});
check('the global state names the spot each hidden supply is at', hidden.length > 0 && onSpot, `${hidden.length} hidden`);
check('...and every spot it names is in the place its rumour names', g.spots.every((si, k) => si === 0xffff || game.world.partSpots[si]?.zone === g.hints[k]));
check('a team that has just set out gets no help', g.help === SUPPLY_HELP.NONE);

const reach = (t) => {
  game.supplyClock = t - 0.01;
  tick(2);
  return global().help;
};
check('nothing found by the first step: the rumour is narrowed', reach(SUPPLY_HELP_AT[0]) === SUPPLY_HELP.NARROW);
check('...then the compass ping', reach(SUPPLY_HELP_AT[1]) === SUPPLY_HELP.PING);
check('...no radio before its time', said.length === 0);
check('...then the radio, once, about a supply still hidden', reach(SUPPLY_HELP_AT[2]) === SUPPLY_HELP.RADIO && said.length === 1 && !(game.supplyFound & (1 << said[0])) && g.spots[said[0]] !== 0xffff, JSON.stringify(said));
tick(40);
check('...and not again', said.length === 1);

// one is found: the help is taken back
const e = hidden[0];
game.supplyFound |= 1 << e.hint;
tick(2);
check('once one is found, the help is gone', global().help === SUPPLY_HELP.NONE);

// a team that found one early never sees any
game.supplyClock = 0;
game.supplyHelp = 0;
said.length = 0;
for (const t of SUPPLY_HELP_AT) reach(t + 30);
check('a team that has found one gets no help at any step', global().help === SUPPLY_HELP.NONE && said.length === 0);

console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join('; ')}` : '\nall supply-help checks passed');
process.exit(fails.length ? 1 : 0);
