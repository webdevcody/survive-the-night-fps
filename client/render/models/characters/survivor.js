// A survivor (a player's avatar): the model of a roster survivor or a custom one, alive and turned (getSurvivorRig),
// and the instance that poses it - walking, crouching, seated, swimming, holding and using what it holds, carrying a
// cat, talking - or, turned or dead, poses it as the dead are posed (characters/pose.js).
import * as THREE from 'three';
import { ZTYPE, ZOMBIE_DEFS, ZANIM, ITEM, WEAPONS } from '../../../../shared/defs.js';
import { isLookKey } from '../../../../shared/appearance.js';
import { CHARACTERS } from '../../../../shared/characters.js';
import { MeshBuilder, instantiateRig, setFx, getCharacterMaterial, getPropMaterial, ikTwoBone, mulberry32, clamp, lerp, smooth, color } from '../skinning.js';
import { CR } from '../charTextures.js';
import { createWorldWeapon, getNunchakuGeo } from '../weapons.js';
import { createBackpack, WORN_AT } from '../backpack.js';

import { NunchakuTP } from '../nunchaku.js';
import { catBackY } from '../cat.js';
import {
  HIPS, SPINE, CHEST, NECK, HEAD, JAW, CLAV_L, UARM_L, FARM_L, HAND_L, CLAV_R, UARM_R, FARM_R, HAND_R, THIGH_L, SHIN_L, FOOT_L, THIGH_R, SHIN_R, FOOT_R,
} from './skeleton.js';
import { clearPose, R, A, chestPitch, arm, legCycle, blendPose } from './posekit.js';
import { poseHumanoid } from './pose.js';
import { gaitLen } from './gait.js';
import { STYLES } from '../zombies/index.js';
import { SURVIVOR_LOOKS, PACK_PIVOT, getSurvivorRig, holdLook, dropLook } from './survivorrig.js';

const PI = Math.PI;
const TAU = PI * 2;
const HALF = PI / 2;

// weapon holding categories
const HOLD_NONE = 0, HOLD_RIFLE = 1, HOLD_PISTOL = 2, HOLD_MELEE = 3, HOLD_THROW = 4, HOLD_RADIO = 5;
// what the swimming pose (SurvivorInstance.poseSwim) moves, blended over the rest: torso, head, arms, legs
const SWIM_BONES = [HIPS, SPINE, CHEST, NECK, HEAD, UARM_L, UARM_L + 1, UARM_L + 2, UARM_R, UARM_R + 1, UARM_R + 2, THIGH_L, THIGH_L + 1, THIGH_L + 2, THIGH_R, THIGH_R + 1, THIGH_R + 2];
function holdFor(item) {
  if (!item) return HOLD_NONE;
  if (item === ITEM.WALKIE) return HOLD_RADIO;
  const w = WEAPONS[item];
  if (w && !w.melee) return w.slot === 1 ? HOLD_PISTOL : HOLD_RIFLE;
  if (item === ITEM.MOLOTOV || item === ITEM.PIPEBOMB || item === ITEM.GRENADE || item === ITEM.DECOY) return HOLD_THROW;
  if (w && w.melee) return HOLD_MELEE;
  return HOLD_THROW; // generic held item
}

// preallocated temps for survivor IK
const _S = new THREE.Vector3();
const _T = new THREE.Vector3();
const _T2 = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _qW = new THREE.Quaternion();
const _qH = new THREE.Quaternion();
const _qU = new THREE.Quaternion();
const _qL = new THREE.Quaternion();
const _qTmp = new THREE.Quaternion();
// weapon mount under the right hand: guns/throwables Rx(-90deg) (barrel along the forearm),
// melee identity (handle through the fist, blade out of the thumb side) - see the weapon space conventions in weapons/parts.js
const _qMountInvGun = new THREE.Quaternion().setFromEuler(new THREE.Euler(HALF, 0, 0));
const _qMountInvMelee = new THREE.Quaternion();
const _e = new THREE.Euler();
const _grip = new THREE.Vector3();
const _gripL = new THREE.Vector3();
const _qWL = new THREE.Quaternion();
const _lh = new THREE.Vector3();
const _off = new THREE.Vector3();
const _reachM = new THREE.Matrix4();
const REACH_FIST = 0.075; // the middle of a closed fist, out from the wrist
const MOUNT_POS = new THREE.Vector3(-0.025, -0.08, 0);
const MOUNT_POS_L = new THREE.Vector3(0.025, -0.08, 0); // (the left fist's, for what a left hand holds: nunchucks)
// a pair of the gun (PSTAT.AKIMBO, setAkimbo): each held out in front of its own shoulder in the pistol hold, the left
// arm and gun the right ones mirrored. How far out from the middle of the chest the grips are
const PAIR_GRIP_X = 0.17;
const PAIR_STOCK_CLEAR = 0.08; // ...and a pair of shotguns that much further forward, its stocks clear of the chest,
const PAIR_LONG_DOWN = -0.12; // ...and tipped down no further than this (rad), however low the look
// the stray cat in their arms (s.cradle, s.pet): the forearms across in front of them under it (arm()'s pitch, abduction,
// twist, elbow), and where the cat lies (cradleAt): its feet from the left wrist, in the survivor's frame. Stroking it
// (solvePet), the right fist is put on its back by IK, the elbow out to the side and up so the forearm comes down onto
// it: along its spine from PET_Z[0] to PET_Z[1] (the cat's own z) in the first PET_ALONG of each stroke, then lifted
// PET_UP clear of it on the way back, at the viewmodel's pace (PET_TIME). Measured against the posed cat like a held
// item (models-hold.js &cat=1&clip=1)
const CRADLE = [0.22, 0.18, 0.75, 1.42];
const PET_ARM = [0.95, 0.3, 1.0, 1.6]; // (arm()'s, under the IK: where the elbow starts from)
const PET_Z = [-0.03, 0.07];
const PET_ALONG = 0.6;
const PET_UP = 0.05;
const PET_TIME = 1.15;
const PET_FIST = 0.04; // the fist's middle over the fur (its half-height, and a few mm)
const PET_TILT = 1.35; // the fist turned forward and down onto it from hanging (chest space)
const PET_REACH = 0.08; // the fist's middle from the wrist, along the hand
const PET_POLE = new THREE.Vector3(1, 0.1, 0.5); // (the elbow out to the side and back, over the fist: the forearm comes down onto it)
const _qPet = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), PET_TILT);
const PET_WRIST = new THREE.Vector3(0, PET_REACH * Math.cos(PET_TILT), PET_REACH * Math.sin(PET_TILT)); // the wrist from the fist's middle
const _cat = new THREE.Vector3();
const CRADLE_CAT = new THREE.Vector3(-0.005, -0.065, -0.05);
const _cr = new THREE.Vector3();
let STOCK_POCKET = -0.14; // (chest-bone space, z) where a shouldered butt ends: the front of the shoulder, in its clothes (the lofted bodies' shoulders are 4 cm further out than the old boxes': measured on four of them, scripts/clip/survey.js)
let RPG_LIFT = 0.14; // the RPG's grip raised so the tube clears the top of the shoulder instead of running through it
// the throwables' radius across the palm (m), and where the survivor's fist's palm face is (x, hand-bone space; less a
// few mm where the fingers wrap)
const THROW_RADIUS = { [ITEM.GRENADE]: 0.032, [ITEM.MOLOTOV]: 0.0335, [ITEM.PIPEBOMB]: 0.0245, [ITEM.FLARE]: 0.017, [ITEM.DECOY]: 0.044 };
const FIST_PALM_X = -0.025;
const PACK_HANG = [1, 0.5]; // how much of the chest's bend (and of the spine's, times the chest's share) the pack undoes
const _mountW = new THREE.Vector3();

