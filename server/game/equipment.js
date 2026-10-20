// What a survivor does with what they carry: wearing and swapping (useItem on armour, a backpack or a weapon in the
// grid, unequip, wornGear), using a consumable over its time (useItem, finishUse, endUse) and taking back the last
// thing they put down (undoDrop).
import { FLASHLIGHT_MAX, SLOT_THROW, SLOT_BUILD, INVENTORY_SIZE } from '../../shared/constants.js';
import { ITEM_DEFS, WEAPONS, CONSUMABLES, useWasted, SOUND, NOTIFY, salvageOf } from '../../shared/defs.js';
import { WORN, WORN_DO, UNDO_NO } from '../../shared/protocol.js';
import { DRAW_TIME } from '../../shared/playersim.js';
import { canPair, isDual, DUAL_BIT } from '../../shared/akimbo.js';
import { invCap, removeItem, takeFrom, countItem, freeSlot, slotMag, setSlotMag } from '../inventory.js';
import { playerMods } from '../loadouts.js';

// ACT.UNDO_DROP: how long after a drop (s) it can be taken back, and how far from it (m) its dropper may have moved.
// The client offers it for 5 s; the rest is the round trip
const UNDO_DROP_TIME = 6;
const UNDO_DROP_REACH = 5;

export const methods = {
  // A pair (shared/akimbo.js) in weapon slot `slot` taken apart: the slot keeps one of the guns and its half of the
  // rounds, and the other is returned ({ item, mag }) for the caller to put somewhere. Null when the slot holds no pair
  splitPair(p, slot) {
    const s = p.state;
    if (!isDual(s, slot)) return null;
    const m = slotMag(s, slot);
    const off = m >> 1;
    s.dual &= ~DUAL_BIT[slot];
    setSlotMag(s, slot, m - off);
    if (s.slot === slot) s.reloadT = 0; // (a pair's reload must not finish on one gun)
    return { item: s.weapons[slot], mag: off };
  },

  // ...and the other gun into the backpack, or down at their feet when there is no room for it there
  splitPairOff(p, slot) {
    const off = this.splitPair(p, slot);
    if (!off) return;
    const i = freeSlot(p.inv, invCap(p));
    if (i >= 0) {
      p.inv[i] = { item: off.item, count: 1, mag: off.mag };
      p.invDirty = p.invSort = true;
    } else this.dropItem(off.item, 1, p.state.x, p.state.y, p.state.z, { spread: 0.5, mag: off.mag });
  },

  // A weapon out of its slot into the backpack (the inventory's Equipment panel: a click, or a drag onto the grid):
  // into backpack index `to` if that is free, else the first free one (255: any). Onto a weapon for the same slot it
  // is the swap a click on that one makes (useItem). The throwable slot only points at a stack in the backpack: no.
  // Out of a pair, one of its guns goes and the other stays in the hand.
  unequip(p, slot, to) {
    const s = p.state;
    if (slot > SLOT_BUILD || slot === SLOT_THROW) return;
    const wpn = s.weapons[slot];
    if (!wpn) return;
    const there = p.inv[to];
    if (there && WEAPONS[there.item]?.slot === slot) return this.useItem(p, to);
    const cap = invCap(p); // (never into a locked slot: past the capacity)
    const i = to < cap && !there ? to : freeSlot(p.inv, cap);
    if (i < 0) return this.notify(NOTIFY.INVENTORY_FULL, 0, p.id);
    const off = this.splitPair(p, slot);
    if (off) {
      p.inv[i] = { item: off.item, count: 1, mag: off.mag };
      p.invDirty = true;
      return;
    }
    // (it keeps its magazine, as a weapon stored in the backpack does)
    p.inv[i] = { item: wpn, count: 1, mag: slotMag(s, slot), ...(p.loadoutWeapons[slot] ? { loadout: p.loadoutWeapons[slot] } : {}) };
    p.loadoutWeapons[slot] = null;
    s.weapons[slot] = 0;
    setSlotMag(s, slot, 0);
    if (s.slot === slot) s.reloadT = 0; // (a reload under way must not finish on an empty hand)
    p.invDirty = true;
  },

  useItem(p, idx) {
    const it = idx < invCap(p) ? p.inv[idx] : null;
    if (!it) return;
    const s = p.state;
    const def = ITEM_DEFS[it.item];
    if (!def) return;
    if (p.downed) return; // (only a teammate gets a downed survivor back up: nothing in their own pack does)
    if (def.cat === 'cons') {
      const c = CONSUMABLES[it.item];
      if (!c || useWasted(it.item, { hp: p.hp, maxHp: p.maxHp, battery: p.battery, downed: p.downed, stamina: s.stamina, exhausted: s.exhausted })) return;
      if (s.pet) this.cm.put(p); // (the hands go to it: the cat in them is set down first)
      // The hands go onto it (s.using: no weapon goes off until it is used up or put away, simulatePlayer) from the
      // client's next command on, which is where its prediction has them go: it sends every command it has made
      // before it asks (Game.useConsumable), so that is the one after the newest that has come in. Those still
      // waiting to be run are run without it (processInputs); with none waiting, that is now.
      p.useItem = { item: it.item, t: 0, total: c.time * playerMods(p).useTime, from: (p.recvSeq + 1) & 0xffff, idx };
      if (!p.cmdQueue.length) {
        s.using = 1;
        p.shadow.using = 1; // (the client did the same after the same command: nothing to rebase it on)
      }
      p.hold = null;
      // a can is cracked as the drink starts; the drinker heard their own at once (Game.quickDrink)
      if (c.drink) this.sound(SOUND.DRINK, s.x, s.y + 1.5, s.z, 12, p.id);
      return;
    }
    if (def.cat === 'armor') {
      // the vest taken off goes into the backpack with the points it has left (`mag`, as a stored weapon keeps its
      // magazine), whatever its condition: it is neither made new nor thrown away. No `mag` is a new vest
      p.inv[idx] = p.armorItem && p.armor > 0 ? { item: p.armorItem, count: 1, mag: p.armor, ...(p.loadoutArmor ? { loadout: p.loadoutArmor } : {}) } : null;
      p.armorItem = it.item;
      p.armor = it.mag || def.armor;
      p.armorMax = def.armor;
      p.loadoutArmor = it.loadout || null;
      p.invDirty = true;
      return;
    }
    if (def.cat === 'pack') {
      // on it goes; one worn till now takes its place in the grid (one for another: the capacity stays as it was)
      p.inv[idx] = p.backpackItem ? { item: p.backpackItem, count: 1, ...(p.loadoutBackpack ? { loadout: p.loadoutBackpack } : {}) } : null;
      p.backpackItem = it.item;
      p.loadoutBackpack = it.loadout || null;
      p.invDirty = true;
      return;
    }
    if (def.cat === 'weapon') {
      const slot = WEAPONS[it.item].slot;
      const cur = s.weapons[slot];
      if (cur === it.item && canPair(cur) && !it.loadout && !p.loadoutWeapons[slot]) {
        // the same gun again onto the one in its slot: the two are a pair, their magazines one (onto a pair already:
        // nothing - two is all there are hands for)
        if (isDual(s, slot)) return;
        s.dual |= DUAL_BIT[slot];
        setSlotMag(s, slot, slotMag(s, slot) + (it.mag || 0));
        p.inv[idx] = null;
        s.slot = slot;
        s.switchT = DRAW_TIME;
        s.reloadT = 0;
        p.invDirty = true;
        return;
      }
      // a pair swapped for another gun: both of its guns go into the backpack, so it takes a second free slot
      if (isDual(s, slot)) {
        const j = freeSlot(p.inv, invCap(p));
        if (j < 0) return this.notify(NOTIFY.INVENTORY_FULL, 0, p.id);
        const off = this.splitPair(p, slot);
        p.inv[j] = { item: off.item, count: 1, mag: off.mag };
      }
      const curMag = slotMag(s, slot);
      const curLoadout = p.loadoutWeapons[slot] || null;
      s.weapons[slot] = it.item;
      p.loadoutWeapons[slot] = it.loadout || null;
      setSlotMag(s, slot, it.mag || 0);
      p.inv[idx] = cur ? { item: cur, count: 1, mag: curMag, ...(curLoadout ? { loadout: curLoadout } : {}) } : null;
      s.slot = slot;
      s.switchT = 0.42;
      s.reloadT = 0;
      p.invDirty = true;
      return;
    }
    if (def.cat === 'throw') {
      s.weapons[SLOT_THROW] = it.item;
      this.syncThrow(p);
      return;
    }
  },

  // ACT.WORN: the armor or the backpack being worn (which: WORN.*) taken off into the grid, dropped in front of the
  // player, or salvaged (salvageOf: about half its recipe back). The backpack holds up its own pockets: while
  // anything is in a slot past INVENTORY_SIZE it does not come off at all - spilling them on the ground would be
  // easy to do by accident in a fight.
  wornGear(p, which, what) {
    const pack = which === WORN.BACKPACK;
    const item = pack ? p.backpackItem : which === WORN.ARMOR ? p.armorItem : 0;
    if (!item) return;
    if (pack && p.inv.some((x, i) => x && i >= INVENTORY_SIZE)) return this.notify(NOTIFY.POCKETS, 0, p.id);
    const s = p.state;
    const mag = pack ? 0 : Math.ceil(p.armor); // (a vest keeps its points, as one taken off for another does)
    const marker = pack ? p.loadoutBackpack : p.loadoutArmor;
    if (what === WORN_DO.OFF) {
      // into a slot it can stay in: with the backpack off, one past INVENTORY_SIZE is a locked one
      const i = freeSlot(p.inv, pack ? INVENTORY_SIZE : invCap(p));
      if (i < 0) return this.notify(NOTIFY.INVENTORY_FULL, 0, p.id);
      p.inv[i] = pack ? { item, count: 1, ...(marker ? { loadout: marker } : {}) } : { item, count: 1, mag, ...(marker ? { loadout: marker } : {}) };
    } else if (what === WORN_DO.DROP) {
      if (marker) return;
      // (no entity id left for it on the ground: it stays on)
      const dropped = this.dropInFront(p, item, 1, { spread: 0.2, mag: mag || undefined });
      if (!dropped) return;
      p.lastDrop = { e: dropped, t: this.time };
    } else if (what !== WORN_DO.SALVAGE || marker || !salvageOf(item)) return;
    if (pack) p.backpackItem = 0;
    else p.armorItem = p.armor = p.armorMax = 0;
    if (pack) p.loadoutBackpack = null;
    else p.loadoutArmor = null;
    // (taken off before what it gives back is handed over: none of it may land in pockets that are gone)
    if (what === WORN_DO.SALVAGE) {
      const back = salvageOf(item);
      for (const k in back) this.giveOrDrop(p, +k, back[k]);
      this.sound(SOUND.CRAFT, s.x, s.y + 1, s.z, 15);
    }
    p.invDirty = true;
  },

  // ACT.UNDO_DROP: the last thing this survivor put down from the inventory (p.lastDrop) back in their hands, as a
  // pickup of it would put it there. Only their own last drop, within UNDO_DROP_TIME, while it still lies there (a
  // teammate may have taken it, or some of it) and they are within UNDO_DROP_REACH of it. What finds no room stays down.
  undoDrop(p) {
    const d = p.lastDrop;
    p.lastDrop = null;
    if (!d) return;
    const e = d.e;
    if (e.removed || e.count <= 0) return this.notify(NOTIFY.UNDO_GONE, UNDO_NO.GONE, p.id);
    if (this.time - d.t > UNDO_DROP_TIME) return this.notify(NOTIFY.UNDO_GONE, UNDO_NO.LATE, p.id);
    const s = p.state;
    if (Math.hypot(e.x - s.x, e.z - s.z) > UNDO_DROP_REACH) return this.notify(NOTIFY.UNDO_GONE, UNDO_NO.FAR, p.id);
    const taken = this.giveItem(p, e.item, e.count, e.mag);
    if (taken <= 0) return this.notify(NOTIFY.INVENTORY_FULL, ITEM_DEFS[e.item]?.cat === 'ammo' ? e.item : 0, p.id);
    this.pickupEvent(p, e.item, taken);
    e.count -= taken;
    if (e.count <= 0) this.removeItemEnt(e);
  },

  // An item use over, done or not: the hands are free again. (The simulation's `using` is never sent on its own: the
  // client reads it off the item in use in the status (writeSelf), which only names one while `using` is up. So the
  // use is never dropped without it: here, or the simulation's 'use_cancel', which put it down first)
  endUse(p) {
    p.useItem = null;
    p.state.using = 0;
  },

  finishUse(p) {
    const u = p.useItem;
    this.endUse(p);
    p.state.switchT = DRAW_TIME; // the weapon comes back out
    if (countItem(p.inv, u.item) <= 0) return;
    const c = CONSUMABLES[u.item];
    // from the stack it was taken from (the one clicked in the grid; [H] and [B] ask for the smallest, as removeItem
    // takes), if that still holds it, and what is left consolidated either way
    if (p.inv[u.idx]?.item === u.item) takeFrom(p.inv, u.idx, 1);
    else removeItem(p.inv, u.item, 1);
    this.track.used(p, u.item);
    p.invDirty = true;
    if (c.heal) p.hp = Math.min(p.maxHp, p.hp + c.heal);
    if (c.stamina) {
      p.state.stamina = 100;
      p.state.exhausted = 0;
    }
    if (c.flashlight) p.battery = FLASHLIGHT_MAX;
    if (!c.drink) this.sound(c.food ? SOUND.EAT : SOUND.HEAL, p.state.x, p.state.y + 1, p.state.z, 12);
  },
};
