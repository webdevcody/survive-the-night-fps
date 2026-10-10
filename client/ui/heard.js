// "You were heard" (EVT.HEARD): a noise of yours woke the dead. A ring on the minimap, as far as it carried, so a
// player learns what is loud and how far it reaches. Named the first time for each kind of noise ("Gunshot: heard
// 70 m away, woke 5"), remembered in this browser. After that it only shows on Ember, or with the setting on
// (settings.js noiseRings).
import { HEARD } from '../../shared/defs.js';
import { lsGet, lsSet } from './dom.js';

const KEY = 'stn.heard'; // the kinds of noise already named in this browser

export const HEARD_NAMES = {
  [HEARD.GUNSHOT]: 'Gunshot',
  [HEARD.BLAST]: 'Explosion',
  [HEARD.MOLOTOV]: 'Molotov',
  [HEARD.BUILD]: 'Hammering',
  [HEARD.CHOP]: 'Chopping',
  [HEARD.SALVAGE]: 'Salvaging',
  [HEARD.PRY]: 'Prying',
  [HEARD.HORN]: 'Horn',
  [HEARD.CAR_ALARM]: 'Car alarm',
};

export const heardLabel = (what, woke, loud) => `${HEARD_NAMES[what] || 'Noise'}: heard ${loud} m away, woke ${woke}`;

// What to show for one: { ring, label } (label null: the ring alone). seen: the kinds already named (a Set, added to)
export function heardShow(what, woke, loud, { ember = false, always = false, seen }) {
  const first = !seen.has(what);
  if (first) seen.add(what);
  return { ring: first || ember || always, label: first ? heardLabel(what, woke, loud) : null };
}

export function loadHeardSeen() {
  try {
    const a = JSON.parse(lsGet(KEY, '[]'));
    return new Set(Array.isArray(a) ? a.filter((n) => Number.isInteger(n)) : []);
  } catch {
    return new Set();
  }
}

export function saveHeardSeen(seen) {
  lsSet(KEY, JSON.stringify([...seen]));
}
