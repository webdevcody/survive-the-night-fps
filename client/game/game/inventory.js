// Game: what we carry and what we do with it - the backpack, quick heals and drinks, items used, crafts sent, and the
// inventory screen's callbacks.
import { CRAFT_STATION_RADIUS, INVENTORY_MAX, inventoryCap, STAMINA_MAX } from '../../../shared/constants.js';
import { ITEM, RECIPE_BY_ID, THROW_ITEMS, AMMO_ITEMS, CONSUMABLES, useWasted } from '../../../shared/defs.js';
import { ACT } from '../../../shared/protocol.js';
import { perkMods } from '../../../shared/progress.js';
import { smallestStack } from '../../../shared/stacks.js';

// what [H] reaches for when not badly hurt, in that order; the HUD counts these as the healing left
export const HEAL_ITEMS = [ITEM.BANDAGE, ITEM.TUNA, ITEM.VENISON, ITEM.PAINKILLERS, ITEM.MEDKIT];
// A bulk craft is one ACT.CRAFT per craft. The server drops whatever a client sends past 200 messages in a second,
// commands included (Game.onMessage), so the repeats leave through a bucket: a whole Ctrl+click at once, and when
// clicks pile up on top of that, the rest over the next ticks.
export const CRAFT_BURST = 20;
const CRAFT_RATE = 40; // per second

