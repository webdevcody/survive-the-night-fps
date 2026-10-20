// What happens to a survivor who is hurt: the damage taken (damagePlayer: the difficulty, perks, armour, a car's
// glass, Second Chance), going down and bleeding out, being revived, dying (killPlayer: what they carried goes on
// the ground, and they rise as one of the dead), and being on fire (PLAYER_FIRE: setAlight, updateFire, putOut,
// dousing). A turned player is hurt here too.
import { PHASE, SLOT_PISTOL, DOWN_TIME, REVIVE_HP, SLOT_RADIO } from '../../shared/constants.js';
import { ITEM_DEFS, ZTYPE, SOUND, EVT, NOTIFY, KILLER, PLAYER_FIRE } from '../../shared/defs.js';
import { CHATF, qpos } from '../../shared/protocol.js';
import { XP, XPS } from '../../shared/progress.js';
import { swimming } from '../../shared/swim.js';
import { playerMods } from '../loadouts.js';
import * as Director from '../director.js';

export const methods = {
  setAlight(p) {
    if (!p || !p.alive || p.zombie || p.downed || p.burning || this.safe(p) || swimming(this.world, p.state)) return false;
    p.burning = true;
    p.state.burning = 1; // (no jumping: the simulation's)
    p.douse = 0;
    this.sound(SOUND.FIRE_WHOOSH, p.state.x, p.state.y + 1, p.state.z, 40);
    return true;
  },

  putOut(p, loud = true) {
    if (!p.burning) return;
    p.burning = false;
    p.state.burning = 0;
    p.douse = 0;
    if (loud) this.sound(SOUND.ACID_SIZZLE, p.state.x, p.state.y + 1, p.state.z, 25);
  },

  // Each tick for a survivor alight: in the water it is out; otherwise it burns them, and each press of [Space] - theirs,
  // and every teammate's within reach who is up and not burning - beats it down, PLAYER_FIRE.presses of them putting it
  // out. true: it killed them
  updateFire(p, dt) {
    const s = p.state;
    if (swimming(this.world, s) || p.downed) {
      this.putOut(p);
      return false;
    }
    let presses = p.firePresses;
    for (const q of this.players.values()) {
      if (q === p || !q.firePresses || !q.alive || q.zombie || q.downed || q.burning || this.safe(q)) continue;
      if (Math.hypot(q.state.x - s.x, q.state.z - s.z) < PLAYER_FIRE.reach && Math.abs(q.state.y - s.y) < 1.5) presses += q.firePresses;
    }
    p.douse = presses ? p.douse + presses / PLAYER_FIRE.presses : Math.max(0, p.douse - PLAYER_FIRE.decay * dt);
    if (p.douse >= 0.999) {
      this.putOut(p);
      return false;
    }
    if ((p.fireT = (p.fireT || 0) + dt) >= 0.5) {
      p.fireT -= 0.5;
      this.damagePlayer(p, PLAYER_FIRE.dps * 0.5, { kind: KILLER.ZOMBIE, ztype: ZTYPE.FLAMMER, x: s.x, z: s.z, fire: true });
    }
    return !p.alive;
  },

  // the burning survivor a teammate's [Space] beats the flames out on (the nearest within reach), or null
  dousing(q) {
    if (!q.alive || q.zombie || q.downed || q.burning || this.safe(q)) return null;
    let best = null;
    let bd = PLAYER_FIRE.reach;
    for (const p of this.players.values()) {
      if (p === q || !p.burning || !p.alive) continue;
      const d = Math.hypot(q.state.x - p.state.x, q.state.z - p.state.z);
      if (d < bd && Math.abs(q.state.y - p.state.y) < 1.5) {
        bd = d;
        best = p;
      }
    }
    return best;
  },
  damagePlayer(p, amount, src) {
    if (!p.alive || amount <= 0 || this.safe(p)) return; // (dropped and held, or back and not playing yet: nothing hurts them)
    if (this.godMode && !p.zombie) {
      // (testing: the survivor takes nothing - the car they sit in still takes what was meant for them)
      if (src && src.kind === KILLER.ZOMBIE && (p.state.drive || p.state.pass) && (this.phase === PHASE.DAY || this.phase === PHASE.NIGHT)) this.vehicles.shield(p, amount * this.diff.hurt);
      return;
    }
    if (this.phase !== PHASE.DAY && this.phase !== PHASE.NIGHT) return;
    // The dead, a fall, the lake. Not a player's own bomb: that should do what the player threw it to do.
    if (!p.zombie && src && (src.kind === KILLER.ZOMBIE || src.kind === KILLER.WORLD)) amount *= this.diff.hurt;
    if (!p.zombie) amount *= playerMods(p).hurt;
    // in a vehicle (vehicles.js): a car takes what the dead meant for who is in it, while it still has its glass
    if (!p.zombie && src && src.kind === KILLER.ZOMBIE && (p.state.drive || p.state.pass) && !((amount = this.vehicles.shield(p, amount)) > 0)) return;
    if (p.downed) {
      // hits on a downed survivor drain what's left of their blood
      p.bleed -= amount * 0.12;
      p.lastSrc = src;
      p.lastDamageT = this.time;
      if (p.bleed <= 0) this.killPlayer(p, src);
      return;
    }
    if (!p.zombie && p.armor > 0) {
      const def = ITEM_DEFS[p.armorItem];
      const absorb = def ? def.absorb : 0.3;
      const soak = Math.min(p.armor, amount * absorb);
      p.armor -= soak;
      amount -= soak;
      if (p.armor <= 0.5) {
        p.armor = 0;
        p.armorItem = 0;
        p.armorMax = 0;
      }
    }
    this.track.hurt(p, amount, src);
    Director.hurt(this, p, amount, src);
    p.hp -= amount;
    p.lastDamageT = this.time;
    p.lastSrc = src;
    // Second Chance (a keystone perk): once a night the blow that would have put them down leaves them standing
    if (p.hp <= 0 && !p.zombie && !p.lastChance && playerMods(p).secondChance) {
      p.lastChance = true;
      p.hp = 1;
      this.sendChat(p, 0, CHATF.SYSTEM, 'Second Chance: you are still standing. Get clear.');
    }
    const s = p.state;
    const fx = src.x ?? s.x;
    const fz = src.z ?? s.z;
    this.emit(
      (w) => {
        w.u8(EVT.DAMAGE);
        w.u8(Math.min(255, Math.round(amount)));
        w.i16(qpos(fx));
        w.i16(qpos(fz));
      },
      { to: p.id },
    );
    if (this.rng() < 0.5) this.sound(p.zombie ? SOUND.ZOMBIE_PAIN : SOUND.PLAYER_HURT, s.x, s.y + 1.5, s.z, 30, p.id);
    if (p.hp <= 0) {
      if (!p.zombie && this.standing() > 1) this.goDown(p);
      else this.killPlayer(p, src);
    }
  },

  goDown(p) {
    this.putOut(p, false); // (down on the ground, they roll the fire out)
    p.downed = true;
    p.hp = 0;
    p.bleed = DOWN_TIME * this.diff.down;
    this.endUse(p);
    p.hold = null;
    p.revivedBy = 0;
    this.releaseHolds(p);
    const s = p.state;
    s.downed = 1;
    s.sprinting = 0;
    if (s.weapons[SLOT_PISTOL] && s.slot !== SLOT_PISTOL && s.slot !== SLOT_RADIO) {
      s.slot = SLOT_PISTOL;
      s.reloadT = 0; // a reload in progress was of the weapon just put away: left running it locks the pistol, then reloads it
    }
    this.nightStats.downs++;
    this.track.down(p);
    Director.down(this, p);
    this.notify(NOTIFY.DOWNED, p.id);
    this.sound(SOUND.DOWNED, s.x, s.y + 0.6, s.z, 70);
    this.playersDirty = true;
    this.checkAllDead();
  },

  revive(p, by, hp = REVIVE_HP) {
    if (!p.downed) return;
    this.track.revive(p, by);
    this.ach.revive(p, by);
    p.downed = false;
    p.state.downed = 0;
    p.hp = Math.min(p.maxHp, hp + (by ? playerMods(by).reviveHp : 0));
    if (by && by !== p && ++by.nightRevives <= XP.revivesFull) this.award(by, XPS.revives, XP.revive * playerMods(by).reviveXp);
    if (by && by !== p && by.alive && !by.downed && !by.zombie) by.hp = Math.min(by.maxHp, by.hp + playerMods(by).reviveSelf);
    p.bleed = 0;
    p.revivedBy = 0;
    p.lastDamageT = this.time;
    this.nightStats.revives++;
    this.notify(NOTIFY.REVIVED, p.id);
    this.sound(SOUND.REVIVE, p.state.x, p.state.y + 1, p.state.z, 30);
    if (by) this.credit([by], 'revives');
    this.playersDirty = true;
  },

  killPlayer(p, src, silent = false) {
    this.putOut(p, false);
    this.track.death(p, src, silent); // (first: what they were when it came)
    this.ach.death(p, src);
    this.vehicles.drop(p); // (out of whatever they were in: it rolls on without them)
    p.hp = 0;
    p.alive = false;
    p.deaths++;
    this.endUse(p);
    p.hold = null;
    p.downed = false;
    p.state.downed = 0;
    this.releaseHolds(p);
    const s = p.state;
    s.vx = s.vy = s.vz = 0;
    if (src.kind === KILLER.PLAYER) {
      const k = this.players.get(src.id);
      if (k) {
        k.kills++;
        if (p.zombie) this.credit([k], 'kills'); // a turned player put down. (A survivor killed by one is on nobody's record)
      }
    }
    this.killfeed(src.kind || KILLER.WORLD, src.kind === KILLER.PLAYER ? src.id : src.ztype ?? 0, p.id, src.weapon || 0, (src.headshot ? 1 : 0) | (p.zombie ? 2 : 0) | (src.drown ? 4 : 0) | (src.deer ? 8 : 0));
    if (!p.zombie) {
      this.nightStats.deaths++;
      this.dropAll(p);
      s.weapons = [0, 0, 0, 0, 0];
      s.dual = 0;
      p.armor = 0;
      p.armorItem = 0;
      p.armorMax = 0;
      p.flashlight = false;
      this.notify(NOTIFY.YOU_DIED, src.kind === KILLER.ZOMBIE ? src.ztype : src.deer ? 254 : 255, p.id); // (254: an undead deer's antlers)
      this.notify(NOTIFY.PLAYER_DIED, p.id);
      this.sound(SOUND.PLAYER_DEATH, s.x, s.y + 1, s.z, 60);
      p.respawnT = 6;
      p.becomeZombie = true;
    } else {
      this.sound(SOUND.ZOMBIE_DEATH, s.x, s.y + 1, s.z, 40);
      p.respawnT = 8;
      p.becomeZombie = true;
    }
    this.playersDirty = true;
    if (!silent) this.checkAllDead();
  },

  // leaper pin / roper rope bookkeeping
  releaseHolds(p) {
    for (const z of this.zombies) {
      if (z.link === p.id) this.zm.releaseLink(z);
    }
    this.roles.letGo(p); // (a downed teammate they were dragging)
    p.state.pulled = 0;
    p.state.pinned = 0;
  },
};
