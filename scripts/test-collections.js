// What is left to earn (shared/collections.js, issue #286): the completion counts of each collection, and what a
// loadout item not found yet gives away of itself - its rarity, type and where to look, never its name, and never
// the name of a boss the player has not seen.
import { ZOMBIE_DEFS, ZTYPE, ITEM, CONT_TABLES, CONT, CONT_DEFS } from '../shared/defs.js';
import { BESTIARY_ALL, bit } from '../shared/bestiary.js';
import { CARDS, STARTER } from '../shared/cards.js';
import { LOADOUT_CATALOG } from '../shared/loadout.js';
import { PERKS } from '../shared/progress.js';
import { ACHIEVEMENTS } from '../shared/achievements.js';
import { CARD_SOURCE, achievementTally, bestiaryTally, cardTally, loadoutTally, perkTally, silhouette, sourceText, tallyPct, tallyText } from '../shared/collections.js';

let failed = 0;
function check(name, ok, detail = '') {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${ok ? '' : detail}`);
}

// ---------------------------------------------------------------- the counts
{
  const n = LOADOUT_CATALOG.length;
  check('no loadout items: 0 of the whole catalog', tallyText(loadoutTally([])) === `0 / ${n}` && tallyText(loadoutTally(null)) === `0 / ${n}`);
  const a = LOADOUT_CATALOG[0].id;
  const b = LOADOUT_CATALOG[1].id;
  const t = loadoutTally([{ id: 'x1', catalog: a }, { id: 'x2', catalog: a }, { id: 'x3', catalog: b }, { id: 'x4', catalog: 99999 }, null]);
  check('loadout: kinds owned, not copies, and nothing the catalog does not have', t.have === 2 && t.total === n, JSON.stringify(t));
  check('every loadout item owned: 100%', tallyPct(loadoutTally(LOADOUT_CATALOG.map((d) => ({ catalog: d.id })))) === 100);

  const starter = CARDS.filter((c) => STARTER[c.id]).length;
  check('cards: the starter set counts as owned', cardTally({}).have === starter && cardTally({}).total === CARDS.length, JSON.stringify(cardTally({})));
  const extra = CARDS.find((c) => !STARTER[c.id]);
  check('cards: a found card adds one kind, however many copies', cardTally({ [extra.id]: 3 }).have === starter + 1);
  check('cards: a zero count is not owned', cardTally({ [extra.id]: 0 }).have === starter);

  check('bestiary: kinds seen of the book', bestiaryTally(0).have === 0 && bestiaryTally(bit(ZTYPE.WALKER) | bit(ZTYPE.RUNNER)).have === 2 && bestiaryTally(BESTIARY_ALL).have === bestiaryTally(0).total);
  const ach = ACHIEVEMENTS.slice(0, 3).reduce((o, x) => ({ ...o, [x.id]: 1 }), { nope: 1 });
  check('achievements: unlocked ones, of all of them', achievementTally(ach).have === 3 && achievementTally(undefined).have === 0 && achievementTally({}).total === ACHIEVEMENTS.length);
  check('perks: taken ones, once each, of the tree', perkTally([PERKS[0].id, PERKS[0].id, PERKS[1].id, 999]).have === 2 && perkTally(null).have === 0 && perkTally([]).total === PERKS.length);
  check('a percentage of nothing is 0, and it rounds down', tallyPct({ have: 0, total: 0 }) === 0 && tallyPct({ have: 2, total: 3 }) === 66);
}

// ---------------------------------------------------------------- silhouettes
{
  const leaks = LOADOUT_CATALOG.filter((d) => {
    const g = silhouette(d, 0);
    const text = `${g.name} ${g.source}`.toLowerCase();
    return text.includes(d.name.toLowerCase()) || (d.flavor && text.includes(d.flavor.toLowerCase()));
  });
  check('a silhouette never gives away the name or flavour of what it hides', !leaks.length, leaks.map((d) => d.name).join());
  check('a silhouette keeps its rarity and type', LOADOUT_CATALOG.every((d) => silhouette(d).rarity === d.rarity && silhouette(d).type === d.type));

  const bossItems = LOADOUT_CATALOG.filter((d) => d.source.kind === 'boss');
  check('there are boss drops to hide', bossItems.length > 0);
  const named = bossItems.filter((d) => sourceText(d, 0).includes(ZOMBIE_DEFS[d.source.boss].name.replace(/^The /, '')));
  check('a boss not met yet is "???" on its drops', !named.length && bossItems.every((d) => sourceText(d, 0).includes('???')), named.map((d) => d.name).join());
  const shown = bossItems.filter((d) => sourceText(d, bit(d.source.boss)) !== `Drops from ${ZOMBIE_DEFS[d.source.boss].name}`);
  check('once the bestiary has the boss, its drops name it', !shown.length, shown.map((d) => d.name).join());
  const other = bossItems.find((d) => bossItems.some((e) => e.source.boss !== d.source.boss));
  if (other) {
    const elsewhere = bossItems.find((e) => e.source.boss !== other.source.boss).source.boss;
    check('seeing one boss does not name another', sourceText(other, bit(elsewhere)).includes('???'));
  }
  const places = LOADOUT_CATALOG.filter((d) => d.source.kind !== 'boss');
  check('the rest say where to look', places.every((d) => sourceText(d, 0) === d.source.text && d.source.text.length > 5));
}

// ---------------------------------------------------------------- where cards come from
{
  const tables = Object.entries(CONT_TABLES).filter(([, rows]) => rows.some((r) => r[0] === ITEM.CARD_PACK)).map(([k]) => k);
  const words = { trunk: 'trunks', duffel: 'bags', locker: 'lockers', cabinet: 'cabinets' };
  const missing = tables.filter((k) => words[k] && !CARD_SOURCE.includes(words[k]));
  check('the card line names the places packs are kept', tables.length > 0 && !missing.length, `${tables.join()} / missing ${missing.join()}`);
  const box = CONT_DEFS[CONT.STRONGBOX];
  check("sealed packs are in the mine's strongbox, as the line says", (box.also || []).some((r) => r[0] === ITEM.SEALED_PACK) && CARD_SOURCE.includes(box.guide));
}

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
