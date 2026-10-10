// The leaper hunts whoever has strayed (server/zombies.js: LONE_NEAR, LONE_WEIGHT, chooseTarget, alone), #299. The
// target choice is run on its own with survivors put where each case needs them:
//   - two survivors together and one alone: leapers all round them go for the lone one most of the time, and far more
//     often than walkers in the same spots do (they take whoever is nearest)
//   - the lone one is taken when up to LONE_WEIGHT times further off than the pair, and not beyond that
//   - a team that keeps together is hunted by distance alone, as a lone survivor in a game of one is
//   - a downed teammate covers nobody; one out of notice range is not hunted however alone they are
// usage: node scripts/test-leaper-lone.js
import { Zombies, LONE_NEAR, LONE_WEIGHT } from '../server/zombies.js';
import { ZTYPE, ZOMBIE_DEFS } from '../shared/defs.js';
import { PHASE } from '../shared/constants.js';

const fails = [];
const check = (name, ok, info = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${info}`);
  if (!ok) fails.push(name);
};

const g = { phase: PHASE.NIGHT, mineNav: null, safe: () => false, vehicles: { notice: () => 1 } };
const zs = { g, alone: Zombies.prototype.alone };
const human = (id, x, z, more = {}) => ({ id, downed: false, under: false, flashlight: false, state: { x, z, crouch: false, sprinting: false }, ...more });
const pick = (ztype, x, z, humans) => {
  const zb = { ztype, def: ZOMBIE_DEFS[ztype], x, z, horde: false, target: 0, aggroId: 0, aggroT: 0, under: false };
  Zombies.prototype.chooseTarget.call(zs, zb, humans);
  return zb.target;
};

// two together at the origin, one alone 20 m off; zombies on a grid round them, every survivor within notice range
{
  const humans = [human(1, 0, 0), human(2, 2, 0), human(3, 20, 0)];
  let n = 0;
  let leaperLone = 0;
  let walkerLone = 0;
  for (let x = -30; x <= 50; x += 2)
    for (let z = -30; z <= 30; z += 2) {
      if (Math.hypot(x, z) > 30 || Math.hypot(x - 20, z) > 30) continue;
      n++;
      if (pick(ZTYPE.LEAPER, x, z, humans) === 3) leaperLone++;
      if (pick(ZTYPE.WALKER, x, z, humans) === 3) walkerLone++;
    }
  const lf = leaperLone / n;
  const wf = walkerLone / n;
  check('leapers go for the lone survivor most of the time', lf > 0.75, `(${(lf * 100).toFixed(0)}% of ${n} spots)`);
  check('...far more often than walkers, who take the nearest', lf > wf + 0.3, `(walkers ${(wf * 100).toFixed(0)}%)`);
}

// the leaper 10 m from the pair; the lone one further off along the other side
{
  const at = (d) => pick(ZTYPE.LEAPER, 0, 0, [human(1, -10, 0), human(2, -10, 2), human(3, d, 0)]);
  check('lone survivor as far off as the pair is taken', at(10) === 3);
  check(`...and at ${LONE_WEIGHT - 0.2}x as far`, at(10 * (LONE_WEIGHT - 0.2)) === 3);
  check(`...but not at ${LONE_WEIGHT + 0.2}x as far`, at(10 * (LONE_WEIGHT + 0.2)) === 1);
  check('a walker in the same spot takes the nearer pair', pick(ZTYPE.WALKER, 0, 0, [human(1, -10, 0), human(2, -10, 2), human(3, 12, 0)]) === 1);
}

// a team that keeps together: everyone within LONE_NEAR of someone, so it is the nearest
{
  const humans = [human(1, 0, 0), human(2, LONE_NEAR - 1, 0), human(3, 2 * (LONE_NEAR - 1), 0)];
  check('a team that keeps together is hunted by distance', pick(ZTYPE.LEAPER, -5, 0, humans) === 1 && pick(ZTYPE.LEAPER, 40, 0, humans) === 3);
  check('a game of one: the only survivor is taken', pick(ZTYPE.LEAPER, 5, 0, [human(1, 0, 0)]) === 1);
}

// a downed teammate covers nobody: the one beside them is alone
{
  const humans = [human(1, -10, 0), human(2, -10, 2), human(3, 15, 0, { downed: true }), human(4, 16, 0)];
  check('a downed teammate covers nobody', pick(ZTYPE.LEAPER, 0, 0, humans) === 4);
  humans[2].downed = false;
  check('...one standing does', pick(ZTYPE.LEAPER, 0, 0, humans) === 1);
}

// out of notice range (55 m at night): not hunted, however alone
{
  const humans = [human(1, -40, 0), human(2, -40, 2), human(3, 60, 0)];
  check('a lone survivor out of notice range is not hunted', pick(ZTYPE.LEAPER, 0, 0, humans) === 1);
}

if (fails.length) {
  console.log(`\n${fails.length} FAILED: ${fails.join(', ')}`);
  process.exit(1);
}
console.log('\nall leaper lone-target checks passed');
