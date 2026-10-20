// Items: loot rolled and laid out, things dropped and where they come to rest, what lies on the ground (spawnItem,
// removeItemEnt: the drops' ceiling, a car supply out of its hiding place), putting something in a survivor's hands
// (giveItem, giveOrDrop) and the pickups they walk over (updateItems). The pack's own rules - stacks, slots, capacity
// - are server/inventory.js's.
import { SLOT_THROW, PLAYER_RADIUS, STEP_HEIGHT } from '../../shared/constants.js';
import { ITEM_DEFS, WEAPONS, SCHEM_BIT, AMMO_MAX, AMMO_ITEMS, SOUND, EVT, NOTIFY, ZONE, THROW_ITEMS, isFirearm } from '../../shared/defs.js';
import { ENT } from '../../shared/protocol.js';
import { COL, footprintContains, groundAt } from '../../shared/collision.js';
import { invCap, addItem, countItem, freeSlot, slotMag, setSlotMag } from '../inventory.js';
import { isLoadoutArmor, isLoadoutBackpack, isLoadoutStack, isLoadoutWeapon } from '../loadouts.js';
import { isDual } from '../../shared/akimbo.js';

// A stack a survivor put down on purpose (ACT.DROP_SLOT) is theirs to leave lying: walking over it does not put it
// back in their backpack until they have been this far from it. A teammate's feet, and their own [E], take it as usual.
const DROP_LEAVE_DIST = 3;
const DROP_AHEAD = 1.1; // m in front of a survivor that what they put down lands (dropInFront)
// seconds between two "no room for that" notices to a survivor whose full backpack keeps leaving things on the ground
const FULL_NOTICE_EVERY = 6;
const AUTO_PICKUP = { res: 1, ammo: 1, cons: 1, throw: 1, part: 1, schem: 1, card: 1 }; // (a card pack is opened as it is picked up: Cards.openPack)
// A loose drop is an entity every client in range has to be told about, so there is a ceiling on them: once this
// many lie around the valley, each new one takes the place of the oldest (spawnItem). Car supplies and schematics
// never despawn and are not counted. (A whole lobby dying with full packs is under 300.)
export const MAX_DROPS = 400;
// a car supply on the ground that is not in its hiding place (that one is only rumoured): dropped, or where its
// carrier fell
export const looseSupply = (e) => e.permanent && e.hint < 0 && ITEM_DEFS[e.item]?.cat === 'part';

