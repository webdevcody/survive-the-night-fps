// The flammer (ZTYPE.FLAMMER) and the fire it brings, against a real Game in-process with survivors joined as clients
// join and driven by real input:
//   - a flammer that comes up to a wooden wall sets it alight; one beside a metal wall does not, and neither does one
//     kept away from what was built
//   - a burning piece takes STRUCT_FIRE.dps until it is gone, and the fire spreads to the piece that touches it; a swing
//     of the hammer puts it out for nothing, and one without the hammer in hand does not
//   - its blow sets a survivor alight: they burn and keep burning until put out; holding Space puts it out in about
//     PLAYER_FIRE.time, a teammate beside them holding theirs as well halves that, a tap does not do it, going down
//     puts it out
//   - fire does it no harm (a molotov's status, a campfire), the sun does
//   - the clients hear all of it: a burning survivor's STATUS field, their own burning bit and how far it is put out,
//     a burning piece's BURN field
// usage: node scripts/test-flammer.js [seed]
import { Game } from '../server/game.js';
import { C2S, S2C, PROTOCOL_VERSION, Writer, Reader, ENT, PSTATUS, qangle16, qpitch, writeInput } from '../shared/protocol.js';
import { BTN, SERVER_TICK_RATE, SLOT_BUILD, PHASE } from '../shared/constants.js';
import { ZTYPE, ZOMBIE_DEFS, STRUCT, STRUCT_DEFS, ITEM, STRUCT_FIRE, PLAYER_FIRE, structBurns } from '../shared/defs.js';
import { makeBox, COL } from '../shared/collision.js';
import { readSnapshot } from '../client/net/decode.js';

