// What the game sends: each tick one packet per client (sendSnapshots, sendTick) with the global state (writeGlobal,
// only what changed: writeGlobalFor), its own state (writeSelf), the entities in range (server/snapshot.js) and the
// tick's events; the player list and the inventory when they change; who is signed in and custom survivors' looks
// as players come (tellFriendCodes, tellLooks). Message layouts are shared/protocol.js's.
import { PHASE, CMDS_PER_PACKET, NIGHT_WAVES, INVENTORY_MAX, PIN_FACE } from '../../shared/constants.js';
import { STRUCT, SCHEMATICS, AMMO_ITEMS, EVT } from '../../shared/defs.js';
import { S2C, SNAP, SELF, PLF, Writer, qpos } from '../../shared/protocol.js';
import { CROSSING } from '../../shared/acts.js';
import { copyPlayerState, samePlayerState, snapPlayerState } from '../../shared/playersim.js';
import { writeEntities, stageEntities } from '../snapshot.js';
import { invCap, tidyStacks, sortInventory } from '../inventory.js';
import { defaultCharacter } from '../../shared/characters.js';
import { looseSupply } from './items.js';

export const methods = {
  broadcast(bytes) {
    for (const p of this.players.values()) p.session.conn.send(bytes);
  },
  writeGlobal(w) {
    w.u8(this.phase);
    w.u8(this.day);
    w.u16(Math.max(0, Math.round(this.timeLeft * 10)));
    let hordeLeft = this.hordeAlive();
    for (const wv of this.waves) hordeLeft += wv.queue.length;
    w.u16(this.phase === PHASE.NIGHT || this.escape.active ? Math.min(0xfffe, hordeLeft) : 0xffff);
    w.u16(this.bossId);
    for (let i = 0; i < 5; i++) w.u8(this.supplies[i]); // (this act's: suppliesOf)
    for (let i = 0; i < 7; i++) w.u8(this.supplyHints[i] ?? 255);
    w.u8(this.supplyFound);
    for (let i = 0; i < 7; i++) w.u16(this.supplyHintSpots[i] >= 0 ? this.supplyHintSpots[i] : 0xffff);
    w.u8(this.supplyHelp);
    w.u8(this.unlocked);
    for (let i = 0; i < SCHEMATICS.length; i++) w.u8(this.schemHints[i] ?? 255);
    w.u8(this.phase === PHASE.NIGHT ? this.wave : 0);
    w.u8(NIGHT_WAVES);
    w.u16(Math.round(Math.max(0, this.escape.t) * 10));
    const esc = this.escape;
    // 8: the warm-up has stalled (nobody on their feet at the car), 16: a survivor is getting in to drive
    // 32: (the plane's stand) the tanks are full and the engines are warming, 64: the dead are on the runway
    w.u8((esc.active ? 1 : 0) | (this.allSuppliesIn() ? 2 : 0) | (esc.ready ? 4 : 0) | (esc.active && esc.stalled ? 8 : 0) | (esc.active && esc.leaving ? 16 : 0) | (esc.active && esc.stage ? 32 : 0) | (esc.active && esc.blocked ? 64 : 0));
    let alive = 0;
    let total = 0;
    for (const p of this.players.values()) {
      total++;
      if (p.alive && !p.zombie) alive++;
    }
    w.u8(alive);
    w.u8(total);
    w.f32(this.restartT);
    w.u16(Math.round(this.phase === PHASE.DAY ? this.dayLen : this.phase === PHASE.CROSSING ? CROSSING.TIME : this.nightLen));
    // the act being played (shared/acts.js), and who has asked to skip the crossing out of who would have to
    w.u8(this.act);
    const [got, need] = this.phase === PHASE.CROSSING ? this.skipVotes() : [0, 0];
    w.u8(Math.min(255, got));
    w.u8(Math.min(255, need));
    w.u8(this.moon); // tonight's moon (MOON), from the dusk horn to dawn
    // workbenches, for the field map: structures themselves only replicate inside AOI_STRUCTURE_RADIUS
    const at = w.reserve8();
    let benches = 0;
    for (const e of this.structures) {
      if (e.stype !== STRUCT.WORKBENCH || benches === 255) continue;
      w.i16(qpos(e.x));
      w.i16(qpos(e.z));
      benches++;
    }
    w.patch8(at, benches);
    // car supplies lying loose (dropped, or where whoever carried one died), for the field map: items only replicate
    // inside AOI_ITEM_RADIUS, and one that never despawns must not be lost for want of knowing where it went down
    const pat = w.reserve8();
    let parts = 0;
    for (const e of this.items) {
      if (!looseSupply(e) || parts === 255) continue;
      w.u8(e.item);
      w.i16(qpos(e.x));
      w.i16(qpos(e.z));
      parts++;
    }
    w.patch8(pat, parts);
    w.u8(this.scouted); // the hiding places a Scout has been near (server/roles.js)
  },

  // Self state. The simulated part only goes out when the client has to rebase its prediction on it (SELF.SYNC):
  // in its first snapshot, while it is dead, when anything but its own commands touched the state (knockback, a
  // pickup, a respawn...) or when its fingerprint of the prediction disagreed with ours (processInputs). Then it is
  // 5 chunks, delta-compressed against what this client last got (byte-compared), and our own state is rounded to
  // what went on the wire so both ends carry on from identical numbers. The status part (hp, armor, battery...)
  // goes out group by group as it changes. A client whose prediction holds costs nothing. Returns false when
  // there was nothing to write.
  writeSelf(w, p) {
    const s = p.state;
    const c = this.cw || (this.cw = new Writer(128));
    if (!p.selfCache) p.selfCache = [];
    // appends the scratch chunk if it differs from the one this client has
    const put = (i) => {
      const prev = p.selfCache[i];
      let same = prev && prev.length === c.o;
      for (let k = 0; same && k < c.o; k++) same = prev[k] === c.u8a[k];
      if (same) return 0;
      p.selfCache[i] = c.u8a.slice(0, c.o);
      w.ensure(c.o);
      w.u8a.set(c.u8a.subarray(0, c.o), w.o);
      w.o += c.o;
      return 1;
    };
    const maskAt = w.reserve8();
    let mask = 0;
    if (p.selfSync || !p.alive || !samePlayerState(s, p.shadow)) {
      mask = SELF.SYNC;
      p.selfSync = false;
      snapPlayerState(s);
      copyPlayerState(p.shadow, s);
      for (let chunk = 0; chunk < 5; chunk++) {
        c.reset();
        switch (chunk) {
          case 0:
            c.f32(s.x);
            c.f32(s.y);
            c.f32(s.z);
            c.f32(s.vx);
            c.f32(s.vy);
            c.f32(s.vz);
            break;
          case 1:
            c.u8((s.onGround ? 1 : 0) | (s.crouch ? 2 : 0) | (s.exhausted ? 4 : 0) | (s.zombie ? 8 : 0) | (s.pulled ? 16 : 0) | (s.pinned ? 32 : 0) | (s.sprinting ? 64 : 0) | (s.downed ? 128 : 0));
            c.f32(s.stamina);
            c.f32(s.staminaDelay);
            break;
          case 2:
            c.u8(s.slot);
            c.f32(s.switchT);
            c.f32(s.cooldown);
            c.f32(s.reloadT);
            c.f32(s.recoil);
            c.u16(s.lastBtn);
            c.u8(s.fireCount);
            break;
          case 3:
            for (let i = 0; i < 5; i++) c.u8(s.weapons[i]);
            c.u8(s.mags[0]);
            c.u8(s.mags[1]);
            c.u8(s.dual);
            for (let i = 0; i < AMMO_ITEMS.length; i++) c.u16(s.ammo[i]);
            c.u8(s.throwCount);
            break;
          case 4:
            c.f32(s.leapCd);
            c.f32(s.stunT);
            c.f32(s.shove);
            c.f32(s.ears);
            c.u8((s.pulled ? 1 : 0) | (s.pinned === PIN_FACE ? 2 : 0)); // (2: what has them is a crawler on the face)
            if (s.pulled) {
              c.f32(s.pullX);
              c.f32(s.pullY);
              c.f32(s.pullZ);
            }
            break;
        }
        if (put(chunk)) mask |= 1 << chunk;
      }
      // (the seat of a ride at the fair: fair.js; the handcar on the railway: handcar.js; the mounted gun or the cat
      // in their arms: mountedgun.js, cats.js; the perks they picked: progress.js)
      c.reset();
      c.u8(s.ride);
      c.u8(s.rideGo);
      c.u32(s.rideT);
      c.u8(s.cart);
      c.f32(s.cartS);
      c.f32(s.cartV);
      c.u8(s.hmg | (s.pet << 1) | (s.drag << 2));
      c.u32(s.perks);
      c.u16(s.drive);
      c.u8(s.driveK | (s.dhold << 4) | (s.ddead ? 128 : 0));
      c.f32(s.dyaw);
      c.f32(s.dsteer);
      c.f32(s.dfuel);
      c.u16(s.pass);
      c.u8(s.passN);
      if (put(12)) mask |= SELF.RIDE;
    }
    // status: 7 field groups behind their own mask
    const subAt = w.reserve8();
    let sub = 0;
    for (let g = 0; g < 7; g++) {
      c.reset();
      switch (g) {
        case 0:
          c.u16(Math.max(0, Math.ceil(p.hp)));
          c.u16(p.maxHp);
          break;
        case 1:
          c.u8(Math.ceil(p.armor));
          c.u8(p.armorMax);
          break;
        case 2:
          c.u8((p.alive ? 1 : 0) | (p.flashlight ? 2 : 0) | (p.revivedBy ? 4 : 0) | (p.burning ? 8 : 0));
          c.u8(Math.round(p.battery));
          {
            // on fire: how far it is put out; beating it out on a teammate: how far theirs is (PLAYER_FIRE)
            const mate = p.burning ? null : this.dousing(p);
            c.u8(Math.round(Math.min(1, p.burning ? p.douse : mate ? mate.douse : 0) * 255));
          }
          break;
        case 3:
          // (only once it is in the hands: this is also what the client has the simulation's `using` from, endUse)
          c.u8(p.useItem && s.using ? p.useItem.item : 0);
          c.u8(p.useItem && s.using ? Math.min(255, Math.round((p.useItem.t / p.useItem.total) * 255)) : 0);
          break;
        case 4:
          c.u8(Math.max(0, Math.min(255, Math.ceil(p.respawnT))));
          break;
        case 5: {
          const h = p.hold;
          c.u8(h ? h.kind : 0);
          c.u8(h ? Math.min(255, Math.round((h.t / h.need) * 255)) : 0);
          break;
        }
        case 6:
          c.u8(p.downed ? Math.max(0, Math.min(255, Math.ceil(p.bleed * 4))) : 0);
          break;
      }
      if (put(5 + g)) sub |= 1 << g;
    }
    if (sub) {
      mask |= SELF.STATUS;
      w.patch8(subAt, sub);
    } else w.o = subAt;
    if (!mask) {
      w.o = maskAt;
      return false;
    }
    w.patch8(maskAt, mask);
    return true;
  },

  sendInventory(p) {
    const w = this.w.reset();
    w.u8(S2C.INVENTORY);
    for (let i = 0; i < INVENTORY_MAX; i++) {
      const it = p.inv[i];
      w.u8(it ? it.item : 0);
      w.u16(it ? it.count : 0);
    }
    w.u8(p.armorItem);
    w.u8(Math.ceil(p.armor));
    w.u8(p.armorMax);
    w.u8(p.backpackItem);
    p.session.conn.send(w.bytes());
    this.stats.bytesOut += w.o;
    this.stats.msgsOut++;
    p.invDirty = false;
  },

  // Who is signed in to an account (S2C.FRIENDS: its name, '' for a guest), for sending each other friend requests: a
  // newcomer is told everyone's, their own among them, and everyone else is told theirs. (An id that comes back to
  // someone else comes with its new account.)
  tellFriendCodes(p) {
    const w = new Writer(16 + 12 * this.players.size);
    w.u8(S2C.FRIENDS);
    w.u8(this.players.size);
    for (const q of this.players.values()) {
      w.u16(q.id);
      w.str(q.friend || '');
    }
    p.session.conn.send(w.bytes());
    const one = new Writer(16);
    one.u8(S2C.FRIENDS);
    one.u8(1);
    one.u16(p.id);
    one.str(p.friend || '');
    const bytes = one.bytes();
    for (const q of this.players.values()) if (q !== p) q.session.conn.send(bytes);
  },

  // Custom survivors' looks (S2C.LOOKS, the character creator): a player joining or coming back is told everyone's
  // (theirs too); the rest are told the newcomer's - or, when the newcomer has none but somebody earlier in this game
  // with the same id had one, that the id's look is gone. A game of roster survivors sends nothing.
  tellLooks(p) {
    const own = (w, q) => {
      w.u16(q.id);
      w.u8(q.look ? q.look.length : 0);
      if (q.look) for (const b of q.look) w.u8(b);
    };
    const withLook = [...this.players.values()].filter((q) => q.look);
    if (withLook.length && p.session) {
      const w = new Writer(8 + 72 * withLook.length);
      w.u8(S2C.LOOKS);
      w.u8(withLook.length);
      for (const q of withLook) own(w, q);
      p.session.conn.send(w.bytes());
    }
    this.lookIds ||= new Set();
    if (!p.look && !this.lookIds.has(p.id)) return;
    if (p.look) this.lookIds.add(p.id);
    const one = new Writer(80);
    one.u8(S2C.LOOKS);
    one.u8(1);
    own(one, p);
    const bytes = one.bytes();
    for (const q of this.players.values()) if (q !== p && q.session) q.session.conn.send(bytes);
  },

  // sends everyone the player list now (it normally rides along with the next snapshot, see sendTick)
  sendPlayers() {
    this.playersList();
    for (const p of this.players.values()) this.sendList(p);
  },
  sendList(p) {
    if (p.listVer === this.listVer) return;
    p.listVer = this.listVer;
    p.session.conn.send(this.listBytes);
    this.stats.bytesOut += this.listBytes.length;
    this.stats.msgsOut++;
  },

  // Rebuilds the player list message; a client is sent it when its copy is out of date (listVer)
  playersList() {
    const w = this.w.reset();
    w.u8(S2C.PLAYERS);
    w.u8(this.players.size);
    for (const p of this.players.values()) {
      w.u16(p.id);
      w.str(p.name);
      w.u8(!p.alive ? 2 : p.zombie ? 1 : p.downed ? 3 : 0);
      p.onAir = this.onAir(p);
      if (p.onAir) this.ach.onAir(p);
      const wp = p.waypoint;
      w.u8((p.onAir ? PLF.ON_AIR : 0) | (wp ? PLF.WAYPOINT : 0));
      w.u16(p.kills + p.zkills);
      w.u16(Math.min(9999, Math.round(p.ping)));
      w.u8(this.levelOf(p));
      if (wp) {
        w.i16(qpos(wp.x));
        w.i16(qpos(wp.z));
        w.u8(wp.zone);
      }
    }
    // each player's character, in the same order, after them all: a client from before the roster stops reading at the
    // end of the list and never sees these
    for (const p of this.players.values()) w.u8(p.character ?? defaultCharacter(p.id));
    // ...then each one's perks in force (progress.js: a mask of ids), for their profile card
    for (const p of this.players.values()) w.u32(p.perks >>> 0);
    this.playersDirty = false;
    const prev = this.listBytes;
    let same = !!prev && prev.length === w.o;
    for (let i = 0; same && i < w.o; i++) same = prev[i] === w.u8a[i];
    if (same) return;
    this.listBytes = w.u8a.slice(0, w.o);
    this.listVer = (this.listVer || 0) + 1;
  },

  // Global state for one client: all of it the first time and whenever anything but the clocks changed, just the
  // clocks (time left, horde left: bytes 2-5) when only they moved, nothing when not even those did.
  // all: this tick's full global state. Returns false if nothing was written.
  writeGlobalFor(w, p, all) {
    const prev = p.globalCache;
    let full = !prev || prev.length !== all.length;
    let clocks = false;
    for (let i = 0; !full && i < all.length; i++) {
      if (prev[i] === all[i]) continue;
      if (i >= 2 && i < 6) clocks = true;
      else full = true;
    }
    if (!full && !clocks) return false;
    w.u8(full ? 1 : 0);
    w.ensure(all.length);
    if (full) {
      w.u8a.set(all, w.o);
      w.o += all.length;
      p.globalCache = all.slice();
    } else {
      for (let i = 2; i < 6; i++) w.u8(all[i]);
      prev.set(all.subarray(2, 6), 2);
    }
    return true;
  },

  // somebody keyed their walkie-talkie or let go of it: everyone has to know at once (their voice, the static)
  checkOnAir() {
    for (const p of this.players.values()) if (this.onAir(p) !== p.onAir) this.playersDirty = true;
  },

  sendSnapshots() {
    if (!this.playersDirty) this.checkOnAir();
    // the list is rebuilt on changes and every 2 s (kills, ping), and only goes out when it came out different
    if (this.playersDirty || this.tick - this.playersListT > 40) {
      this.playersListT = this.tick;
      this.playersList();
    }
    let global = null;
    if (this.globalDirty || this.tick % 20 === 0) {
      const gw = (this.gw || (this.gw = new Writer(256))).reset();
      this.writeGlobal(gw);
      global = gw.bytes();
    }
    this.globalDirty = false;
    if (this.players.size) stageEntities(this.all, this.tick); // once for all clients: each sendTick's writeEntities reads the staged copy
    for (const p of this.players.values()) {
      const conn = p.session.conn;
      if (p.pingAt) {
        const held = Math.min(255, Math.round(performance.now() - p.pingAt));
        p.pingAt = 0;
        this.emit(
          (w) => {
            w.u8(EVT.PONG);
            w.u8(held);
          },
          { to: p.id },
        );
      }
      // A client that isn't draining its socket gets nothing this tick: every baseline stays where it is and the
      // next snapshot that does go out covers the gap (dropping an encoded one would break the delta chain)
      if (conn.congested && conn.congested()) continue;
      // everything this client gets this tick leaves as one packet
      if (conn.cork) conn.cork(() => this.sendTick(p, global));
      else this.sendTick(p, global);
    }
    this.events.length = 0;
  },

  // one client's traffic for this tick: the player list and its inventory when they changed, then the snapshot
  // global: this tick's full global state when it is due (null otherwise)
  sendTick(p, global) {
    const conn = p.session.conn;
    this.sendList(p);
    this.sendProgress(p);
    this.cards.send(p);
    if (p.invDirty) {
      // picked up or dropped this tick: sorted (sortInventory), a split left apart. Else the safety net, for any path
      // that left two part stacks of a thing
      if (p.invSort) sortInventory(p.inv, invCap(p), p.splitKeep);
      else tidyStacks(p.inv, p.splitKeep);
      p.invSort = false;
      this.sendInventory(p);
    }
    const w = this.w.reset();
    w.u8(S2C.SNAPSHOT);
    const flagsAt = w.reserve8();
    let flags = 0;
    const ackStep = (p.lastSeq - p.ackSent) & 0xffff;
    if (this.tick !== p.snapTick + 1) {
      flags |= SNAP.TICK;
      w.u32(this.tick);
      w.u16(p.lastSeq);
    } else if (ackStep !== CMDS_PER_PACKET) {
      flags |= SNAP.ACK;
      w.varu(ackStep);
    }
    p.snapTick = this.tick;
    p.ackSent = p.lastSeq;
    if (global && this.writeGlobalFor(w, p, global)) flags |= SNAP.GLOBAL;
    if (this.writeSelf(w, p)) flags |= SNAP.SELF;
    flags |= writeEntities(w, p.view, p, this.all, this.tick);
    // events
    const at = w.reserve8();
    let n = 0;
    const px = p.state.x;
    const pz = p.state.z;
    for (const ev of this.events) {
      if (ev.to && ev.to !== p.id) continue;
      if (ev.except && ev.except === p.id) continue;
      if (ev.r2) {
        const dx = ev.x - px;
        const dz = ev.z - pz;
        if (dx * dx + dz * dz > ev.r2) continue;
      }
      if (n >= 255) break;
      w.ensure(ev.bytes.length);
      w.u8a.set(ev.bytes, w.o);
      w.o += ev.bytes.length;
      n++;
    }
    if (n) {
      flags |= SNAP.EVENTS;
      w.patch8(at, n);
    } else w.o = at;
    w.patch8(flagsAt, flags);
    conn.send(w.bytes());
    this.stats.bytesOut += w.o;
    this.stats.msgsOut++;
  },
};
