// Two guns at once (shared/akimbo.js), against a real Game and with what the server sends decoded as a client does:
// a second pistol or shotgun put on onto the one in its slot makes a pair (rifles never), the two magazines are one,
// the hands take turns and the trigger can be pulled faster, there are no sights, and a reload fills both. Taken
// apart every way there is - put in the pack, dropped, torn down, swapped for another gun, a death - the second gun
// comes back as a gun of its own with its half of the rounds, and nothing is lost or made.
// usage: node scripts/test-akimbo.js [seed]
import { Game } from '../server/game.js';
import { C2S, S2C, ACT, ENT, PSTAT, SALVAGE_FROM, PROTOCOL_VERSION, Writer, Reader, qangle16, qpitch, writeInput } from '../shared/protocol.js';
import { BTN, CMD_DT, INVENTORY_SIZE, SLOT_PRIMARY, SLOT_PISTOL } from '../shared/constants.js';
import { ITEM, ITEM_DEFS, WEAPONS, AMMO, NOTIFY } from '../shared/defs.js';
import { createPlayerState, simulatePlayer, aimingWith, heldDef, hashPlayerState } from '../shared/playersim.js';
import { canPair, pairDef, PAIR, DUAL_BIT } from '../shared/akimbo.js';
import { readSnapshot } from '../client/net/decode.js';

