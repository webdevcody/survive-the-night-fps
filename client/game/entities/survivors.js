// The survivors on the client: what Entities (entities.js) does for an ENT.PLAYER record - the body they chose, what
// it holds and how it moves, where they sit or ride, their flashlight cone, their fire and their footsteps.
// Laid onto Entities as methods (addMethods), so they are called on it as this.name(...) like any of its own.
import * as THREE from 'three';
import { PFLAG, PSTAT, playerRide } from '../../../shared/protocol.js';
import { WEAPONS, ITEM } from '../../../shared/defs.js';
import { WATER_LEVEL } from '../../../shared/constants.js';
import { afloatAt } from '../../../shared/swim.js';
import { defaultCharacter } from '../../../shared/characters.js';
import { createSurvivor } from '../../render/models/characters.js';
import { nkSounds } from '../nunchaku.js';

const _vq = new THREE.Quaternion();
const _vUp = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _nkAt = new THREE.Vector3();
const _catPose = { cradle: false, pet: false };
const _car = { x: 0, y: 0, z: 0 }; // where a player riding a handcar stands

export const methods = {
  // Entities.onCreate
  createSurvivorView(e) {
    this.survivorView(e);
    e.fireCount = e.q[8];
    const cone = new THREE.Mesh(this.coneGeo, this.coneMat);
    cone.visible = false;
    cone.renderOrder = 6;
    this.scene.add(cone);
    e.cone = cone;
    e.stepT = 0;
  },

  // A player's body: the survivor they chose to be (the player list's character: Game.onPlayers), or, until the list
  // has said, the one their id picks. A new one if the list says another (the list can come after the entity's create).
  // What it held, whether it had turned and its backpack are put on it again by the next update.
  survivorView(e) {
    const ch = this.g.lookOf(e.id) ?? defaultCharacter(e.id); // (a custom survivor: their own model once it is built)
    if (e.view && e.char === ch) return;
    if (e.view) e.view.dispose();
    const v = createSurvivor(e.id * 31 + 7, ch);
    e.view = v;
    e.char = ch;
    this.addToScene(v.object, this.charShadows, false);
    e.weapon = -1;
    e.pair = false;
    e.zombieForm = null;
    e.packOn = false;
  },

  // Entities.onUpdate, when PF.FIRE (fireCount) changed: the third-person swing, throw or shot
  survivorFired(e) {
    if (e.q[8] === e.fireCount) return;
    e.fireCount = e.q[8];
    const w = e.q[6];
    const def = WEAPONS[w];
    if (e.q[5] & PFLAG.ZOMBIE || def?.melee) e.view?.melee();
    else if (w === ITEM.MOLOTOV || w === ITEM.PIPEBOMB || w === ITEM.GRENADE || w === ITEM.DECOY) e.view?.throwAnim();
    else e.view?.fire();
  },

  // Entities.update, once a frame. flashCands: the lit flashlights, for the two nearest to light the world
  survivorUpdate(e, dt, renderTick, time, camPos, flashCands) {
    const g = this.g;
    const tmp = this.tmp;
    e.samples.sample(renderTick, tmp);
    // on a ride at the fair they are drawn in their seat, where the ride is drawn this frame (game/fair.js),
    // and slide into it and out of it over a moment instead of popping
    const ride = playerRide(e.q[5]);
    if (ride) e.seat = ride;
    e.seatK = Math.max(0, Math.min(1, (e.seatK || 0) + (ride ? dt : -dt) * 5));
    if (e.seatK > 0) g.fair.seatBlend(e.seat - 1, tmp, e.seatK);
    // on a handcar they stand on its deck where the car is drawn (game/handcar.js), stepping onto it over a moment
    const seat = g.vehicles.seatOf(e.id); // in a vehicle: drawn in their seat of it, as it is drawn (game/vehicles.js)
    const carted = g.handcar.riderAt(e.id, _car);
    e.cartK = carted ? Math.min(1, (e.cartK || 0) + dt * 5) : 0;
    if (carted) {
      const u = e.cartK * e.cartK * (3 - 2 * e.cartK);
      tmp.x += (_car.x - tmp.x) * u;
      tmp.y += (_car.y - tmp.y) * u;
      tmp.z += (_car.z - tmp.z) * u;
    }
    const dx = tmp.x - e.rx;
    const dy = tmp.y - e.ry;
    const dz = tmp.z - e.rz;
    const sp = Math.hypot(dx, dz) / Math.max(dt, 1e-3);
    e.speed += (Math.min(sp, 14) - e.speed) * Math.min(1, dt * 10);
    if (e.seatK > 0 || carted || seat) e.speed = 0; // (carried, not walking)
    const fallVy = e.vy || 0; // (how fast they came down before this frame: a jump into the water splashes)
    e.vy = e.seatK > 0 || carted ? 0 : dy / Math.max(dt, 1e-3);
    e.rx = tmp.x;
    e.ry = tmp.y;
    e.rz = tmp.z;
    e.ryaw = tmp.yaw;
    e.rpitch = tmp.pitch;
    if (e.view && e.char !== (g.lookOf(e.id) ?? e.char)) this.survivorView(e);
    const v = e.view;
    if (!v) return;
    const flags = e.q[5];
    const zombie = !!(flags & PFLAG.ZOMBIE);
    const dead = !!(flags & PFLAG.DEAD);
    if (zombie !== e.zombieForm) {
      e.zombieForm = zombie;
      v.setZombie(zombie);
      e.weapon = -1;
    }
    const pack = !!(flags & PFLAG.BACKPACK); // wearing a backpack: it shows on their back
    if (pack !== !!e.packOn) {
      e.packOn = pack;
      v.setBackpack?.(pack);
    }
    const grips = g.gun.gunner === e.id; // at the mounted gun: both hands on it, their own weapon put away
    // afloat in the lake or a pond (shared/swim.js): swimming, the weapon put away; in with a splash from a jump
    const afloat = !dead && !zombie && !carted && e.seatK === 0 && afloatAt(g.world, e.rx, e.ry, e.rz);
    if (afloat && !e.afloat && fallVy < -3) {
      g.effects.splash(e.rx, WATER_LEVEL, e.rz, Math.min(1, 0.3 - fallVy / 15));
      g.audio.footstep('water', e.rx, WATER_LEVEL, e.rz, 1);
    }
    e.afloat = afloat;
    const carry = !grips && g.gun.carrier === e.id; // ...or carrying it off in both arms (mountedgun.js draws it there)
    const cat = g.cat.poseOf(e.id, _catPose); // ...or the stray cat (catcarry.js draws it there)
    const ears = !zombie && !dead && !!(e.q[9] & PSTAT.EARS); // (both hands over the ears: a screecher's scream)
    const weapon = zombie || grips || afloat || carry || cat.cradle || ears || (seat && seat.k === 0) ? 0 : e.q[6]; // (the cat in their arms; at the wheel: both hands on it)
    if (weapon !== e.weapon) {
      e.weapon = weapon;
      v.setWeapon(weapon);
    }
    const pair = !!weapon && !!(e.q[9] & PSTAT.AKIMBO); // (two of the gun: one in each hand, shared/akimbo.js)
    if (pair !== !!e.pair) {
      e.pair = pair;
      v.setAkimbo?.(pair);
    }
    const downed = !!(flags & PFLAG.DOWNED) && !dead;
    e.downed = downed;
    e.beingRevived = !!(flags & PFLAG.REVIVING);
    e.downK = (e.downK || 0) + ((downed ? 1 : 0) - (e.downK || 0)) * Math.min(1, dt * 6);
    v.object.position.set(e.rx, e.ry + e.downK * 0.18, e.rz);
    v.object.rotation.order = 'YXZ';
    v.object.rotation.y = e.ryaw;
    v.object.rotation.x = -1.3 * e.downK;
    // a vehicle's seat: the body goes over from where it stood beside it, folding as it goes (and back out)
    const vride = seat ? g.vehicles.place(seat, v) : null;
    e.vK = seat && !e.vFoot ? 1 : Math.max(0, Math.min(1, (e.vK || 0) + (seat ? dt : -dt) / 0.3)); // (first seen in a seat: in it)
    if (seat) {
      (e.vSeat ||= new THREE.Vector3()).copy(v.object.position);
      (e.vQuat ||= new THREE.Quaternion()).copy(v.object.quaternion);
    } else if (e.vK <= 0 || !e.vFoot) {
      (e.vFoot ||= new THREE.Vector3()).set(e.rx, e.ry, e.rz);
      e.vYaw = e.ryaw;
    }
    const vU = e.vK * e.vK * (3 - 2 * e.vK);
    if (e.vK > 0 && e.vK < 1 && e.vSeat && e.vFoot) {
      if (seat) {
        _vq.setFromAxisAngle(_vUp, e.vYaw || 0);
        v.object.position.lerpVectors(e.vFoot, e.vSeat, vU);
      } else {
        _vq.setFromAxisAngle(_vUp, e.ryaw);
        v.object.position.set(e.rx, e.ry, e.rz).lerp(e.vSeat, vU);
      }
      v.object.quaternion.copy(_vq).slerp(e.vQuat, vU);
    }
    v.update(dt, { speed: downed ? e.speed * 0.4 : e.speed, sprint: !!(flags & PFLAG.SPRINT), crouch: !!(flags & PFLAG.CROUCH) || downed, pitch: downed ? 0.9 : e.rpitch, onGround: Math.abs(e.vy) < 1.5, reloading: !!(flags & PFLAG.RELOADING), dead, time, grips, carry, cradle: cat.cradle, pet: cat.pet, sit: e.seatK > 0.5 || !!seat || e.vK > 0, reach: vride?.reach, sitT: vride?.sitT, sitK: vride?.sitK, sitSplay: vride?.sitSplay, sitLean: vride?.sitLean, sitTwist: vride?.sitTwist, feet: vride?.feet, sitNow: seat || e.vK > 0 ? vU : undefined, swim: afloat && !downed, ears, talk: !!g.players.get(e.id)?.onAir, voice: g.voice?.mouthLevel(e.id) || 0 }); // (talk: on the walkie-talkie; voice: how loud they are talking, for the mouth)
    v.object.visible = !(dead && zombie);
    this.updateFireOn(e, !dead && !zombie && !!(e.q[9] & PSTAT.BURNING) && e.id !== g.myId, dt, camPos, 1.7, 0.3); // (set alight by a flammer: ours is the HUD's)
    // nunchucks: what their chain is doing is heard from where they stand (nothing of it is on the wire)
    if (weapon === ITEM.NUNCHAKU) {
      const nk = v.nk?.();
      if (nk) nkSounds(g.audio, nk.core, _nkAt.set(e.rx, e.ry + 1.3, e.rz), e.nkSt || (e.nkSt = {}), time);
    }
    // flashlight
    const flashOn = !!(flags & PFLAG.FLASHLIGHT) && !dead;
    e.cone.visible = flashOn;
    if (flashOn) {
      const a = v.flashlightAnchor;
      if (a) a.getWorldPosition(_v);
      else _v.set(e.rx, e.ry + 1.4, e.rz);
      const cp = Math.cos(e.rpitch);
      _v2.set(-Math.sin(e.ryaw) * cp, Math.sin(e.rpitch), -Math.cos(e.ryaw) * cp);
      e.cone.position.copy(_v);
      e.cone.lookAt(_v.x + _v2.x, _v.y + _v2.y, _v.z + _v2.z);
      flashCands.push({ pos: _v.clone(), dir: _v2.clone(), d: (e.rx - camPos.x) ** 2 + (e.rz - camPos.z) ** 2 });
    }
    // footsteps
    if (!dead && e.speed > 1 && Math.abs(e.vy) < 1.5) {
      e.stepT -= dt * (e.speed * 0.55);
      if (e.stepT <= 0) {
        e.stepT = 1;
        g.audio.footstep(afloat ? 'water' : g.surfaceAt(e.rx, e.ry, e.rz), e.rx, e.ry, e.rz, flags & PFLAG.CROUCH ? 0.3 : flags & PFLAG.SPRINT ? 1 : 0.65);
        if (afloat) g.effects.splash(e.rx - Math.sin(e.ryaw) * 0.6, WATER_LEVEL, e.rz - Math.cos(e.ryaw) * 0.6, 0.12); // a stroke
      }
    }
    g.voice?.setPeerPosition(e.id, e.rx, e.ry + 1.6, e.rz, zombie);
  },
};
