// Stone (ITEM.STONE): broken off boulders with a melee weapon, and the most of it at the quarry - its boulders on the
// island, its pit's faces on the mainland (COL.ROCK, COL.QUARRY) - and what it builds: the Stone Wall, mended with
// stone. Against the worlds the server builds and a real Game in-process.
// usage: node scripts/test-stone.js
import { createWorld } from '../shared/world.js';
import { createMainland } from '../shared/mainland.js';
import { Game } from '../server/game.js';
import { COL } from '../shared/collision.js';
import { ITEM, STRUCT, STRUCT_DEFS, STRUCT_ORDER, ZONE, REPAIR_COST, repairCostOf } from '../shared/defs.js';
import { surfaceOf, SURF } from '../shared/surfaces.js';

const fails = [];
const check = (name, ok, info = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${info}`);
  if (!ok) fails.push(name);
};
const all = (w) => w.staticGrid.query(0, 0, w.half * 1.5, []);
const count = (cols, flags) => cols.filter((c) => (c.flags & flags) === flags).length;

// ---------------------------------------------------------------- the worlds: what can be mined
{
  // (not every island has the quarry: the first few seeds that do)
  let seen = 0;
  for (let seed = 1; seed <= 40 && seen < 3; seed++) {
    const w = createWorld(seed);
    if (!w.zones.some((z) => z.id === ZONE.QUARRY)) continue;
    seen++;
    const cols = all(w);
    const rocks = count(cols, COL.ROCK);
    const quarry = count(cols, COL.ROCK | COL.QUARRY);
    check(`island ${seed}: its boulders can be mined, and the quarry's give more`, rocks > 100 && quarry > 3 && quarry < rocks, `${rocks} boulders, ${quarry} of them the quarry's`);
    check(`island ${seed}: nothing is both a tree or a wreck and a rock`, cols.every((c) => !(c.flags & COL.ROCK) || !(c.flags & (COL.TREE | COL.SALVAGE))));
  }
  check('some island has the quarry', seen > 0);
  const w = createMainland(1);
  const cols = all(w);
  const rocks = count(cols, COL.ROCK);
  const faces = count(cols, COL.ROCK | COL.QUARRY);
  check('the mainland: its boulders can be mined, and the quarry pit\'s faces are richer', rocks > 1000 && faces > 20, `${rocks} rocks, ${faces} of them the pit's faces`);
}

// ---------------------------------------------------------------- mining: what a blow gives, and when it runs out
{
  const game = new Game({ seed: 4242, log: () => {} });
  let got = {};
  const notes = [];
  game.giveOrDrop = (p, item, n) => (got[item] = (got[item] || 0) + n);
  game.notify = (m, a) => notes.push(a);
  const p = { id: 0, state: { x: 0, y: 0, z: 0 } };
  const mine = (flags, weapon, blows) => {
    got = {};
    const col = { flags: COL.STATIC | flags };
    for (let k = 0; k < blows; k++) game.gatherHit(p, col, 0, 0, 0, weapon);
    return got[ITEM.STONE] || 0;
  };
  check('a boulder gives 1 stone a blow for 4 blows, then nothing', mine(COL.ROCK, ITEM.KNIFE, 4) === 4 && mine(COL.ROCK, ITEM.KNIFE, 12) === 4 && Object.keys(got).length === 1);
  check("a quarry's gives 2 a blow for 8 blows", mine(COL.ROCK | COL.QUARRY, ITEM.KNIFE, 20) === 16);
  let blunt = 0;
  for (let n = 0; n < 2000; n++) blunt += mine(COL.ROCK, ITEM.HAMMER, 4);
  check('a hammer breaks off half again as much', Math.abs(blunt / 8000 - 1.5) < 0.05, `${(blunt / 8000).toFixed(2)} a blow`);
  notes.length = 0;
  for (let n = 0; n < 200; n++) mine(COL.ROCK, ITEM.KNIFE, 6);
  check('a mined-out rock says so (as a rock, not a tree or a wreck)', notes.length > 0 && notes.every((a) => a === 3));
}

// ---------------------------------------------------------------- the Stone Wall
{
  const def = STRUCT_DEFS[STRUCT.STONE_WALL];
  const wood = STRUCT_DEFS[STRUCT.WALL];
  const metal = STRUCT_DEFS[STRUCT.METAL_WALL];
  check('the Stone Wall is in the build menu, after the wood wall', STRUCT_ORDER.indexOf(STRUCT.STONE_WALL) === STRUCT_ORDER.indexOf(STRUCT.WALL) + 1);
  check('...tougher than wood, not as tough as metal, and needs no schematic', def.hp > wood.hp && def.hp < metal.hp && !def.schem && def.block);
  check('...built of stone', def.cost[ITEM.STONE] > 0);
  check('...mended with stone, the others with planks and nails as before', repairCostOf(STRUCT.STONE_WALL)[ITEM.STONE] > 0 && !repairCostOf(STRUCT.STONE_WALL)[ITEM.WOOD] && repairCostOf(STRUCT.WALL) === REPAIR_COST && repairCostOf(STRUCT.METAL_WALL) === REPAIR_COST);
  check('...and struck, it is stone', surfaceOf({ flags: COL.STRUCT, id: 1 }, false, '', () => STRUCT.STONE_WALL) === SURF.STONE);
}

console.log(fails.length ? `\n${fails.length} FAILED:\n  ${fails.join('\n  ')}` : '\nall stone checks passed');
process.exit(fails.length ? 1 : 0);