// Talking (s.voice: how loud they are on voice chat, Voice.mouthLevel). The mouth pops open on each syllable and
// relaxes shut a little slower; through the short gaps between words it stays a dark slit, and it goes 0.4 s after
// the last one. Loudness is the RMS of the speaker's own stream: about 0.05-0.15 in speech, under 0.01 when silent.
const MOUTH_FLOOR = 0.02; // the level the mouth starts to open at...
const MOUTH_RANGE = 0.12; // ...and how much louder than that it is wide open
const MOUTH_TALK = 0.03; // louder than this is a word: the mouth shows (for MOUTH_HOLD s after)
const MOUTH_HOLD = 0.4;
const MOUTH_SLIT = 0.08; // the mouth between words, as a fraction of wide open
const MOUTH_JAW = 0.2; // the jaw drops this far (rad) wide open...
const MOUTH_NOD = 0.04; // ...and the head lifts this much
let _mouthGeo = null;
/** The inside of the mouth, on the head bone: a thin dark lens laid on the face under the nose (bent round it and
 *  leaning back with it), the tongue at its bottom. No teeth: a pale line along the top read as a grimace between
 *  words. Its top edge is at the origin, so scaling it in Y opens it downward; the jaw (which drops with it) covers
 *  its lower part. It sits on the lip line of the head (humans.js headPoint: rig.mouth), just behind the lips, the
 *  face there sloping back about 0.5 per unit down and curving back 0.95 x^2 / hr to the sides. */
function createMouth(rig) {
  const hr = rig.P.headR;
  if (!_mouthGeo) {
    const mb = new MeshBuilder({ skinned: false });
    const ry = hr * 0.13;
    mb.ellip(0, [0, -ry, 0], [hr * 0.25, ry, hr * 0.025], {
      ws: 14, hs: 6, color: 0x1e0907, region: CR.PLAIN, ao: false, blood: false, mottle: 0,
      shape(v) {
        v.z += (0.95 * v.x * v.x) / hr;
      },
      tint(p, n, c) {
        if (-p.y > ry * 1.4) c.lerp(color(0x5a1c1a), 0.8); // the tongue
      },
    });
    _mouthGeo = mb.build().geometry;
  }
  const m = new THREE.Mesh(_mouthGeo, getCharacterMaterial());
  m.name = 'mouth';
  const a = rig.mouth;
  m.position.set(0, a.y + hr * 0.035, a.z + hr * 0.035);
  m.rotation.x = -Math.atan(0.5);
  m.visible = false;
  return m;
}

class SurvivorInstance {
  // character: a roster id, or a custom look's key ('a:<code>'); transient: a model of its own, let go with it (the
  // creator's preview, rebuilt at every change)
  constructor(seed, character = -1, { transient = false } = {}) {
    this.seed = seed >>> 0;
    const custom = isLookKey(character);
    this.look = custom ? character : character >= 0 && character < SURVIVOR_LOOKS ? character | 0 : this.seed % SURVIVOR_LOOKS;
    this.character = custom ? { id: -1, name: 'Survivor', custom: true } : CHARACTERS[this.look];
    this.transient = transient;
    if (!transient) holdLook(this.look);
    const rnd = mulberry32(this.seed * 7 + 3);
    this.rigH = getSurvivorRig(this.look, false, transient);
    this.rigZ = null;
    this.P = this.rigH.P;
    const inst = instantiateRig(this.rigH, getCharacterMaterial(), 1.6);
    this.mesh = inst.mesh;
    this.bones = inst.bones;
    this.skeleton = inst.skeleton;
    this.fx = inst.fx;
    this.nb = this.bones.length;
    this.X = {};
    for (const [n, i] of this.rigH.names) this.X[n] = i;
    this.object = new THREE.Group();
    this.object.name = 'survivor';
    this.body = new THREE.Group();
    this.body.add(this.mesh);
    this.object.add(this.body);
    this.pose = new Float32Array(this.nb * 4 + 3);
    this.snap = new Float32Array(this.nb * 4 + 3);
    this.out = new Float32Array(this.nb * 4 + 3);
    this.zombie = false;
    this.item = 0;
    this.hold = HOLD_NONE;
    this.weapon = null;
    this.stockZ = 0;
    this.mount = new THREE.Object3D();
    this.mount.position.copy(MOUNT_POS);
    this.mount.rotation.set(-HALF, 0, 0);
    this.bones[HAND_R].add(this.mount);
    // the left gun of a pair, in the left fist, mirrored (setAkimbo)
    this.akimbo = false;
    this.weaponL = null;
    this.muzzleL = null;
    this.mountL = new THREE.Object3D();
    this.mountL.position.copy(MOUNT_POS_L);
    this.mountL.rotation.set(-HALF, 0, 0);
    this.bones[HAND_L].add(this.mountL);
    this.fireLeft = true; // (the gun of a pair that went off last: the right one goes first)
    this.flashlightAnchor = new THREE.Object3D();
    this.flashlightAnchor.position.set(0.16, this.P.shoulderY - this.P.chestY + 0.02, -0.16);
    this.bones[CHEST].add(this.flashlightAnchor);
    // the crafted backpack on the back of the chest, where the shoulder straps sit: shown while one is worn (setBackpack)
    this.pack = createBackpack(true, this.rigH.strapFit);
    this.packDZ = this.rigH.packDZ || 0;
    this.holdDZ = this.rigH.holdDZ || 0; // (how far this body's back is from the default one's)
    this.pack.position.set(WORN_AT[0], WORN_AT[1], WORN_AT[2] + this.packDZ);
    this.pack.visible = false;
    this.bones[CHEST].add(this.pack);
    this.packOn = false;
    this.headCenter = new THREE.Object3D();
    this.headCenter.position.set(0, this.P.headR * 0.9, 0);
    this.bones[HEAD].add(this.headCenter);
    this.object.userData.head = this.headCenter;
    this.mouth = createMouth(this.rigH);
    this.bones[HEAD].add(this.mouth);
    this.mouthOpen = 0; // 0 shut .. 1 wide open (updateMouth)
    this.talkT = 0; // the mouth shows while this runs down: MOUTH_HOLD from the last word
    this.phase = rnd() * TAU;
    this.time = 0;
    this.off = rnd() * 50;
    this.hit = 0;
    this.stateKey = -1;
    this.stateT = 0;
    this.fadeT = 1;
    this.fadeDur = 0.2;
    this.pulseFire = 9;
    this.pulseFireL = 9;
    this.pulseMelee = 9;
    this.pulseThrow = 9;
    this.meleeSide = 0;
    this.deadT = 0;
    this.crouchW = 0;
    this.sitW = 0; // seated (a ride at the fair): thighs level, shins hanging
    this.airW = 0;
    this.runW = 0;
    this.reloadW = 0;
    this.swimW = 0; // afloat in the water (shared/swim.js)
    this.swimPh = 0; // ...and the stroke's clock
    this.talkW = 0; // on the air with the walkie-talkie (s.talk): raised to the mouth
    this.s = null;
    // zombie-mode animation shim (reuses humanoid zombie pose code)
    this.z = {
      type: ZTYPE.WALKER, def: ZOMBIE_DEFS[ZTYPE.WALKER], st: STYLES[ZTYPE.RUNNER], P: this.P, nb: this.nb, pose: this.pose,
      X: this.X, seed: this.seed, off: this.off, rate: 1, limpSide: 0, armSide: 1, deadDir: this.seed & 1 ? 1 : -1, tilt: 1,
      state: ZANIM.IDLE, stateT: 0, time: 0, phase: 0, speed: 0, sacPulse: 0, bellyPulse: 0, abdPulse: 0,
    };
    this.deadDir = this.seed & 1 ? 1 : -1;
    this._seen = true;
    this.mesh.onBeforeRender = () => {
      this._seen = true;
    };
  }

