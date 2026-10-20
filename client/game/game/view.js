// Game: the first-person view - the camera, the hands and what they hold.
import * as THREE from 'three';
import { ZTYPE, ITEM } from '../../../shared/defs.js';
import { ENT, HOLD } from '../../../shared/protocol.js';
import { punchOf, stepClimb, punchAt } from '../aimview.js';
import { raycastWorld } from '../../../shared/collision.js';
import { ViewModel } from '../../render/models/weapons.js';
import { eyeHeight, currentWeapon, heldDef, shotClimb, aimingWith } from '../../../shared/playersim.js';
import { isDual } from '../../../shared/akimbo.js';
import { SLOT_BUILD, BTN } from '../../../shared/constants.js';
import { pryWeapon } from '../../../shared/trunk.js';
import { FaceLatch } from '../facelatch.js';
import { nkSounds } from '../nunchaku.js';

const _wcF = new THREE.Vector3(), _wcR = new THREE.Vector3(), _wcU = new THREE.Vector3(), _wcD = new THREE.Vector3();
const _wcHit = { t: -1, col: null, terrain: false };
const WC_RAYS = [[0, 0], [0.3, -0.25]]; // (right, up) of the view: straight on, and out past the right hand
const LAND_SPRING = 16; // rad/s of the camera's landing dip: lowest ~60 ms after touchdown, level again in ~0.35 s
// Turning while aimed is slowed by the gun's zoom, tan(aimed fov / 2) / tan(hip fov / 2) (the ratio of the two
// magnifications, the same on any aspect ratio), so what is under the crosshair slides across the screen as far per
// centimetre of mouse as it does from the hip, whatever the zoom. On top of that, AIM_SENS: at 1 aimed and hip would
// match exactly; 0.82 keeps an ordinary gun where the flat 0.6 it replaces had it (0.82 * 0.73 at 75 degrees). The
// "Aim sensitivity" setting multiplies it (1.22 there is the exact match).
const AIM_SENS = 0.82;
// the field of view down the sights, of the hip one: the scoped rifles' closer, any other gun's this
const ADS_ZOOM = { [ITEM.HUNTING_RIFLE]: 0.45, [ITEM.AT_RIFLE]: 0.6 };
const ADS_ZOOM_ANY = 0.78;
const _nkAcc = new THREE.Vector3();
const _nkQ = new THREE.Quaternion();

