// A player's first playthrough (#270): what they are walked through, and what this browser remembers of it. The first
// things a new player sees build their idea of the game, so the opening is the car and the goal, then the first zombie
// (marked, with what to do about it), then the rest a night needs, one step at a time (game/onboarding.js plays them
// out, ui/coach.js draws them). Once they have been through it - every step done, or a first night survived, or a run
// played to its end - it is not shown again, on any difficulty. The first-time tips (perks, achievements, the
// bestiary) are kept apart and come once each, whenever their moment does. Nothing in here is sent to the server.
//
// To go through it again: open the game with ?newplayer in the address. Your record of runs is kept; the
// walkthrough, the first-time tips, the key hints and the remembered difficulty start over.
import { DIFFICULTIES } from '../../shared/difficulty.js';
import { lsGet, lsSet } from './dom.js';

const KEY = 'stn.onboarding'; // { v: 1, done, steps: { id: 1 }, tips: { id: 1 } }
const DIFF_KEY = 'stn.difficulty'; // the difficulty this browser last made a game on
const HINTS_KEY = 'stn.keyhints'; // keyhints.js: how often each key hint's thing was done
export const NEW_DIFFICULTY = 'ember'; // what a player who has not been through the walkthrough is offered first

// ---------------------------------------------------------------- what this browser remembers
const fresh = () => ({ v: 1, done: false, steps: {}, tips: {} });
let mem = null; // (storage that will not take it: it lasts as long as the page)

export function loadOnboarding() {
  if (mem) return mem;
  try {
    const o = JSON.parse(lsGet(KEY, 'null'));
    if (o && typeof o === 'object' && o.v === 1) {
      const clean = (m) => Object.fromEntries(Object.keys(m && typeof m === 'object' ? m : {}).map((k) => [k, 1]));
      return (mem = { v: 1, done: o.done === true, steps: clean(o.steps), tips: clean(o.tips) });
    }
  } catch {
    /* not JSON: start over */
  }
  // nothing stored: a player with a run on record here (from before the guide) has been through it already
  return (mem = { ...fresh(), done: playedBefore() });
}

function playedBefore() {
  try {
    return (JSON.parse(lsGet('stn.runs', 'null'))?.total?.runs | 0) > 0;
  } catch {
    return false;
  }
}

// read it from storage again (another tab, or a test, changed it)
export function reloadOnboarding() {
  mem = null;
  return loadOnboarding();
}

function save(o) {
  mem = o;
  lsSet(KEY, JSON.stringify(o));
}

export const onboardingDone = () => loadOnboarding().done;
export const stepDone = (id) => !!loadOnboarding().steps[id];
export const tipSeen = (id) => !!loadOnboarding().tips[id];

export function markStep(id) {
  const o = loadOnboarding();
  if (o.steps[id]) return;
  o.steps[id] = 1;
  if (CORE.every((s) => o.steps[s.id])) o.done = true;
  save(o);
}
export function markTip(id) {
  const o = loadOnboarding();
  if (!o.tips[id]) save({ ...o, tips: { ...o.tips, [id]: 1 } });
}
// been through it: a first night survived, or a run played to its end
export function finishOnboarding() {
  const o = loadOnboarding();
  if (!o.done) save({ ...o, done: true });
}

// ?newplayer in the address (main.js, as the page loads): what a first playthrough shows starts over. The record of
// runs is not touched.
export function applyNewPlayer(search = globalThis.location?.search ?? '') {
  if (!new URLSearchParams(search).has('newplayer')) return false;
  mem = null;
  try {
    localStorage.setItem(KEY, JSON.stringify(fresh())); // (stored, so a record of runs does not count as been through it)
    localStorage.removeItem(HINTS_KEY);
    localStorage.removeItem(DIFF_KEY);
  } catch {
    /* storage unavailable: nothing was remembered */
  }
  return true;
}

// The yaw (Game.yaw: 0 looks down -z) that faces from (x, z) towards (tx, tz): a new player starts facing the car.
export const yawTowards = (x, z, tx, tz) => Math.atan2(-(tx - x), -(tz - z));

// a player who has not been through the walkthrough yet
export const isFirstRun = () => !onboardingDone();

// The difficulty the new-game card starts on: the one last picked here, else Ember for a new player and Nightfall
// (the game as it has always been) for anyone else.
export function suggestedDifficulty(last = lsGet(DIFF_KEY, '')) {
  if (DIFFICULTIES.some((d) => d.id === last)) return last;
  return isFirstRun() ? NEW_DIFFICULTY : 'nightfall';
}

export function rememberDifficulty(id) {
  if (DIFFICULTIES.some((d) => d.id === id)) lsSet(DIFF_KEY, id);
}