  setWeapon(item) {
    item = item | 0;
    if (item === this.item && (this.weapon || !item)) return;
    this.item = item;
    this.hold = holdFor(item);
    if (this.weapon) {
      if (this.weapon.parent === this.mount) this.mount.remove(this.weapon);
      this.weapon = null;
    }
    this.mount.rotation.set(this.hold === HOLD_MELEE ? 0 : -HALF, 0, 0);
    // a throwable is wider than the fist: held against the palm, not through it
    this.mount.position.copy(MOUNT_POS);
    if (THROW_RADIUS[item]) this.mount.position.x = FIST_PALM_X - THROW_RADIUS[item];
    if (this.nk) this.nk.group.visible = false;
    if (item === ITEM.NUNCHAKU && !this.zombie) {
      // nunchucks: nothing rides in the fist as a fixed model. Both handles and the chain are the simulation's
      // (models/nunchaku.js), drawn in the chest's space, and both arms are solved to where it has the hands
      if (!this.nk) {
        this.nk = new NunchakuTP(getNunchakuGeo(false), getPropMaterial(), this.P);
        this.bones[CHEST].add(this.nk.group);
      }
      this.nk.group.visible = true;
      this.nk.core.draw();
      this.weapon = this.nk.group;
      this.muzzle = null;
      this.leftGrip = null;
      this.stockZ = 0;
      this._syncPair();
      return;
    }
    if (item && !this.zombie) {
      const w = createWorldWeapon(item);
      if (w) {
        this.weapon = w;
        this.mount.add(w);
        this.muzzle = w.getObjectByName('muzzle') || null;
        this.leftGrip = w.userData && w.userData.leftHand ? w.userData.leftHand : null;
        // how far the butt reaches behind the grip (weapon space +Z)
        const wm = w.getObjectByName('weaponMesh');
        if (wm && !wm.geometry.boundingBox) wm.geometry.computeBoundingBox();
        this.stockZ = wm ? Math.max(0, wm.geometry.boundingBox.max.z) : 0;
      }
    }
    this._syncPair();
  }

  // wearing the crafted backpack (PFLAG.BACKPACK). (The dead carry none)
  setBackpack(on) {
    this.packOn = !!on;
    this.pack.visible = this.packOn && !this.zombie;
  }

  setZombie(v) {
    v = !!v;
    if (v === this.zombie) return;
    this.zombie = v;
    this.pack.visible = this.packOn && !v;
    if (v && !this.rigZ) this.rigZ = getSurvivorRig(this.look, true, this.transient);
    this.mesh.geometry = v ? this.rigZ.geometry : this.rigH.geometry;
    if (this.weapon) this.weapon.visible = !v;
    if (!v && this.item && !this.weapon) this.setWeapon(this.item);
    this._syncPair();
    this.z.state = -1;
  }

  // two of the gun in hand (PSTAT.AKIMBO): one in each fist
  setAkimbo(on) {
    this.akimbo = !!on;
    this._syncPair();
  }
  _syncPair() {
    const want = this.akimbo && !this.zombie && !!this.weapon && (this.hold === HOLD_PISTOL || this.hold === HOLD_RIFLE) ? this.item : 0;
    if ((this.weaponL?.userData.item | 0) === want) return;
    if (this.weaponL) this.mountL.remove(this.weaponL);
    this.weaponL = this.muzzleL = null;
    if (!want) return;
    const w = createWorldWeapon(want);
    if (!w) return;
    w.scale.x = -1;
    w.userData.item = want;
    this.mountL.add(w);
    this.weaponL = w;
    this.muzzleL = w.getObjectByName('muzzle') || null;
    this.fireLeft = true;
  }
  get paired() {
    return !!this.weaponL;
  }

  fire() {
    // (a pair: the guns go off in turn, from the right)
    if (this.paired) this.fireLeft = !this.fireLeft;
    if (this.paired && this.fireLeft) this.pulseFireL = 0;
    else this.pulseFire = 0;
  }
  melee() {
    this.pulseMelee = 0;
    this.meleeSide ^= 1;
    // (nunchucks: which move is not on the wire; the rig works it out the way the rules do)
    if (this.nk && this.item === ITEM.NUNCHAKU && !this.zombie) this.nk.swing(-1, this.s || {});
  }
  /** Nunchucks: a move begins, named (ours); a blow of it landed. */
  nkSwing(move) {
    if (this.nk && this.item === ITEM.NUNCHAKU) this.nk.swing(move, this.s || {});
  }
  nkHit(kind, power = 1) {
    if (this.nk && this.item === ITEM.NUNCHAKU) this.nk.core.hit(kind, 0, 0.1, 1, power);
  }
  throwAnim() {
    this.pulseThrow = 0;
  }
  flash(a) {
    this.hit = Math.max(this.hit, clamp(a, 0, 1));
    setFx(this.fx, this.hit, 1);
  }

  getMuzzleWorld(out) {
    if (this.paired && this.fireLeft && this.muzzleL && this.weaponL.visible) return this.muzzleL.getWorldPosition(out);
    if (this.weapon && this.muzzle && this.weapon.visible) return this.muzzle.getWorldPosition(out);
    return this.bones[HAND_R].getWorldPosition(out);
  }

  /** Where the stray cat lies in their arms (s.cradle): its feet, in the world, across the forearms. Its head is to
   *  their left (its yaw is theirs + PI / 2). After update. */
  cradleAt(out) {
    this.bones[HAND_L].getWorldPosition(out);
    return out.add(_cr.copy(CRADLE_CAT).applyQuaternion(this.object.quaternion));
  }

  /** The right fist stroking the cat in their arms (s.cradle, s.pet): two-bone IK, in chest space as solveArms does */
  solvePet(time) {
    const P = this.P;
    const b = this.bones;
    this.object.updateMatrixWorld(true);
    this.cradleAt(_cat);
    // where along it this moment of the stroke is (its z), and how far up off it on the way back
    const u = (time / PET_TIME) % 1;
    const along = u < PET_ALONG;
    const k = along ? smooth(u / PET_ALONG) : 1 - smooth((u - PET_ALONG) / (1 - PET_ALONG));
    const z = PET_Z[0] + (PET_Z[1] - PET_Z[0]) * k;
    const up = along ? 0 : Math.sin((PI * (u - PET_ALONG)) / (1 - PET_ALONG)) * PET_UP;
    // the fist's middle over its back: in the survivor's frame its spine runs along x (its head to their left)
    _T.set(z, catBackY(z, -0.04, 0.04) + PET_FIST + up, 0).applyQuaternion(this.object.quaternion).add(_cat);
    b[CHEST].worldToLocal(_T);
    _T.add(PET_WRIST);
    _S.set(P.shoulderW, P.shoulderY - P.chestY, 0);
    ikTwoBone(_S, _T, P.uarmLen, P.farmLen, PET_POLE, _qU, _qL);
    const clavR = b[CLAV_R].quaternion;
    _qTmp.copy(clavR).invert().multiply(_qU);
    b[UARM_R].quaternion.copy(_qTmp);
    b[FARM_R].quaternion.copy(_qL);
    _qTmp.copy(clavR).multiply(b[UARM_R].quaternion).multiply(_qL).invert().multiply(_qPet);
    b[HAND_R].quaternion.copy(_qTmp);
  }