export const methods = {
  rollTable(table) {
    let total = 0;
    for (const t of table) total += t[1];
    let r = this.rng() * total;
    for (const t of table) {
      r -= t[1];
      if (r <= 0) return [t[0], t[2] + Math.floor(this.rng() * (t[3] - t[2] + 1))];
    }
    const t = table[0];
    return [t[0], t[2]];
  },

  spawnLoot(lp) {
    const [item, count] = this.rollTable(lp.table);
    lp.ent = this.spawnItem(item, count, lp.x, this.onFloor(lp.x, lp.y, lp.z), lp.z, { point: lp });
  },

  // The height something laid at an authored spot (floor loot, a hidden supply) lies at: on the floor it was meant to
  // be on. The island's places put their spots 2 cm over a building's base, and the floor is a 12 cm slab laid on that
  // base (Builder.room), so a fan belt or a box of spark plugs (3-4 cm tall) lay hidden under the floorboards and a
  // battery or a tyre half sunk in them. Only ever up, onto a surface within 15 cm over the spot: one on a desk stays
  // on the desk, and one outdoors stays where it is.
  onFloor(x, y, z) {
    const LIFT = 0.15;
    return Math.max(y, groundAt(this.world, x, z, y + LIFT - STEP_HEIGHT - 0.02, 0) + 0.02);
  },

  spawnItem(item, count, x, y, z, opts = {}) {
    const e = {
      kind: ENT.ITEM,
      item,
      count,
      x,
      y,
      z,
      mag: opts.mag ?? (isFirearm(item) ? Math.floor(WEAPONS[item].mag * (0.3 + this.rng() * 0.7)) : 0),
      point: opts.point || null,
      droppedBy: this.dropper, // who put it down on purpose and has stayed by it since (0: nobody); see updateItems
      despawnAt: opts.permanent || opts.point ? Infinity : this.time + (opts.life || 150),
      permanent: !!opts.permanent,
      hint: opts.hint ?? -1, // a car supply still in its hiding place: which of the supply hints points at it
      noAutoUntil: opts.noAuto ? this.time + opts.noAuto : 0,
      drop: opts.drop && !opts.permanent ? ++this.dropSeq : 0, // a loose drop: its place in the order they fell
    };
    if (!this.spawnEntity(e)) return null;
    this.items.push(e);
    if (looseSupply(e)) this.globalDirty = true; // (the field map marks it: writeGlobal)
    // the ceiling on loose drops (MAX_DROPS): the oldest one makes room
    if (e.drop && ++this.drops > this.maxDrops) {
      let oldest = e;
      for (const it of this.items) if (it.drop && it.drop < oldest.drop) oldest = it;
      this.removeItemEnt(oldest);
    }
    return e;
  },

  removeItemEnt(e) {
    if (e.point) {
      e.point.ent = null;
      e.point.respawnAt = this.time + (e.point.zone === ZONE.FOREST ? 110 + this.rng() * 140 : 150 + this.rng() * 180);
    }
    if (e.drop && !e.removed) this.drops--;
    // a hidden car supply only ever leaves its spot in someone's hands: that place needs no more searching
    if (e.hint >= 0 && !e.removed) {
      this.track.supplyFound(e);
      this.supplyFound |= 1 << e.hint;
      this.globalDirty = true;
    }
    if (looseSupply(e) && !e.removed) this.globalDirty = true;
    this._listRemove(this.items, e);
    this.removeEntity(e);
  },

  // The height something dropped from feet height y comes to rest at on x,z - or null where nobody could pick it up
  // again: on the lake bed (a deck over the water is ground like any other) or inside something solid.
  dropRest(x, y, z) {
    const w = this.world;
    // (the ground of the level the feet are on: down in the mine the floor of the drift, and no spot in its rock)
    const terrain = w.floorAt(x, z, y + 0.5);
    if (w.mine && w.mine.under(x, y + 0.5, z) && w.mine.sdf(x, z) > -0.2) return null;
    // onto whatever is there up to a metre above the feet (a table, a hood), uphill onto what stands on the slope
    const gy = groundAt(w, x, z, Math.max(y, terrain) + 1, 0.1, true);
    if (w.isDeepWater(x, z) && gy <= terrain + 0.01) return null;
    const near = [];
    for (const grid of w.colliderGrids) {
      for (const c of grid.query(x, z, 0.15, near)) {
        if (c.flags & (COL.NOBLOCK | COL.HUMANPASS)) continue;
        // a wall, a rock, a wreck, a tree trunk - not the floor under it or a roof over it
        if (c.y1 > gy + STEP_HEIGHT && c.y0 < gy + 0.3 && footprintContains(c, x, z, 0.15)) return null;
      }
    }
    return gy;
  },

  // Scatter a dropped item near x,z. It never comes to rest where nobody can get at it - the lake bed off the pier,
  // inside a wall or a rock, beyond the edge of the map: it lands short of that instead, on the way back to the feet of
  // whoever dropped it (opts.from, else x,z itself), and when those will not do either (a body out in the lake) on the
  // nearest spot around them that will. A car supply lost that way would make the game unwinnable. The search draws
  // nothing from the rng.
  dropItem(item, count, x, y, z, opts = {}) {
    const a = this.rng() * Math.PI * 2;
    const r = opts.spread ?? 0.6 + this.rng() * 0.8;
    const lim = this.world.half - 3; // as far out as a survivor gets (simulatePlayer)
    const inMap = (v) => Math.max(-lim, Math.min(lim, v));
    const hx = inMap(opts.from?.x ?? x);
    const hz = inMap(opts.from?.z ?? z);
    const sx = inMap(x + Math.sin(a) * r);
    const sz = inMap(z + Math.cos(a) * r);
    // it falls from the ground under the dropper's feet (they may be in mid-air), not onto a roof beside them. What
    // flies over open water has no ground to speak of and drops from where it is, onto the deck if that is nearest
    const under = groundAt(this.world, hx, hz, y, PLAYER_RADIUS * 0.7, true);
    const fy = this.world.isDeepWater(hx, hz) && under <= this.world.heightAt(hx, hz) + 0.01 ? y : Math.min(y, under);
    let dx;
    let dz;
    let gy = null;
    const tryAt = (px, pz) => {
      dx = px;
      dz = pz;
      gy = this.dropRest(px, fy, pz);
    };
    // where it was thrown, then two thirds and one third of the way there, then the dropper's feet
    for (let k = 3; k >= 0 && gy === null; k--) tryAt(hx + ((sx - hx) * k) / 3, hz + ((sz - hz) * k) / 3);
    // then rings around the feet, each a little wider than the last, as far as the lake is across
    for (let ring = 0.25, n = 0; ring < 140 && gy === null; ring *= 1.15, n++) {
      for (let k = 0; k < 16 && gy === null; k++) tryAt(inMap(hx + Math.sin(a + n + k * 0.3927) * ring), inMap(hz + Math.cos(a + n + k * 0.3927) * ring));
    }
    if (gy === null) {
      // nowhere at all (no map has such a place): back at the breakdown rather than gone
      const sp = this.world.spawnPoints[0];
      dx = sp.x;
      dz = sp.z;
      gy = groundAt(this.world, dx, dz, this.world.heightAt(dx, dz) + 1, 0.1, true);
    }
    const cat = ITEM_DEFS[item]?.cat;
    return this.spawnItem(item, count, dx, gy + 0.02, dz, { life: opts.life ?? 240, mag: opts.mag, permanent: cat === 'part' || cat === 'schem', noAuto: opts.noAuto, drop: true });
  },

  // Something a survivor puts down (ACT.DROP_*, a worn piece dropped) lands DROP_AHEAD in front of them, and never
  // where they could not get at it again (dropItem, back towards their feet)
  dropInFront(p, item, count, opts) {
    const s = p.state;
    return this.dropItem(item, count, s.x - Math.sin(s.yaw) * DROP_AHEAD, s.y, s.z - Math.cos(s.yaw) * DROP_AHEAD, { ...opts, from: s });
  },

  // everything a survivor carries goes on the ground around them (one who leaves the game has had what is left of
  // their starting kit taken out first: parkKit)
  dropAll(p) {
    const s = p.state;
    const x = s.x;
    const y = s.y;
    const z = s.z;
    for (let i = 0; i < p.inv.length; i++) {
      const it = p.inv[i];
      if (it && !isLoadoutStack(it)) this.dropItem(it.item, it.count, x, y, z, { spread: 1.5 + this.rng() * 1.5, mag: it.mag, noAuto: 2 });
      p.inv[i] = null;
    }
    if (!p.zombie) {
      for (let slot = 0; slot < 5; slot++) {
        const wpn = s.weapons[slot];
        if (!wpn || slot === SLOT_THROW) continue;
        if (isLoadoutWeapon(p, slot)) continue;
        // (a pair is two guns on the ground, the rounds shared out between them)
        const m = slotMag(s, slot);
        const pair = isDual(s, slot);
        if (pair) this.dropItem(wpn, 1, x, y, z, { spread: 1.2, mag: m >> 1 });
        this.dropItem(wpn, 1, x, y, z, { spread: 1.2, mag: pair ? m - (m >> 1) : m });
      }
      s.dual = 0;
      for (let i = 0; i < AMMO_ITEMS.length; i++) if (s.ammo[i] > 0) this.dropItem(AMMO_ITEMS[i], s.ammo[i], x, y, z, { spread: 1.5, noAuto: 2 });
      if (p.armorItem && !isLoadoutArmor(p) && p.armor > p.armorMax * 0.3) this.dropItem(p.armorItem, 1, x, y, z);
      // the backpack goes down with what was in it (its pockets were emptied with the rest above)
      if (p.backpackItem && !isLoadoutBackpack(p)) this.dropItem(p.backpackItem, 1, x, y, z, { spread: 1.2 });
    }
    p.backpackItem = 0;
    s.ammo = AMMO_ITEMS.map(() => 0);
    p.invDirty = true;
  },

  // give an item to a player (pickup / craft / search). Returns number taken.
  giveItem(p, item, count, mag) {
    const s = p.state;
    const def = ITEM_DEFS[item];
    if (!def) return 0;
    if (def.cat === 'schem') {
      this.unlockSchematic(item, p);
      return count;
    }
    // a pack of cards is opened there and then: its cards go into their collection, and it takes no slot
    if (def.cat === 'card') return this.cards.openPack(p, item, count);
    // ammunition is carried apart from the backpack, up to AMMO_MAX of a calibre: what a full reserve has no room for
    // is left where it is
    if (def.cat === 'ammo') {
      const take = Math.max(0, Math.min(AMMO_MAX[def.ammo] - s.ammo[def.ammo], count));
      s.ammo[def.ammo] += take;
      return take;
    }
    if (def.cat === 'weapon') {
      const slot = WEAPONS[item].slot;
      if (!s.weapons[slot]) {
        s.weapons[slot] = item;
        setSlotMag(s, slot, mag ?? WEAPONS[item].mag);
        return 1;
      }
      // store in inventory (keeps its mag)
      const i = freeSlot(p.inv, invCap(p));
      if (i < 0) return 0;
      p.inv[i] = { item, count: 1, mag: mag ?? (isFirearm(item) ? WEAPONS[item].mag : 0) };
      p.invDirty = p.invSort = true;
      return 1;
    }
    if (def.cat === 'armor' && mag) {
      // a worn vest that was dropped comes back with the points it had left, not as a new one
      const i = freeSlot(p.inv, invCap(p));
      if (i < 0) return 0;
      p.inv[i] = { item, count: 1, mag };
      p.invDirty = p.invSort = true;
      return 1;
    }
    const left = addItem(p.inv, item, count, invCap(p));
    const taken = count - left;
    if (taken > 0) {
      p.invDirty = p.invSort = true;
      if (THROW_ITEMS.includes(item) && !s.weapons[SLOT_THROW]) s.weapons[SLOT_THROW] = item;
      this.syncThrow(p);
      if (def.cat === 'part') this.notify(NOTIFY.SUPPLY_FOUND, item);
    }
    return taken;
  },

  // give, or drop at the player's feet what does not fit
  giveOrDrop(p, item, count) {
    const taken = this.giveItem(p, item, count);
    if (taken > 0) this.pickupEvent(p, item, taken);
    if (taken < count) {
      const s = p.state;
      this.dropItem(item, count - taken, s.x, s.y, s.z, { spread: 0.8 });
      this.notify(NOTIFY.INVENTORY_FULL, ITEM_DEFS[item]?.cat === 'ammo' ? item : 0, p.id); // (ammo: that reserve is full)
    }
  },

  unlockSchematic(item, p) {
    const bit = SCHEM_BIT[item];
    if (bit === undefined || this.unlocked & (1 << bit)) return;
    this.unlocked |= 1 << bit;
    this.notify(NOTIFY.SCHEMATIC, item);
    this.track.schematic(item, p);
    if (p) this.sound(SOUND.CRAFT, p.state.x, p.state.y + 1, p.state.z, 20);
    this.globalDirty = true;
  },

  syncThrow(p) {
    const s = p.state;
    if (s.weapons[SLOT_THROW]) {
      s.throwCount = countItem(p.inv, s.weapons[SLOT_THROW]);
      if (s.throwCount > 0) return;
      s.weapons[SLOT_THROW] = 0;
    }
    // (none in the slot, or the last of it gone: the first throwable in the pack takes its place)
    for (const it of THROW_ITEMS) {
      const n = countItem(p.inv, it);
      if (n > 0) {
        s.weapons[SLOT_THROW] = it;
        s.throwCount = n;
        break;
      }
    }
  },

  pickupEvent(p, item, count) {
    this.emit(
      (w) => {
        w.u8(EVT.PICKUP);
        w.u8(item);
        w.u16(count);
      },
      { to: p.id },
    );
    p.invDirty = true;
  },

  updateItems(dt) {
    // auto-pickup of materials / ammo / consumables the survivors walk over
    if (this.tick % 4 === 0) {
      for (const p of this.players.values()) {
        if (!p.alive || p.zombie || p.downed) continue;
        const s = p.state;
        for (let i = this.items.length - 1; i >= 0; i--) {
          const e = this.items[i];
          if (!e || e.removed) continue;
          const dx = e.x - s.x;
          const dz = e.z - s.z;
          // what this survivor put down themselves stays down while they stand by it (to clear a slot, to hand it to
          // a teammate): once they have walked off it is a stack like any other, for them too
          if (e.droppedBy === p.id) {
            if (dx * dx + dz * dz <= DROP_LEAVE_DIST * DROP_LEAVE_DIST) continue;
            e.droppedBy = 0;
          }
          if (dx * dx + dz * dz > 1.9 * 1.9 || Math.abs(e.y - s.y) > 1.6) continue;
          if (this.time < e.noAutoUntil) continue;
          const cat = ITEM_DEFS[e.item]?.cat;
          if (!AUTO_PICKUP[cat] || !this.canReachEnt(p, e)) continue;
          const taken = this.giveItem(p, e.item, e.count, e.mag);
          if (taken <= 0) {
            e.noAutoUntil = this.time + 3;
            // No room in the backpack (ammo is another matter: a full reserve). Say so, or the survivor walks on
            // without knowing: always for a car supply, the run depends on those; for the rest only as they walk
            // over it, not again and again while they stand in a pile of it.
            const part = cat === 'part';
            if (cat !== 'ammo' && this.time - (part ? p.partFullT : p.fullT) >= FULL_NOTICE_EVERY && (part || s.vx * s.vx + s.vz * s.vz > 1)) {
              p.fullT = this.time;
              if (part) p.partFullT = this.time;
              this.notify(NOTIFY.INVENTORY_FULL, e.item, p.id);
            }
            continue;
          }
          this.pickupEvent(p, e.item, taken);
          e.count -= taken;
          if (e.count <= 0) this.removeItemEnt(e);
          else e.noAutoUntil = this.time + 3;
        }
      }
    }
    // despawn dropped items, respawn loot points slowly when nobody is watching
    if (this.tick % 10 !== 0) return;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const e = this.items[i];
      if (this.time > e.despawnAt) this.removeItemEnt(e);
    }
    const humans = this.humans();
    for (const lp of this.lootPoints) {
      if (lp.ent || this.time < lp.respawnAt || lp.respawnAt === 0) continue;
      let seen = false;
      for (const h of humans) {
        if (Math.hypot(h.state.x - lp.x, h.state.z - lp.z) < 30) {
          seen = true;
          break;
        }
      }
      if (!seen) this.spawnLoot(lp);
    }
  },
};
