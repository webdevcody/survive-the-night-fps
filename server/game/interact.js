// [E] on something in the world: a quick press (interact: picking up, breaking a crate open, the car's supplies,
// feeding a fire, lifting the cat) and a hold (holdBegin, updateHold: searching a container, reviving a teammate,
// starting the engine and driving off, and the holds the fixtures, the fair, the mounted gun and the vehicles own).
// What is in reach is what a client is offered the prompt on (pickY, reachOf, canReachEnt), with some slack.
import { ESCAPE_DRIVE_TIME, REVIVE_TIME, SEARCH_TIME, ENGINE_START_TIME, INTERACT_REACH, PICK_RADIUS, MATE_PICK_Y, INTERACT_SLACK, HOLD_SLACK, EYE_HEIGHT } from '../../shared/constants.js';
import { ITEM, ITEM_DEFS, WEAPONS, STRUCT, STRUCT_DEFS, structPickRadius, CAMPFIRE_FUEL, CAMPFIRE_MAX_FUEL, LOOT_TABLES, SCHEMATICS, SCHEM_BIT, CONT, CONT_DEFS, CONT_TABLES, loadedAmmo, SOUND, NOTIFY, ZONE } from '../../shared/defs.js';
import { ENT, HOLD, CAR_ID, FAIR_GEN_ID, FAIR_TANK_ID, SIPHON_ID } from '../../shared/protocol.js';
import { PLANE_REACH } from '../../shared/acts.js';
import { PRY, pryTime } from '../../shared/trunk.js';
import { eyeHeight } from '../../shared/playersim.js';
import { canReach } from '../../shared/collision.js';
import { removeItem, countItem, slotMag, setSlotMag } from '../inventory.js';
import { GUN, GUN_LYING } from '../../shared/mountedgun.js';
import { playerMods } from '../loadouts.js';
import { CRATE_TABLE } from './supplydrops.js';

