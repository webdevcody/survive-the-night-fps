// Two guns at once. A gun whose file says `akimbo` (shared/weapons/) can be held as a pair: a second one of the same
// gun put on from the backpack onto the one in its slot (Game.useItem) makes the slot a pair, and s.dual says which
// slots are (a bit each: DUAL_BIT). A pair is one weapon to the simulation, with its own numbers (pairDef): both
// magazines in one (mags[i] counts the pair's rounds), the guns going off in turn so the trigger can be pulled
// faster, a wider cone, no sights and a longer reload for two guns. Taken apart (unequip, a drop, salvage, a swap,
// death) the second gun goes back to being one of its own, with half the rounds (Game.splitPair).
import { SLOT_PRIMARY, SLOT_PISTOL } from './constants.js';
import { WEAPONS } from './defs.js';
import { WEAPON_LIST } from './weapons/index.js';

const AKIMBO = new Set(WEAPON_LIST.filter((w) => w.akimbo).map((w) => w.id));

// what a pair does next to one of its guns
export const PAIR = {
  rate: 0.55, // x the time between shots: the hands take turns
  spread: 1.5, // x the cone, still and moving
  reload: 1.6, // x a magazine's reload (shell by shell: each shell takes as long, and there are twice as many)
};

export const canPair = (item) => AKIMBO.has(item);

// the bit of s.dual for a weapon slot (only the two slots with a magazine take a pair)
export const DUAL_BIT = { [SLOT_PRIMARY]: 1, [SLOT_PISTOL]: 2 };
export const isDual = (s, slot) => ((s.dual | 0) & (DUAL_BIT[slot] | 0)) !== 0;

// The numbers of a pair of `item` (built once each): its WEAPONS row with the PAIR changes, and `pair` set
const PAIRS = {};
export function pairDef(item) {
  let d = PAIRS[item];
  if (d) return d;
  const w = WEAPONS[item];
  d = PAIRS[item] = {
    ...w,
    pair: true,
    mag: w.mag * 2,
    rate: w.rate * PAIR.rate,
    spread: w.spread * PAIR.spread,
    moveSpread: w.moveSpread * PAIR.spread,
    reload: w.reloadEach ? w.reload : w.reload * PAIR.reload,
  };
  return d;
}

// The numbers of the gun in weapon slot `slot` as it is held: a pair's, or its own
export function slotDef(s, slot) {
  const item = s.weapons[slot];
  if (!item) return undefined;
  return isDual(s, slot) ? pairDef(item) : WEAPONS[item];
}

// which hand the next round of a pair goes from: the right with an even number of rounds left, the left with an odd
// one, so a full pair starts on the right and the two take turns from there
export const pairHand = (mag) => (mag & 1 ? -1 : 1);
