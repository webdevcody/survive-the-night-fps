// Crafting: what a survivor can make where they stand (a lit fire, a workbench, the schematics found: craftCtx), how a
// cost is paid with the materials short of it made on the way (planFor: shared/autocraft.js; client/game/bulkcraft.js
// repeats these rules for its own model of the pack), and tearing things down for parts (salvage).
import { CRAFT_STATION_RADIUS, SLOT_THROW, SLOT_BUILD, INVENTORY_MAX } from '../../shared/constants.js';
import { ITEM_DEFS, WEAPONS, RECIPE_BY_ID, SALVAGE, STRUCT_DEFS, SCHEM_BIT, AMMO_MAX, AMMO_ITEMS, SOUND, NOTIFY, isFirearm } from '../../shared/defs.js';
import { SALVAGE_FROM } from '../../shared/protocol.js';
import { invCap, addItem, takeFrom, countsMap, payCost, canFit, freeSlot, slotMag, setSlotMag } from '../inventory.js';
import { planCost } from '../../shared/autocraft.js';
import { isLoadoutArmor, isLoadoutStack, isLoadoutWeapon } from '../loadouts.js';

export const methods = {
  // nearest structure of a crafting station kind ('fire' needs to be lit)
  nearStation(p, kind) {
    const s = p.state;
    for (const e of this.structures) {
      const def = STRUCT_DEFS[e.stype];
      if (def.station !== kind) continue;
      if (kind === 'fire' && e.burnLeft <= 0) continue;
      if (Math.hypot(e.x - s.x, e.z - s.z) <= CRAFT_STATION_RADIUS) return e;
    }
    return null;
  },

  // what player p could craft with right here: { fire, bench, unlocked } (planCost, shared/autocraft.js)
  craftCtx(p) {
    return { fire: !!this.nearStation(p, 'fire'), bench: !!this.nearStation(p, 'bench'), unlocked: this.unlocked };
  },

  // how p pays `cost`, the materials short of it made from what they are made of (planCost); null: p cannot
  planFor(p, cost) {
    return planCost(countsMap(p.inv), cost, this.craftCtx(p));
  },

  // What a plan's batches made beyond what it took (ten Nails for the four a wall needs), once its `take` is paid and
  // what was bought handed over: into the pack where addItem puts it (craftRun in client/game/bulkcraft.js puts it
  // in the same place), and at p's feet what does not fit
  madeExtra(p, plan) {
    for (const k in plan.give) {
      const left = addItem(p.inv, +k, plan.give[k], invCap(p));
      if (left > 0) this.dropItem(+k, left, p.state.x, p.state.y, p.state.z, { spread: 0.8 });
    }
  },

  craft(p, recipeId) {
    const rec = RECIPE_BY_ID.get(recipeId);
    if (!rec) return;
    if (rec.schem && !(this.unlocked & (1 << SCHEM_BIT[rec.schem]))) return this.notify(NOTIFY.LOCKED, rec.schem, p.id);
    if (rec.station && !this.nearStation(p, rec.station)) return this.notify(rec.station === 'fire' ? NOTIFY.NEED_FIRE : NOTIFY.NEED_BENCH, 0, p.id);
    const plan = this.planFor(p, rec.cost);
    if (!plan) {
      this.notify(NOTIFY.NOT_ENOUGH, 0, p.id);
      return;
    }
    if (rec.vehicle) {
      // a vehicle: it stands beside the bench when it is made (server/vehicles.js); nothing goes into the pack
      const no = this.vehicles.build(p, rec.vehicle, true);
      if (no) return this.notify(NOTIFY.VEH_NEED, no, p.id);
      payCost(p.inv, plan.take);
      this.madeExtra(p, plan);
      this.vehicles.build(p, rec.vehicle);
      this.track.craft(p, rec);
      this.ach.crafted(p);
      p.invDirty = true;
      this.sound(SOUND.CRAFT, p.state.x, p.state.y + 1, p.state.z, 15);
      return;
    }
    const def = ITEM_DEFS[rec.out];
    // capacity check
    if (def.cat === 'ammo') {
      if (p.state.ammo[def.ammo] >= AMMO_MAX[def.ammo]) return this.notify(NOTIFY.INVENTORY_FULL, rec.out, p.id);
    } else if (def.cat === 'weapon') {
      const slot = WEAPONS[rec.out].slot;
      if (p.state.weapons[slot] && freeSlot(p.inv, invCap(p)) < 0) return this.notify(NOTIFY.INVENTORY_FULL, 0, p.id);
    } else if (!canFit(p.inv, rec.out, rec.n, invCap(p))) {
      // paying may free slots; do a trial
      const copy = p.inv.map((x) => (x ? { ...x } : null));
      payCost(copy, plan.take);
      if (!canFit(copy, rec.out, rec.n, invCap(p))) return this.notify(NOTIFY.INVENTORY_FULL, 0, p.id);
    }
    payCost(p.inv, plan.take);
    const sorting = p.invSort;
    const taken = this.giveItem(p, rec.out, rec.n);
    this.madeExtra(p, plan);
    p.invSort = sorting; // (a craft lands where the client's model of it puts it, bulkcraft.js: it is not a pickup)
    // rounds the reserve has no room for were paid for all the same: they go on the ground instead of nowhere
    if (def.cat === 'ammo' && taken < rec.n) {
      this.dropItem(rec.out, rec.n - taken, p.state.x, p.state.y, p.state.z, { spread: 0.8 });
      this.notify(NOTIFY.INVENTORY_FULL, rec.out, p.id);
    }
    this.track.craft(p, rec);
    this.ach.crafted(p);
    p.invDirty = true;
    this.syncThrow(p);
    this.sound(SOUND.CRAFT, p.state.x, p.state.y + 1, p.state.z, 15);
  },

  // Tear something down for what it is made of (SALVAGE): n of the stack at backpack index `from`, or what is in a
  // weapon slot or worn (SALVAGE_FROM). What comes of it goes into the pack, and at their feet what does not fit.
  salvage(p, from, n) {
    const s = p.state;
    let item = 0;
    let mag = 0; // rounds in a gun's magazine: they go back into the pack
    if (from < INVENTORY_MAX) {
      const it = from < invCap(p) ? p.inv[from] : null;
      if (!it || isLoadoutStack(it) || !SALVAGE[it.item] || n < 1) return;
      item = it.item;
      mag = it.mag || 0; // (a weapon is a stack of one)
      n = takeFrom(p.inv, from, n); // (what is left of that item consolidated)
    } else if (from === SALVAGE_FROM.ARMOR) {
      if (isLoadoutArmor(p) || !SALVAGE[p.armorItem]) return;
      item = p.armorItem;
      n = 1;
      p.armorItem = 0;
      p.armor = 0;
      p.armorMax = 0;
    } else {
      // (the throwable slot only points at a stack in the backpack: that is torn down from there)
      const slot = from - SALVAGE_FROM.WEAPON;
      if (slot < 0 || slot > SLOT_BUILD || slot === SLOT_THROW || isLoadoutWeapon(p, slot) || !SALVAGE[s.weapons[slot]]) return;
      item = s.weapons[slot];
      n = 1;
      // (out of a pair one gun is torn down, with its half of the rounds, and the other stays in the hand)
      const off = this.splitPair(p, slot);
      if (off) mag = off.mag;
      else {
        mag = slotMag(s, slot);
        s.weapons[slot] = 0;
        setSlotMag(s, slot, 0);
      }
    }
    p.invDirty = true;
    this.ach.salvaged(p, n);
    for (const k in SALVAGE[item]) this.giveOrDrop(p, +k, SALVAGE[item][k] * n);
    if (mag > 0 && isFirearm(item)) this.giveOrDrop(p, AMMO_ITEMS[WEAPONS[item].ammo], mag);
    this.syncThrow(p);
    this.sound(SOUND.CRAFT, s.x, s.y + 1, s.z, 15, p.id); // (they hear their own at once: Game.uiCallbacks)
  },
};