  update(dt, s) {
    if (dt > 0.1) dt = 0.1;
    this.s = s;
    this._dt = dt;
    const time = s.time ?? this.time + dt;
    this.time = time;
    this.pulseFire += dt;
    this.pulseFireL += dt;
    this.pulseMelee += dt;
    this.pulseThrow += dt;
    if (this.hit > 0) this.hit = Math.max(0, this.hit - dt * 5);
    setFx(this.fx, this.hit, 1);
    const speed = s.speed || 0;
    // state key for crossfades (major pose changes only)
    const key = s.dead ? 3 : this.zombie ? 2 : 1;
    if (key !== this.stateKey) {
      this.captureSnap();
      this.stateKey = key;
      this.stateT = 0;
      this.fadeT = 0;
      this.fadeDur = s.dead ? 0.1 : 0.25;
    }
    this.stateT += dt;
    this.fadeT += dt;
    const k = 1 - Math.exp(-dt * 10);
    this.crouchW += ((s.crouch && !s.sit ? 1 : 0) - this.crouchW) * k;
    // (s.sitNow: how far into the seat they are, said outright - a vehicle's seat, where the body is moved in from
    // beside it as it folds: game/vehicles.js)
    if (s.sitNow !== undefined) this.sitW = s.sit ? s.sitNow : 0;
    else this.sitW += ((s.sit ? 1 : 0) - this.sitW) * k;
    this.airW += ((s.onGround === false ? 1 : 0) - this.airW) * (1 - Math.exp(-dt * 12));
    this.runW += ((s.sprint && speed > 4 ? 1 : 0) - this.runW) * k;
    this.reloadW += ((s.reloading ? 1 : 0) - this.reloadW) * k;
    this.swimW += ((s.swim ? 1 : 0) - this.swimW) * (1 - Math.exp(-dt * 5));
    this.swimPh += dt * (1.8 + 1.6 * clamp(speed / 2, 0, 1));
    this.talkW += ((s.talk ? 1 : 0) - this.talkW) * k;
    // talking on voice chat: nothing to do for anyone who is not (zombies and the dead are out of it)
    const voice = this.zombie || s.dead ? 0 : s.voice || 0;
    if (voice > 0 || this.talkT > 0) this.updateMouth(dt, voice);
    const z = this.z;
    let cyc = lerp(lerp(1.7, 2.5, clamp(speed / 7, 0, 1)), 1.1, this.crouchW);
    if (this.zombie) {
      z.st = STYLES[ZTYPE.RUNNER];
      cyc = gaitLen(z, speed > 3, speed); // the runner gait plants its feet against this stride
    }
    this.phase += (dt * speed * TAU) / cyc;
    // zombie-mode / death state machine (advances even when culled)
    if (this.zombie || s.dead) {
      const anim = s.dead ? ZANIM.DEAD : s.onGround === false ? ZANIM.AIRBORNE : this.pulseMelee < 0.5 ? ZANIM.ATTACK : speed > 3 ? ZANIM.RUN : speed > 0.3 ? ZANIM.WALK : ZANIM.IDLE;
      if (anim !== z.state) {
        if (z.state >= 0 && this.fadeT > 0) {
          // crossfade between zombie-mode states too
          this.captureSnap();
          this.fadeT = 0;
          this.fadeDur = anim === ZANIM.DEAD ? 0.12 : 0.2;
        }
        z.state = anim;
        z.stateT = 0;
      }
      z.stateT += dt;
    }
    const seen = this._seen;
    this._seen = false;
    if (!seen && this.fadeT > this.fadeDur) return;

    const p = this.pose;
    let ik = false;
    if (this.zombie || s.dead) {
      const anim = z.state;
      z.time = time;
      z.speed = speed;
      z.phase = this.phase;
      z.st = this.zombie ? STYLES[ZTYPE.RUNNER] : SURV_STYLE;
      z.deadDir = this.deadDir;
      poseHumanoid(z);
      if (anim === ZANIM.ATTACK && this.zombie) {
        const u = clamp(this.pulseMelee / 0.45, 0, 1);
        const sw = Math.sin(u * PI);
        arm(p, this.meleeSide, 1.2 + 0.9 * sw, 0.5 - 0.9 * sw, 0.2, 0.3, 0.4);
      }
    } else {
      this.poseHuman(p, s, speed, time);
      if (s.sitLean && this.sitW > 0) {
        // over the bars: the trunk forward, the head still up
        const l = s.sitLean * this.sitW;
        p[SPINE * 4] -= l * 0.5;
        p[CHEST * 4] -= l * 0.5;
        p[NECK * 4] += l * 0.45;
        p[HEAD * 4] += l * 0.35;
      }
      if (s.sitTwist && this.sitW > 0) {
        // carried, and aiming out of the side: the trunk comes round to it
        const t = s.sitTwist * this.sitW;
        p[SPINE * 4 + 1] += t * 0.4;
        p[CHEST * 4 + 1] += t * 0.45;
        p[HEAD * 4 + 1] += t * 0.15;
      }
      ik = this.hold !== HOLD_NONE;
    }
    const o = this.out;
    if (this.fadeT < this.fadeDur) blendPose(o, this.snap, p, smooth(this.fadeT / this.fadeDur));
    else o.set(p);
    this.applyPose(o);
    if (ik) this.solveArms(s, time);
    else if (s.cradle && s.pet && !this.zombie && !s.dead) this.solvePet(time);
    if (s.reach && !this.zombie && !s.dead) this.solveReach(s.reach);
    if (s.feet && !this.zombie && !s.dead && this.sitW > 0.02) this.solveFeet(s.feet, this.sitW);
    if (this.hide) {
      // seen from our own eyes (in a vehicle's seat): no head in the way, and no arms where the view's own are
      this.bones[HEAD].scale.setScalar(0.001);
      if (this.hide > 1) {
        this.bones[UARM_L].scale.setScalar(0.001);
        this.bones[UARM_R].scale.setScalar(0.001);
      }
    }
    if (this.packOn) this.hangPack();
    // flashlight follows the full aim pitch (chest only carries part of it)
    const fl = this.flashlightAnchor;
    if (this.zombie || s.dead) fl.rotation.set(0, 0, 0);
    else fl.rotation.set(clamp(s.pitch || 0, -1.4, 1.4) - (o[HIPS * 4] + o[SPINE * 4] + o[CHEST * 4]), 0, 0);
  }

  /** Voice chat loudness to the mouth (see MOUTH_*): called while they talk and through the hold after. */
  updateMouth(dt, voice) {
    const want = clamp((voice - MOUTH_FLOOR) / MOUTH_RANGE, 0, 1);
    this.mouthOpen += (want - this.mouthOpen) * Math.min(1, dt * (want > this.mouthOpen ? 35 : 15));
    if (voice > MOUTH_TALK) this.talkT = MOUTH_HOLD;
    else this.talkT = Math.max(0, this.talkT - dt);
    if (this.zombie || this.s.dead) this.talkT = 0; // (shut at once, not after the hold)
    const on = this.talkT > 0;
    if (!on) this.mouthOpen = 0;
    this.mouth.visible = on;
    if (on) this.mouth.scale.set(1 - 0.2 * this.mouthOpen, MOUTH_SLIT + (1 - MOUTH_SLIT) * this.mouthOpen, 1);
  }

  /**
   * The worn pack hangs from its shoulder straps: it is on the chest bone, but its bottom sits at the small of the back,
   * where the chest's own bend doesn't reach. Turned with the chest, a look up or down (and the downed sprawl) swung
   * the bottom into the lower back by up to 15 cm, so it is turned back by PACK_HANG of the chest's and the spine's
   * bend, about the top of its back panel.
   */
  hangPack() {
    const b = this.bones;
    const a = -Math.max(0, b[CHEST].rotation.x + b[SPINE].rotation.x * PACK_HANG[1]) * PACK_HANG[0]; // (a lean forward takes the back with it)
    const c = Math.cos(a), sn = Math.sin(a);
    const dy = WORN_AT[1] - PACK_PIVOT[1], dz = WORN_AT[2] - PACK_PIVOT[2];
    this.pack.position.set(WORN_AT[0], PACK_PIVOT[1] + dy * c - dz * sn, PACK_PIVOT[2] + this.packDZ + dy * sn + dz * c);
    this.pack.rotation.x = a;
  }

  /** Snapshot the CURRENT bone pose (including IK-driven arms) for crossfading. */
  captureSnap() {
    const b = this.bones, sn = this.snap, nb = this.nb;
    for (let i = 1; i < nb; i++) {
      const k = i * 4, r = b[i].rotation;
      sn[k] = r.x;
      sn[k + 1] = r.y;
      sn[k + 2] = r.z;
      sn[k + 3] = b[i].scale.x;
    }
    sn[nb * 4] = b[1].position.x;
    sn[nb * 4 + 1] = b[1].position.y;
    sn[nb * 4 + 2] = b[1].position.z;
  }

  applyPose(p) {
    const b = this.bones;
    const nb = this.nb;
    for (let i = 1; i < nb; i++) {
      const k = i * 4;
      b[i].rotation.set(p[k], p[k + 1], p[k + 2]);
      const sc = p[k + 3];
      b[i].scale.set(sc, sc, sc);
    }
    b[1].position.set(p[nb * 4], p[nb * 4 + 1], p[nb * 4 + 2]);
  }

