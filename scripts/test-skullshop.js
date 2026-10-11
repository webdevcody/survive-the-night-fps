// The Skull shop (#285): cosmetic unlocks bought with Zombie Skulls.
// - at least 10 cosmetics, each a wardrobe dye with a price, never rolled by the dice
// - purchases go through the Skull ledger: not enough Skulls, a second purchase and two at once (both stores)
// - what a guest bought goes to their account when they sign in
// - other players see a bought dye, and the plain colour until it is bought (S2C.LOOKS)
// - the report's Skulls week by week (analytics_skulls)
import { createHash, randomUUID } from 'node:crypto';
import { LoadoutService, MemoryLoadoutStore, PgLoadoutStore } from '../server/userloadout.js';
import { LocalLoadouts } from '../server/loadouts.js';
import { Game } from '../server/game.js';
import { openDb } from '../server/db/index.js';
import { migrate } from '../server/db/migrate.js';
import { C2S, S2C, PROTOCOL_VERSION, Reader, Writer } from '../shared/protocol.js';
import { CHARACTER_NONE } from '../shared/characters.js';
import { APPEARANCE, decode, defaults, normalize, randomLook, writeLook, readLook } from '../shared/appearance.js';
import { SKULL_SHOP } from '../shared/economy.js';
import { COSMETICS, cosmeticDef, lockedCosmetics, ownedLook, ownedLookBytes } from '../shared/skullshop.js';
import { PALETTES } from '../shared/wardrobe.js';

const fails = [];
const check = (name, ok, info = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${ok ? '' : info}`);
  if (!ok) fails.push(name);
};
const errCode = async (fn) => {
  try {
    await fn();
    return '';
  } catch (err) {
    return err.code || err.message;
  }
};
const settle = async () => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r));
};
const guestOf = (pid) => `g:${createHash('sha256').update(pid).digest('hex')}`;
const byName = (n) => COSMETICS.find((c) => c.swatch === n);

function catalog() {
  console.log('\n-- the shop');
  check('at least 10 cosmetics', COSMETICS.length >= 10, String(COSMETICS.length));
  check('ids are unique and each priced in whole Skulls', new Set(COSMETICS.map((c) => c.id)).size === COSMETICS.length && COSMETICS.every((c) => Number.isInteger(c.price) && c.price > 0));
  const shopSwatches = Object.values(PALETTES).flatMap((p) => p.swatches.filter((s) => s.shop));
  check('every shop swatch in the wardrobe is in the price table', shopSwatches.length === SKULL_SHOP.length && shopSwatches.every((s) => cosmeticDef(s.shop)?.swatch === s.name));
  check('cosmeticDef refuses what is not in the shop', cosmeticDef(0) === null && cosmeticDef(999) === null && cosmeticDef('1') === null);
  let rolled = 0;
  let seed = 1;
  const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 3000; i++) if (lockedCosmetics(randomLook(rng)).length) rolled++;
  check('the dice never roll a Skull shop dye', rolled === 0, `${rolled} of 3000`);
  const blood = byName('blood');
  const look = normalize({ ...defaults(), topColor: 'blood', hat: 'cap', hatColor: 'blood', trouserColor: 'gold' });
  check('a look wearing shop dyes lists each once', lockedCosmetics(look).map((c) => c.swatch).sort().join() === 'blood,gold');
  const shown = ownedLook(look, [blood.id]);
  check('...shown with what is not owned back to the default', shown.topColor === 'blood' && shown.hatColor === 'blood' && shown.trouserColor === APPEARANCE.fallback(APPEARANCE.byKey.get('trouserColor')));
  const bytes = [...APPEARANCE.encode(look)];
  check('...and the same on the wire', decode(Uint8Array.from(ownedLookBytes(bytes, []))).topColor === 'grey' && ownedLookBytes(null, []) === null);
  check('a look without shop dyes is left alone', ownedLookBytes(bytes, COSMETICS.map((c) => c.id)).join() === bytes.join());
}

async function stores() {
  for (const [label, makeStore] of [
    ['memory', async (uid) => Object.assign(new MemoryLoadoutStore(), { accounts: new Set([uid]) })],
    [
      'postgres',
      async (uid) => {
        const db = await openDb('pglite:memory');
        await migrate(db);
        await db.query("INSERT INTO users (id, email, username, password_hash) VALUES ($1, 'shop@example.com', 'Shopper', 'x')", [uid]);
        return Object.assign(new PgLoadoutStore(db), { db });
      },
    ],
  ]) {
    console.log(`\n-- buying (${label})`);
    const uid = randomUUID();
    const store = await makeStore(uid);
    const svc = new LoadoutService({ store });
    const browser = randomUUID();
    const g = guestOf(browser);
    const blood = byName('blood'), gold = byName('gold'), bile = byName('bile');
    check(`${label}: not enough Skulls is refused`, (await errCode(() => svc.buyCosmetic(g, blood.id))) === 'insufficient_skulls');
    check(`${label}: ...and buys nothing`, (await svc.cosmetics(g)).length === 0 && (await svc.balance(g)) === 0);
    await svc.earnSkulls(g, 300, { kind: 'test' }, 'shop:earn:1');
    const got = await svc.buyCosmetic(g, blood.id);
    check(`${label}: a purchase takes its price`, got.balance === 300 - blood.price && (await svc.balance(g)) === 300 - blood.price, JSON.stringify(got));
    check(`${label}: ...and it is theirs`, (await svc.cosmetics(g)).join() === String(blood.id));
    check(`${label}: buying it again is refused`, (await errCode(() => svc.buyCosmetic(g, blood.id))) === 'owned' && (await svc.balance(g)) === 300 - blood.price);
    const before = await svc.balance(g);
    const both = await Promise.allSettled([svc.buyCosmetic(g, bile.id), svc.buyCosmetic(g, bile.id)]);
    check(`${label}: two purchases of one thing at once pay once`, both.filter((r) => r.status === 'fulfilled').length === 1 && both.find((r) => r.status === 'rejected')?.reason.code === 'owned' && (await svc.balance(g)) === before - bile.price);
    check(`${label}: what is not in the shop is refused`, (await errCode(() => svc.buyCosmetic(g, 999))) === 'bad_cosmetic' && (await errCode(() => svc.buyCosmetic('nobody', blood.id))) === 'bad_cosmetic');
    check(`${label}: more than is left is refused`, (await errCode(() => svc.buyCosmetic(g, gold.id))) === 'insufficient_skulls' && !(await svc.cosmetics(g)).includes(gold.id));
    const merged = await svc.mergeGuest(uid, browser);
    check(`${label}: a guest's cosmetics go to their account`, merged.cosmetics === 2 && (await svc.cosmetics(`a:${uid}`)).join() === [blood.id, bile.id].sort((a, b) => a - b).join() && (await svc.cosmetics(g)).length === 0, JSON.stringify(merged));
    const profile = await svc.profile(`a:${uid}`);
    check(`${label}: the loadout profile says what they have`, profile.cosmetics.length === 2);
    if (store.db) {
      const rows = (await store.db.query('SELECT * FROM analytics_skulls()')).rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, k === 'week' ? v : Number(v)])));
      const w = rows[0] || {};
      check(`${label}: the report's week: Skulls earned, spent in the shop, net`, rows.length === 1 && w.earned === 300 && w.cosmetics === blood.price + bile.price && w.spent === blood.price + bile.price && w.net === 300 - blood.price - bile.price && w.buyers === 1, JSON.stringify(rows));
    }
    await svc.close();
  }
}

