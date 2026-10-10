// The smoker (ZTYPE.SMOKER, AREA.SMOKE, shared/smoke.js), against the real server in-process with one survivor:
//   - within smokeRange of a survivor it stops and breathes out a cloud where it stands, smokeRadius across, which
//     is gone again smokeLife s later; another follows after smokeRate s or more; out of range, none
//   - killed out in the open it lets go one more cloud (deathSmoke); killed among baseCount pieces of what the
//     survivors built it lets go one that fills the base (baseSmoke); with fewer pieces about, the small one
//   - a cloud's radius fits the wire (a u8 of tenths of a metre)
//   - how deep in the clouds an eye is (smokeCover): 1 at the heart, thinning to 0 at the edge, none above or outside
//   - the horde: none before night 10, at least one on night 10
// usage: node scripts/test-smoker.js [seed]
import { Game } from '../server/game.js';
import { C2S, S2C, ENT, PROTOCOL_VERSION, Writer, Reader } from '../shared/protocol.js';
import { SERVER_TICK_RATE } from '../shared/constants.js';
import { ZTYPE, ZOMBIE_DEFS, AREA, STRUCT } from '../shared/defs.js';
import { groundAt } from '../shared/collision.js';
import { smokeCover, SMOKE } from '../shared/smoke.js';

