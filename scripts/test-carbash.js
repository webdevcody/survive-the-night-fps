// Hitting a car with a knife or a bat. The body rocks and settles, scrap metal breaks off and lands, and the
// server pays scrap and tells every client it was a bash (a bat harder than a knife). A tree is still wood, and
// a wreck that is not a car is still a spark. The car the team came in gives scrap too, and it stays where it is.
// usage: node scripts/test-carbash.js [seed]
import { Game } from '../server/game.js';
import { C2S, S2C, PROTOCOL_VERSION, Writer, Reader } from '../shared/protocol.js';
import { SLOT_MELEE } from '../shared/constants.js';
import { ITEM, IMPACT } from '../shared/defs.js';
import { COL } from '../shared/collision.js';
import { PROPS } from '../shared/props.js';
import {
  CAR_BASH,
  BASH_SOFT,
  BASH_HARD,
  bashCarAt,
  carContains,
  carToWorld,
  worldToCar,
  createSpring,
  springImpulse,
  springStep,
  makeDent,
  makeShards,
  stepShard,
} from '../shared/carbash.js';

const seed = +(process.argv[2] || 4242);
const fails = [];
const check = (name, ok, info = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${info}`);
  if (!ok) fails.push(name);
};

// ---------------------------------------------------------------- the spring and the falling scrap
{
  const sp = createSpring();
  springImpulse(sp, 0.8, -1.2, BASH_HARD);
  check('a hit shoves the car', sp.liftV > 1 && sp.rollV > 0 && sp.pitchV < 0, `liftV ${sp.liftV.toFixed(2)} rollV ${sp.rollV.toFixed(2)} pitchV ${sp.pitchV.toFixed(2)}`);
  let moving = true;
  let peak = 0;
  for (let t = 0; t < 3; t += 1 / 60) {
    moving = springStep(sp, 1 / 60);
    peak = Math.max(peak, sp.lift);
  }
  check('it rises, then the suspension settles', peak > 0.02 && peak < 0.1 && !moving && Math.abs(sp.lift) < 0.01, `peak ${peak.toFixed(3)} lift ${sp.lift.toFixed(4)}`);
}

{
  const rng = () => 0.5;
  const soft = makeShards(1, 1, 1, 1, 0, 0, BASH_SOFT, rng);
  const hard = makeShards(1, 1, 1, 1, 0, 0, BASH_HARD, rng);
  check('a knife knocks one piece off and a bat knocks three', soft.length === 1 && hard.length === 3 && soft[0].panel && hard[0].panel, `${soft.length} / ${hard.length}`);
  check('the piece is a scrap of metal, not a panel in the lens', soft[0].sx < 0.5 && soft[0].sz < 0.3 && Math.hypot(soft[0].vx, soft[0].vz) < 3.5, `${soft[0].sx.toFixed(2)}x${soft[0].sz.toFixed(2)} v ${Math.hypot(soft[0].vx, soft[0].vz).toFixed(2)}`);
  const s = hard[0];
  const x0 = s.x;
  const z0 = s.z;
  let y0 = s.y;
  for (let t = 0; t < 4; t += 1 / 60) stepShard(s, 0, 1 / 60, null);
  check('the piece flies, then lands and stays', s.sleep && s.y < y0 && s.y < 0.1 && s.vy === 0, `y ${y0.toFixed(2)} -> ${s.y.toFixed(3)}`);
  check('it lands within a step of the car', Math.hypot(s.x - x0, s.z - z0) < 2.2, `d ${Math.hypot(s.x - x0, s.z - z0).toFixed(2)}`);
  const buried = makeShards(0, 0.5, 0, 0, 1, 0, BASH_SOFT, rng)[0];
  buried.vy = -2;
  let pushed = false;
  for (let t = 0; t < 0.5 && !buried.sleep; t += 1 / 60) {
    const before = buried.y;
    stepShard(buried, 0, 1 / 60, () => buried.y < 0.4);
    if (buried.y > before) pushed = true;
  }
  check('a piece that falls back into the car is pushed back out', pushed, `y ${buried.y.toFixed(2)}`);
}

{
  const pr = { type: 'car', x: 10, y: 2, z: -4, ry: Math.PI / 2 };
  const back = carToWorld(pr, 0, 0.7, 0);
  const local = worldToCar(pr, back.x, back.y, back.z);
  check('a point on the car converts and converts back', Math.abs(local.x) < 1e-6 && Math.abs(local.y - 0.7) < 1e-6 && Math.abs(local.z) < 1e-6, `${local.x.toFixed(3)} ${local.y.toFixed(3)} ${local.z.toFixed(3)}`);
  check('the body counts as the car and the ground beside it does not', carContains(pr, back.x, back.y, back.z) && !carContains(pr, pr.x + 6, pr.y, pr.z));
  check('the nearest of two cars is the one that was hit', bashCarAt([pr, { type: 'car_wreck', x: 40, y: 2, z: -4, ry: 0 }], back.x, back.y, back.z) === pr);
  const dent = makeDent({ type: 'car', x: 0, y: 0, z: 0, ry: 0 }, 0.95, 0.64, -0.2, () => 0.5);
  check('the scrape lies flat on the door', Math.abs(dent.nx - 1) < 0.02 && Math.abs(dent.ny) < 0.02 && Math.abs(dent.nz) < 0.02 && dent.x > 0.85 && dent.x < 0.95 && dent.y > 0.4 && dent.y < 0.85, `${dent.nx.toFixed(2)} ${dent.ny.toFixed(2)} ${dent.nz.toFixed(2)} @ ${dent.x.toFixed(2)} ${dent.y.toFixed(2)}`);
  check('every bashed prop is one that gives scrap', [...CAR_BASH].every((t) => PROPS[t]?.salvage === true), [...CAR_BASH].filter((t) => !PROPS[t]?.salvage).join(','));
}

// ---------------------------------------------------------------- on a real map: the car, a wreck, a tree
const game = new Game({ seed, godMode: true, dayLength: 3600, log: () => {} });
function client(name) {
  const c = { name, id: 0 };
  c.conn = {
    send(bytes) {
      const r = new Reader(bytes.slice ? bytes.slice().buffer : bytes);
      if (r.u8() === S2C.WELCOME) c.id = r.u16();
    },
  };
  c.session = game.onOpen(c.conn);
  const w = new Writer(64);
  w.u8(C2S.JOIN);
  w.u8(PROTOCOL_VERSION);
  w.str(name);
  game.onMessage(c.session, w.bytes().slice());
  c.p = () => game.players.get(c.id);
  return c;
}
const A = client('Basher');
for (let i = 0; i < 2; i++) game.update();
const p = A.p();
const s = p.state;
game.combat.forTargets = () => {};
const scrap = () => p.inv.reduce((n, x) => n + (x && x.item === ITEM.SCRAP ? x.count : 0), 0);

// stand near `at` and swing until a hit passes `accept` (default: any hit). Other hits are discarded.
function swingAt(at, weapon, accept = () => true) {
  s.weapons[SLOT_MELEE] = weapon;
  s.slot = SLOT_MELEE;
  const hits = [];
  const real = game.impact.bind(game);
  game.impact = (kind, x, y, z, nx, ny, nz) => {
    hits.push({ kind, x, y, z });
    real(kind, x, y, z, nx, ny, nz);
  };
  let found = false;
  for (const dist of [1.15, 1.55, 2.05]) {
    for (let k = 0; k < 8 && !found; k++) {
      const ang = (k / 8) * Math.PI * 2;
      s.x = at.x + Math.cos(ang) * dist;
      s.z = at.z + Math.sin(ang) * dist;
      s.y = game.world.heightAt(s.x, s.z);
      const dx = at.x - s.x;
      const dz = at.z - s.z;
      s.yaw = Math.atan2(-dx, -dz);
      for (const pitch of [-0.15, -0.4, 0.05]) {
        s.pitch = pitch;
        const before = hits.length;
        game.combat.melee(p, { weapon, heavy: false });
        if (hits.length > before && accept(hits[hits.length - 1])) found = true;
        else if (hits.length > before) hits.pop();
        if (found) break;
      }
    }
    if (found) break;
  }
  game.impact = real;
  return hits;
}

const car = game.world.props.find((pr) => pr.type === 'car');
const onCar = (h) => h.kind === IMPACT.BASH && bashCarAt(game.world.props, h.x, h.y, h.z) === car;
const had = scrap();
const knife = swingAt(car, ITEM.KNIFE, onCar);
check('a knife on the car you came in is a bash', knife.length === 1 && knife[0].kind === IMPACT.BASH, knife.map((h) => h.kind).join(',') || 'no hit');
check('and it pays scrap', scrap() === had + 1, `${had} -> ${scrap()}`);
check('the car is still there', game.world.props.includes(car) && bashCarAt(game.world.props, knife[0].x, knife[0].y, knife[0].z) === car);

const bat = swingAt(car, ITEM.BAT, (h) => h.kind === IMPACT.BASH_HARD && bashCarAt(game.world.props, h.x, h.y, h.z) === car);
check('a bat on the same car hits harder', bat.some((h) => h.kind === IMPACT.BASH_HARD) && scrap() === had + 2, `scrap ${scrap()}`);

const wreck = game.world.props.find((pr) => pr.type === 'car_wreck');
const wreckHits = swingAt(wreck, ITEM.KNIFE, (h) => h.kind === IMPACT.BASH && bashCarAt(game.world.props, h.x, h.y, h.z)?.type === 'car_wreck');
check('a wrecked car bashes too', wreckHits.some((h) => h.kind === IMPACT.BASH) && bashCarAt(game.world.props, wreckHits[0].x, wreckHits[0].y, wreckHits[0].z)?.type === 'car_wreck', wreckHits.map((h) => h.kind).join(','));

const other = game.world.props.find((pr) => pr.type === 'generator' || pr.type === 'tractor');
if (other) {
  const quiet = swingAt(other, ITEM.KNIFE, (h) => h.kind === IMPACT.SPARK);
  check('a generator or a tractor still just sparks', quiet.some((h) => h.kind === IMPACT.SPARK) && quiet.every((h) => h.kind !== IMPACT.BASH && h.kind !== IMPACT.BASH_HARD), `${other.type} ${quiet.map((h) => h.kind).join(',')}`);
} else check('a generator or a tractor still just sparks', false, 'none on this seed');

// a tree, from the same search the salvage smoke uses
let tree = null;
const cols = game.world.staticGrid.query(car.x, car.z, 80, []);
for (const col of cols) {
  if (!(col.flags & COL.TREE)) continue;
  const hits = swingAt({ x: col.x, z: col.z, y: col.y0 }, ITEM.KNIFE, (h) => h.kind === IMPACT.WOOD);
  if (hits.some((h) => h.kind === IMPACT.WOOD)) {
    tree = hits;
    break;
  }
}
check('a tree is still wood, not a bash', !!tree && tree.every((h) => h.kind !== IMPACT.BASH && h.kind !== IMPACT.BASH_HARD), tree ? tree.map((h) => h.kind).join(',') : 'no tree hit');

const carCol = game.world.staticGrid.query(car.x, car.z, 2, []).find((c) => c.flags & COL.CAR);
check('the car collider is marked as a car and as salvage', !!carCol && !!(carCol.flags & COL.SALVAGE));

console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join('; ')}` : '\nall car-bash checks passed');
process.exit(fails.length ? 1 : 0);