const seed = +(process.argv[2] || 4242);
const DT = 1 / SERVER_TICK_RATE;
const fails = [];
const check = (name, ok, info = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${info}`);
  if (!ok) fails.push(name);
};

const game = new Game({ seed, dayLength: 3600, themes: false, log: () => {} });

// a client: joins, decodes every snapshot it is sent (client/net/decode.js), and sends commands with the buttons asked
function join(name) {
  const c = { id: 0, seq: 0, buttons: 0, net: { tick: 0, ack: 0 }, global: null, self: {}, store: { ents: new Map(), onCreate() {}, onRemove() {}, onUpdate() {} }, handler: new Proxy({}, { get: () => () => {} }) };
  c.session = game.onOpen({
    send(bytes) {
      const r = new Reader(bytes.slice ? bytes.slice().buffer : bytes);
      const t = r.u8();
      if (t === S2C.WELCOME) c.id = r.u16();
      else if (t === S2C.SNAPSHOT && c.id) readSnapshot(r, c);
    },
  });
  const w = new Writer(64);
  w.u8(C2S.JOIN);
  w.u8(PROTOCOL_VERSION);
  w.str(name);
  game.onMessage(c.session, w.bytes().slice());
  c.p = game.players.get(c.id);
  return c;
}
function send(c) {
  const w = new Writer(64);
  w.u8(C2S.INPUT);
  w.u16(game.tick & 0xffff);
  w.u8(0);
  const cmds = [];
  for (let i = 0; i < 3; i++) {
    c.seq = (c.seq + 1) & 0xffff;
    cmds.push({ seq: c.seq, buttons: c.buttons, qyaw: qangle16(c.p.state.yaw), qpitch: qpitch(0), slot: 255 });
  }
  writeInput(w, cmds);
  game.onMessage(c.session, w.bytes().slice());
}
const clients = [];
const run = (secs, each = null) => {
  for (let i = 0, n = Math.round(secs * SERVER_TICK_RATE); i < n; i++) {
    for (const c of clients) send(c);
    game.update();
    if (each && each()) return i * DT;
  }
  return Infinity;
};
function clearZombies() {
  for (const z of [...game.zombies]) {
    game._listRemove(game.zombies, z);
    game.removeEntity(z);
  }
  game.zm.herds.reset();
  game.zm.maintainT = game.zm.herds.spawnT = 1e9;
}
// a piece put up as Game.build puts one, without the builder's checks (a test puts it exactly where it wants it)
function place(type, x, z, rot8 = 0) {
  const def = STRUCT_DEFS[type];
  const y = game.world.floorAt(x, z, game.world.heightAt(x, z) + 0.5);
  const e = { kind: ENT.STRUCTURE, stype: type, rot8, x, y, z, hp: def.hp, maxHp: def.hp, minHealth: 1, placedAt: game.time, state: 1, owner: 0, burnLeft: def.burn || 0, fire: 0, fireDmg: 0, collider: null, trapTick: 0 };
  game.spawnEntity(e);
  e.collider = game.structCollider(type, x, y, z, rot8, e.id);
  game.world.structGrid.add(e.collider);
  game.nav.addStructure(e.collider);
  game.structures.push(e);
  return e;
}
const removeAll = () => {
  for (const e of [...game.structures]) game.destroyStructure(e, false);
};
const put = (p, x, z) => {
  const s = p.state;
  s.x = x;
  s.z = z;
  s.y = game.world.heightAt(x, z);
  s.vx = s.vy = s.vz = 0;
};

const A = join('Ash');
const B = join('Bea');
clients.push(A, B);
run(0.5);
check('the run is under way (daytime)', game.phase === PHASE.DAY);
clearZombies();
// open ground well away from the car, where nothing stands
const car = game.world.car;
let spot = null;
for (let r = 40; r < 260 && !spot; r += 6) {
  for (let a = 0; a < 6.28 && !spot; a += 0.3) {
    const x = car.x + Math.sin(a) * r;
    const z = car.z + Math.cos(a) * r;
    let ok = !game.world.isDeepWater(x, z);
    const h0 = game.world.heightAt(x, z);
    for (let dx = -14; dx <= 14 && ok; dx += 2) for (let dz = -14; dz <= 14 && ok; dz += 2) ok = !game.nav.isBlocked(x + dx, z + dz) && !game.world.isDeepWater(x + dx, z + dz) && Math.abs(game.world.heightAt(x + dx, z + dz) - h0) < 1.5;
    if (ok) spot = { x, z };
  }
}
check('open ground to try it on', !!spot);
const X = spot.x;
const Z = spot.z;
put(A.p, X + 30, Z + 30);
put(B.p, X + 34, Z + 30);

// ---------------------------------------------------------------- the definition
const def = ZOMBIE_DEFS[ZTYPE.FLAMMER];
check('the flammer: a special of a night of its own, fireproof, that sets things alight', def && def.fireproof && def.igniteRange > 0 && def.igniteRate > 0 && !def.boss && Object.values(ZOMBIE_DEFS).filter((d) => !d.boss && d.minNight === def.minNight).length === 1, `night ${def?.minNight}`);
check('wood burns, metal and the fires themselves do not', structBurns(STRUCT.WALL) && structBurns(STRUCT.BARRICADE) && structBurns(STRUCT.DOOR) && !structBurns(STRUCT.METAL_WALL) && !structBurns(STRUCT.TORCH) && !structBurns(STRUCT.CAMPFIRE) && !structBurns(STRUCT.GENERATOR));

// ---------------------------------------------------------------- setting what was built alight
// a wooden wall and a metal one, 8 m apart, and a flammer walking up to each from behind (the survivors far off: the
// flammer has nobody to chase, so it is steered straight into the wall as a wanderer would)
const wood = place(STRUCT.WALL, X, Z);
const metal = place(STRUCT.METAL_WALL, X + 8, Z);
const f1 = game.zm.spawn(ZTYPE.FLAMMER, X, Z - 1.5, { horde: true });
const f2 = game.zm.spawn(ZTYPE.FLAMMER, X + 8, Z - 1.5, { horde: true });
const f3 = game.zm.spawn(ZTYPE.FLAMMER, X + 4, Z - 9, { horde: true });
const hold = () => {
  for (const [f, x, z] of [
    [f1, X, Z - 0.75],
    [f2, X + 8, Z - 0.75],
    [f3, X + 4, Z - 9],
  ]) {
    f.x = x;
    f.z = z;
    f.vx = f.vz = 0;
    f.wanderX = x;
    f.wanderZ = z;
    f.target = 0;
  }
};
const lit = run(4, () => {
  hold();
  return wood.fire > 0;
});
check('a flammer against a wooden wall sets it alight', wood.fire > 0, `after ${lit.toFixed(2)} s`);
run(2, hold);
check('...one against a metal wall does not', !(metal.fire > 0));
check('...and nothing out of its reach catches', game.structures.every((e) => e === wood || !(e.fire > 0)));
// the clients: the burning piece's BURN field
run(0.2, hold);
const seenWood = A.store.ents.get(wood.id);
check('the clients see the wall burning (SF.BURN 1) and the metal one not', !!seenWood && seenWood.q[5] === 1 && A.store.ents.get(metal.id)?.q[5] === 0, `${seenWood?.q[5]}`);
for (const f of [f1, f2, f3]) {
  game._listRemove(game.zombies, f);
  game.removeEntity(f);
}

// ---------------------------------------------------------------- the fire: damage, spread, the hammer
removeAll();
{
  // three walls end to end along x, a gap of 2 m and a fourth, and the first set alight
  const w = [place(STRUCT.WALL, X, Z), place(STRUCT.WALL, X + 3.05, Z), place(STRUCT.WALL, X + 6.1, Z), place(STRUCT.WALL, X + 11.1, Z)];
  game.igniteStructure(w[0]);
  const hp0 = w[0].hp;
  run(2);
  const lost = hp0 - w[0].hp;
  const want = STRUCT_FIRE.dps * game.diff.hurt * 2;
  check('a burning wall takes STRUCT_FIRE.dps', Math.abs(lost - want) <= 13, `${lost.toFixed(0)} in 2 s (want ${want.toFixed(0)})`);
  const spreadT = run(25, () => w[1].fire > 0);
  check('...the fire spreads to the wall touching it', w[1].fire > 0 && spreadT >= STRUCT_FIRE.spreadAfter - 2, `after ${(2 + spreadT).toFixed(1)} s`);
  run(60);
  check('...burns down what it is on, if nobody puts it out', w[0].removed, `hp ${w[0].hp.toFixed(0)}`);
  check('...but does not jump a 2 m gap', !(w[3].fire > 0) && !w[3].removed);
  removeAll();
}
{
  // the hammer: a survivor with it in hand puts a burning wall out with one swing, for nothing
  const w = place(STRUCT.WALL, X, Z);
  const s = A.p.state;
  put(A.p, X, Z - 2);
  s.weapons[SLOT_BUILD] = ITEM.HAMMER;
  s.slot = 0;
  game.igniteStructure(w);
  run(0.5);
  A.p.actionT = -1;
  game.repair(A.p, w.id);
  check('a swing without the hammer in hand puts nothing out', w.fire > 0);
  s.slot = SLOT_BUILD;
  const inv = JSON.stringify(A.p.inv);
  A.p.actionT = -1;
  game.repair(A.p, w.id);
  check('...with it, the fire is out', !(w.fire > 0));
  check('...and it cost nothing', JSON.stringify(A.p.inv) === inv);
  const hp = w.hp;
  run(2);
  check('...and the wall burns no more', w.hp === hp);
  removeAll();
}

// ---------------------------------------------------------------- a survivor alight
const pa = A.p;
const pb = B.p;
put(pa, X, Z);
put(pb, X + 30, Z + 30);
pa.hp = pa.maxHp;
run(0.2);
{
  // its blow
  const f = game.zm.spawn(ZTYPE.FLAMMER, X, Z - 1.2, { horde: true });
  const t = run(6, () => {
    put(pa, X, Z);
    return pa.burning;
  });
  check("a flammer's blow sets a survivor alight", pa.burning, `after ${t.toFixed(2)} s`);
  game._listRemove(game.zombies, f);
  game.removeEntity(f);
}
run(0.2);
check('the burning survivor hears it (self status) and the others see it (STATUS field)', A.self.burning === 1 && (B.store.ents.get(pa.id)?.q[9] & PSTATUS.BURNING) > 0 && !(B.store.ents.get(pb.id)?.q[9] & PSTATUS.BURNING));
{
  pa.hp = pa.maxHp;
  const hp = pa.hp;
  run(4);
  check('they burn, and it does not go out by itself', pa.burning && hp - pa.hp > PLAYER_FIRE.dps * 3 * game.diff.hurt, `${(hp - pa.hp).toFixed(1)} hp in 4 s`);
  // a tap
  A.buttons = BTN.JUMP;
  run(0.15);
  A.buttons = 0;
  run(1.5);
  check('a tap of Space does not put it out', pa.burning);
  // held
  pa.hp = pa.maxHp;
  A.buttons = BTN.JUMP;
  let half = -1;
  const t = run(4, () => {
    if (half < 0 && A.self.douse >= 0.4) half = A.self.douse;
    return !pa.burning;
  });
  A.buttons = 0;
  check('holding Space puts it out in about PLAYER_FIRE.time', !pa.burning && Math.abs(t - PLAYER_FIRE.time) < 0.4, `${t.toFixed(2)} s`);
  check('...and they watched it go out (the douse in their status)', half >= 0.4, `${half}`);
  run(0.2);
  check('...which everyone hears', A.self.burning === 0 && !(B.store.ents.get(pa.id)?.q[9] & PSTATUS.BURNING));
}
{
  // a teammate beside them, both holding
  game.setAlight(pa);
  put(pb, X + 1, Z);
  A.buttons = BTN.JUMP;
  B.buttons = BTN.JUMP;
  const t = run(4, () => {
    put(pb, X + 1, Z);
    return !pa.burning;
  });
  A.buttons = B.buttons = 0;
  check('...with a teammate beside them holding theirs too, in half the time', !pa.burning && t < PLAYER_FIRE.time * 0.65, `${t.toFixed(2)} s`);
  // the teammate alone
  game.setAlight(pa);
  B.buttons = BTN.JUMP;
  const t2 = run(4, () => {
    put(pb, X + 1, Z);
    return !pa.burning;
  });
  B.buttons = 0;
  check('...and by the teammate alone', !pa.burning && Math.abs(t2 - PLAYER_FIRE.time) < 0.4, `${t2.toFixed(2)} s`);
  // too far off to reach
  game.setAlight(pa);
  put(pb, X + 6, Z);
  B.buttons = BTN.JUMP;
  run(3, () => put(pb, X + 6, Z));
  B.buttons = 0;
  check('...but not from out of reach', pa.burning);
  game.goDown(pa);
  check('going down puts it out', !pa.burning);
  game.revive(pa, null);
  pa.hp = pa.maxHp;
}

// ---------------------------------------------------------------- fireproof, but not sunproof
{
  const f = game.zm.spawn(ZTYPE.FLAMMER, X + 20, Z + 20, { horde: true });
  const hp = f.hp;
  game.combat.ignite(f, pa, ITEM.MOLOTOV);
  game.combat.damageZombie(f, 50, null, { fire: true });
  run(1, () => {
    f.x = X + 20;
    f.z = Z + 20;
  });
  check('fire does a flammer no harm', f.hp === hp && !(f.burnT > 0), `${f.hp} of ${hp}`);
  f.onFire = true;
  run(1);
  check('...the sun does', f.dead || f.hp < hp);
}

console.log(fails.length ? `\n${fails.length} FAILED` : '\nall ok');
process.exit(fails.length ? 1 : 0);
