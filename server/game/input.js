// What a client sends to play: its commands (handleInput queues them, processInputs runs them through the shared
// simulation and checks its prediction, handleSimEvent acts on what the simulation says happened) and its actions
// (handleAction: one ACT each - [E], drops, crafting, building, the inventory's moves, pings, waypoints...).
import { SERVER_TICK_RATE, CMD_RATE, PHASE, SLOT_THROW, BTN } from '../../shared/constants.js';
import { ITEM, ITEM_DEFS, ZTYPE, AMMO_ITEMS, SOUND, EVT, NOTIFY, KILLER, THROW_ITEMS } from '../../shared/defs.js';
import { ACT, CAR_ID, readInput, qpos, dqpos, dqangle16, dqpitch, PING_KIND } from '../../shared/protocol.js';
import { copyPlayerState, samePlayerState, hashPlayerState, simulatePlayer, eyeHeight, currentWeapon } from '../../shared/playersim.js';
import { invCap, removeItem, takeFrom, countItem, freeSlot, slotMag, setSlotMag } from '../inventory.js';
import { isDual } from '../../shared/akimbo.js';
import { isLoadoutStack, isLoadoutWeapon } from '../loadouts.js';

const NO_HASH = -2; // a command packet that came without a state fingerprint
const CMDS_PER_TICK = CMD_RATE / SERVER_TICK_RATE; // commands a client issues per server tick
const CMD_QUEUE_MAX = 24; // commands a client can have waiting (0.4 s of them); older ones are dropped
const CMD_CATCH_UP = 1.05; // a client's command allowance refills this much faster than it issues them (processInputs)
const STEP_IDLE = 20000; // ms: a clock held by /step is let go when nothing has been asked of it for this long

