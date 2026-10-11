// The first-run experience (#270): what a brand-new player is offered (client/ui/firstrun.js), the order the key
// hints come in (client/ui/keyhints.js: the threat before the map, the inventory and building), and the walker that
// turns up in a run's first minute (server/zombies.js spawnOpener).
import { isFirstRun, suggestedDifficulty, rememberDifficulty, earlyRuns, simpleHud, yawTowards, goalLine, SIMPLE_HUD_RUNS } from '../client/ui/firstrun.js';
import { HINTS, KeyHints } from '../client/ui/keyhints.js';
import { sanitizeRecord } from '../client/ui/records.js';
import { Game } from '../server/game.js';
import { OPENER_AT, OPENER_UNTIL, OPENER_DIST } from '../server/zombies.js';
import { PHASE } from '../shared/constants.js';
import { ZTYPE } from '../shared/defs.js';
import { C2S, S2C, PROTOCOL_VERSION, Writer, Reader } from '../shared/protocol.js';

let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  ${detail}`}`);
};
const near = (a, b, e = 1e-9) => Math.abs(a - b) < e;

// ---- a stand-in for the browser's storage
let store = {};
Object.defineProperty(globalThis, 'localStorage', {
  value: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => void (store[k] = String(v)), removeItem: (k) => void delete store[k] },
  configurable: true,
  writable: true,
});
const withRuns = (n) => sanitizeRecord({ v: 1, runs: [], total: { runs: n, escapes: 0, streak: 0 }, best: {} });

// ---- who is new, and what they are offered
check('no run in the record is a first run', isFirstRun(withRuns(0)) && isFirstRun(sanitizeRecord(null)) && isFirstRun(undefined));
check('one run in the record is not', !isFirstRun(withRuns(1)));
check('a brand-new player is offered Ember', suggestedDifficulty(withRuns(0)) === 'ember');
check('a returning player with no choice remembered gets Nightfall', suggestedDifficulty(withRuns(4)) === 'nightfall');
rememberDifficulty('blackout');
check('the last difficulty picked here wins for a returning player', suggestedDifficulty(withRuns(4)) === 'blackout');
check('...and for a new one who already picked', suggestedDifficulty(withRuns(0)) === 'blackout');
rememberDifficulty('god');
check('a name the game does not have is not remembered', suggestedDifficulty(withRuns(4)) === 'blackout');
store = {};
store['stn.difficulty'] = 'nonsense';
check('a stored name the game does not have is ignored', suggestedDifficulty(withRuns(0)) === 'ember' && suggestedDifficulty(withRuns(2)) === 'nightfall');

// ---- the simple HUD
check(`the first ${SIMPLE_HUD_RUNS} runs get the simple HUD`, earlyRuns(withRuns(0)) && earlyRuns(withRuns(SIMPLE_HUD_RUNS - 1)) && !earlyRuns(withRuns(SIMPLE_HUD_RUNS)));
check('a returning player never gets it', !simpleHud(earlyRuns(withRuns(10)), {}) && !simpleHud(earlyRuns(withRuns(10)), { fullHud: false }));
check('Show the whole HUD turns it off for a new player', simpleHud(true, { fullHud: false }) && !simpleHud(true, { fullHud: true }));

// ---- the opening look and the goal
check('facing north is yaw 0 (forward is -z)', near(yawTowards(0, 0, 0, -10), 0));
check('facing east is -90 degrees', near(yawTowards(0, 0, 10, 0), -Math.PI / 2));
{
  const y = yawTowards(3, 4, -20, 31);
  const fx = -Math.sin(y);
  const fz = -Math.cos(y);
  const dx = -23;
  const dz = 27;
  const len = Math.hypot(dx, dz);
  check('the look it gives points at the target', near(fx, dx / len, 1e-9) && near(fz, dz / len, 1e-9));
}
check('the goal line counts the parts', goalLine(7) === 'Fix the car: 7 parts' && goalLine(1) === 'Fix the car: 1 part');

// ---- the key hints' order: the threat comes before the map, the inventory and building
const at = (id) => HINTS.findIndex((h) => h.id === id);
check('every hint is there once', ['flashlight', 'heal', 'drink', 'attack', 'sprint', 'build', 'map', 'inventory'].every((id) => at(id) >= 0 && HINTS.filter((h) => h.id === id).length === 1));
check('attack, then sprint away', at('attack') < at('sprint'));
check('the threat before building, the map and the inventory', Math.max(at('attack'), at('sprint')) < Math.min(at('build'), at('map'), at('inventory')));
check('attack names the fire key and sprint the sprint key', HINTS[at('attack')].action === 'fire' && HINTS[at('sprint')].action === 'sprint');

