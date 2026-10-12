// "You were heard" (EVT.HEARD): a noise of yours woke the dead. A ring on the minimap, as far as it carried, and the
// dots of the ones it woke lit for a moment, so a player learns what is loud, how far it reaches and what it brings.
// Every time, unless the setting is off (settings.js heardRings); the noise is named the first time for each kind
// ("Gunshot: heard 45 m away, woke 2"), remembered in this browser, and that first one shows with the setting off too.
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

// What to show for one: { show, label } (show: the ring and the woken dead lit; label null: no name). seen: the
// kinds already named (a Set, added to)
export function heardShow(what, woke, loud, { always = true, seen }) {
  const first = !seen.has(what);
  if (first) seen.add(what);
  return { show: first || always, label: first ? heardLabel(what, woke, loud) : null };
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