function fakeConn(got) {
  return { send: (b) => got.push(Uint8Array.from(b)), cork(fn) { fn(); }, closed: false, slot: 0, user: null, ip: '127.0.0.1', congested: () => false };
}
function joinWith(game, name, pid, values, got) {
  const session = game.onOpen(fakeConn(got));
  const w = new Writer(512);
  w.u8(C2S.JOIN);
  w.u8(PROTOCOL_VERSION);
  w.str(name);
  w.str(pid);
  w.u8(CHARACTER_NONE);
  writeLook(w, values);
  game.onMessage(session, w.bytes());
  return [...game.players.values()].find((p) => p.name === name);
}
// the look another player was last told this id has (S2C.LOOKS)
function seenLook(got, id) {
  let out;
  for (const b of got) {
    if (b[0] !== S2C.LOOKS) continue;
    const r = new Reader(b);
    r.u8();
    for (let n = r.u8(); n > 0; n--) {
      const who = r.u16();
      const look = readLook(r);
      if (who === id) out = look ? decode(look) : null;
    }
  }
  return out;
}

async function inGame() {
  console.log('\n-- what other players see');
  const service = new LoadoutService({ store: new MemoryLoadoutStore() });
  const game = new Game({ seed: 7, cards: null, loadouts: new LocalLoadouts(service), dayLength: 999, nightLength: 999, godMode: true });
  game.code = 'SHOP';
  const blood = byName('blood'), gold = byName('gold');
  const aPid = randomUUID(), bPid = randomUUID(), cPid = randomUUID();
  await service.earnSkulls(guestOf(aPid), 300, { kind: 'test' }, 'shop:a');
  await service.buyCosmetic(guestOf(aPid), blood.id);
  await service.earnSkulls(guestOf(cPid), 300, { kind: 'test' }, 'shop:c');
  const bGot = [];
  const b = joinWith(game, 'Watcher', bPid, null, bGot);
  const a = joinWith(game, 'Buyer', aPid, normalize({ ...defaults(), topColor: 'blood' }), []);
  const c = joinWith(game, 'Hopeful', cPid, normalize({ ...defaults(), topColor: 'gold' }), []);
  await settle();
  check('a bought dye is shown to the others', seenLook(bGot, a.id)?.topColor === 'blood', JSON.stringify(seenLook(bGot, a.id)?.topColor));
  check('a dye not bought is shown as the plain colour', seenLook(bGot, c.id)?.topColor === 'grey', JSON.stringify(seenLook(bGot, c.id)?.topColor));
  await service.buyCosmetic(guestOf(cPid), gold.id);
  await settle();
  check('...until it is bought in the game: then everyone sees it', seenLook(bGot, c.id)?.topColor === 'gold', JSON.stringify(seenLook(bGot, c.id)?.topColor));
  check('the watcher, with no look of their own, is not touched', !b.look);
}

catalog();
await stores();
await inGame();

if (fails.length) {
  console.error(`\n${fails.length} Skull shop test(s) failed: ${fails.join(', ')}`);
  process.exit(1);
}
console.log('\nSkull shop tests passed');
