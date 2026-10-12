// The first playthrough (#270): the walkthrough's steps and what this browser remembers of it (client/ui/firstrun.js),
// the order the key hints come in (client/ui/keyhints.js: the threat before the map, the inventory and building), and
// the walker that turns up in a run's first minute (server/zombies.js spawnOpener).
import { isFirstRun, suggestedDifficulty, rememberDifficulty, applyNewPlayer, yawTowards, loadOnboarding, markStep, markTip, tipSeen, finishOnboarding, onboardingDone, reloadOnboarding, pickStep, CORE, TIPS, ZOMBIE_NEAR } from '../client/ui/firstrun.js';
import { HINTS, KeyHints } from '../client/ui/keyhints.js';
import { ACTIONS } from '../shared/binds.js';
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
const startOver = () => applyNewPlayer('?newplayer');

// ---- who is new, and what they are offered
startOver();
check('nobody has been through it yet: a first run', isFirstRun() && !onboardingDone());
check('a new player is offered Ember', suggestedDifficulty() === 'ember');
rememberDifficulty('blackout');
check('the last difficulty picked here wins', suggestedDifficulty() === 'blackout');
rememberDifficulty('god');
check('a name the game does not have is not remembered', suggestedDifficulty() === 'blackout');
store['stn.difficulty'] = 'nonsense';
check('a stored name the game does not have is ignored', suggestedDifficulty() === 'ember');

// ---- what is remembered, and when it is over
startOver();
for (const s of CORE.slice(0, -1)) markStep(s.id);
check('all but one step done: still going', !onboardingDone() && isFirstRun());
markStep(CORE[CORE.length - 1].id);
check('every step done: over, on any difficulty', onboardingDone() && !isFirstRun() && suggestedDifficulty() === 'nightfall');
check('...and it is kept in storage', JSON.parse(store['stn.onboarding']).done === true);
startOver();
markStep('goal');
finishOnboarding();
check('a first night survived or a run played out ends it too', onboardingDone() && loadOnboarding().steps.goal === 1);
store['stn.onboarding'] = '{"v":1,"done":"yes","steps":{"goal":true},"tips":"x"}';
check('a hand-edited record comes back well formed', (() => {
  const o = reloadOnboarding();
  return o.done === false && o.steps.goal === 1 && Object.keys(o.tips).length === 0 && isFirstRun();
})());
store['stn.onboarding'] = 'not json';
check('...and one that is not JSON starts over', !reloadOnboarding().done && Object.keys(loadOnboarding().steps).length === 0);
store = { 'stn.runs': '{"v":1,"runs":[],"total":{"runs":3,"escapes":0,"streak":0},"best":{}}' };
check('a player with runs on record from before the guide has been through it', reloadOnboarding().done === true);
startOver();
check('...unless they ask for it again with ?newplayer', !onboardingDone() && !reloadOnboarding().done && isFirstRun());
store = {};
check('nothing stored and no runs: a new player', !reloadOnboarding().done);
startOver();
check('the first-time tips are kept apart from the walkthrough', !tipSeen('perks') && (markTip('perks'), tipSeen('perks')) && !onboardingDone());
finishOnboarding();
check('...and outlive it', tipSeen('perks') && !tipSeen('bestiary'));

// ---- ?newplayer: what a first playthrough shows starts over, the record of runs kept
store = { 'stn.onboarding': '{"v":1,"done":true,"steps":{},"tips":{}}', 'stn.keyhints': '{"map":2}', 'stn.difficulty': 'blackout', 'stn.runs': 'kept' };
check('an address without it changes nothing', !applyNewPlayer('?game=ABCD') && store['stn.difficulty'] === 'blackout');
check('?newplayer is seen', applyNewPlayer('?game=ABCD&newplayer=1'));
check('...and the walkthrough, the key hints and the remembered difficulty start over', isFirstRun() && JSON.parse(store['stn.onboarding']).done === false && !('stn.keyhints' in store) && !('stn.difficulty' in store));
check('...and the record of runs is left alone', store['stn.runs'] === 'kept');