const seed = Number(process.argv[2]) || 1;
const DT = 1 / SERVER_TICK_RATE;
const def = ZOMBIE_DEFS[ZTYPE.SMOKER];
const fails = [];
const check = (name, ok, info = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${info}`);
  if (!ok) fails.push(name);
};

const game = new Game({ seed, godMode: true, dayLength: 3600, themes: false, log: () => {} });
const conn = { send(bytes) { const r = new Reader(bytes.slice ? bytes.slice().buffer : bytes); if (r.u8() === S2C.WELCOME) conn.id = r.u16(); } };
const session = game.onOpen(conn);
const w = new Writer(64);
w.u8(C2S.JOIN);
w.u8(PROTOCOL_VERSION);
w.str('Smoked');
game.onMessage(session, w.bytes().slice());
for (let i = 0; i < 5; i++) game.update();
const p = game.players.get(conn.id);
const s = p.state;

// open, level ground out from the car, with nothing standing on it
function findSpot() {
  const wd = game.world;
  for (let r = 60; r < 280; r += 7) {
    for (let a = 0; a < 6.28; a += 0.3) {
      const x = wd.car.x + Math.sin(a) * r;
      const z = wd.car.z + Math.cos(a) * r;
      if (Math.abs(x) > 280 || Math.abs(z) > 280) continue;
      let ok = true;
      for (let dx = -16; dx <= 16 && ok; dx += 2) {
        for (let dz = -16; dz <= 16 && ok; dz += 2) {
          if (wd.isDeepWater(x + dx, z + dz) || game.nav.isBlocked(x + dx, z + dz) || Math.abs(wd.heightAt(x + dx, z + dz) - wd.heightAt(x, z)) > 1.2) ok = false;
        }
      }
      if (ok) return { x, z };
    }
  }
  return null;
}
function clear() {
  for (const z of [...game.zombies]) {
    game._listRemove(game.zombies, z);
    game.removeEntity(z);
  }
  for (const a of [...game.areas]) {
    game._listRemove(game.areas, a);
    game.removeEntity(a);
  }
  game.zm.herds.reset();
  game.zm.maintainT = game.zm.herds.spawnT = 1e9;
}
const smokes = () => game.areas.filter((a) => a.atype === AREA.SMOKE);
const spot = findSpot();
check('found open ground', !!spot);
s.x = spot.x;
s.z = spot.z;
s.y = groundAt(game.world, s.x, s.z, 200, 0.3);
const smoker = (d) => game.zm.spawn(ZTYPE.SMOKER, spot.x + d, spot.z, { horde: true });

// ---------------------------------------------------------------- it breathes out its cloud
{
  clear();
  const z = smoker(12);
  let first = null;
  let t = 0;
  for (; t < 10 && !first; t += DT) {
    game.update();
    first = smokes()[0] || null;
  }
  const at = first ? Math.hypot(first.x - z.x, first.z - z.z) : -1;
  check('a smoker 12 m from a survivor breathes out a cloud', !!first && first.radius === def.smokeRadius, first ? `after ${t.toFixed(1)} s, ${at.toFixed(1)} m from it, radius ${first.radius}` : 'none in 10 s');
  check('...where it stands', first && at < 2.5, `${at.toFixed(2)} m`);
  let gone = -1;
  let next = -1;
  for (let u = 0; u < def.smokeLife + def.smokeRate + 6; u += DT) {
    game.update();
    if (gone < 0 && !game.areas.includes(first)) gone = u;
    if (next < 0 && smokes().some((a) => a !== first)) next = u;
    s.x = z.x - 6; // (keep the survivor in its range, out of its reach)
    s.z = z.z;
  }
  check(`...gone again after ${def.smokeLife} s`, Math.abs(gone - def.smokeLife) < 0.2, `${gone.toFixed(2)} s`);
  check(`...and another no sooner than ${def.smokeRate} s on`, next >= def.smokeRate - 0.1 && next < def.smokeRate + 5, `${next.toFixed(1)} s`);
  s.x = spot.x;
  s.z = spot.z;
}
{
  clear();
  const z = smoker(def.smokeRange + 12);
  z.alertT = 0;
  let n = 0;
  for (let t = 0; t < 8; t += DT) {
    game.update();
    n = Math.max(n, smokes().length);
    z.x = spot.x + def.smokeRange + 12; // (it stays out there)
    z.z = spot.z;
  }
  check(`a smoker ${def.smokeRange + 12} m off, out of its range: no cloud`, n === 0, `${n}`);
}

// ---------------------------------------------------------------- its last breath
const piece = (x, z) => {
  const e = { kind: ENT.STRUCTURE, stype: STRUCT.BARRICADE, rot8: 0, x, y: groundAt(game.world, x, z, 200, 0.3), z, hp: 300, maxHp: 300, minHealth: 1, placedAt: game.time, state: 1, owner: p.id, burnLeft: 0, collider: null, trapTick: 0 };
  game.spawnEntity(e);
  e.collider = game.structCollider(e.stype, e.x, e.y, e.z, 0, e.id);
  game.world.structGrid.add(e.collider);
  game.nav.addStructure(e.collider);
  game.structures.push(e);
  return e;
};
const lastBreath = (d) => {
  clear();
  const z = smoker(d);
  z.specialCd = 1e9;
  game.update();
  game.combat.killZombie(z, p, {});
  return smokes();
};
{
  const open = lastBreath(8);
  check('killed out in the open: one more cloud, the small one', open.length === 1 && open[0].radius === def.deathSmoke.radius && Math.abs(open[0].until - game.time - def.deathSmoke.life) < 0.1, open.map((a) => a.radius).join());
  // four barricades round a spot 8 m off: the survivors' base
  const base = [[0, 4], [0, -4], [4, 0], [-4, 0]].map(([ox, oz]) => piece(spot.x + 8 + ox * 1.5, spot.z + oz * 1.5));
  const inBase = lastBreath(8);
  check(`killed among ${def.baseCount} pieces of the base: a cloud that fills it`, inBase.length === 1 && inBase[0].radius === def.baseSmoke.radius && Math.abs(inBase[0].until - game.time - def.baseSmoke.life) < 0.1, inBase.map((a) => a.radius).join());
  const out = lastBreath(8 + def.baseRange + 8);
  check(`...killed ${def.baseRange + 8} m out from it: the small one`, out.length === 1 && out[0].radius === def.deathSmoke.radius, out.map((a) => a.radius).join());
  game.destroyStructure(base[0], false);
  const few = lastBreath(8);
  check(`...with only ${def.baseCount - 1} pieces about: the small one`, few.length === 1 && few[0].radius === def.deathSmoke.radius, few.map((a) => a.radius).join());
  check("the base's cloud fits the wire (a u8 of tenths of a metre)", Math.round(def.baseSmoke.radius * 10) <= 255);
  for (const e of base.slice(1)) game.destroyStructure(e, false);
  clear();
}

// ---------------------------------------------------------------- how deep in it an eye is
{
  const c = { x: 0, y: 0, z: 0, radius: 10 };
  const at = (x, y, z) => smokeCover(x, y, z, [c]);
  check('at the heart of a cloud: 1', at(0, 1.6, 0) === 1 && at((1 - SMOKE.edge) * 10, 1.6, 0) === 1);
  const mid = at((1 - SMOKE.edge / 2) * 10, 1.6, 0);
  check('...thinning out towards its edge', mid > 0.4 && mid < 0.6, mid.toFixed(2));
  check('...none at the edge, outside, or high over it', at(10, 1.6, 0) === 0 && at(14, 1.6, 0) === 0 && at(0, SMOKE.height + 1, 0) === 0);
  check('...the thickest of two counts', smokeCover(9, 1.6, 0, [c, { x: 9, y: 0, z: 0, radius: 4 }]) === 1 && smokeCover(0, 0, 0, []) === 0);
}

// ---------------------------------------------------------------- the horde
{
  const count = (n) => {
    game.day = n;
    game.startNight();
    return game.waves.flatMap((wv) => wv.queue).filter((t) => t === ZTYPE.SMOKER).length;
  };
  const before = [1, 4, 9].map(count);
  const on = count(def.minNight);
  check(`no smokers in the horde before night ${def.minNight}`, before.every((k) => k === 0), before.join('/'));
  check(`...and smokers in it on night ${def.minNight}`, on >= 1, `${on}`);
}

if (fails.length) {
  console.log(`\n${fails.length} FAILED`);
  process.exit(1);
}
console.log('\nall smoker checks passed');
process.exit(0);