  /** Human locomotion + torso aim (arms solved by IK afterwards). */
  poseHuman(p, s, speed, time) {
    clearPose(p, this.nb);
    const z = this.z;
    z.phase = this.phase;
    const ph = this.phase;
    const mv = clamp(speed / 1.2, 0, 1);
    const run = this.runW;
    const cr = this.crouchW;
    const air = this.airW;
    const t = time + this.off;
    // legs
    const amp = mv * lerp(lerp(0.45, 0.75, run), 0.4, cr);
    const knee = mv * lerp(lerp(0.75, 1.3, run), 0.6, cr);
    const sit = this.sitW;
    // (seated: thighs level and shins hanging, unless the seat says how its legs go - s.sitT / sitK / sitSplay: the
    // thigh's and the knee's angles and how far the knees are apart, in a car or on a saddle: game/vehicles.js)
    const baseT = lerp(cr * 0.95, s.sitT ?? 1.5, sit);
    const baseK = lerp(0.06 + cr * 1.5, s.sitK ?? 1.45, sit);
    // nunchucks: the trunk and the legs go with the move (the rig's body track: twist, lean, bend, knees, step)
    const nb = this.nk && this.item === ITEM.NUNCHAKU && !this.zombie ? this.nk.core.bodyS : null;
    const nkDrop = nb ? clamp(nb[4] / 0.3, 0, 0.6) * (1 - cr) : 0;
    // (s.pedal: on a bicycle the legs go round with its cranks - their angle)
    const ped = s.pedal !== undefined && sit > 0.5;
    legCycle(z, p, ped ? s.pedal : ph, ped ? 0.3 : amp * (1 - sit), ped ? 0.55 : knee * (1 - sit), baseT + nkDrop * 0.95, baseK + nkDrop * 1.5, 0, 0.03 + (s.sitSplay ?? 0.1) * sit);
    // air: tuck legs
    if (air > 0.01) {
      for (let side = 0; side < 2; side++) {
        const th = side ? THIGH_R : THIGH_L;
        p[th * 4] = lerp(p[th * 4], side ? 0.3 : 0.75, air);
        p[(th + 1) * 4] = lerp(p[(th + 1) * 4], side ? -0.5 : -1.0, air);
      }
      p[this.nb * 4 + 1] *= 1 - air;
    }
    const bob = mv * 0.025 * Math.cos(ph * 2);
    p[this.nb * 4 + 1] += -Math.abs(bob) * 0.5;
    // torso: lean with speed, aim pitch split spine/chest
    const pitch = clamp(s.pitch || 0, -1.4, 1.4);
    const lean = -0.08 * mv - 0.22 * run - 0.25 * cr;
    R(p, HIPS, 0, -0.1 * Math.sin(ph) * mv, 0);
    R(p, SPINE, lean * 0.6 + pitch * 0.25, 0.1 * Math.sin(ph) * mv * (1 - (this.hold ? 0.7 : 0)), 0);
    R(p, CHEST, lean * 0.4 + pitch * 0.3 + (1 - mv) * 0.012 * Math.sin(t * 1.6), 0.06 * Math.sin(ph) * mv * (this.hold ? 0.2 : 1), 0);
    if (nb) {
      // (a left-handed driver's move is the mirror: the twist, the bend and the step turn round)
      const sd = this.nk.core.side, tw = nb[1] * sd, ln = nb[2], bd = nb[3] * sd, st = nb[5] * sd * (1 - mv * 0.8) * (1 - sit);
      A(p, HIPS, -ln * 0.15, tw * 0.15, 0);
      A(p, SPINE, -ln * 0.45, tw * 0.4, -bd * 0.5);
      A(p, CHEST, -ln * 0.4, tw * 0.45, -bd * 0.5);
      // a step into it: the leading leg forward and bent, the other back and straighter
      const lead = st > 0 ? THIGH_R : THIGH_L, rear = st > 0 ? THIGH_L : THIGH_R, a = Math.abs(st);
      A(p, lead, 0.5 * a, 0, 0);
      A(p, lead + 1, -0.6 * a, 0, 0);
      A(p, lead + 2, 0.1 * a, 0, 0);
      A(p, rear, -0.42 * a, 0, 0);
      A(p, rear + 1, -0.12 * a, 0, 0);
      A(p, rear + 2, 0.5 * a, 0, 0);
      p[this.nb * 4 + 1] -= 0.035 * a;
    }
    // head: rest of the pitch
    const cp = chestPitch(p);
    R(p, NECK, (pitch - cp) * 0.4, nb ? -(p[SPINE * 4 + 1] + p[CHEST * 4 + 1] + p[HIPS * 4 + 1]) * 0.4 : 0, 0);
    R(p, HEAD, (pitch - cp) * 0.6, nb ? -(p[SPINE * 4 + 1] + p[CHEST * 4 + 1] + p[HIPS * 4 + 1]) * 0.5 : 0, 0);
    // arms (FK baseline; IK overrides for held items)
    const aSw = mv * lerp(0.35, 0.8, run) * Math.sin(ph);
    arm(p, 0, 0.05 - aSw, 0.1, 0, 0.25 + run * 1.0 + 0.1 * mv, 0);
    arm(p, 1, 0.05 + aSw, 0.1, 0, 0.25 + run * 1.0 + 0.1 * mv, 0);
    if (air > 0.01) {
      A(p, UARM_L, 0.4 * air, 0, -0.3 * air);
      A(p, UARM_R, 0.4 * air, 0, 0.3 * air);
    }
    // both hands out on the grips of a mounted gun (s.grips, from Entities while this survivor mans one)
    if (s.grips) {
      arm(p, 0, 1.15, 0.1, 0, 0.45, 0);
      arm(p, 1, 1.15, 0.1, 0, 0.45, 0);
    }
    // ...or carrying it off: upper arms down along the body, forearms out level under its weight (s.carry)
    else if (s.carry) {
      arm(p, 0, 0.45, 0.02, 0, 1.15, 0);
      arm(p, 1, 0.45, 0.02, 0, 1.15, 0);
    }
    // ...or the stray cat across both forearms (s.cradle, the cat drawn at cradleAt), the right hand stroking it (s.pet)
    else if (s.cradle) {
      arm(p, 0, CRADLE[0], CRADLE[1], CRADLE[2], CRADLE[3], 0);
      if (s.pet) arm(p, 1, PET_ARM[0], PET_ARM[1], PET_ARM[2], PET_ARM[3], 0); // (solvePet puts the hand on it)
      else arm(p, 1, CRADLE[0], CRADLE[1], CRADLE[2], CRADLE[3], 0);
    }
    // ...or both hands clapped over the ears (s.ears: a screecher screamed right by them), the head ducked into it
    else if (s.ears) {
      const sh = Math.sin(t * 31) * 0.03;
      arm(p, 0, 0.35 + sh, 1.05, -0.6, 2.35, 0.3);
      arm(p, 1, 0.35 - sh, 1.05, -0.6, 2.35, 0.3);
      A(p, NECK, -0.25, 0, 0);
      A(p, HEAD, -0.15, 0, 0.12 * Math.sin(t * 4));
    }
    // throw pulse without IK hold
    if (this.hold === HOLD_NONE && this.pulseMelee < 0.4) {
      const u = this.pulseMelee / 0.4;
      arm(p, 1, 1.4 * Math.sin(u * PI), 0.2, 0, 0.4, 0);
    }
    if (this.swimW > 0.01) this.poseSwim(p, s, speed);
    // talking: the jaw drops with the mouth and the head lifts a touch on each syllable
    if (this.mouthOpen > 0) {
      R(p, JAW, -MOUTH_JAW * this.mouthOpen, 0, 0);
      A(p, HEAD, MOUTH_NOD * this.mouthOpen, 0, 0);
    }
  }

