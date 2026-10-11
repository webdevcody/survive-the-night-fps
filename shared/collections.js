// What is left to earn in each collection (issue #286): how many of the loadout items, Dead Hand cards, bestiary
// kinds, achievements and perks a player has, out of how many there are, and what an item not yet found says of
// itself. The bestiary's way with what is not seen yet is the rule here too: a silhouette keeps its rarity, its type
// and where it comes from, but not its name or what it does, and a boss's drop does not name the boss until the
// bestiary has it (a "???" source instead), so the catalog gives away no monster the player has not met.
import { ZOMBIE_DEFS } from './defs.js';
import { BESTIARY, bit, seenCount } from './bestiary.js';
import { CARDS, owned as cardsOwned } from './cards.js';
import { LOADOUT_CATALOG, loadoutTypeName } from './loadout.js';
import { PERKS } from './progress.js';
import { ACHIEVEMENTS } from './achievements.js';

// where Dead Hand cards come from (CONT_TABLES trunk/duffel/locker/cabinet, CONT_DEFS strongbox, server/cards.js bossDrop)
export const CARD_SOURCE = "Card packs in trunks, bags, lockers and cabinets; sealed packs in the mine's strongbox and from bosses";

const tally = (have, total) => ({ have: Math.max(0, Math.min(total, have | 0)), total });
export const tallyText = (t) => `${t.have} / ${t.total}`;
export const tallyPct = (t) => (t.total ? Math.floor((t.have / t.total) * 100) : 0);

// owned loadout items ([{ catalog }], as /api/loadout sends them) -> catalog id -> copies
export function loadoutCounts(items) {
  const m = new Map();
  for (const it of Array.isArray(items) ? items : []) if (it && Number.isInteger(it.catalog)) m.set(it.catalog, (m.get(it.catalog) || 0) + 1);
  return m;
}
// kinds of item owned at least once, of the whole catalog
export function loadoutTally(items) {
  const m = loadoutCounts(items);
  return tally(LOADOUT_CATALOG.filter((d) => m.has(d.id)).length, LOADOUT_CATALOG.length);
}
// kinds of card owned at least once (the starter set counts), of every card
export const cardTally = (found) => tally(CARDS.filter((c) => cardsOwned(c.id, found) > 0).length, CARDS.length);
export const bestiaryTally = (mask) => tally(seenCount(mask | 0), BESTIARY.length);
export const achievementTally = (unlocked) => tally(ACHIEVEMENTS.filter((a) => unlocked && unlocked[a.id]).length, ACHIEVEMENTS.length);
export const perkTally = (perks) => tally(new Set((Array.isArray(perks) ? perks : []).filter((id) => PERKS.some((p) => p.id === id))).size, PERKS.length);

// where an item comes from, as a player who has seen the kinds in `seen` (a bestiary mask) may be told it
export function sourceText(def, seen = 0) {
  const s = def?.source || {};
  if (s.kind === 'boss') return seen & bit(s.boss) ? `Drops from ${ZOMBIE_DEFS[s.boss]?.name || 'a boss'}` : 'Drops from ??? (a boss you have not met)';
  return s.text || 'The valley';
}

// an item not found yet, as its silhouette shows it: no name, no flavour, no effects
export const silhouette = (def, seen = 0) => ({ id: def.id, rarity: def.rarity, type: def.type, name: `Unknown ${loadoutTypeName(def.type).toLowerCase()}`, source: sourceText(def, seen) });