export const methods = {
  // The first-person arms and weapons. Baking their two 1024 px atlases holds the main thread for ~0.3 s, so it is
  // done in the shader warm-up behind the splash (warmViews), after the backdrop is on screen, or on the join if
  // that comes first - not in the constructor or the world build, where it held the splash's first picture back.
  ensureViewModel() {
    if (this.vm) return;
    this.vm = new ViewModel();
    this.renderer.vmScene.add(this.vm.group);
  },

  // How far the world is in front of the held item (m, along the view): two short rays from the eye, straight ahead and
  // out past the right hand where a gun's muzzle or a blade is, against walls, props, structures and the ground
  weaponClearance(cam) {
    const f = _wcF.set(0, 0, -1).applyQuaternion(cam.quaternion);
    const r = _wcR.set(1, 0, 0).applyQuaternion(cam.quaternion);
    const u = _wcU.set(0, 1, 0).applyQuaternion(cam.quaternion);
    let near = 99;
    for (const [a, b] of WC_RAYS) {
      const d = _wcD.copy(f).addScaledVector(r, a).addScaledVector(u, b).normalize();
      raycastWorld(this.world, cam.position.x, cam.position.y, cam.position.z, d.x, d.y, d.z, 1.4, _wcHit);
      if (_wcHit.t >= 0) near = Math.min(near, _wcHit.t * d.dot(f));
    }
    return near;
  },

  // something jolts the view: the shake builds up, to cap at most (updateCamera lets it die away)
  shakeView(amount, cap = 1) {
    this.camShake = Math.min(cap, (this.camShake || 0) + amount);
  },

  // a round of ours punches the view (aimview.js)
  punchView(def, aiming) {
    const p = punchOf(def, aiming);
    this.punch = p.amp;
    this.punchLen = p.len;
    this.punchT = 0;
  },

  // the crawler on our face, if one is (ZF.LINK: who it has hold of)
  latchedBy() {
    for (const e of this.entities.ents.values()) if (e.kind === ENT.ZOMBIE && e.ztype === ZTYPE.CRAWLER && e.q[6] === this.myId && !e.dead) return e;
    return null;
  },

  // The eye this frame: its height (eased: a crouch, a fall to the knees), the bob of the stride or the water, a landing's
  // dip, a step's lag, a heavy footfall's quake, the gun's climb and the last round's punch, the shake - and the camera
  // put there: a cutscene's, a debug camera's, our own, or the death cam
  updateCamera(dt, time, s, buttons, cine, hspeed, swim) {
    const self = this.self;
    const rp = this.renderPos;
    const inVeh = this.vehicles.eye.on;
    const targetEye = eyeHeight(s);
    this.eyeH += (targetEye - this.eyeH) * Math.min(1, dt * (s.downed ? 5 : 12));
    this.swimK += ((swim ? 1 : 0) - this.swimK) * Math.min(1, dt * 3);
    if (s.onGround && hspeed > 0.5 && !s.drive) this.camBob += dt * hspeed * (s.downed ? 3.2 : swim ? 1.3 : 1.9);
    // Every landing dips the view, by how hard it was: with the square of the fall speed (so with the height
    // fallen) from 4 cm after a jump up to the 12 cm of a hard landing, the one the simulation calls `land`
    // (9 m/s and up), which is this same dip and not another on top. "Weapon look sway" off is the one way a
    // player has to ask for less motion, so then only that hard landing dips, as it always has.
    if (!self.alive) this.fallV = 0;
    else if (!s.onGround) this.fallV = -s.vy;
    else {
      if (this.fallV > 9 || (this.fallV > 0 && this.settings.weaponSway !== false)) this.landVel += 0.12 * Math.min(1, (this.fallV / 9) ** 2) * LAND_SPRING * Math.E;
      this.fallV = 0;
    }
    // (a critically damped spring, solved exactly: a kick of d * LAND_SPRING * e bottoms out d below, 1 / LAND_SPRING s later)
    const landA = (this.landVel + LAND_SPRING * this.landDip) * dt;
    const landE = Math.exp(-LAND_SPRING * dt);
    this.landDip = Math.min(0.12, (this.landDip + landA) * landE); // two touchdowns in a row (a correction) don't add up
    this.landVel = (this.landVel - LAND_SPRING * landA) * landE;
    // a step up or down reaches the eye over ~100 ms (Prediction.viewLag), with the eye kept 0.3 m clear of the floor
    const stepLag = this.prediction.viewLag(dt, this.eyeH - 0.3);
    // a heavy footfall drops the view and rattles it, then dies away in ~0.4 s however faint it was: far off it is a
    // tremor that lasts as long as the jolt of one landing beside you
    this.quake *= Math.exp(-dt * 6);
    // Settings > Accessibility: camera shake (x the shake and the quake's drop, 0 holds the view still) and view bob
    const shakeK = this.settings.cameraShake ?? 1;
    const bobK = this.settings.viewBob === false ? 0 : 1;
    const bobY = (Math.sin(this.camBob * 2) * (s.downed ? 0.06 : 0.035) * Math.min(1, hspeed / 5) + this.swimK * (Math.sin(time * 1.7) * 0.035 + Math.sin(time * 0.63) * 0.02)) * bobK - this.landDip - stepLag - this.quake * 0.03 * shakeK;
    // the gun's climb and the last round's punch (aimview.js): the view is lifted by both, so the sights or the
    // crosshair are where the next round goes
    const gdef = self.alive && !s.zombie && !this.gun.manning ? heldDef(s) : null;
    this.viewClimb = stepClimb(this.viewClimb, gdef && !gdef.melee ? shotClimb(s, gdef, aimingWith(s, buttons)) : 0, dt);
    this.punchT += dt;
    const viewKick = this.viewClimb + this.punch * punchAt(this.punchT / this.punchLen);
    this.camShake = Math.max(0, (this.camShake || 0) - dt * 2.5);
    const shake = (this.camShake * 0.02 + this.effects.shake * 0.03 + this.quake * 0.02) * shakeK;
    const cam = this.camera;
    if (cine) {
      cine.update(dt, cam); // (a cutscene: the shot's camera, and its own field of view)
      cam.position.y += (Math.random() - 0.5) * shake;
    } else if (this.debugCam) {
      const d = this.debugCam;
      cam.position.set(d.x, d.y, d.z);
      cam.rotation.set(d.pitch, d.yaw, 0);
    } else if (self.alive) {
      if (inVeh) cam.position.set(this.vehicles.eye.x, this.vehicles.eye.y - this.quake * 0.03 * shakeK, this.vehicles.eye.z); // (carried: the seat's eye)
      else cam.position.set(rp.x, rp.y + this.eyeH + bobY, rp.z);
      const roll = (inVeh ? this.vehicles.eye.roll : 0) + (s.downed ? 0.18 + Math.sin(time * 1.3) * 0.03 : 0) + this.swimK * Math.sin(time * 1.1) * 0.025 * bobK;
      cam.rotation.set(this.input.pitch + viewKick + (Math.random() - 0.5) * shake, this.input.yaw + (Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake * 0.5 + roll);
      // nunchucks: the view goes with the strikes - a sprung nod, turn and roll from the moves and from what they hit
      // (ViewModel's rig, as of last frame). "Weapon look sway" off leaves the view still
      const nk = this.vm.itemId === ITEM.NUNCHAKU && this.settings.weaponSway !== false ? this.vm.nk?.core : null;
      if (nk) {
        cam.rotation.x += nk.kick.x;
        cam.rotation.y += nk.kick.y;
        cam.rotation.z += nk.kick.z;
      }
    } else {
      // death cam: slumped on the ground looking up
      cam.position.set(rp.x, rp.y + 0.35, rp.z);
      cam.rotation.set(0.9, this.input.yaw, 0.4);
    }
  },

  // Aiming down the sights: the field of view eases in to the gun's zoom (out a little at a sprint), and the look
  // sensitivity follows it. -> whether we are aiming
  updateZoom(dt, s, buttons, cine, wdef, swim) {
    const self = this.self;
    const cam = this.camera;
    // ADS zoom
    const aiming = self.alive && !!(buttons & BTN.ALT) && wdef && !wdef.melee && !wdef.pair && s.reloadT <= 0 && !this.handcar.handsOn && !this.vehicles.handsOn && !swim && !s.pet; // (hands on a handcar's lever or a vehicle's controls, swimming, the cat in our arms, or a pair: no sights)
    const baseFov = (this.debugCam && this.debugCam.fov) || this.settings.fov || 75; // (a debug camera may bring its own lens)
    const targetFov = aiming ? baseFov * (ADS_ZOOM[currentWeapon(s)] ?? ADS_ZOOM_ANY) : s.sprinting ? baseFov * 1.06 : baseFov;
    this.fovCur += (targetFov - this.fovCur) * Math.min(1, dt * 12);
    if (!cine && Math.abs(cam.fov - this.fovCur) > 0.01) {
      cam.fov = this.fovCur;
      cam.updateProjectionMatrix();
    }
    // look sensitivity follows the zoom as it eases in and out (see AIM_SENS), so the turn rate never steps mid-turn.
    // The sprint fov is wider than the hip one and must not speed the turn up; settled at the hip it is the setting alone
    this.aimT += ((aiming ? 1 : 0) - this.aimT) * Math.min(1, dt * 12);
    if (!aiming && this.aimT < 0.001) this.aimT = 0;
    const zoom = this.aimT > 0 ? Math.min(1, Math.tan((this.fovCur * Math.PI) / 360) / Math.tan((baseFov * Math.PI) / 360)) : 1;
    this.input.sensitivity = (this.settings.sensitivity || 1) * zoom * (1 + (AIM_SENS * (this.settings.aimSensitivity || 1) - 1) * this.aimT);
    return aiming;
  },

  // The hands and what they hold (render/models/weapons.js): the item, what the view model is told of the body and the
  // look this frame, the nunchucks' chain, a crawler over our eyes, the muzzle's light going out
  updateViewModel(dt, time, s, buttons, cine, hspeed, swim, aiming, lookDX, lookDY) {
    const self = this.self;
    const cam = this.camera;
    const weaponNow = s.zombie ? -2 : self.alive ? currentWeapon(s) : 0;
    const pairNow = weaponNow > 0 && isDual(s, s.slot); // (two of the gun: one in each hand, shared/akimbo.js)
    if (weaponNow !== this.vmItem || pairNow !== !!this.vmPair) {
      this.vmItem = weaponNow;
      this.vmPair = pairNow;
      this.input.clearToggle('aim'); // (an aim on toggle is let go with the weapon it was on)
      if (weaponNow === -2) this.vm.setItem(0, { claws: true });
      else this.vm.setItem(s.slot === SLOT_BUILD && !weaponNow ? 0 : weaponNow, { tuck: self.alive, akimbo: pairNow }); // (tuck: nunchucks are folded away first)
    }
    const stroking = this.cat.holding && !!(buttons & BTN.ATTACK) && !this.ui.inventoryOpen && !this.ui.mapOpen; // (the cat in our arms, the fire button held)
    this.cat.update(dt, stroking);
    this.vm.setVisible(self.alive && !cine && !this.ui.inventoryOpen && !this.ui.mapOpen && !this.ui.boardOpen && !this.ui.bestiaryOpen && !this.ui.cardsOpen && !this.debugCam && !this.gun.manning && !s.hmg && !this.handcar.handsOn && !this.vehicles.handsOn && !swim);
    const wallDist = self.alive ? this.weaponClearance(cam) : 99; // (the viewmodel tucks back off a wall in front)
    const vmState = { speed: hspeed, sprint: !!s.sprinting, onGround: !!s.onGround, crouch: !!s.crouch, aiming, lookDX, lookDY, time, loaded: s.mags[0] > 0, talk: this.radio.keyed, wallDist, pinned: !!s.pinned && !!self.alive, ears: s.ears > 0 && !!self.alive, shove: s.shove, pet: stroking };
    const vmCam = this.renderer.vmCamera;
    if (Math.abs(vmCam.fov - this.vm.fov) > 0.01) {
      vmCam.fov = this.vm.fov; // (as of last frame: the aimed view of iron sights is narrowed onto them, cfg.adsFov)
      vmCam.updateProjectionMatrix();
    }
    if (this.vm.itemId === ITEM.NUNCHAKU) {
      // (asked of the view itself: for a moment after another weapon is asked for they are still in the hands, being
      // folded away)
      // nunchucks: their chain hangs in the world, not in the view - it needs which way the eye looks and how the
      // eye is being carried (so it swings as the view turns and trails as the body starts and stops); and the
      // heavy attack's wind-up clock, straight from the predicted state
      const k = dt > 0 ? 1 / dt : 0;
      _nkAcc.set((s.vx - this.nkVx) * k, 0, (s.vz - this.nkVz) * k).applyQuaternion(_nkQ.copy(cam.quaternion).invert());
      this.nkVx = s.vx;
      this.nkVz = s.vz;
      vmState.camQ = cam.quaternion;
      vmState.acc = _nkAcc;
      vmState.nkWind = weaponNow === ITEM.NUNCHAKU ? s.reloadT : 0;
      // (the reload key has nothing to reload: it asks for the flourish)
      if (weaponNow === ITEM.NUNCHAKU && buttons & BTN.RELOAD && !(this.nkBtn & BTN.RELOAD) && self.alive) {
        if (this.vm.nkFlourish()) this.selfBody?.nkFlourish();
      }
      this.nkBtn = buttons;
    }
    // (forcing a car's boot: the weapon in the hand is the lever)
    const prying = self.holdKind === HOLD.SEARCH && this.entities.ents.get(this.holding);
    vmState.pry = !!(prying && this.bootOf(prying)?.shut && pryWeapon(weaponNow));
    this.vm.update(dt, vmState);
    // a crawler on our face: the animal itself over our eyes, its belly to them (built the first time one lands)
    const latched = vmState.pinned && !s.zombie && !cine && !this.debugCam && !!this.latchedBy();
    if (latched && !this.faceLatch) this.faceLatch = new FaceLatch(this.renderer.vmScene);
    this.faceLatch?.update(dt, latched, s.shove, time);
    if (this.vm.itemId === ITEM.NUNCHAKU && this.vm.nk) nkSounds(this.audio, this.vm.nk.core, null, this.nkSt, time);
    if (this.vmMuzzleT > 0) {
      this.vmMuzzleT -= dt;
      if (this.vmMuzzleT <= 0) this.renderer.vmMuzzle.intensity = 0;
    }
  },

  // what the post passes are told of us this frame: hurt, low, turned, down or dead (render/renderer.js)
  updatePost(dt, time, s) {
    const self = this.self;
    const hpFrac = self.maxHp ? self.hp / self.maxHp : 1;
    this.damageFx = Math.max(0, this.damageFx - dt * 1.5);
    const lowHealth = self.alive && !self.zombie ? (s.downed ? 1 : Math.max(0, 1 - hpFrac / 0.3)) : 0;
    this.post = {
      time,
      night: this.env.night,
      damage: this.damageFx,
      lowHealth,
      infected: self.zombie ? 1 : 0,
      dead: self.alive ? (s.downed ? 0.35 : 0) : 1,
      exposure: this.env.exposure * (self.zombie ? 1.6 : 1),
      rays: this.env.rays,
      beam: this.beamState(),
      adaptRef: self.alive ? this.env.adaptRef : 0,
      dt,
    };
  },
};