const seed = +(process.argv[2] || 4242);
const game = new Game({ seed, godMode: true, dayLength: 3600, log: () => {} });
const fails = [];
const check = (name, ok, info = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${info}`);
  if (!ok) fails.push(name);
};

// a client, as test-unequip.js has it: the snapshot and the inventory decoded as the game does
function client(name) {
  const c = { name, id: 0, net: { tick: 0, ack: 0 }, global: null, self: {}, store: { ents: new Map(), onCreate() {}, onRemove() {}, onUpdate() {} }, notes: [], seq: 0, slots: [] };
  const nop = () => {};
  c.handler = new Proxy({ notify: (m, a) => c.notes.push([m, a]) }, { get: (t, k) => t[k] || nop });
  c.conn = {
    send(bytes) {
      const r = new Reader(bytes.slice ? bytes.slice().buffer : bytes);
      const t = r.u8();
      if (t === S2C.WELCOME) c.id = r.u16();
      else if (t === S2C.SNAPSHOT) readSnapshot(r, c);
      else if (t === S2C.INVENTORY) {
        for (let i = 0; i < INVENTORY_SIZE; i++) {
          const item = r.u8();
          const count = r.u16();
          c.slots[i] = item ? { item, count } : null;
        }
      }
    },
  };
  c.session = game.onOpen(c.conn);
  const w = new Writer(64);
  w.u8(C2S.JOIN);
  w.u8(PROTOCOL_VERSION);
  w.str(name);
  game.onMessage(c.session, w.bytes().slice());
  c.p = () => game.players.get(c.id);
  c.act = (act, ...args) => {
    const w2 = new Writer(16);
    w2.u8(C2S.ACTION);
    w2.u8(act);
    for (const a of args) w2.u8(a);
    game.onMessage(c.session, w2.bytes().slice());
  };
  c.input = (buttons, slot = 255) => {
    const w2 = new Writer(64);
    w2.u8(C2S.INPUT);
    w2.u16(game.tick & 0xffff);
    w2.u8(0);
    const cmds = [];
    for (let i = 0; i < 3; i++) {
      c.seq = (c.seq + 1) & 0xffff;
      cmds.push({ seq: c.seq, buttons, qyaw: qangle16(0), qpitch: qpitch(0), slot: i === 0 ? slot : 255 });
    }
    writeInput(w2, cmds);
    game.onMessage(c.session, w2.bytes().slice());
  };
  return c;
}

const A = client('Alice');
const B = client('Bob');
const a = A.p();
const s = a.state;
const run = (ticks, fn) => {
  for (let i = 0; i < ticks; i++) {
    A.input(fn ? fn(i) : 0);
    B.input(0);
    game.update();
  }
};
const pack = (...list) => {
  a.inv.fill(null);
  list.forEach((x, i) => (a.inv[i] = x && { count: 1, ...x }));
  a.invDirty = true;
};
const at = (i) => (a.inv[i] ? `${a.inv[i].item}:${a.inv[i].mag ?? '-'}` : '-');
const pistols = () => game.all.filter((e) => e.kind === ENT.ITEM && e.item === ITEM.PISTOL);
const clearGround = () => {
  for (const e of pistols()) game.removeItemEnt(e);
};
const P = WEAPONS[ITEM.PISTOL];
run(5);

// which guns: pistols and shotguns pair, rifles and the rest do not
check('the pistols and shotguns can be held two at once', [ITEM.PISTOL, ITEM.REVOLVER, ITEM.DEAGLE, ITEM.SHOTGUN, ITEM.DB_SHOTGUN].every(canPair));
check('...and the rifles, the anti-tank rifle, the SMG, the flare gun and melee weapons cannot', ![ITEM.AK47, ITEM.M4A1, ITEM.HUNTING_RIFLE, ITEM.AT_RIFLE, ITEM.MP5, ITEM.FLARE_GUN, ITEM.KNIFE].some(canPair));

// a second pistol onto the one in hand
{
  s.weapons[SLOT_PISTOL] = ITEM.PISTOL;
  s.mags[1] = 12;
  s.dual = 0;
  pack({ item: ITEM.PISTOL, mag: 7 });
  A.act(ACT.USE_ITEM, 0);
  run(3);
  check('a second pistol put on onto the first makes a pair, its rounds added to the magazine', s.dual === DUAL_BIT[SLOT_PISTOL] && s.mags[1] === 19 && a.inv[0] === null && s.slot === SLOT_PISTOL, `dual ${s.dual}, mag ${s.mags[1]}, cell 0 ${at(0)}`);
  check('...and the client hears of it in its own state', A.self.dual === DUAL_BIT[SLOT_PISTOL] && A.self.mags[1] === 19, `self.dual ${A.self.dual}`);
  const other = B.store.ents.get(a.id);
  check('...and the others see a pair in their hands (PSTAT.AKIMBO)', !!other && (other.q[9] & PSTAT.AKIMBO) !== 0, `q9 ${other?.q[9]}`);
  check('a pair changes the state\'s fingerprint', hashPlayerState(s) !== hashPlayerState({ ...s, dual: 0 }));
  pack({ item: ITEM.PISTOL, mag: 12 });
  A.act(ACT.USE_ITEM, 0);
  run(2);
  check('a third one onto the pair does nothing: two is all there are hands for', s.dual === DUAL_BIT[SLOT_PISTOL] && s.mags[1] === 19 && at(0) === `${ITEM.PISTOL}:12`);
}

// the pair's numbers
{
  const d = pairDef(ITEM.PISTOL);
  check('a pair of pistols: both magazines, faster shots, a wider cone, a longer reload', d.mag === P.mag * 2 && d.rate < P.rate && d.spread > P.spread && d.reload > P.reload && d.damage === P.damage && d.pellets === P.pellets);
  check('...and a shell-by-shell shotgun loads each shell as fast, with twice as many to load', pairDef(ITEM.SHOTGUN).reload === WEAPONS[ITEM.SHOTGUN].reload && pairDef(ITEM.SHOTGUN).mag === WEAPONS[ITEM.SHOTGUN].mag * 2);
  check('heldDef is the pair\'s in hand', heldDef(s) === d);
  check('no sights with a pair', !aimingWith({ ...s, reloadT: 0, switchT: 0 }, BTN.ALT) && aimingWith({ ...s, dual: 0, reloadT: 0, switchT: 0 }, BTN.ALT));
}

// in the simulation: the hands take turns, from the right, and a pull comes round sooner than one gun's
{
  const st = createPlayerState();
  Object.assign(st, { x: s.x, y: s.y, z: s.z, slot: SLOT_PISTOL, dual: DUAL_BIT[SLOT_PISTOL], switchT: 0 });
  st.weapons[SLOT_PISTOL] = ITEM.PISTOL;
  st.mags[1] = P.mag * 2;
  const shots = [];
  let seq = 0;
  // pull the trigger as often as it lets us for a second: a press, then let go
  for (let i = 0; i < Math.round(1 / CMD_DT); i++) {
    const ev = [];
    simulatePlayer(st, { seq: seq++, buttons: i & 1 ? 0 : BTN.ATTACK, yaw: 0, pitch: 0, slot: 255 }, game.world, ev);
    for (const e of ev) if (e.type === 'fire') shots.push(e.hand);
  }
  const one = createPlayerState();
  Object.assign(one, { x: s.x, y: s.y, z: s.z, slot: SLOT_PISTOL, switchT: 0 });
  one.weapons[SLOT_PISTOL] = ITEM.PISTOL;
  one.mags[1] = P.mag;
  let single = 0;
  for (let i = 0; i < Math.round(1 / CMD_DT); i++) {
    const ev = [];
    simulatePlayer(one, { seq: seq++, buttons: i & 1 ? 0 : BTN.ATTACK, yaw: 0, pitch: 0, slot: 255 }, game.world, ev);
    single += ev.filter((e) => e.type === 'fire').length;
  }
  check('the right gun goes first, then the left, in turn', shots.length > 2 && shots[0] === 1 && shots.every((h, i) => h === (i % 2 ? -1 : 1)), shots.join(' '));
  check('...and the pair gets more rounds off in a second than one pistol', shots.length > single && st.mags[1] === P.mag * 2 - shots.length, `${shots.length} vs ${single}`);
  check('a gun on its own says no hand', one.mags[1] === P.mag - single);
}

// a reload fills both, and takes longer
{
  s.mags[1] = 3;
  s.ammo[AMMO.P9] = 100;
  run(1, () => 0);
  A.input(0, SLOT_PISTOL);
  game.update();
  run(12);
  run(1, () => BTN.RELOAD);
  const t = s.reloadT;
  run(Math.ceil(P.reload * PAIR.reload * 20) + 4);
  check('a reload fills both magazines from the reserve', s.mags[1] === P.mag * 2 && s.ammo[AMMO.P9] === 100 - (P.mag * 2 - 3), `mag ${s.mags[1]}, reserve ${s.ammo[AMMO.P9]}`);
  check('...and takes the pair\'s time, not one gun\'s', t > P.reload * 1.2, `${t.toFixed(2)} s`);
}

// put one in the pack: the other stays in the hand, the rounds shared out
{
  pack();
  s.mags[1] = 19;
  A.act(ACT.UNEQUIP, SLOT_PISTOL, 255);
  run(2);
  check('put in the pack, one pistol goes with half the rounds and the other stays in the hand', s.dual === 0 && s.weapons[SLOT_PISTOL] === ITEM.PISTOL && s.mags[1] === 10 && at(0) === `${ITEM.PISTOL}:9`, `slot mag ${s.mags[1]}, cell 0 ${at(0)}`);
  check('...and no hand holds more than a magazine', s.mags[1] <= P.mag);
  A.act(ACT.USE_ITEM, 0);
  run(2);
  check('put on again, they are a pair with every round', s.dual === DUAL_BIT[SLOT_PISTOL] && s.mags[1] === 19);
}

// a full backpack: put in the pack, the pair stays a pair
{
  pack(...Array.from({ length: INVENTORY_SIZE }, () => ({ item: ITEM.CLOTH, count: ITEM_DEFS[ITEM.CLOTH].stack })));
  A.notes.length = 0;
  A.act(ACT.UNEQUIP, SLOT_PISTOL, 255);
  run(2);
  check('with the backpack full the pair stays together, and the survivor is told', s.dual === DUAL_BIT[SLOT_PISTOL] && s.mags[1] === 19 && A.notes.some(([m]) => m === NOTIFY.INVENTORY_FULL));
}

// swapped for another pistol-slot gun: both pistols go into the backpack, and need two cells
{
  pack({ item: ITEM.REVOLVER, mag: 5 });
  A.act(ACT.USE_ITEM, 0);
  run(2);
  const cells = [a.inv[0], a.inv[1]].filter(Boolean).map((x) => `${x.item}:${x.mag}`).sort().join(' ');
  check('swapped for a revolver, both pistols go into the backpack with their rounds', s.weapons[SLOT_PISTOL] === ITEM.REVOLVER && s.dual === 0 && s.mags[1] === 5 && cells === [`${ITEM.PISTOL}:10`, `${ITEM.PISTOL}:9`].sort().join(' '), cells);
  // back to the pair, then a backpack with only the revolver's cell free
  pack({ item: ITEM.PISTOL, mag: 10 }, { item: ITEM.PISTOL, mag: 9 });
  A.act(ACT.USE_ITEM, 0);
  run(2);
  A.act(ACT.USE_ITEM, 1);
  run(2);
  check('(two pistols from the pack put on one by one are a pair again)', s.weapons[SLOT_PISTOL] === ITEM.PISTOL && s.dual === DUAL_BIT[SLOT_PISTOL] && s.mags[1] === 19 && a.inv.some((x) => x && x.item === ITEM.REVOLVER && x.mag === 5), `mag ${s.mags[1]}, cells ${at(0)} ${at(1)}`);
  pack(...Array.from({ length: INVENTORY_SIZE }, (_, i) => (i === 0 ? { item: ITEM.REVOLVER, mag: 5 } : { item: ITEM.CLOTH, count: ITEM_DEFS[ITEM.CLOTH].stack })));
  A.notes.length = 0;
  A.act(ACT.USE_ITEM, 0);
  run(2);
  check('...with no second cell for it, the pair stays and the survivor is told', s.weapons[SLOT_PISTOL] === ITEM.PISTOL && s.dual === DUAL_BIT[SLOT_PISTOL] && at(0) === `${ITEM.REVOLVER}:5` && A.notes.some(([m]) => m === NOTIFY.INVENTORY_FULL));
}

// dropped: one goes down, the other stays in the hand
{
  pack();
  clearGround();
  s.mags[1] = 19;
  const w = new Writer(8);
  w.u8(C2S.ACTION);
  w.u8(ACT.DROP_WEAPON);
  w.u8(SLOT_PISTOL);
  game.onMessage(A.session, w.bytes().slice());
  run(2);
  const g = pistols();
  check('dropped, one pistol goes down with its half of the rounds and the other stays in the hand', g.length === 1 && g[0].mag === 9 && s.weapons[SLOT_PISTOL] === ITEM.PISTOL && s.dual === 0 && s.mags[1] === 10, `${g.length} down (${g.map((e) => e.mag)}), hand ${s.mags[1]}`);
  clearGround();
}

// torn down: one is salvaged, the other stays in the hand
{
  pack({ item: ITEM.PISTOL, mag: 9 });
  A.act(ACT.USE_ITEM, 0);
  run(2);
  const parts = (it) => a.inv.reduce((n, x) => n + (x && x.item === it ? x.count : 0), 0);
  const gp = parts(ITEM.GUNPARTS);
  const w = new Writer(8);
  w.u8(C2S.ACTION);
  w.u8(ACT.SALVAGE);
  w.u8(SALVAGE_FROM.WEAPON + SLOT_PISTOL);
  w.u16(1);
  game.onMessage(A.session, w.bytes().slice());
  run(2);
  check('salvaged, one pistol is torn down and the other stays in the hand', s.weapons[SLOT_PISTOL] === ITEM.PISTOL && s.dual === 0 && s.mags[1] === 10 && parts(ITEM.GUNPARTS) === gp + 1, `hand ${s.mags[1]}, gun parts ${gp} -> ${parts(ITEM.GUNPARTS)}`);
}

// a death: both guns on the ground, the rounds shared out between them
{
  pack({ item: ITEM.PISTOL, mag: 12 });
  A.act(ACT.USE_ITEM, 0);
  run(2);
  pack();
  clearGround();
  s.mags[1] = 21;
  game.dropAll(a);
  const g = pistols().map((e) => e.mag).sort((x, y) => x - y);
  check('dropped at a death, a pair is two pistols with every round between them', g.join(',') === '10,11' && s.dual === 0, `${g.length} down (${g})`);
  clearGround();
}

// a pair of shotguns in the primary slot; a rifle never pairs
{
  pack({ item: ITEM.SHOTGUN, mag: 2 });
  s.weapons[SLOT_PRIMARY] = ITEM.SHOTGUN;
  s.mags[0] = 6;
  A.act(ACT.USE_ITEM, 0);
  run(2);
  check('two shotguns are a pair in the primary slot', s.dual === DUAL_BIT[SLOT_PRIMARY] && s.mags[0] === 8 && a.inv[0] === null);
  s.dual = 0;
  s.weapons[SLOT_PRIMARY] = ITEM.AK47;
  s.mags[0] = 30;
  pack({ item: ITEM.AK47, mag: 10 });
  A.act(ACT.USE_ITEM, 0);
  run(2);
  check('two rifles are not: the one put on trades places with the one in hand', s.dual === 0 && s.mags[0] === 10 && at(0) === `${ITEM.AK47}:30`);
}

// the bridge's checkpoint (a wipe on the mainland puts back what each survivor crossed with): a pair comes back a pair
{
  s.weapons[SLOT_PISTOL] = ITEM.PISTOL;
  s.dual = DUAL_BIT[SLOT_PISTOL];
  s.mags[1] = 20;
  const k = game.kitOf(a);
  game.spawnHuman(a, k.kit || { mag: 0, ammo: 0, items: [], tools: [] });
  game.wear(a, k);
  check('a pair crossed with comes back a pair after a wipe on the mainland', s.dual === DUAL_BIT[SLOT_PISTOL] && s.mags[1] === 20 && s.weapons[SLOT_PISTOL] === ITEM.PISTOL, `dual ${s.dual}, mag ${s.mags[1]}`);
}

console.log(fails.length ? `\n${fails.length} FAILED:\n  ${fails.join('\n  ')}` : '\nall akimbo checks passed');
process.exit(fails.length ? 1 : 0);