export const methods = {
  onInventory(r) {
    const slots = this.inventory.slots;
    for (let i = 0; i < INVENTORY_MAX; i++) {
      const item = r.u8();
      const count = r.u16();
      slots[i] = item ? { item, count } : null;
    }
    const armorItem = r.u8();
    const armor = r.u8();
    const armorMax = r.u8();
    this.inventory.armor = armorItem ? { item: armorItem, points: armor, max: armorMax } : null;
    this.inventory.backpack = r.u8(); // the backpack worn (0: none): it opens the locked slots of the grid
    this.pushInventoryToUI(true);
  },

  pushInventoryToUI(force = false) {
    const s = this.prediction.state;
    // (the magazines move with every shot: only the open screen shows them)
    const key = `${s.weapons.join(',')}|${s.ammo.join(',')}|${this.ui.inventoryOpen ? s.mags.join(',') : ''}|${s.throwCount}`;
    if (!force && key === this.lastHudInvKey) return;
    this.lastHudInvKey = key;
    const throwCounts = {};
    for (const it of this.inventory.slots) if (it && THROW_ITEMS.includes(it.item)) throwCounts[it.item] = (throwCounts[it.item] || 0) + it.count;
    this.ui.setInventory({ slots: this.inventory.slots, armor: this.inventory.armor, backpack: this.inventory.backpack, ammo: [...s.ammo], weapons: [...s.weapons], mags: [...s.mags], dual: s.dual | 0, throwCounts });
  },

  // what we carry, by item: the backpack, and the ammunition carried apart from it (the reserves we predict)
  invCounts() {
    const m = {};
    for (const it of this.inventory.slots) if (it) m[it.item] = (m[it.item] || 0) + it.count;
    this.prediction.state.ammo.forEach((n, i) => n > 0 && (m[AMMO_ITEMS[i]] = n));
    return m;
  },

  // The weapon that picking up one for this slot would put down: the slot is taken and the pack has no room for a
  // second (the server then swaps them: Game.interact on the server). 0 when it would just go in.
  swapsOut(slot) {
    const held = this.prediction.state.weapons[slot];
    if (!held) return 0;
    const cap = inventoryCap(this.inventory.backpack);
    for (let i = 0; i < cap; i++) if (!this.inventory.slots[i]) return 0;
    return held;
  },

  quickHeal() {
    const inv = this.inventory.slots;
    const hp = this.self.hp;
    if (this.prediction.state.downed) return void this.ui.notify('Only a teammate can get you up', 'warning', 1.5);
    const order = hp < 45 ? [ITEM.MEDKIT, ITEM.VENISON, ITEM.BANDAGE, ITEM.TUNA, ITEM.PAINKILLERS] : HEAL_ITEMS;
    for (const item of order) {
      const idx = smallestStack(inv, item); // (the stack the server would take from: removeItem)
      if (idx >= 0) {
        if (this.useConsumable(idx, item)) this.audio.playLocal(item === ITEM.MEDKIT ? 'heal' : CONSUMABLES[item].meat ? 'eat' : CONSUMABLES[item].food ? 'can_open' : 'bandage');
        return;
      }
    }
    this.ui.notify('No healing items', 'warning', 1.5);
  },

  // The drink key ([B]): an energy drink from the backpack, stamina back in one go (the server turns one down at full stamina).
  // idx: the backpack slot clicked, when it was not the key
  quickDrink(idx = smallestStack(this.inventory.slots, ITEM.ENERGY_DRINK)) {
    const s = this.prediction.state;
    if (s.zombie || s.downed || s.using || this.self.useItem) return;
    if (idx < 0) return void this.ui.notify('No energy drinks', 'warning', 1.5);
    if (s.stamina >= STAMINA_MAX - 0.5 && !s.exhausted) return void this.ui.notify('Stamina is already full', 'info', 1.5);
    if (this.useConsumable(idx, ITEM.ENERGY_DRINK)) this.audio.playLocal('drink');
  },

  // Starts using the consumable in backpack slot idx. The hands go onto it from the next command on (no weapon goes
  // off until it is used up or a click puts it away: simulatePlayer), and the server has them go onto it there too:
  // on the first command that reaches it after the request, so every one made before goes out ahead of it
  // (Game.useItem on the server). A use the server would turn down is not asked for at all.
  useConsumable(idx, item) {
    const c = CONSUMABLES[item];
    if (!c) return false;
    const s = this.prediction.state;
    if (useWasted(item, { hp: this.self.hp, maxHp: this.self.maxHp, battery: this.self.battery, downed: s.downed, stamina: s.stamina, exhausted: s.exhausted })) {
      this.ui.notify(c.flashlight ? 'Flashlight battery is full' : s.downed ? 'Only a teammate can get you up' : c.heal ? 'Health is full' : 'Stamina is already full', 'toast', 1.5);
      return false;
    }
    this.sendCommands(0, true);
    this.conn.action(ACT.USE_ITEM, idx);
    this.prediction.startUse();
    this.vm.useItem?.(c.time * perkMods(s.perks).useTime, item);
    return true;
  },

  craftContext() {
    const rp = this.renderPos;
    const st = this.entities.stationsNear(rp.x, rp.z, CRAFT_STATION_RADIUS);
    return { fire: st.fire, bench: st.bench, unlocked: this.global.unlocked | 0 };
  },

  // n more of a craft just asked for (a bulk click in the crafting panel, which has counted what the server will take)
  craftRepeat(id, n) {
    const q = this.craftQueue;
    while (n-- > 0 && q.length < 4 * CRAFT_BURST) q.push(id);
    this.sendCrafts(0);
  },

  // sends the waiting crafts the bucket has room for; called every frame to refill it
  sendCrafts(dt) {
    this.craftBudget = Math.min(CRAFT_BURST, this.craftBudget + dt * CRAFT_RATE);
    const q = this.craftQueue;
    while (q.length && this.craftBudget >= 1) {
      this.conn.action(ACT.CRAFT, q.shift());
      this.craftBudget--;
    }
  },

  uiCallbacks() {
    return {
      onCraft: (id) => {
        this.askedCost = RECIPE_BY_ID.get(id)?.cost;
        this.conn.action(ACT.CRAFT, id);
        this.audio.playLocal('craft', { volume: 0.6 });
      },
      onCraftRepeat: (id, n) => this.craftRepeat(id, n),
      onUseItem: (i) => {
        const it = this.inventory.slots[i];
        if (it && CONSUMABLES[it.item]?.drink) return void this.quickDrink(i); // (that very can)
        const c = it && CONSUMABLES[it.item];
        if (!c) return this.conn.action(ACT.USE_ITEM, i); // (armour, a schematic: taken at once)
        if (this.useConsumable(i, it.item) && c.food) this.audio.playLocal(c.meat ? 'eat' : 'can_open'); // (venison comes in no tin)
      },
      onDropItem: (i, n) => this.conn.action(ACT.DROP_SLOT, i, n),
      onSplitItem: (i, n) => this.conn.action(ACT.SPLIT_INV, i, n),
      onDropAmmo: (cal, n) => this.conn.action(ACT.DROP_AMMO, cal, n),
      onUndoDrop: () => this.conn.action(ACT.UNDO_DROP),
      onSalvage: (from, n) => {
        this.conn.action(ACT.SALVAGE, from, n);
        this.audio.playLocal('craft', { volume: 0.6 }); // (the server's sound leaves us out)
      },
      onSwapItems: (a, b) => this.conn.action(ACT.SWAP_INV, a, b),
      onEquipArmor: (i) => this.conn.action(ACT.EQUIP_ARMOR, i),
      onDropWeapon: (slot) => this.conn.action(ACT.DROP_WEAPON, slot),
      onUnequip: (slot, to = 255) => this.conn.action(ACT.UNEQUIP, slot, to),
      onWorn: (which, what) => this.conn.action(ACT.WORN, which, what),
      onSelectStructure: (t) => this.buildMenu && this.pickStructure(t),
      onHoverStructure: (t) => this.pointBuildMenu(t),
      onSelectThrowable: (item) => this.conn.action(ACT.SELECT_THROWABLE, item),
      onCloseInventory: () => this.state === 'playing' && this.toggleInventory(false),
      onChatSend: (text) => {
        if (this.devCommand(text)) return;
        this.conn.chat(text);
      },
    };
  },
};