// ---------------------------------------------------------------- the walkthrough
// Each step: when it comes up (when(c)), when it has been done (done(c, s): s is the step's own memory, e.g. where the
// player stood as it came up), and how long it stays at least (min) and at most (max) in seconds. text: [action] names
// a key (game/binds.js), {need} the parts the car needs. urgent: it takes over from a calmer step on screen (which
// comes back later). nice: a word as it is done. c, the moment (game/onboarding.js makes it):
//   t        seconds into this run          x, z     where the player is
//   day      by day (not the final stand)   dusk     the dusk horn has gone   night   the night or the final stand
//   zombie   { id, d } the nearest of the dead within ZOMBIE_NEAR m, or null
//   gone     ids of the dead that died or went out of sight since the last look (a Set)
//   harvest  { kind: 'tree' | 'rock', d } the nearest tree or boulder within HARVEST_NEAR m that still gives, or null
//   gathered something chopped or mined since the last look   searchable  a container's search prompt is up
//   searching holding [E] on one                picked   a material picked up since the last look
//   inv      the inventory is open              carrying a car part in the pack   installed  car parts in the car
//   danger   0..1, the dead close by (Game.danger)
export const ZOMBIE_NEAR = 40;
export const HARVEST_NEAR = 16;
export const MOVE_FAR = 20;
const calm = (c) => c.day && !(c.danger > 0.2);

export const CORE = [
  {
    id: 'zombie',
    urgent: true,
    title: 'A zombie is coming for you',
    text: 'Attack it: [fire]. Aim for the head, it drops faster. Too many? Sprint away: [sprint]',
    when: (c) => !!c.zombie,
    start: (c, s) => (s.target = c.zombie.id),
    done: (c, s) => c.gone.has(s.target),
    max: 45,
    nice: 'Nice kill. Headshots save ammo.',
  },
  {
    id: 'part',
    urgent: true,
    title: 'You found a car part!',
    text: 'Take it to the car and press [interact] there to install it. The car is marked on the compass.',
    when: (c) => c.carrying,
    start: (c, s) => (s.had = c.installed),
    done: (c, s) => c.installed > s.had,
    max: 90,
    nice: 'Installed. Keep going: every part gets you closer to driving out.',
  },
  {
    id: 'goal',
    title: 'Fix the car to escape',
    text: 'Your car died on Route 9. It needs {need} parts, hidden around the valley. The compass and the notes top left show where each is rumoured to be.',
    when: (c) => c.day,
    min: 8,
    max: 11,
  },
  {
    id: 'move',
    title: 'Get moving',
    text: 'Move: [forward][left][back][right]  ·  Sprint: [sprint]  ·  Jump: [jump]',
    when: (c) => c.day,
    start: (c, s) => ((s.x = c.x), (s.z = c.z)),
    done: (c, s) => Math.hypot(c.x - s.x, c.z - s.z) >= MOVE_FAR,
    min: 4,
    max: 14,
  },
  {
    id: 'harvest',
    title: 'Trees and rocks are materials',
    text: 'Trees give sticks and planks, rocks give stone. Take out your melee weapon [slot3] and hit them: [fire]. You build walls and craft with them.',
    when: (c) => calm(c) && !!c.harvest,
    done: (c) => c.gathered,
    min: 4,
    max: 30,
    nice: 'Materials go straight into your backpack.',
  },
  {
    id: 'search',
    title: 'Search everything',
    text: 'Hold [interact] to search lockers, crates, cabinets and car trunks. They hide ammo, medicine, materials and car parts.',
    when: (c) => calm(c) && c.searchable,
    done: (c) => c.searching,
    min: 3,
    max: 25,
  },
  {
    id: 'inventory',
    title: 'Craft what you need',
    text: 'Open your backpack [inventory] to craft bandages, weapons and the planks you build with.',
    when: (c) => calm(c) && c.picked,
    done: (c) => c.inv,
    min: 3,
    max: 20,
  },
  {
    id: 'dusk',
    title: 'Night is coming',
    text: 'Get back to your team before dark. Board up: take out the hammer [slot5] and build walls from planks. The horde comes from every side.',
    when: (c) => c.dusk,
    min: 10,
    max: 12,
  },
  {
    id: 'night',
    title: 'Survive until dawn',
    text: 'The horde comes in waves. Stick together, keep your flashlight on [flashlight], and pick up a downed friend: hold [interact].',
    when: (c) => c.night,
    min: 10,
    max: 12,
  },
];

// The first-time tips: once each, whenever their moment comes, walkthrough or not
export const TIPS = {
  perks: { title: 'Level up! You have a perk point', text: 'Open Perks [perks] to spend it: more health, faster reloads, quieter steps...' },
  achievements: { title: 'Achievement unlocked', text: 'See them all, and track the next ones on your HUD: [achievements]' },
  bestiary: { title: 'New kind of zombie: {name}', text: 'Read up on how it moves, what it does and how to kill it in the Bestiary [bestiary]' },
};

// The step to show now, from what is on (active: the step on screen, or null) and the moment c. One that is done or
// has been seen to (seen: ids, this browser's record) never comes up again; an urgent one takes over from a calm one.
export function pickStep(c, active, seen) {
  for (const s of CORE) {
    if (seen[s.id] || s === active) continue;
    if (active && !(s.urgent && !active.urgent)) break;
    if (s.when(c)) return s;
  }
  return active;
}
