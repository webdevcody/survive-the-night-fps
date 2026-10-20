// Game: our own survivor's body, for a debug camera or a seat in a vehicle.
import { ITEM } from '../../../shared/defs.js';
import { currentWeapon } from '../../../shared/playersim.js';
import { isDual } from '../../../shared/akimbo.js';
import { nkSounds } from '../nunchaku.js';
import { createSurvivor } from '../../render/models/characters.js';

export const methods = {
  // Our own survivor, as the others see us, drawn from our own predicted state: only while a debug camera asks for it
  // (debugCam.body) - a look at the third person from outside without a second client (scripts/clip/nunchaku-film.js).
  // Everything else about a game with one player in it is as it always is: nobody has a body of their own.
  updateSelfBody(dt, s, rp, time, hspeed, early = false) {
    // (in a vehicle VehicleClient.update has us placed already this frame, before it took the eye from our head)
    if (!early && this.selfBodyDone) {
      this.selfBodyDone = false;
      return;
    }
    this.selfBodyDone = early;
    // our seat in a vehicle, by our own prediction (the entity's record says the same a moment later)
    const veh = this.vehicles;
    const seat = veh.mine && veh.myK >= 0 ? (this.selfSeat ||= { e: null, k: 0, pose: {} }) : null;
    if (seat) {
      if (seat.e !== veh.mine || seat.k !== veh.myK) seat.pose = {};
      seat.e = veh.mine;
      seat.k = veh.myK;
    }
    // under our own eyes (no debug camera): only in a seat, and without the head the eye is in or the arms the view
    // has its own of
    const fp = !this.debugCam && !this.cine && !!seat;
    const want = !!this.self.alive && (fp || !!(this.debugCam && this.debugCam.body));
    if (!want) {
      if (this.selfBody) {
        this.scene.remove(this.selfBody.object);
        this.selfBody.dispose?.();
        this.selfBody = null;
      }
      return;
    }
    let sv = this.selfBody;
    const who = this.lookOf(this.myId) ?? -1;
    if (sv && this.selfBodyWho !== who) {
      // (the player list, or our custom survivor's models, came after the body was made: made again as them)
      this.scene.remove(sv.object);
      sv.dispose?.();
      sv = this.selfBody = null;
    }
    if (!sv) {
      sv = this.selfBody = createSurvivor(this.myId || 1, who);
      this.selfBodyWho = who;
      sv.object.traverse((m) => m.isMesh && (m.castShadow = true));
      this.scene.add(sv.object);
      this.selfBodyItem = -1;
      this.selfBodyPair = false;
    }
    const cat = this.cat.poseOf(this.myId, this.selfCat || (this.selfCat = {})); // (the stray cat in our arms)
    sv.setHide(fp ? 2 : 0);
    sv.object.visible = !fp || veh.mountK > 0.75;
    const item = s.zombie || cat.cradle || (seat && (seat.k === 0 || fp)) ? 0 : currentWeapon(s); // (at the wheel both hands are on it; under our own eyes the view holds the weapon)
    if (item !== this.selfBodyItem) {
      this.selfBodyItem = item;
      sv.setWeapon(item);
    }
    const pair = !!item && isDual(s, s.slot); // (two of the gun: one in each fist, as the others see it)
    if (pair !== this.selfBodyPair) {
      this.selfBodyPair = pair;
      sv.setAkimbo(pair);
    }
    sv.object.position.set(rp.x, rp.y, rp.z);
    sv.object.rotation.set(0, this.input.yaw, 0);
    const ride = seat ? veh.place(seat, sv) : null;
    sv.update(dt, { sit: !!seat, sitNow: seat ? 1 : undefined, reach: ride?.reach, feet: ride?.feet, sitT: ride?.sitT, sitK: ride?.sitK, sitSplay: ride?.sitSplay, sitLean: ride?.sitLean, sitTwist: ride?.sitTwist, speed: seat ? 0 : hspeed, sprint: !!s.sprinting, crouch: !!s.crouch, pitch: seat && seat.k === 0 ? 0 : this.input.pitch, onGround: !!s.onGround, reloading: item !== ITEM.NUNCHAKU && s.reloadT > 0, wind: item === ITEM.NUNCHAKU ? s.reloadT : undefined, dead: false, time, cradle: cat.cradle, pet: cat.pet });
    const nk = item === ITEM.NUNCHAKU ? sv.nk() : null;
    if (nk) nkSounds(this.audio, nk.core, this.vm.visible ? null : { x: rp.x, y: rp.y + 1.3, z: rp.z }, this.nkSt2, time);
  },
};
