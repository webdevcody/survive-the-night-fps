// What a brand-new player is shown differently (#270): the first things they see build their idea of the game, so
// their first run opens on the car and the goal, the new-game card suggests Ember, and their first runs keep the
// HUD to health, ammo, the goal and the compass. "New" is this browser's own record (records.js): a player who has
// finished no run here. Nothing in here is sent to the server.
import { DIFFICULTIES } from '../../shared/difficulty.js';
import { lsGet, lsSet } from './dom.js';

const DIFF_KEY = 'stn.difficulty'; // the difficulty this browser last made a game on
export const NEW_DIFFICULTY = 'ember'; // what a player with no run behind them is offered first
export const SIMPLE_HUD_RUNS = 3; // runs played with the simple HUD (Settings -> Show the whole HUD turns it off)

// rec: loadRecord()
export const isFirstRun = (rec) => !(rec?.total?.runs > 0);

// The difficulty the new-game card starts on: the one last picked here, else Ember for a player with no run behind
// them and Nightfall (the game as it has always been) for anyone else.
export function suggestedDifficulty(rec, last = lsGet(DIFF_KEY, '')) {
  if (DIFFICULTIES.some((d) => d.id === last)) return last;
  return isFirstRun(rec) ? NEW_DIFFICULTY : 'nightfall';
}

export function rememberDifficulty(id) {
  if (DIFFICULTIES.some((d) => d.id === id)) lsSet(DIFF_KEY, id);
}

// The simple HUD: on a player's first SIMPLE_HUD_RUNS runs (early: earlyRuns(rec), worked out as a run starts), unless
// they asked for everything
export const earlyRuns = (rec) => (rec?.total?.runs | 0) < SIMPLE_HUD_RUNS;
export const simpleHud = (early, settings) => !!early && settings?.fullHud !== true;

// The look that faces a survivor at (x, z) towards (tx, tz): forward is (-sin yaw, -cos yaw), as everywhere
export const yawTowards = (x, z, tx, tz) => Math.atan2(-(tx - x), -(tz - z));

// The goal in one line, for the opening of a first run: "Fix the car: 7 parts"
export function goalLine(need, thing = 'car') {
  return `Fix the ${thing}: ${need} part${need === 1 ? '' : 's'}`;
}