export const methods = {
  // (the plane is a bigger thing to stand beside than the car: PLANE_REACH further)
  nearCar(p, r = 5) {
    const s = p.state;
    const car = this.world.car;
    return Math.hypot(s.x - car.x, s.z - car.z) <= r + (car.plane ? PLANE_REACH : 0);
  },

  interact(p, id) {
    if (this.time - p.interactT < 0.15) return;
    p.interactT = this.time;
    const s = p.state;
    const ex = s.x;
    const ey = s.y + eyeHeight(s);
    const ez = s.z;
    if (id === CAR_ID) {
      if (!this.nearCar(p)) return;
      let installed = 0;
      this.sup.items.forEach((item, i) => {
        const need = this.sup.need[i] - this.supplies[i];
        if (need <= 0) return;
        const have = countItem(p.inv, item);
        const n = Math.min(need, have);
        if (n <= 0) return;
        removeItem(p.inv, item, n);
        this.supplies[i] += n;
        installed += n;
        this.track.install(p, item, n);
        this.notify(NOTIFY.CAR_PART, item);
      });
      const car = this.world.car;
      if (installed) {
        p.invDirty = true;
        this.sound(SOUND.CAR_PART, car.x, 0.8, car.z, 40);
        this.globalDirty = true;
        if (this.allSuppliesIn()) this.notify(NOTIFY.SUPPLIES_DONE, 0);
      } else if (!this.allSuppliesIn()) this.notify(NOTIFY.NEED_SUPPLIES, 0, p.id);
      return;
    }
    if (id === FAIR_TANK_ID) return this.fair.topUp(p);
    const e = this.ents[id];
    if (!e || e.removed) return;
    const dx = e.x - ex;
    const dz = e.z - ez;
    const dy = this.pickY(e) - ey;
    const d = Math.hypot(dx, dz);
    const reach = this.reachOf(e);
    if (d > reach || Math.abs(dy) > reach) return;
    if (!this.canReachEnt(p, e)) return;
    if (e.kind === ENT.ITEM) {
      const taken = this.giveItem(p, e.item, e.count, e.mag);
      if (taken <= 0) {
        // weapon slot full & inventory full: swap weapon
        const def = ITEM_DEFS[e.item];
        if (def && def.cat === 'weapon') {
          const slot = WEAPONS[e.item].slot;
          const old = s.weapons[slot];
          // (a pair goes down as its two guns)
          const off = this.splitPair(p, slot);
          if (off) this.dropItem(off.item, 1, s.x, s.y, s.z, { mag: off.mag, spread: 0.5 });
          const oldMag = slotMag(s, slot);
          // (the weapon in hand goes down first: with no entity id left for it there is no swap, and it is kept)
          if (old && !this.dropItem(old, 1, s.x, s.y, s.z, { mag: oldMag, spread: 0.5 })) return this.notify(NOTIFY.INVENTORY_FULL, 0, p.id);
          s.weapons[slot] = e.item;
          if (s.slot === slot) s.reloadT = 0; // a reload of the weapon swapped out must not finish on this one
          setSlotMag(s, slot, e.mag);
          this.removeItemEnt(e);
          this.pickupEvent(p, e.item, 1);
        } else {
          this.notify(NOTIFY.INVENTORY_FULL, def?.cat === 'ammo' ? e.item : 0, p.id); // (ammo: that reserve is full)
        }
        return;
      }
      this.pickupEvent(p, e.item, taken);
      e.count -= taken;
      if (e.count <= 0) this.removeItemEnt(e);
      return;
    }
    if (e.kind === ENT.CRATE) {
      if (e.state !== 1) return;
      e.state = 2;
      e.despawnAt = this.time + 180;
      if (e.gun) {
        // one of the gun crates at the start of a game begun on the mainland (startCrates)
        this.openGunCrate(e);
        this.sound(SOUND.WOOD_BREAK, e.x, e.y + 0.5, e.z, 30);
        return;
      }
      this.track.crateOpened(p);
      const n = 5 + Math.floor(this.rng() * 3);
      for (let i = 0; i < n; i++) {
        const [item, cnt] = this.rollTable(CRATE_TABLE);
        this.dropItem(item, cnt, e.x, e.y, e.z, { spread: 1.4 + this.rng() * 1.2, life: 400 });
      }
      // supply drops often carry a schematic the team is still missing
      const missing = SCHEMATICS.filter((it) => !(this.unlocked & (1 << SCHEM_BIT[it])));
      if (missing.length && this.rng() < 0.45) this.dropItem(missing[Math.floor(this.rng() * missing.length)], 1, e.x, e.y, e.z, { spread: 1 });
      this.sound(SOUND.WOOD_BREAK, e.x, e.y + 0.5, e.z, 30);
      return;
    }
    if (e.kind === ENT.CACHE) {
      this.holdBegin(p, e.id);
      return;
    }
    if (e.kind === ENT.CAT) {
      this.cm.lift(p, e); // the stray cat, into their arms (cats.js)
      return;
    }
    if (e.kind === ENT.STRUCTURE) {
      if (e.stype === STRUCT.CAMPFIRE) return this.feedFire(p, e);
      if (this.power.interact(p, e)) return; // (a generator takes fuel)
      this.repair(p, e.id);
    }
  },

  // height of the entity's interaction point (as the client picks it)
  pickY(e) {
    if (e.kind === ENT.ITEM) return e.y + 0.15;
    if (e.kind === ENT.CRATE) return e.y + 0.6;
    if (e.kind === ENT.STRUCTURE) return e.y + Math.min(1, STRUCT_DEFS[e.stype].sy * 0.5);
    if (e.kind === ENT.PLAYER) return e.y + (e.downed ? 0.3 : MATE_PICK_Y); // (one down is lying there; a teammate on their feet is aimed at chest high: Dead Hand's [E])
    if (e.kind === ENT.CAT) return e.y + 0.18;
    if (e.kind === ENT.GUN && e.mode === GUN_LYING) return e.y - GUN.pivotY + 0.3; // (on its side on the ground)
    return e.y;
  },

  // How far away the entity can be interacted with: as far as a client can be offered [E] on it (its view ray passes
  // within the pick radius of the interaction point, inside INTERACT_REACH of the eye), and INTERACT_SLACK beyond,
  // because our copy of the player trails the one that client looks out of. Never less: a refusal is silent, so
  // the player would be holding [E] on a prompt with nothing happening
  reachOf(e) {
    const r = e.kind === ENT.ITEM ? PICK_RADIUS.ITEM : e.kind === ENT.CACHE ? PICK_RADIUS.CACHE : e.kind === ENT.CRATE ? PICK_RADIUS.CRATE : e.kind === ENT.STRUCTURE ? structPickRadius(e.stype) : e.kind === ENT.CAT ? PICK_RADIUS.CAT : e.kind === ENT.PLAYER && !e.downed ? PICK_RADIUS.MATE : PICK_RADIUS.DOWNED;
    return Math.hypot(INTERACT_REACH, r) + INTERACT_SLACK;
  },

  // eye -> the entity's interaction point isn't cut off by a wall
  canReachEnt(p, e) {
    const s = p.state;
    return canReach(this.world, s.x, s.y + eyeHeight(s), s.z, e.x, this.pickY(e), e.z, s.y + EYE_HEIGHT);
  },

  feedFire(p, e) {
    if (e.burnLeft >= CAMPFIRE_MAX_FUEL - 5) return;
    let item = 0;
    if (countItem(p.inv, ITEM.WOOD) > 0) item = ITEM.WOOD;
    else if (countItem(p.inv, ITEM.STICK) > 0) item = ITEM.STICK;
    if (!item) return this.notify(NOTIFY.NOT_ENOUGH, ITEM.STICK, p.id);
    removeItem(p.inv, item, 1);
    p.invDirty = true;
    const wasOut = e.burnLeft <= 0;
    e.burnLeft = Math.min(CAMPFIRE_MAX_FUEL, Math.max(0, e.burnLeft) + CAMPFIRE_FUEL[item]);
    e.state = 1;
    e.hp = e.maxHp;
    this.sound(SOUND.CAMPFIRE_ADD, e.x, e.y + 0.4, e.z, 30);
    if (wasOut) this.notify(NOTIFY.CAMPFIRE_LIT, p.id, p.id);
  },
  holdBegin(p, id) {
    const s = p.state;
    if (p.useItem) return;
    if (id === CAR_ID) {
      if (!this.nearCar(p)) return;
      if (this.escape.active) {
        // once the engine is warm the same hold gets in and drives: the run does not end until somebody does
        if (this.escape.ready) p.hold = { kind: HOLD.DRIVE, target: CAR_ID, t: 0, need: ESCAPE_DRIVE_TIME };
        return;
      }
      if (!this.allSuppliesIn()) return this.interact(p, CAR_ID);
      p.hold = { kind: HOLD.ENGINE, target: CAR_ID, t: 0, need: ENGINE_START_TIME };
      return;
    }
    if (this.fixtures.owns(id)) return this.fixtures.holdBegin(p, id);
    if (id === FAIR_GEN_ID) return this.fair.holdBegin(p);
    const e = this.ents[id];
    if (!e || e.removed || !this.canReachEnt(p, e)) return;
    if (e.kind === ENT.GUN) return this.gun.holdBegin(p); // lifting the mounted gun
    if (e.kind === ENT.VEHICLE) return this.vehicles.holdBegin(p, e); // fitting a part, pouring fuel in, patching it up
    const d = Math.hypot(e.x - s.x, e.z - s.z);
    if (e.kind === ENT.CACHE) {
      if (d > this.reachOf(e) || e.state !== 0) {
        if (e.state !== 0) this.notify(NOTIFY.SEARCH_EMPTY, 0, p.id);
        return;
      }
      // (a car's boot is forced: longer, by what is in the hand - shared/trunk.js)
      const pry = this.pryOf(p, e);
      p.hold = { kind: HOLD.SEARCH, target: id, t: 0, need: (pry ? pryTime(pry.weapon) : SEARCH_TIME) * playerMods(p).search, pry };
      this.sound(SOUND.SEARCH, e.x, e.y, e.z, 18);
      return;
    }
    if (e.kind === ENT.PLAYER && e !== p && e.alive && e.downed && !e.zombie) {
      if (d > this.reachOf(e)) return;
      if (this.roles.drag(p, e)) return; // (a crouched Runner takes them by the collar instead: server/roles.js)
      p.hold = { kind: HOLD.REVIVE, target: id, t: 0, need: REVIVE_TIME * this.diff.revive * playerMods(p).revive * this.roles.reviveMul(p) };
      e.revivedBy = p.id;
    }
  },

  updateHold(p, dt) {
    const h = p.hold;
    if (!h) return;
    const s = p.state;
    let ok = !p.downed && !p.zombie && p.alive;
    let tgt = null;
    if (ok) {
      if (h.target === CAR_ID) ok = this.nearCar(p, 6) && (h.kind === HOLD.DRIVE ? this.escape.active && this.escape.ready : !this.escape.active);
      else if (this.fixtures.owns(h.target)) ok = this.fixtures.holdOk(p, h);
      else if (h.target === FAIR_GEN_ID) ok = this.fair.holdOk(p, h);
      else if (h.target === SIPHON_ID) ok = this.vehicles.siphonOk(p, h);
      else if (h.kind >= HOLD.VEH_FIX && h.kind <= HOLD.VEH_REPAIR) ok = this.vehicles.holdOk(p, h);
      else {
        tgt = this.ents[h.target];
        if (!tgt || tgt.removed) ok = false;
        else {
          // broken off a little further out than it can start: a hold begun at the edge survives a step back
          const near = Math.hypot(tgt.x - s.x, tgt.z - s.z) < this.reachOf(tgt) + HOLD_SLACK;
          if (h.kind === HOLD.SEARCH) ok = near && tgt.state === 0;
          else if (h.kind === HOLD.REVIVE) ok = near && tgt.alive && tgt.downed && !tgt.zombie;
          else if (h.kind === HOLD.GUN_LIFT) ok = this.gun.holdOk(p);
          ok = ok && this.canReachEnt(p, tgt);
        }
      }
    }
    if (!ok) {
      if (tgt && h.kind === HOLD.REVIVE && tgt.revivedBy === p.id) tgt.revivedBy = 0;
      p.hold = null;
      return;
    }
    h.t += dt;
    if (h.kind === HOLD.REVIVE && tgt) tgt.revivedBy = p.id;
    if (h.pry && h.t >= h.pry.next && h.t < h.need) {
      h.pry.next += PRY.lever;
      this.pryHeave(p, tgt, h.pry);
    }
    if (h.t < h.need) return;
    p.hold = null;
    if (h.kind === HOLD.SEARCH) this.searchCache(p, tgt);
    else if (h.kind === HOLD.REVIVE) this.revive(tgt, p);
    else if (h.kind === HOLD.ENGINE) this.startEngine(p);
    else if (h.kind === HOLD.DRIVE) this.driveOff(p);
    else if (h.kind === HOLD.GUN_LIFT) this.gun.lift(p);
    else if (this.fixtures.owns(h.target)) this.fixtures.holdDone(p, h);
    else if (h.target === FAIR_GEN_ID) this.fair.holdDone(p, h);
    else if (h.target === SIPHON_ID) this.vehicles.siphonDone(p, h);
    else if (h.kind >= HOLD.VEH_FIX && h.kind <= HOLD.VEH_REPAIR) this.vehicles.holdDone(p, h);
  },

  searchCache(p, c) {
    c.state = 1;
    this.track.searched(p, c);
    this.ach.searched(p, c);
    const def = CONT_DEFS[c.ctype];
    const table = (def.table && CONT_TABLES[def.table]) || LOOT_TABLES[c.zone] || LOOT_TABLES[ZONE.ROADSIDE];
    let rolls = def.rolls[0] + Math.floor(this.rng() * (def.rolls[1] - def.rolls[0] + 1));
    if (this.diff.loot > 1) rolls++; // Ember: the first cupboard still pays even if you do not know what you are looking for
    const extra = playerMods(p).extraFind;
    if (extra && this.rng() < extra) rolls++;
    for (let i = 0; i < rolls; i++) {
      const [item, n] = this.rollTable(table);
      this.giveOrDrop(p, item, n);
      // (a strongbox: the gun comes with something to fire)
      const ammo = def.loaded ? loadedAmmo(item, def.loaded) : null;
      if (ammo) this.giveOrDrop(p, ammo[0], ammo[1]);
    }
    for (const [item, n] of def.also || []) this.giveOrDrop(p, item, n);
    if (c.ctype === CONT.STRONGBOX) this.loadouts.containerDrop(p, c.ctype);
    if (c.schem) {
      this.unlockSchematic(c.schem, p);
      this.pickupEvent(p, c.schem, 1);
      c.schem = 0;
    }
    this.sound(SOUND.SEARCH, c.x, c.y, c.z, 20);
    if (c.alarm) {
      c.alarm = false;
      this.triggerCarAlarm(p, c);
    }
  },
};