  /** Afloat (shared/swim.js), blended over the rest by swimW: upright treading water, sculling at the surface, and
   *  leaning into a breaststroke on the move. Only the head and shoulders are out of the water: what shows of it is
   *  the arms sweeping out and in at the surface. Nothing is in the hands (Entities puts the weapon away). */
  poseSwim(p, s, speed) {
    const w = this.swimW;
    const sv = this._swimSave || (this._swimSave = new Float32Array(SWIM_BONES.length * 3 + 1));
    for (let i = 0; i < SWIM_BONES.length; i++) {
      const k = SWIM_BONES[i] * 4;
      sv[i * 3] = p[k];
      sv[i * 3 + 1] = p[k + 1];
      sv[i * 3 + 2] = p[k + 2];
    }
    sv[SWIM_BONES.length * 3] = p[this.nb * 4 + 1];
    const mv = clamp(speed / 2, 0, 1);
    const u = this.swimPh;
    const sn = Math.sin(u), cs = Math.cos(u);
    // legs: a slow frog kick under the water
    for (let side = 0; side < 2; side++) {
      const th = side ? THIGH_R : THIGH_L;
      const sg = side ? 1 : -1;
      R(p, th, 0.3 + 0.25 * sn * (0.5 + mv), 0, sg * (0.25 + 0.15 * cs));
      R(p, th + 1, -0.7 - 0.5 * Math.max(0, cs), 0, 0);
      R(p, th + 2, 0.6, 0, 0);
    }
    // torso: upright, leaning into the stroke as it goes; the head keeps the face out whatever they look at
    R(p, HIPS, 0, 0, 0);
    R(p, SPINE, 0.12 + 0.2 * mv + 0.04 * sn * mv, 0, 0);
    R(p, CHEST, 0.06 + 0.1 * mv, 0, 0.03 * Math.sin(u * 0.5) * (1 - mv));
    const cp = chestPitch(p);
    const look = clamp(s.pitch || 0, -0.5, 0.6) - cp;
    R(p, NECK, look * 0.4, 0, 0);
    R(p, HEAD, look * 0.6, 0, 0);
    // arms: treading, a sweep out and back at the sides; swimming, the breaststroke - reach, sweep out, elbows in
    for (let side = 0; side < 2; side++) {
      const pitch = lerp(0.95 + 0.1 * cs, 1.35 + 0.15 * cs - 0.3 * Math.max(0, -sn), mv);
      const abd = lerp(0.75 + 0.25 * sn, 0.15 + 0.3 * (1 - cs), mv);
      const elbow = lerp(1.0 + 0.25 * cs, 0.25 + 1.25 * Math.max(0, -sn), mv);
      arm(p, side, pitch, abd, lerp(0.2 * sn, 0, mv), elbow, 0);
    }
    // the water holds the hips up: no foot on the ground to bend down to
    p[this.nb * 4 + 1] = 0;
    if (w >= 0.999) return;
    for (let i = 0; i < SWIM_BONES.length; i++) {
      const k = SWIM_BONES[i] * 4;
      p[k] = sv[i * 3] + (p[k] - sv[i * 3]) * w;
      p[k + 1] = sv[i * 3 + 1] + (p[k + 1] - sv[i * 3 + 1]) * w;
      p[k + 2] = sv[i * 3 + 2] + (p[k + 2] - sv[i * 3 + 2]) * w;
    }
    p[this.nb * 4 + 1] = sv[SWIM_BONES.length * 3] * (1 - w);
  }

  /** Nunchucks: the rig's frame, and both arms to where it has the hands (chest space, as solveArms). */
  solveNunchaku(s) {
    const P = this.P, b = this.bones, nk = this.nk;
    b[CHEST].updateWorldMatrix(true, false);
    nk.update(this._dt || 0, s, b[CHEST]);
    const cy = P.shoulderY - P.chestY;
    for (const side of [1, -1]) {
      const h = side > 0 ? nk.core.right : nk.core.left;
      const U = side > 0 ? UARM_R : UARM_L, clav = b[side > 0 ? CLAV_R : CLAV_L].quaternion;
      // the hand's frame is its handle's; the wrist is the grip less the fist's own offset to it
      _qH.copy(h.q);
      _mountW.copy(side > 0 ? MOUNT_POS : MOUNT_POS_L).applyQuaternion(_qH);
      _T.copy(h.p).sub(_mountW);
      _S.set(P.shoulderW * side, cy, 0);
      ikTwoBone(_S, _T, P.uarmLen, P.farmLen, h.pole, _qU, _qL);
      _qTmp.copy(clav).invert().multiply(_qU);
      b[U].quaternion.copy(_qTmp);
      b[U + 1].quaternion.copy(_qL);
      _qTmp.copy(clav).multiply(b[U].quaternion).multiply(_qL).invert().multiply(_qH);
      b[U + 2].quaternion.copy(_qTmp);
    }
  }