export const methods = {
  handleInput(p, r) {
    // where the client's interpolation clock stood when it sent these commands: what it had on screen, so what
    // their shots were aimed at. It stays with them: by the time a command is run, newer packets may have come in
    const renderTick = r.u16();
    const renderFrac = r.u8() / 255;
    const { cmds, hash, ping, rttMs } = readInput(r);
    if (cmds.length) this.arrived(p);
    if (ping) {
      p.pingAt = performance.now(); // answered in this player's next snapshot (sendSnapshots)
      if (rttMs > 0) {
        const next = p.ping > 0 ? p.ping * 0.7 + rttMs * 0.3 : rttMs;
        if (Math.round(next) !== Math.round(p.ping)) this.playersDirty = true;
        p.ping = next;
      }
    }
    for (let i = 0; i < cmds.length; i++) {
      const c = cmds[i];
      // the packet's last command carries the client's fingerprint of its predicted state after it (NO_HASH: none
      // to check against, so that client gets our state)
      p.cmdQueue.push({ seq: c.seq, buttons: c.buttons, yaw: dqangle16(c.qyaw), pitch: Math.max(-1.55, Math.min(1.55, dqpitch(c.qpitch))), slot: c.slot, hash: i < cmds.length - 1 ? -1 : hash < 0 ? NO_HASH : hash, renderTick, renderFrac });
      p.recvSeq = c.seq;
    }
    if (p.cmdQueue.length > CMD_QUEUE_MAX) p.cmdQueue.splice(0, p.cmdQueue.length - CMD_QUEUE_MAX);
  },

  // a client's commands during the crossing: acknowledged, and not run (nobody acts while the cutscene plays)
  drainInputs(p) {
    for (const cmd of p.cmdQueue) {
      p.lastSeq = cmd.seq;
      p.hasSeq = true;
    }
    if (p.cmdQueue.length) p.selfSync = true; // (its prediction ran them: it takes our state back)
    p.cmdQueue.length = 0;
  },

  processInputs() {
    for (const p of this.players.values()) {
      // A client issues CMDS_PER_TICK commands a tick, and that is what it is allowed. They do not arrive that
      // evenly: a hiccup on the link or at either end and a whole burst comes in late. So the allowance banks up
      // while nothing arrives (as far as the queue is long) and a late burst is run at once, and it refills a touch
      // faster than commands are issued, so whatever does get left waiting drains. A queue that only ever empties
      // as fast as it fills would delay everything that client does from then on: it would stand somewhere it left
      // a moment ago, for the dead to hit, and fire every shot late.
      p.cmdBudget = Math.min(p.cmdBudget + CMDS_PER_TICK * CMD_CATCH_UP, CMD_QUEUE_MAX);
      while (p.cmdQueue.length && p.cmdBudget >= 1) {
        const cmd = p.cmdQueue.shift();
        if (p.hasSeq && ((cmd.seq - p.lastSeq) & 0xffff) >= 0x8000) continue; // old/duplicate
        if (p.hasSeq && cmd.seq === p.lastSeq) continue;
        p.cmdBudget--;
        p.lastSeq = cmd.seq;
        p.hasSeq = true;
        // lag compensation rewinds to what this command's packet said was on screen (Combat.rewindTime)
        p.renderTick = cmd.renderTick;
        p.renderFrac = cmd.renderFrac;
        if (!p.alive) continue;
        const events = [];
        // The client predicts with the same simulation, so its state only needs sending when the two can differ:
        // something other than a command touched ours since the last one, or its fingerprint says it got elsewhere
        if (!samePlayerState(p.state, p.shadow)) p.selfSync = true;
        // an item asked for is in the hands from the client's first command after asking on (useItem)
        if (p.useItem && !p.state.using && ((cmd.seq - p.useItem.from) & 0xffff) < 0x8000) p.state.using = 1;
        if (cmd.buttons & BTN.JUMP & ~p.state.lastBtn) p.firePresses++;
        simulatePlayer(p.state, cmd, this.world, events);
        // pinned by a leaper (or a crawler on their face): shoved all the way (the simulation's meter, s.shove), they
        // throw it off (Zombies.throwOff)
        const off = p.state.pinned && p.state.shove >= 1 ? this.zm.throwOff(p) : null;
        if (off) {
          p.selfSync = true;
          if (off.ztype === ZTYPE.LEAPER) this.ach.threwOff(p);
        }
        copyPlayerState(p.shadow, p.state);
        if (cmd.hash === NO_HASH || (cmd.hash >= 0 && cmd.hash !== hashPlayerState(p.state))) p.selfSync = true;
        for (const ev of events) this.handleSimEvent(p, ev);
        if (this.gun.ent) this.gun.command(p, cmd); // the gunner's commands are the mounted gun's trigger
      }
    }
  },

  // Held (the admin /step): how many ticks may run now. Takes them.
  takeSteps(now, max) {
    if (now - this.stepAsked > STEP_IDLE) this.stepMode = false;
    const n = Math.min(max, this.stepCredit);
    this.stepCredit -= n;
    return n;
  },

  handleSimEvent(p, ev) {
    const s = p.state;
    switch (ev.type) {
      case 'gun_drop':
        this.gun.drop(p); // reached for a weapon with the mounted gun in their arms: it goes down where they stand
        break;
      case 'cat_drop':
        this.cm.put(p); // ...or with the cat in their arms: it is set down in front of them
        break;
      case 'fire':
        this.combat.fire(p, ev);
        break;
      case 'melee':
        this.combat.melee(p, ev);
        break;
      case 'nk_swing':
        // a move of the nunchucks begins: the others hear the swing now, its blows land later ('melee', with the move)
        this.sound(SOUND.MELEE_SWING, s.x, s.y + eyeHeight(s), s.z, 20, p.id);
        break;
      case 'use_cancel':
        // a click or a weapon asked for put the item in the hands away unused (the simulation has let go of it). (Not
        // one asked for since, that the client has in its hands from a later command on)
        if (p.useItem && ((p.lastSeq - p.useItem.from) & 0xffff) < 0x8000) p.useItem = null;
        break;
      case 'throw': {
        const item = ev.item;
        // (no entity id left for the projectile: nothing leaves the hand, and syncThrow gives the simulation
        // back the one it counted as thrown)
        if (this.combat.throwProjectile(p, item)) removeItem(p.inv, item, 1);
        p.invDirty = true;
        this.syncThrow(p);
        break;
      }
      case 'reload':
        this.sound(currentWeapon(s) === ITEM.CROSSBOW ? SOUND.CROSSBOW_COCK : currentWeapon(s) === ITEM.AT_RIFLE ? SOUND.AT_RELOAD : SOUND.RELOAD, s.x, s.y + 1.2, s.z, 20, p.id);
        break;
      case 'leap':
        this.sound(SOUND.ZPLAYER_GROWL, s.x, s.y + 1.5, s.z, 40, p.id);
        break;
      case 'land':
        if (!p.zombie && ev.v > 13) this.damagePlayer(p, (ev.v - 13) * 6, { kind: KILLER.WORLD, fall: true });
        break;
      case 'splash': // into the lake (shared/swim.js): the others hear it from what they see (client entities)
        break;
      case 'veh_crash':
        this.vehicles.crashEvent(p, ev);
        break;
      case 'veh_river':
        this.vehicles.riverEvent(p, ev);
        break;
      case 'veh_off':
        this.vehicles.left(p, ev);
        break;
      case 'veh_skid':
        this.vehicles.skid(p);
        break;
      case 'cart_bump':
        // a handcar run into the end of its stretch of line (shared/handcar.js)
        this.sound(SOUND.METAL_HIT, s.x, s.y, s.z, 40, p.id);
        break;
    }
  },
  // ACT.WAYPOINT: a player's field-map waypoint (or none), which the rest of the team sees through the player list.
  // A burst of clicks costs one list a tick at most (playersDirty), so there is no rate limit to fall out of step with.
  setWaypoint(p, r) {
    let wp = null;
    if (r.u8()) {
      const lim = this.world.half - 3; // (as the map clamps a click)
      const x = Math.max(-lim, Math.min(lim, dqpos(r.i16())));
      const z = Math.max(-lim, Math.min(lim, dqpos(r.i16())));
      const zone = r.u8();
      wp = { x, z, zone: this.world.zoneById[zone] ? zone : 255 };
    }
    const cur = p.waypoint;
    if (cur === wp || (cur && wp && cur.x === wp.x && cur.z === wp.z && cur.zone === wp.zone)) return;
    p.waypoint = wp;
    this.playersDirty = true;
  },

  handleAction(p, r) {
    const act = r.u8();
    const s = p.state;
    // (a waypoint is only a mark on the map: it is theirs to move whatever has become of them)
    if (act === ACT.WAYPOINT) return this.setWaypoint(p, r);
    if (act === ACT.SKIP) return this.skipCrossing(p);
    if (this.phase === PHASE.CROSSING) return; // (nobody acts while the cutscene plays)
    if (!p.alive) return;
    if (p.zombie && act !== ACT.FLASHLIGHT && act !== ACT.PING) return;
    if (p.downed && act !== ACT.FLASHLIGHT && act !== ACT.PING && act !== ACT.HOLD_END) return;
    if (act !== ACT.FLASHLIGHT && act !== ACT.PING) p.arriving = null; // (whoever does something in the world is playing: resume)
    switch (act) {
      case ACT.INTERACT:
        return this.interact(p, r.u16());
      case ACT.HOLD_BEGIN:
        return this.holdBegin(p, r.u16());
      case ACT.HOLD_END:
        p.hold = null;
        return;
      case ACT.PING: {
        const kind = r.u8();
        const x = dqpos(r.i16());
        const y = dqpos(r.i16());
        const z = dqpos(r.i16());
        if (this.time - p.pingT < 0.6) return;
        p.pingT = this.time;
        if ((kind & 3) === PING_KIND.DANGER) this.roles.mark(p, x, y, z); // (a Spotter's marks the one it lands on)
        this.emit((w) => {
          w.u8(EVT.PING);
          w.u16(p.id);
          w.u8(kind & 3);
          w.i16(qpos(x));
          w.i16(qpos(y));
          w.i16(qpos(z));
        });
        return;
      }
      case ACT.DROP_SLOT: {
        const idx = r.u8();
        const cnt = r.u16();
        const it = p.inv[idx];
        if (!it || isLoadoutStack(it)) return;
        this.dropper = p.id; // the stack remembers who put it down, so it does not hop back into their backpack
        const n = cnt === 0 ? it.count : Math.min(cnt, it.count);
        const dropped = this.dropInFront(p, it.item, n, { spread: 0.3, mag: it.mag, noAuto: 4 });
        this.dropper = 0;
        // (no entity id left for it on the ground: it stays in the pack)
        if (!dropped) return;
        p.lastDrop = { e: dropped, t: this.time };
        takeFrom(p.inv, idx, n); // (a few off a full stack: what is left of it merged with the part stack, consolidate)
        p.invDirty = p.invSort = true;
        this.syncThrow(p);
        return;
      }
      case ACT.DROP_WEAPON: {
        const slot = r.u8();
        if (slot > 4 || slot === SLOT_THROW) return;
        const wpn = s.weapons[slot];
        if (!wpn || isLoadoutWeapon(p, slot)) return;
        // (out of a pair one gun goes down, with its half of the rounds, and the other stays in the hand)
        const pair = isDual(s, slot);
        const dropped = this.dropInFront(p, wpn, 1, { spread: 0.2, mag: pair ? slotMag(s, slot) >> 1 : slotMag(s, slot) });
        if (!dropped) return;
        p.lastDrop = { e: dropped, t: this.time };
        if (pair) return void this.splitPair(p, slot);
        s.weapons[slot] = 0;
        setSlotMag(s, slot, 0);
        return;
      }
      case ACT.DROP_AMMO: {
        // rounds out of a reserve onto the ground for a teammate: all of a calibre, or some (the ammo pouch's popover
        // and menu). The client hears of the smaller reserve in its next snapshot, as of a reload
        const cal = r.u8();
        const cnt = r.u16();
        const have = cal < AMMO_ITEMS.length ? s.ammo[cal] : 0;
        if (have <= 0) return;
        const n = cnt === 0 ? have : Math.min(cnt, have);
        this.dropper = p.id; // (as a dropped stack: it does not hop straight back into the reserve)
        const dropped = this.dropInFront(p, AMMO_ITEMS[cal], n, { spread: 0.3, noAuto: 4 });
        this.dropper = 0;
        if (!dropped) return;
        s.ammo[cal] -= n;
        p.lastDrop = { e: dropped, t: this.time };
        return;
      }
      case ACT.UNDO_DROP:
        return this.undoDrop(p);
      case ACT.CRAFT:
        return this.craft(p, r.u8());
      case ACT.SALVAGE: {
        const from = r.u8();
        return this.salvage(p, from, r.u16());
      }
      case ACT.USE_ITEM:
        return this.useItem(p, r.u8());
      case ACT.UNEQUIP: {
        const slot = r.u8();
        return this.unequip(p, slot, r.u8());
      }
      case ACT.EQUIP_ARMOR:
        return this.useItem(p, r.u8());
      case ACT.WORN: {
        const which = r.u8();
        return this.wornGear(p, which, r.u8());
      }
      case ACT.BUILD: {
        const type = r.u8();
        const x = dqpos(r.i16());
        const z = dqpos(r.i16());
        const rot = r.u8();
        return this.build(p, type, x, z, rot);
      }
      case ACT.DEMOLISH:
        return this.demolish(p, r.u16());
      case ACT.REPAIR:
        return this.repair(p, r.u16());
      case ACT.FLASHLIGHT: {
        const on = r.u8() === 1;
        p.flashlight = on && p.battery > 1 && !p.zombie;
        return;
      }
      case ACT.SWAP_INV: {
        const a = r.u8();
        const b = r.u8();
        // (a locked slot - past the capacity - is neither taken from nor put into)
        if (a >= invCap(p) || b >= invCap(p)) return;
        const A = p.inv[a];
        const B = p.inv[b];
        // onto a stack of the same that has room it tops that up; onto a full one the two trade places, as anything
        // else does (and as the client shows a drag at once: InventoryScreen)
        if (A && B && A !== B && A.item === B.item && ITEM_DEFS[A.item].stack > 1 && B.count < ITEM_DEFS[A.item].stack) {
          const max = ITEM_DEFS[A.item].stack;
          const move = Math.min(max - B.count, A.count);
          B.count += move;
          A.count -= move;
          if (A.count <= 0) p.inv[a] = null;
        } else {
          p.inv[a] = B;
          p.inv[b] = A;
        }
        p.invDirty = true;
        return;
      }
      case ACT.SPLIT_INV: {
        // part of a stack into a slot of its own: to drop for a teammate, or to keep apart
        const it = p.inv[r.u8()];
        const n = r.u16();
        if (!it || isLoadoutStack(it) || n < 1 || n >= it.count) return;
        const to = freeSlot(p.inv, invCap(p));
        if (to < 0) return this.notify(NOTIFY.INVENTORY_FULL, 0, p.id);
        it.count -= n;
        p.inv[to] = { item: it.item, count: n };
        // The one way to more than one part stack of a thing: asked for. They stay apart while they are only moved
        // about; the next change to that item's count (a pickup, a use, a craft, a drop) merges them again
        p.splitKeep.set(it.item, countItem(p.inv, it.item));
        p.invDirty = true;
        return;
      }
      case ACT.SELECT_THROWABLE: {
        const item = r.u8();
        if (THROW_ITEMS.includes(item) && countItem(p.inv, item) > 0) {
          s.weapons[SLOT_THROW] = item;
          this.syncThrow(p);
        }
        return;
      }
      case ACT.INSTALL_PART:
        return this.interact(p, CAR_ID);
      case ACT.GUN_MAN:
        return this.gun.man(p, r.u8());
      case ACT.GUN_FEED:
        return this.gun.feed(p, r.u8());
      case ACT.GUN_PUT:
        return this.gun.put(p, r.u8());
      case ACT.CAT_PUT:
        return this.cm.put(p);
      case ACT.RIDE:
        return this.fair.board(p, r.u8());
      case ACT.HANDCAR:
        return this.handcars.board(p, r.u8());
      case ACT.GEN_SWITCH:
        return this.power.flip(p, r.u16());
      case ACT.VEHICLE: {
        const what = r.u8();
        return this.vehicles.act(p, what, r.u16());
      }
      case ACT.SIPHON: {
        const qx = r.i16();
        return this.vehicles.siphonBegin(p, qx, r.i16());
      }
    }
  },
};