// applies() against a stand-in for the game
const fake = (danger, state = {}) => ({
  game: { danger, prediction: { state: { cooldown: 0, sprinting: 0, exhausted: 0, stamina: 100, ...state } } },
  counts: {},
  done: {},
});
const applies = (o, id) => KeyHints.prototype.applies.call(o, HINTS[at(id)], true);
check('no attack hint with nothing near', !applies(fake(0), 'attack'));
check('an attack hint with one of the dead closing in', applies(fake(0.3), 'attack'));
{
  const o = fake(0.3);
  o.done.attack = true;
  check('...and none once they have attacked', !applies(o, 'attack'));
}
check('no sprint hint before the attack hint has had its turn', !applies(fake(0.8), 'sprint'));
{
  const o = fake(0.8);
  o.done.attack = true;
  check('a sprint hint up close after attacking', applies(o, 'sprint'));
  check('...not further off', !applies({ ...o, game: fake(0.3).game }, 'sprint'));
  check('...not already sprinting', !applies({ ...o, game: fake(0.8, { sprinting: 1 }).game }, 'sprint'));
  check('...not out of breath', !applies({ ...o, game: fake(0.8, { stamina: 5 }).game }, 'sprint'));
}
{
  const o = fake(0.8);
  o.counts.attack = 2;
  check('a player who retired the attack hint gets the sprint one straight away', applies(o, 'sprint'));
}

// ---- the opening walker
function join(game, name) {
  const c = { id: 0 };
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
  w.str('');
  game.onMessage(c.session, w.bytes());
  c.p = game.players.get(c.id);
  return c;
}
const nearest = (g, s) => {
  let best = null;
  for (const z of g.zombies) {
    if (z.dead) continue;
    const d = Math.hypot(z.x - s.x, z.z - s.z);
    if (!best || d < best.d) best = { z, d };
  }
  return best;
};

for (const seed of [7, 11, 23]) {
  const g = new Game({ seed, log: () => {} });
  const { p } = join(g, 'Ann');
  const s = p.state;
  check(`seed ${seed}: the run is on day 1`, g.phase === PHASE.DAY && g.day === 1, `${g.phase} ${g.day}`);
  const before = nearest(g, s);
  check(`seed ${seed}: the start is clear as it always was`, !before || before.d > 45, before && before.d.toFixed(1));
  const count = g.zombies.length;
  g.timeLeft = g.dayLen - (OPENER_AT - 1);
  g.zm.update(0.05);
  check(`seed ${seed}: nothing before the opener's time`, g.zombies.length === count && !g.zm.opener);
  g.timeLeft = g.dayLen - OPENER_AT - 0.5;
  g.zm.update(0.05);
  const w = g.zombies.find((z) => !z.dead && Math.hypot(z.x - s.x, z.z - s.z) < OPENER_DIST + 8);
  check(`seed ${seed}: one walker turns up ahead, coming their way`, !!w && w.ztype === ZTYPE.WALKER && w.alertT > 0 && Math.hypot(w.alertX - s.x, w.alertZ - s.z) < 1, w ? `${w.ztype} ${Math.hypot(w.x - s.x, w.z - s.z).toFixed(1)}` : 'none');
  if (w) {
    const fx = -Math.sin(s.yaw);
    const fz = -Math.cos(s.yaw);
    const dx = (w.x - s.x) / Math.hypot(w.x - s.x, w.z - s.z);
    const dz = (w.z - s.z) / Math.hypot(w.x - s.x, w.z - s.z);
    check(`seed ${seed}: in front of them, not behind`, fx * dx + fz * dz > 0.5, (fx * dx + fz * dz).toFixed(2));
  }
  g.timeLeft -= 5;
  g.zm.update(0.05);
  check(`seed ${seed}: only one`, g.zm.opener && g.zombies.filter((z) => !z.dead && Math.hypot(z.x - s.x, z.z - s.z) < OPENER_DIST + 8).length === 1);
  check(`seed ${seed}: the handoff carries that it happened`, g.zm.save().opener === true);
}
{
  const g = new Game({ seed: 7, log: () => {} });
  join(g, 'Ann');
  g.timeLeft = g.dayLen - OPENER_UNTIL - 1;
  const count = g.zombies.length;
  g.zm.update(0.05);
  check('a team that comes in after the first minute gets no opener', g.zm.opener && g.zombies.length === count);
  g.zm.load({ ...g.zm.save(), opener: undefined });
  check('a save from before the opener counts it as seen to', g.zm.opener === true);
}

if (failed) {
  console.log(`${failed} failed`);
  process.exit(1);
}
console.log('first run ok');