  /** Two-bone IK for weapon holds, in chest space. */
  solveArms(s, time) {
    if (this.nk && this.item === ITEM.NUNCHAKU) return this.solveNunchaku(s);
    const P = this.P;
    const b = this.bones;
    const hold = this.hold;
    const pitch = clamp(s.pitch || 0, -1.4, 1.4);
    const cp = b[HIPS].rotation.x + b[SPINE].rotation.x + b[CHEST].rotation.x;
    const aimRel = pitch - cp; // weapon pitch relative to the chest
    const cy = P.shoulderY - P.chestY; // shoulder height in chest space
    const run = this.runW * (hold === HOLD_RIFLE || hold === HOLD_PISTOL ? 1 : 0.5);
    const rl = this.reloadW;
    // fire pulse
    const fu = this.pulseFire;
    const kick = fu < 0.25 ? Math.exp(-fu * 18) * (1 - Math.exp(-fu * 80)) : 0;
    // weapon orientation (chest space)
    let wx = aimRel, wy = 0, wz = 0;
    let wxL = 0; // (the left gun of a pair: its turn before the mirror, with its own kick)
    const pair = this.paired;
    _grip.set(0, 0, 0);
    if (hold === HOLD_RIFLE && !pair) {
      // far enough forward that the butt ends at the front of the shoulder (STOCK_POCKET) instead of inside the arm
      if (this.item === ITEM.RPG) _grip.set(0.1, cy - 0.12 + RPG_LIFT, -0.24); // (its tube rides on top of the shoulder)
      else _grip.set(0.1, cy - 0.12, Math.min(-0.24, STOCK_POCKET - this.stockZ));
      if (run > 0.01) {
        // low-ready while sprinting
        wx = lerp(wx, -0.7, run);
        wy = lerp(0, 0.6, run);
        _grip.x += 0.03 * run;
        _grip.y -= 0.1 * run;
        _grip.z += 0.1 * run;
      }
      wx += rl * -0.35;
      wz += rl * 0.5;
      _grip.z += kick * 0.05;
      wx += kick * 0.12;
    } else if (hold === HOLD_PISTOL || pair) {
      // (a pair of shotguns: their stocks reach back past the grips, so they are held further forward and never
      // tipped down as far as pistols, or the stocks come up into the arms)
      const long = pair && hold === HOLD_RIFLE;
      _grip.set(pair ? PAIR_GRIP_X : 0.04, cy - 0.06, -0.44);
      if (long) _grip.z -= PAIR_STOCK_CLEAR;
      if (run > 0.01) {
        wx = lerp(wx, long ? PAIR_LONG_DOWN : -0.9, run);
        _grip.y -= 0.22 * run;
        _grip.z += 0.2 * run;
      }
      if (long) wx = Math.max(wx, PAIR_LONG_DOWN);
      wx += rl * (long ? -0.15 : -0.5);
      if (pair) {
        // the left gun: the same hold, kicked by its own shots
        const fl = this.pulseFireL;
        const kickL = fl < 0.25 ? Math.exp(-fl * 18) * (1 - Math.exp(-fl * 80)) : 0;
        _gripL.copy(_grip);
        _gripL.z += kickL * 0.06;
        wxL = wx + kickL * 0.3;
      }
      _grip.z += kick * 0.06;
      wx += kick * 0.3;
    } else if (hold === HOLD_MELEE) {
      // ready stance: weapon raised over the right shoulder, pointing up/back
      _grip.set(0.2, cy - 0.2, -0.2);
      wx = 1.2;
      wy = -0.2;
      wz = -0.3;
      const mu = this.pulseMelee;
      if (mu < 0.5) {
        const u = mu / 0.5;
        const sw = u < 0.3 ? -smooth(u / 0.3) * 0.4 : -0.4 + smooth((u - 0.3) / 0.25) * 1.4 - smooth((u - 0.55) / 0.45);
        // big diagonal swing from right-high to left-low
        _grip.x = lerp(0.2, -0.15, clamp(sw, 0, 1));
        _grip.y = cy - 0.2 - 0.25 * clamp(sw, 0, 1) + 0.12 * clamp(-sw, 0, 1);
        _grip.z = -0.2 - 0.25 * Math.sin(clamp(sw, 0, 1) * PI);
        wx = lerp(1.2, 0.1, clamp(sw, 0, 1)) + 0.4 * clamp(-sw, 0, 1);
        wy = lerp(-0.2, 1.2, clamp(sw, 0, 1));
        wz = lerp(-0.3, -1.4, clamp(sw, 0, 1));
      }
    } else if (hold === HOLD_RADIO) {
      // the walkie-talkie upright in front of the chest, its face turned in; keyed, it comes up beside the mouth
      const tk = smooth(this.talkW);
      _grip.set(lerp(0.17, 0.08, tk), cy + lerp(-0.14, 0.1, tk), lerp(-0.22, -0.14, tk));
      wx = lerp(0.25, 0.1, tk);
      wy = lerp(0.4, 1.0, tk);
    } else if (hold === HOLD_THROW) {
      _grip.set(0.2, cy - 0.12, -0.2);
      wx = 0.4;
      const tu = this.pulseThrow;
      if (tu < 0.6) {
        const u = tu / 0.6;
        const wind = u < 0.4 ? smooth(u / 0.4) : 1 - smooth((u - 0.4) / 0.2);
        const rel = u < 0.4 ? 0 : u < 0.6 ? smooth((u - 0.4) / 0.2) : 1 - smooth((u - 0.6) / 0.4);
        _grip.y += 0.25 * wind - 0.05 * rel;
        _grip.z += 0.3 * wind - 0.35 * rel;
        wx += 1.2 * wind - 0.6 * rel;
      }
    }
    // gun melee (bash)
    if ((hold === HOLD_RIFLE || hold === HOLD_PISTOL) && this.pulseMelee < 0.4) {
      const u = Math.sin((this.pulseMelee / 0.4) * PI);
      _grip.z -= 0.18 * u;
      _grip.x -= 0.08 * u;
      wy += 0.5 * u;
      if (pair) {
        _gripL.z -= 0.18 * u;
        _gripL.x -= 0.08 * u;
      }
    }
    _grip.z += this.holdDZ; // (a deeper chest: everything held comes out in front of it)
    _gripL.z += this.holdDZ;
    _e.set(wx, wy, wz, 'YXZ');
    _qW.setFromEuler(_e);
    // hand orientation = weapon * mount^-1 ; wrist target = grip - Qh * mountPos
    _qH.copy(_qW).multiply(hold === HOLD_MELEE ? _qMountInvMelee : _qMountInvGun);
    _mountW.copy(this.mount.position).applyQuaternion(_qH);
    _T.copy(_grip).sub(_mountW);
    // right arm
    _S.set(P.shoulderW, cy, 0);
    _pole.set(0.7, -1, 0.35);
    ikTwoBone(_S, _T, P.uarmLen, P.farmLen, _pole, _qU, _qL);
    const clavR = b[CLAV_R].quaternion;
    _qTmp.copy(clavR).invert().multiply(_qU);
    b[UARM_R].quaternion.copy(_qTmp);
    b[FARM_R].quaternion.copy(_qL);
    // hand local = (clav * upper * lower)^-1 * Qh
    _qTmp.copy(clavR).multiply(b[UARM_R].quaternion).multiply(_qL).invert().multiply(_qH);
    b[HAND_R].quaternion.copy(_qTmp);
    if (pair) {
      // left arm: on the left gun of the pair, the right arm mirrored (x -> -x; a turn's Euler (x, y, z) -> (x, -y, -z))
      this.weaponL.visible = !!this.weapon?.visible;
      _e.set(wxL, -wy, -wz, 'YXZ');
      _qWL.setFromEuler(_e);
      _qH.copy(_qWL).multiply(_qMountInvGun);
      _mountW.copy(this.mountL.position).applyQuaternion(_qH);
      _T2.set(-_gripL.x, _gripL.y, _gripL.z).sub(_mountW);
      _S.set(-P.shoulderW, cy, 0);
      _pole.set(-0.7, -1, 0.35);
      ikTwoBone(_S, _T2, P.uarmLen, P.farmLen, _pole, _qU, _qL);
      const clavL = b[CLAV_L].quaternion;
      _qTmp.copy(clavL).invert().multiply(_qU);
      b[UARM_L].quaternion.copy(_qTmp);
      b[FARM_L].quaternion.copy(_qL);
      _qTmp.copy(clavL).multiply(b[UARM_L].quaternion).multiply(_qL).invert().multiply(_qH);
      b[HAND_L].quaternion.copy(_qTmp);
      return;
    }
    // left arm: support grip on two-handed weapons
    let twoHand = false;
    if (hold === HOLD_RIFLE || hold === HOLD_PISTOL) {
      twoHand = true;
      if (this.leftGrip) _lh.copy(this.leftGrip);
      else if (hold === HOLD_RIFLE) _lh.set(0, -0.03, -0.3);
      else _lh.set(0, -0.05, 0.02);
      if (rl > 0.01) {
        // reach for the magazine / ammo
        _lh.lerp(_off.set(0, -0.12, -0.12), rl * (0.5 + 0.5 * Math.sin(time * 6)));
      }
      _lh.applyQuaternion(_qW).add(_grip);
      _T2.copy(_lh);
      // offset from palm to wrist for the left hand (palm faces up/right)
      _T2.x -= 0.03;
      _T2.y -= 0.05;
      _T2.z += 0.05;
    } else if (hold === HOLD_THROW && this.pulseThrow < 0.6) {
      twoHand = true;
      _T2.set(-0.1, cy - 0.15, -0.35);
    }
    if (twoHand) {
      _S.set(-P.shoulderW, cy, 0);
      _pole.set(-0.8, -1, 0.1);
      ikTwoBone(_S, _T2, P.uarmLen, P.farmLen, _pole, _qU, _qL);
      const clavL = b[CLAV_L].quaternion;
      _qTmp.copy(clavL).invert().multiply(_qU);
      b[UARM_L].quaternion.copy(_qTmp);
      b[FARM_L].quaternion.copy(_qL);
      // left hand: palm up under the handguard
      _e.set(wx + HALF * 0.9, wy, wz - 1.2, 'YXZ');
      _qH.setFromEuler(_e);
      _qTmp.copy(clavL).multiply(b[UARM_L].quaternion).multiply(_qL).invert().multiply(_qH);
      b[HAND_L].quaternion.copy(_qTmp);
    } else if (hold === HOLD_MELEE) {
      // guard: left fist up near the chest
      b[UARM_L].rotation.set(0.5 - b[SPINE].rotation.x - b[CHEST].rotation.x, 0, -0.25);
      b[FARM_L].rotation.set(1.6, 0, 0);
    }
  }

