// The Skull shop: cosmetic unlocks bought with Zombie Skulls (prices: SKULL_SHOP in shared/economy.js). Each one is a
// dye in the wardrobe (shared/wardrobe.js, a swatch with `shop`), so it is drawn on the survivor everyone else sees and
// changes nothing else. Anyone may try one on in the character creator; the server (server/game.js, looks) shows the
// field's default instead while its wearer has not bought it, and the purchase itself goes through the Skull ledger
// (server/userloadout.js buyCosmetic).
import { PALETTES } from './wardrobe.js';
import { SKULL_SHOP } from './economy.js';
import { APPEARANCE, decode, encode, canonical } from './appearance.js';

export const COSMETICS = Object.freeze(
  SKULL_SHOP.map((s) => {
    for (const [palette, pal] of Object.entries(PALETTES)) {
      const sw = pal.swatches.find((x) => x.shop === s.id);
      if (sw && sw.name !== s.swatch) throw new Error(`skull shop: shop ${s.id} is ${sw.name} in the wardrobe, not ${s.swatch}`);
      if (sw) return Object.freeze({ id: s.id, kind: 'dye', palette, swatch: sw.name, label: sw.label, hex: sw.hex, price: s.price });
    }
    throw new Error(`skull shop: no swatch has shop ${s.id} (${s.swatch})`);
  })
);
const BY_ID = new Map(COSMETICS.map((c) => [c.id, c]));
const BY_SWATCH = new Map(COSMETICS.map((c) => [`${c.palette}:${c.swatch}`, c]));

export const cosmeticDef = (id) => (Number.isInteger(id) ? BY_ID.get(id) || null : null);
/** The cosmetic a field's value is (a Skull shop dye), or null. */
export function cosmeticOf(f, name) {
  return f && f.kind === 'swatch' ? BY_SWATCH.get(`${f.palette}:${name}`) || null : null;
}

/** The Skull shop dyes a look wears that are not in `owned` (ids: an array or a Set) -> [cosmetic] */
export function lockedCosmetics(values, owned = []) {
  const have = owned instanceof Set ? owned : new Set(owned);
  const out = new Map();
  for (const f of APPEARANCE.fields) {
    const c = cosmeticOf(f, values?.[f.key]);
    if (c && !have.has(c.id)) out.set(c.id, c);
  }
  return [...out.values()];
}

/** The look as others are shown it: each Skull shop dye not in `owned` back to its field's default. */
export function ownedLook(values, owned = []) {
  const have = owned instanceof Set ? owned : new Set(owned);
  let v = values;
  for (const f of APPEARANCE.fields) {
    const c = cosmeticOf(f, v?.[f.key]);
    if (c && !have.has(c.id)) v = { ...v, [f.key]: APPEARANCE.fallback(f) };
  }
  return v;
}

/** The same for a look's canonical bytes (a plain array, as the server keeps it), or null for none. */
export function ownedLookBytes(bytes, owned = []) {
  if (!bytes) return null;
  const v = decode(Uint8Array.from(bytes));
  if (!v) return null;
  const out = ownedLook(v, owned);
  return out === v ? [...bytes] : [...encode(canonical(out))];
}