// ---- the steps
const actions = new Set(ACTIONS.map((a) => a.id));
const keys = (t) => [...t.matchAll(/\[(\w+)\]/g)].map((m) => m[1]);
const named = [...CORE.map((s) => s.text), ...Object.values(TIPS).map((t) => t.text)].flatMap(keys);
check('every key a step names is a real action', named.length > 10 && named.every((k) => actions.has(k)), named.filter((k) => !actions.has(k)).join(' '));
check('the zombie, then a car part, take over: they come first', CORE[0].id === 'zombie' && CORE[0].urgent && CORE[1].id === 'part' && CORE[1].urgent);
check('trees and rocks have a step of their own', CORE.some((s) => s.id === 'harvest' && /tree/i.test(s.text) && /rock/i.test(s.text) && s.text.includes('[fire]')));
check('the first-time tips name the perks, achievements and bestiary keys', TIPS.perks.text.includes('[perks]') && TIPS.achievements.text.includes('[achievements]') && TIPS.bestiary.text.includes('[bestiary]'));

const moment = (o = {}) => ({ t: 0, x: 0, z: 0, dayN: 1, day: true, dusk: false, night: false, zombie: null, gone: new Set(), harvest: null, gathered: false, searchable: false, searching: false, picked: false, inv: false, carrying: false, installed: 0, danger: 0, ...o });
const id = (s) => s?.id ?? null;
check('a run opens on the goal', id(pickStep(moment(), null, {})) === 'goal');
check('...then moving', id(pickStep(moment(), null, { goal: 1 })) === 'move');
const goal = CORE.find((s) => s.id === 'goal');
check('a zombie close by takes over from the goal', id(pickStep(moment({ zombie: { id: 9, d: 30 } }), goal, {})) === 'zombie');
check(`...but not one further off than ${ZOMBIE_NEAR} m (the moment leaves it out)`, id(pickStep(moment(), goal, {})) === 'goal');
check('a calm step waits while another is up', id(pickStep(moment({ harvest: { kind: 'tree', d: 5 } }), goal, {})) === 'goal');
const zombie = CORE[0];
check('the zombie step stays up until its zombie is gone', !zombie.done(moment({ gone: new Set([4]) }), { target: 9 }) && zombie.done(moment({ gone: new Set([9]) }), { target: 9 }));
check('a tree or rock in reach brings up the harvest step', id(pickStep(moment({ harvest: { kind: 'rock', d: 8 } }), null, { goal: 1, move: 1 })) === 'harvest');
check('...not with the dead close', id(pickStep(moment({ harvest: { kind: 'rock', d: 8 }, danger: 0.5 }), null, { goal: 1, move: 1 })) === null);
check('...and it is done by chopping or mining', CORE.find((s) => s.id === 'harvest').done(moment({ gathered: true })));
check('a car part in the pack takes over, and is done when one more is in the car', id(pickStep(moment({ carrying: true }), goal, {})) === 'part' && CORE[1].done(moment({ installed: 3 }), { had: 2 }));
check('the dusk horn and the night have theirs', id(pickStep(moment({ dusk: true }), null, Object.fromEntries(CORE.slice(0, 7).map((s) => [s.id, 1])))) === 'dusk' && id(pickStep(moment({ day: false, night: true }), null, {})) === 'night');
check('a step seen to never comes back', id(pickStep(moment(), null, Object.fromEntries(CORE.map((s) => [s.id, 1])))) === null);
startOver();

// ---- the opening look
check('facing north is yaw 0 (forward is -z)', near(yawTowards(0, 0, 0, -10), 0));
check('facing east is -90 degrees', near(yawTowards(0, 0, 10, 0), -Math.PI / 2));
{
  const y = yawTowards(3, 4, -20, 31);
  const dx = -23;
  const dz = 27;
  const len = Math.hypot(dx, dz);
  check('the look it gives points at the target', near(-Math.sin(y), dx / len) && near(-Math.cos(y), dz / len));
}

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