  // Both hands out to two points of the world (s.reach: { l, r }, Vector3s or null): the grips of a moped's bars,
  // the rim of a steering wheel. The wrist stops a fist short of the point, so that the fist closes on it.
  solveReach(reach) {
    const P = this.P;
    const b = this.bones;
    const chest = b[CHEST];
    chest.updateWorldMatrix(true, false);
    _reachM.copy(chest.matrixWorld).invert();
    const cy = P.shoulderY - P.chestY;
    for (const side of [1, -1]) {
      const t = side > 0 ? reach.r : reach.l;
      if (!t) continue;
      _T.copy(t).applyMatrix4(_reachM);
      _S.set(side * P.shoulderW, cy, 0);
      _pole.set(side * 0.7, -1, 0.45);
      // (the wrist stops a fist short of the point, back along the forearm: where the forearm lies is found by
      // solving for the point itself first, then twice for the wrist)
      _lh.copy(_T);
      for (let it = 0; it < 3; it++) {
        ikTwoBone(_S, _T, P.uarmLen, P.farmLen, _pole, _qU, _qL, _off);
        if (it === 2) break;
        _off.sub(_lh).normalize(); // from the point back towards the elbow
        _T.copy(_lh).addScaledVector(_off, REACH_FIST);
      }
      const clav = b[side > 0 ? CLAV_R : CLAV_L].quaternion;
      b[side > 0 ? UARM_R : UARM_L].quaternion.copy(_qTmp.copy(clav).invert().multiply(_qU));
      b[side > 0 ? FARM_R : FARM_L].quaternion.copy(_qL);
      b[side > 0 ? HAND_R : HAND_L].quaternion.identity();
    }
  }

  // Both feet to two points of the world (s.feet: { l, r, pitch }: where the ankles go - a pedal, a footboard, the
  // floor of a car; pitch: the toes down by this much), by weight w of the pose's own legs.
  solveFeet(feet, w = 1) {
    const P = this.P;
    const b = this.bones;
    for (const side of [1, -1]) {
      const t = side > 0 ? feet.r : feet.l;
      if (!t) continue;
      const th = b[side > 0 ? THIGH_R : THIGH_L];
      const sh = b[side > 0 ? SHIN_R : SHIN_L];
      const ft = b[side > 0 ? FOOT_R : FOOT_L];
      th.parent.updateWorldMatrix(true, false);
      _reachM.copy(th.parent.matrixWorld).invert();
      _T.copy(t).applyMatrix4(_reachM);
      _S.copy(th.position);
      _pole.set(side * (feet.splay ?? 0.22), 0.45, -1); // the knee: forward and up, a little out
      ikLeg(_S, _T, P.thighLen, P.shinLen, _pole, _qU, _qL);
      _qTmp.copy(_qU).multiply(_qL).invert(); // (the sole level with the hips)
      if (feet.pitch) _qTmp.multiply(_qFoot.setFromAxisAngle(_XAX, feet.pitch));
      if (w >= 1) {
        th.quaternion.copy(_qU);
        sh.quaternion.copy(_qL);
        ft.quaternion.copy(_qTmp);
      } else {
        th.quaternion.slerp(_qU, w);
        sh.quaternion.slerp(_qL, w);
        ft.quaternion.slerp(_qTmp, w);
      }
    }
  }

  dispose() {
    this.skeleton.dispose();
    if (this.object.parent) this.object.parent.remove(this.object);
    if (this.transient) {
      this.rigH.geometry.dispose();
      if (this.rigZ) this.rigZ.geometry.dispose();
    } else if (!this.disposed) dropLook(this.look);
    this.disposed = true;
  }
}

const _qFoot = new THREE.Quaternion();
const _XAX = new THREE.Vector3(1, 0, 0);
const _kld = new THREE.Vector3(), _klp = new THREE.Vector3(), _klu = new THREE.Vector3(), _kle = new THREE.Vector3(), _klf = new THREE.Vector3(), _klw = new THREE.Vector3(), _klh = new THREE.Vector3();
const _klbm = new THREE.Matrix4();
// Two-bone IK for a leg (skinning.js ikTwoBone is an arm's: its hinge bends the other way): the bones' bind direction
// is -Y, the knee's hinge local +X, and a NEGATIVE turn of the shin about it folds it back. All in the thigh's
// parent's space: S the hip joint, T where the ankle goes, pole the way the knee points.
function ikLeg(S, T, L1, L2, pole, qUpper, qLower) {
  _kld.subVectors(T, S);
  let dist = _kld.length();
  if (dist < 1e-5) _kld.set(0, -1, 0);
  _kld.normalize();
  dist = Math.min(L1 + L2 - 1e-4, Math.max(Math.abs(L1 - L2) + 1e-3, dist));
  _klp.copy(pole).addScaledVector(_kld, -pole.dot(_kld));
  if (_klp.lengthSq() < 1e-8) _klp.set(0, 0, -1).addScaledVector(_kld, _kld.z);
  _klp.normalize();
  const a = Math.acos(Math.min(1, Math.max(-1, (L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist))));
  _klu.copy(_kld).multiplyScalar(Math.cos(a)).addScaledVector(_klp, Math.sin(a)).normalize();
  _kle.copy(S).addScaledVector(_klu, L1);
  _klf.copy(S).addScaledVector(_kld, dist).sub(_kle).normalize();
  _klw.copy(_klf).addScaledVector(_klu, -_klf.dot(_klu));
  if (_klw.lengthSq() < 1e-8) _klw.copy(_klp).multiplyScalar(-1);
  _klw.normalize();
  _klh.crossVectors(_klu, _klw).normalize();
  // the thigh's basis: X = -h, Y = -u, Z = w (so that the shin, turned by -beta about X, lies along f)
  _klbm.makeBasis(_klh.negate(), _kle.copy(_klu).negate(), _klw);
  qUpper.setFromRotationMatrix(_klbm);
  qLower.setFromAxisAngle(_XAX, -Math.acos(Math.min(1, Math.max(-1, _klu.dot(_klf)))));
}

const SURV_STYLE = Object.assign({}, STYLES[ZTYPE.WALKER], { idleLean: 0, walkLean: -0.05, runLean: -0.2, limp: 0, headTilt: 0, jaw: 0 });

/**
 * Create a survivor (player avatar). character: a roster id (shared/characters.js), or a custom survivor's key
 * ('a:<code>': shared/appearance.js lookKey); opts.transient: a model of its own, let go with it.
 */
export function createSurvivor(seed = 0, character = -1, opts = undefined) {
  const sv = new SurvivorInstance(seed, character, opts);
  return {
    object: sv.object,
    character: sv.character,
    update: (dt, s) => sv.update(dt, s),
    setWeapon: (id) => sv.setWeapon(id),
    fire: () => sv.fire(),
    melee: () => sv.melee(),
    nkSwing: (move) => sv.nkSwing(move),
    nkHit: (kind, power) => sv.nkHit(kind, power),
    nkFlourish: () => !!(sv.nk && sv.item === ITEM.NUNCHAKU && sv.nk.core.flourish()),
    nk: () => (sv.item === ITEM.NUNCHAKU ? sv.nk : null),
    throwAnim: () => sv.throwAnim(),
    setZombie: (v) => sv.setZombie(v),
    setBackpack: (on) => sv.setBackpack(on),
    setAkimbo: (on) => sv.setAkimbo(on),
    setHide: (m) => (sv.hide = m), // 0: all of them; 1: no head; 2: no head, no arms (our own body under our own eyes)
    headWorld: (out) => sv.bones[HEAD].getWorldPosition(out),
    shoulderWorld: (side, out) => sv.bones[side > 0 ? UARM_R : UARM_L].getWorldPosition(out),
    getMuzzleWorld: (out) => sv.getMuzzleWorld(out),
    cradleAt: (out) => sv.cradleAt(out),
    flashlightAnchor: sv.flashlightAnchor,
    flash: (a) => sv.flash(a),
    dispose: () => sv.dispose(),
    _inst: sv,
  };
}

/** Debug (models sandbox, &cradle= / &petarm= / &catat=): the cat-in-arms pose and where the cat lies. */
export function setCradle(cradle, pet, at) {
  if (cradle) CRADLE.splice(0, 4, ...cradle);
  if (pet) PET_ARM.splice(0, 4, ...pet);
  if (at) CRADLE_CAT.set(...at);
}
/** Debug (models sandbox): where a shouldered butt ends. */
export function setStockPocket(z, rpgLift = RPG_LIFT) {
  STOCK_POCKET = z;
  RPG_LIFT = rpgLift;
}
