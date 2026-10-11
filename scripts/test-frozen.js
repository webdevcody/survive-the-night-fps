// The frozen core feel (issue #277, the block at the top of shared/constants.js): walk, sprint and crouch speed, the
// turned survivor's speed, stamina, and each zombie kind's speed. A change to any of them fails here on purpose: it
// is a design decision, so it is made here too, by hand, never as a side effect. To make a run easier or harder,
// retune shared/difficulty.js's multipliers instead.
import * as C from '../shared/constants.js';
import { ZOMBIE_DEFS, ZTYPE } from '../shared/defs.js';

let failed = 0;
function check(name, ok, detail = '') {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${ok ? '' : detail}`);
}

const PLAYER = {
  WALK_SPEED: 4.6,
  SPRINT_SPEED: 7.5,
  CROUCH_SPEED: 2.1,
  ZOMBIE_PLAYER_SPEED: 6.4,
  STAMINA_MAX: 100,
  STAMINA_DRAIN: 14,
  STAMINA_REGEN: 19,
  STAMINA_REGEN_DELAY: 0.9,
  STAMINA_JUMP_COST: 9,
  STAMINA_UNLOCK: 30,
};
const ZOMBIES = {
  WALKER: 1.9,
  RUNNER: 5.6,
  TANK: 2.5,
  SPITTER: 2.3,
  LEAPER: 4.2,
  ROPER: 2.1,
  BOOMER: 1.7,
  BAT: 7.5,
  BOSS_ABOMINATION: 3,
  BOSS_HIVEQUEEN: 2.4,
  DOG: 6.2,
  SHADE: 6.6,
  BOSS_BRUTE: 1.7,
  BOSS_ALPHA: 6.4,
  BOSS_BLOATER: 1.45,
};

for (const [k, v] of Object.entries(PLAYER)) check(`${k} is still ${v}`, C[k] === v, `(now ${C[k]})`);
for (const [k, v] of Object.entries(ZOMBIES)) {
  const now = ZTYPE[k] !== undefined ? ZOMBIE_DEFS[ZTYPE[k]]?.speed : undefined;
  check(`the ${k.toLowerCase()}'s speed is still ${v}`, now === v, `(now ${now})`);
}

console.log(failed ? `\n${failed} check(s) failed: the core feel is frozen (shared/constants.js)` : '\nthe core feel is still frozen');
process.exit(failed ? 1 : 0);
