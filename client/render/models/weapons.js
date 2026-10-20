// Procedural weapon models: third-person/pickup models (createWorldWeapon) and the first-person
// ViewModel (arms + detailed weapons + procedural animation).
// Every held item is a file of its own in weapons/: its model, how it is held in first person and its own hand poses
// (weapons/index.js lists them). The shapes they are built from are weapons/parts.js, the hands and arms weapons/hands.js.
import * as THREE from 'three';
import { ITEM, CONSUMABLES, CANIM } from '../../../shared/defs.js';
import { NunchakuFP, FP_SHOULDER_L, FP_SHOULDER_R } from './nunchaku.js';
import { catBackY } from './cat.js';
import { WR } from './charTextures.js';
import { MeshBuilder, getPropMaterial, getViewWeaponMaterial, ikTwoBone } from './skinning.js';
import { PI, PartSet, finishParts, handQ } from './weapons/parts.js';
import { HAND_POSES, HAND_MAT, FINGERS, PHALANX_R, THUMB_MCP, getHandGeo, VMArm, ARM_L1, ARM_L2 } from './weapons/hands.js';
import { BUILDERS, VM } from './weapons/index.js';
import { atHold } from './weapons/at-rifle.js';
import { getNunchakuGeo } from './weapons/nunchaku.js';

export { getNunchakuGeo };

const PRY_BEAT = 0.4; // s a heave on a boot's lid (shared/trunk.js PRY.lever: the blows the server sends are that far apart)

// ================================================================== world weapons
const worldCache = new Map();
function getWorldData(itemId) {
  let d = worldCache.get(itemId);
  if (d === undefined) {
    const fn = BUILDERS[itemId];
    if (!fn) {
      worldCache.set(itemId, null);
      return null;
    }
    const P = new PartSet(false, false);
    fn(P);
    const parts = finishParts(P);
    d = { geometry: parts.body.geometry, tris: parts.body.tris, meta: P.meta };
    worldCache.set(itemId, d);
  }
  return d;
}

/**
 * Third-person / pickup weapon model. Grip at origin, barrel/blade along -Z.
 * userData: { itemId, leftHand?: Vector3 (support-hand grip point), tris }
 * Guns have a child Object3D named 'muzzle'. Molotov/pipebomb have a child named 'flame'.
 */
export function createWorldWeapon(itemId) {
  const group = new THREE.Group();
  group.name = 'weapon';
  group.userData.itemId = itemId;
  const d = itemId ? getWorldData(itemId) : null;
  if (!d) return group;
  const mesh = new THREE.Mesh(d.geometry, getPropMaterial());
  mesh.name = 'weaponMesh';
  group.add(mesh);
  if (d.meta.muzzle) {
    const m = new THREE.Object3D();
    m.name = 'muzzle';
    m.position.copy(d.meta.muzzle);
    group.add(m);
  }
  if (d.meta.flame) {
    const f = new THREE.Object3D();
    f.name = 'flame';
    f.position.copy(d.meta.flame);
    group.add(f);
  }
  if (d.meta.leftHand) group.userData.leftHand = d.meta.leftHand.clone();
  group.userData.tris = d.tris;
  return group;
}

/** Triangle count of the cached world model (debug). */
export function worldWeaponTris(itemId) {
  const d = getWorldData(itemId);
  return d ? d.tris : 0;
}

// ================================================================== viewmodel data
const vmCache = new Map();
function getVMData(itemId) {
  let d = vmCache.get(itemId);
  if (d === undefined) {
    const fn = BUILDERS[itemId];
    if (!fn) {
      vmCache.set(itemId, null);
      return null;
    }
    const P = new PartSet(true, true);
    fn(P);
    const parts = finishParts(P);
    let tris = 0;
    for (const k in parts) tris += parts[k].tris;
    d = { parts, meta: P.meta, tris };
    vmCache.set(itemId, d);
  }
  return d;
}

// flare gun reload (ViewModel._animReload, breakPistol): the gun's pose change (pitch down, roll, yaw, x/y/z shift),
// how far the barrel tips open (rad), and the free hand pushing a shell into the open breech, set in camera space
// (fingers forward and a little up, palm to the right) so that the arm comes in from the lower left whatever the gun does
const FG_RELOAD = { pitch: 0.1, roll: 0.75, yaw: 0.05, x: 0.07, y: 0.06, z: 0.02, open: 0.55 };
FG_RELOAD.q = handQ(-1, [0.25, 0.12, -0.96], [1, -0.3, 0]);
// revolver reload (ViewModel._animReload, revolver): the gun's pose change (roll, pitch up, yaw, x/y/z shift), how far
// the cylinder swings out (rad), and the free hand on the speedloader, set in camera space as the flare gun's is
const RV_RELOAD = { pitch: 0.18, roll: 0.55, yaw: 0.1, x: 0.06, y: 0.08, z: 0.05, open: 1.45, hand: [-0.015, 0, 0.045] };
RV_RELOAD.q = handQ(-1, [0.35, 0.1, -0.93], [1, -0.2, 0]);
// pinned by a leaper (ViewModel._push), camera space: both hands flat against it, palms forward, fingers up and in
// toward each other, the wrists bent back to shove with the heels of the hands. How long the weapon takes to go down
// and the hands to come up (s), and to drop again once it lets go; how long a throw-off holds the arms out at full
// stretch; the thrust of one press (a kick to a spring, m/s)
const PUSH_Q_R = handQ(1, [-0.3, 0.92, 0.25], [-0.25, 0, -1]);
const PUSH_Q_L = handQ(-1, [0.3, 0.92, 0.25], [0.25, 0, -1]);
const PUSH_IN = 0.22, PUSH_OUT = 0.4, PUSH_FLING = 0.3, PUSH_KICK = 2.4;
// deafened by a screecher's scream close by (s.ears, _push): both hands clapped over the ears, at the edges of the view,
// fingers up and back, palms in toward the head
const EARS_Q_R = handQ(1, [0.1, 0.9, 0.35], [-1, 0, 0.2]);
const EARS_Q_L = handQ(-1, [-0.1, 0.9, 0.35], [1, 0, 0.2]);

export const VM_FOV = 68; // the viewmodel camera's field of view (renderer.js vmCamera), degrees

// melee swing keyframes: [t, px,py,pz, rx,ry,rz, ease] (absolute weapon pose, Euler YXZ); ease 0 smooth,1 linear,2 out,3 in
const SWINGS = {
  // knife keys, like its hip, were solved for a hand that stays in line with the forearm
  knife: { dur: 0.36, keys: [[0.28, 0.24, -0.04, -0.3, 0.901, 3.168, 2.304, 0], [0.55, -0.1, -0.22, -0.42, 0.084, 0.895, 2.987, 1], [0.7, -0.12, -0.25, -0.38, 0.045, 0.834, 3.166, 2]] },
  stab: { dur: 0.62, keys: [[0.3, 0.21, -0.2, -0.29, 0.466, 1.691, 2.32, 0], [0.48, 0.06, -0.19, -0.54, 0.318, 0.912, 2.116, 2], [0.66, 0.06, -0.19, -0.52, 0.385, 0.959, 2.145, 0]] },
  bat: { dur: 0.62, keys: [[0.3, 0.26, -0.13, -0.34, 0.5, -1.7, 0.4, 0], [0.47, 0.08, -0.19, -0.45, 0.1, 0.5, 0.1, 1], [0.64, -0.2, -0.17, -0.36, 0.2, 1.8, -0.3, 2]] },
  machete: { dur: 0.5, keys: [[0.32, 0.21, 0.06, -0.3, 1.6, -0.3, -0.4, 0], [0.52, -0.02, -0.15, -0.42, -0.3, 0.9, 0.6, 1], [0.66, -0.12, -0.23, -0.36, -0.8, 1.1, 0.8, 2]] },
  hammer: { dur: 0.5, keys: [[0.32, 0.2, 0.05, -0.3, 1.8, 0.1, 0.0, 0], [0.52, 0.06, -0.16, -0.45, -0.2, 0.2, 0.0, 1], [0.64, 0.05, -0.18, -0.43, -0.3, 0.2, 0.0, 2]] },
  shove: { dur: 0.5, keys: [[0.25, 0.14, -0.16, -0.24, 0.15, 0.45, 0.55, 0], [0.42, 0.0, -0.12, -0.44, 0.1, 0.55, 0.65, 2], [0.55, 0.0, -0.12, -0.42, 0.1, 0.55, 0.65, 0]] },
};

// claws: wrist frames (camera space): [t, px,py,pz, rx,ry,rz, ease] for the swinging (right) hand; mirrored for left
const CLAW_IDLE = [0.18, -0.15, -0.38, -0.55, -0.35, 0.85];
const CLAW_SWING = { dur: 0.5, keys: [[0.3, 0.3, 0.02, -0.22, 0.0, -0.9, 1.3, 0], [0.55, -0.16, -0.24, -0.44, -1.2, 0.5, -0.2, 1]] };

// the tuck off a wall (update): per kind, the most it moves the item [px,py,pz, rx,ry,rz]; it starts TUCK_GAP short of
// where the item's reach meets the wall and is all the way in TUCK_RANGE further
const TUCK = {
  rifle: [-0.03, -0.02, 0.13, 0.55, 0.3, 0.3], // high ready: the muzzle up and in, the gun back
  shotgun: [-0.03, -0.02, 0.13, 0.55, 0.3, 0.3],
  pistol: [-0.01, -0.03, 0.1, 0.65, 0.15, 0.1],
  melee: [0.02, -0.04, 0.1, 0.35, 0.15, 0.0], // back and up
  throw: [0.0, -0.05, 0.08, 0.2, 0.0, 0.0],
  radio: [0.0, -0.02, 0.06, 0.0, 0.0, 0.0],
};
const TUCK_GAP = 0.06, TUCK_RANGE = 0.32;

const THROW_RELEASE = 0.46; // (of the throw animation) the item leaves the hand

const ease = (u, e) => (e === 1 ? u : e === 2 ? 1 - (1 - u) * (1 - u) : e === 3 ? u * u : u * u * (3 - 2 * u));
function evalSwing(sw, idle, t, out) {
  // t in 0..1 over sw.dur; first/last keys = idle
  const keys = sw.keys;
  let t0 = 0, a = idle;
  for (let i = 0; i <= keys.length; i++) {
    const k = i < keys.length ? keys[i] : null;
    const t1 = k ? k[0] : 1;
    if (t <= t1 || !k) {
      const u = t1 > t0 ? Math.min(1, Math.max(0, (t - t0) / (t1 - t0))) : 1;
      const w = ease(u, k ? k[7] : 0);
      for (let j = 0; j < 6; j++) {
        const av = a === idle ? idle[j] : a[j + 1];
        const bv = k ? k[j + 1] : idle[j];
        out[j] = av + (bv - av) * w;
      }
      return out;
    }
    t0 = t1;
    a = k;
  }
  return out;
}

// ================================================================== ViewModel
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3();
const _v5 = new THREE.Vector3();
const _v6 = new THREE.Vector3();
const _v7 = new THREE.Vector3();
const _v8 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _q3 = new THREE.Quaternion();
const _qU = new THREE.Quaternion();
const _qL = new THREE.Quaternion();
const _e1 = new THREE.Euler(0, 0, 0, 'YXZ');
const _m1 = new THREE.Matrix4();
const _pose6 = new Float64Array(6);
const _pose6b = new Float64Array(6);
const SHOULDER_R = new THREE.Vector3(0.2, -0.29, 0.1);
const SHOULDER_L = new THREE.Vector3(-0.12, -0.31, -0.06);
// two of the gun, one in each hand (setItem's opts.akimbo, shared/akimbo.js): the left arm is the right one mirrored,
// from a shoulder and an elbow mirrored too, so the left hand holds the left gun exactly as the right holds the right
const SHOULDER_L_PAIR = new THREE.Vector3(-SHOULDER_R.x, SHOULDER_R.y, SHOULDER_R.z);
// ...each gun held a little further out to its side than one on its own, and turned in less toward the crosshair
// (added to cfg.hip, by kind)
const PAIR_HIP = { pistol: [0.025, 0.005, 0, 0, -0.07, 0], shotgun: [0.0, 0.0, -0.02, 0, -0.1, 0] };
// ...and at a sprint (in place of cfg.sprint): carried low and turned out a little. A long gun's own sprint swings its
// muzzle across the chest, through the left one - mirrored - swung across the other way; a pistol's turns in less
const PAIR_SPRINT = { pistol: [0.0, -0.015, 0.03, -0.3, 0.06, 0.28], shotgun: [0.0, -0.04, 0.02, -0.32, -0.12, 0.15] };
const POLE_R = new THREE.Vector3(0.75, -0.65, 0.15);
const POLE_L = new THREE.Vector3(-0.75, -0.65, 0.15);
const DB_LOAD_ARC = new THREE.Vector3(-0.12, 0.03, 0.03);
const DB_LOAD_POLE = new THREE.Vector3(-1, 0.5, 0.1);
const RIFLE_RELOAD_ARC = new THREE.Vector3(-0.03, -0.07, 0.0);
const SHOVE_POLE_R = new THREE.Vector3(1, -0.2, 0.2);
const XBOW_HAUL_POLE = new THREE.Vector3(-1, 0.4, 0.2);
const PISTOL_RACK_POLE = new THREE.Vector3(-1, -0.3, 0.3);
const PISTOL_RACK_ARC = new THREE.Vector3(-0.07, 0.02, 0.03);
const X_AXIS = new THREE.Vector3(1, 0, 0);
const SWAY_PIVOT = new THREE.Vector3(0.1, -0.14, -0.32); // roughly between the hands
// The stray cat in both arms (ViewModel.holdCat). Where it lies in the view: its model's origin (its feet), turned
// across the arms with its head to the left, and tipped toward the eye so its back shows; it looks round at the one
// holding it now and then (CAT_LOOK: its head's yaw toward the eye). Then, in the cat's own space (models/cat.js:
// metres, its head toward -Z, its feet at y = 0, the side nearest the eye -X): the left palm cupped under its belly
// under its tucked legs, the right palm on its back, both hands' fingers round its far side (+X). A stroke takes the
// right palm along its back from behind its neck toward its hips, riding on the top of it (catBackY, models/cat.js),
// and back clear of it. The hand poses were fitted against the posed cat over the whole stroke (scripts/clip/grip-lib.js).
const CAT_AT = new THREE.Vector3(-0.015, -0.4, -0.5);
const CAT_YAW = PI / 2 + 0.3;
const CAT_TIP = 0.3;
const CAT_LOOK = 1.25;
const CAT_RAISE = 0.35; // s: up into the view as it is picked up
const CAT_CUP = { p: new THREE.Vector3(-0.005, 0.1388, -0.004), q: handQ(-1, [1, 0.05, 0], [0, 1, 0]) };
const CAT_BACK = { x: -0.012, z: 0.045, q: handQ(1, [1, -0.05, 0], [0, -1, 0]) };
const CAT_PALM = [-0.026, 0.04]; // how far the palm reaches along the cat either side of its middle
const CAT_STROKE = { z0: -0.045, z1: 0.09, lift: 0.035, dur: 1.15, along: 0.6, clear: 0.0028 };
const CAT_POLE_R = new THREE.Vector3(1, -0.7, 0.3);
const IDLE_RATE = 1.35; // breathing, rad/s (~4.7 s per breath)
const softClamp = (x, m) => m * Math.tanh(x / m);

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const win = (u, a, b, c, d) => smoothstep(a, b, u) * (1 - smoothstep(c, d, u)); // rise a..b, fall c..d
// a drink at the mouth, on top of where a used item is held: up (m), towards the eye (m), tipped back (rad)
const DRINK_LIFT = [0.06, 0.17, 1.6];

// A damped spring, kicked through .v (recoil, landing dip, look lag). Its constants were tuned with one explicit
// step per frame at 60 fps (v += a * dt, x += v * dt), and that step is part of the feel: it takes c / 60 off a
// kick in its first frame. One such step per frame also made the motion depend on the frame time, and it is only
// stable for short steps: one 100 ms frame threw the kick forward instead of back, and 10 fps diverged.
// So the motion is defined as that 60 Hz step, a linear map M of (x, v), and a frame of any length applies
// M^(dt * 60) exactly: the old motion at 60 fps, the same curve at every other frame rate, and never further out
// than that curve however long the frame. (Exported for scripts/test-netsync.js, which holds it to this.)
const SPRING_HZ = 60;
export class Spring {
  constructor(k, c) {
    this.x = 0;
    this.v = 0;
    // a spring too stiff to be stepped at that rate (M would flip it over every step, which has no in-between)
    // gets a finer step
    let h = 1 / SPRING_HZ;
    while (c * h >= 1 || k * h * h + c * h >= 2) h /= 2;
    this.rate = 1 / h;
    this.m00 = 1 - k * h * h;
    this.m01 = (1 - c * h) * h;
    this.m10 = -k * h;
    this.m11 = 1 - c * h;
    // M's eigenvalues are r * e^(+-i * w) for a spring that rings, r * e^(+-w) for one that does not
    const r = Math.sqrt(this.m11); // det M = 1 - c * h
    const cw = (this.m00 + this.m11) / (2 * r);
    this.ring = cw < 1;
    this.w = Math.max(1e-6, this.ring ? Math.acos(cw) : Math.acosh(cw));
    this.lr = Math.log(r);
    this.ia = 1 / (this.ring ? Math.sin(this.w) : Math.sinh(this.w));
    this.ib = this.ia / r;
  }
  step(dt, target = 0) {
    // M^t = a * I + b * M (t = 1 gives a = 0, b = 1: the old step)
    const t = dt * this.rate, w = this.w, lr = this.lr;
    let s, s1; // r^t * sin(t * w) and r^t * sin((t - 1) * w), sinh for a spring that does not ring
    if (this.ring) {
      const rt = Math.exp(t * lr);
      s = rt * Math.sin(t * w);
      s1 = rt * Math.sin((t - 1) * w);
    } else {
      // from the two eigenvalues to the power t: both are below 1, so nothing overflows however long the frame
      const p = Math.exp(t * (lr + w)), q = Math.exp(t * (lr - w));
      s = (p - q) / 2;
      s1 = (p * Math.exp(-w) - q * Math.exp(w)) / 2;
    }
    const a = -s1 * this.ia, b = s * this.ib;
    const x = this.x - target, v = this.v;
    this.x = target + a * x + b * (this.m00 * x + this.m01 * v);
    this.v = a * v + b * (this.m10 * x + this.m11 * v);
    return this.x;
  }
}

function makeScopeOverlay() {
  const g = new THREE.Group();
  g.name = 'scopeOverlay';
  const mat = new THREE.MeshBasicMaterial({ color: 0x000000, fog: false, depthTest: false, depthWrite: false });
  const z = -0.1;
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.052, 1.0, 64, 1), mat);
  ring.position.z = z;
  g.add(ring);
  // soft inner edge: a second, slightly transparent ring
  const edge = new THREE.Mesh(new THREE.RingGeometry(0.047, 0.0525, 64, 1), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55, fog: false, depthTest: false, depthWrite: false }));
  edge.position.z = z;
  g.add(edge);
  const bar = (w, h, x, y) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.position.set(x, y, z);
    g.add(m);
  };
  // thin crosshair + thick outer posts (duplex)
  bar(0.1, 0.00018, 0, 0);
  bar(0.00018, 0.1, 0, 0);
  for (const s of [-1, 1]) {
    bar(0.03, 0.0009, s * 0.037, 0);
    bar(0.0009, 0.03, 0, s * 0.037);
  }
  g.traverse((o) => {
    o.renderOrder = 10;
    o.frustumCulled = false;
  });
  return g;
}

function makeKit() {
  const mb = new MeshBuilder({ skinned: false, atlas: 'weapon' });
  mb.box(0, [0, 0, 0], [0.15, 0.1, 0.055], { region: WR.PLAIN, color: 0xb01c16, round: 0.2, seg: 2 });
  mb.box(0, [0, 0, 0.028], [0.045, 0.012, 0.004], { region: WR.PLAIN, color: 0xf0f0e8 });
  mb.box(0, [0, 0, 0.028], [0.012, 0.045, 0.004], { region: WR.PLAIN, color: 0xf0f0e8 });
  mb.box(0, [0, 0.053, 0], [0.06, 0.008, 0.012], { region: WR.PLAIN, color: 0x222222 });
  mb.box(0, [0, 0.0, 0.0], [0.152, 0.004, 0.057], { region: WR.PLAIN, color: 0x303030 });
  // bandage roll
  mb.seg(0, [-0.03, 0.06, -0.01], [0.03, 0.06, -0.01], 0.018, 0.018, { region: WR.RAG, color: 0xf2eee4, rs: 10, hs: 1, caps: 1, capScale: 0.05 });
  mb.blood([0.02, 0.07, -0.02], 0.02, 0.8);
  return mb.build().geometry;
}

// opened tin of tuna (food "use" prop): held upright between the palms, lid peeled back off the far rim
function makeCan() {
  const mb = new MeshBuilder({ skinned: false, atlas: 'weapon' });
  const R = 0.043, H = 0.036;
  mb.seg(0, [0, -H / 2, 0], [0, H / 2, 0], R, R, { region: WR.PLAIN, color: 0xb4b6b2, rs: 14, hs: 1, caps: 1, capScale: 0.02 });
  mb.seg(0, [0, -H * 0.32, 0], [0, H * 0.32, 0], R + 0.0006, R + 0.0006, { region: WR.PLAIN, color: 0x2c5a8e, rs: 14, hs: 1, caps: 0 });
  mb.seg(0, [0, -H * 0.06, 0], [0, H * 0.08, 0], R + 0.001, R + 0.001, { region: WR.PLAIN, color: 0xe0c45a, rs: 14, hs: 1, caps: 0 });
  mb.seg(0, [0, H / 2 - 0.003, 0], [0, H / 2 + 0.0012, 0], R * 0.9, R * 0.9, { region: WR.PLAIN, color: 0xbfa08a, rs: 12, hs: 1, caps: 1, capScale: 0.1 });
  // lid: hinged at the far rim and bent back past upright, underside to the camera
  const a = (115 * PI) / 180, r = R * 0.92;
  const c = [0, H / 2 + Math.sin(a) * r, -R + Math.cos(a) * r], n = [0, Math.cos(a) * 0.0006, -Math.sin(a) * 0.0006];
  mb.seg(0, [c[0], c[1] - n[1], c[2] - n[2]], [c[0], c[1] + n[1], c[2] + n[2]], r, r, { region: WR.PLAIN, color: 0xc8cac6, rs: 12, hs: 1, caps: 1, capScale: 0.02 });
  return mb.build().geometry;
}

// energy drink (drink "use" prop): a tall black can with a lime band, held in both hands and tipped up to the mouth
function makeDrink() {
  const mb = new MeshBuilder({ skinned: false, atlas: 'weapon' });
  const R = 0.03, H = 0.15;
  mb.seg(0, [0, -H / 2, 0], [0, -H / 2 + 0.007, 0], R * 0.84, R, { region: WR.PLAIN, color: 0xb4b6b2, rs: 14, hs: 1, caps: 1, capScale: 0.02 });
  mb.seg(0, [0, -H / 2 + 0.007, 0], [0, H * 0.42, 0], R, R, { region: WR.PLAIN, color: 0x141614, rs: 14, hs: 1, caps: 0 });
  mb.seg(0, [0, -H * 0.12, 0], [0, H * 0.18, 0], R + 0.0006, R + 0.0006, { region: WR.PLAIN, color: 0x6cc228, rs: 14, hs: 1, caps: 0 });
  mb.seg(0, [0, -H * 0.085, 0], [0, -H * 0.055, 0], R + 0.001, R + 0.001, { region: WR.PLAIN, color: 0xe6e6dc, rs: 14, hs: 1, caps: 0 });
  // the shoulder narrowing into the lid, and the ring-pull bent up off it
  mb.seg(0, [0, H * 0.42, 0], [0, H / 2, 0], R, R * 0.82, { region: WR.PLAIN, color: 0xb4b6b2, rs: 14, hs: 1, caps: 1, capScale: 0.02 });
  mb.box(0, [R * 0.3, H / 2 + 0.002, 0], [0.012, 0.0016, 0.008], { region: WR.PLAIN, color: 0xc8cac6 });
  return mb.build().geometry;
}

// a cut of venison on the bone (food "use" prop for meat): raw and red, or browned off the fire
function makeMeat(cooked) {
  const mb = new MeshBuilder({ skinned: false, atlas: 'weapon' });
  const flesh = cooked ? 0x6a3a1e : 0x9a2a26;
  mb.box(0, [0, 0, 0], [0.11, 0.05, 0.075], { region: WR.PLAIN, color: flesh, round: 0.75, seg: 3 });
  mb.box(0, [0.012, 0.012, 0.004], [0.075, 0.034, 0.06], { region: WR.PLAIN, color: cooked ? 0x8a5428 : 0xb8443c, round: 0.8, seg: 2 });
  mb.box(0, [-0.03, -0.004, 0], [0.04, 0.045, 0.07], { region: WR.PLAIN, color: cooked ? 0x4a2812 : 0xd8c4b4, round: 0.7, seg: 2 }); // seared edge, or the fat
  mb.seg(0, [-0.045, 0, 0], [-0.1, 0.006, 0], 0.011, 0.009, { region: WR.PLAIN, color: 0xe2d8c4, rs: 8, hs: 1, caps: 1, capScale: 0.6 });
  mb.seg(0, [-0.098, -0.008, 0], [-0.098, 0.02, 0], 0.012, 0.012, { region: WR.PLAIN, color: 0xe2d8c4, rs: 8, hs: 1, caps: 1, capScale: 0.6 });
  return mb.build().geometry;
}

export class ViewModel {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'viewmodel';
    this.sway = new THREE.Group();
    this.group.add(this.sway);
    this.weaponRoot = new THREE.Group();
    this.sway.add(this.weaponRoot);
    this.armR = new VMArm(1);
    this.armL = new VMArm(-1);
    this.armR.shoulder.position.copy(SHOULDER_R);
    this.armL.shoulder.position.copy(SHOULDER_L);
    this.sway.add(this.armR.shoulder, this.armL.shoulder);
    // sniper-scope overlay (hunting rifle ADS): black ring + duplex reticle, drawn on top
    this.scopeOverlay = makeScopeOverlay();
    this.scopeOverlay.visible = false;
    this.group.add(this.scopeOverlay);
    this.scoped = false;
    this.kitGeo = makeKit();
    this.canGeo = makeCan();
    this.drinkGeo = makeDrink();
    this.meatGeo = [makeMeat(false), makeMeat(true)];
    this.drinking = false; // the use is a drink: the can goes up to the mouth and tips
    this.kitGrip = 0.1; // half the distance between the hands holding it
    this.usePose = ['kitHold', 'kitHold'];
    this.kit = new THREE.Mesh(this.kitGeo, getViewWeaponMaterial());
    this.kit.visible = false;
    this.kit.frustumCulled = false;
    this.sway.add(this.kit);
    this.cat = null; // the stray cat in our arms (holdCat)
    this.catT = 0; // ...up into the view (0..1)
    this.petU = -1; // ...a stroke under way (0..1 through it; -1 none)
    this.petW = 0; // ...the right hand on its way from resting on its back to the stroke
    this.flameAnchor = new THREE.Object3D();
    this.flameAnchor.name = 'flameAnchor';
    this.group.userData.flameAnchor = this.flameAnchor;
    this.group.userData.flameVisible = false;
    this.group.userData.scoped = false;
    this.items = new Map();
    this.cur = null; // current item view
    this.itemId = 0;
    this.claws = false;
    // state
    this.time = 0;
    this.drawT = 1;
    this.adsT = 0;
    this.fov = VM_FOV; // the field of view to draw the viewmodel with this frame (cfg.adsFov as the sights come up)
    this.sprintT = 0;
    this.talkT = 0; // the walkie-talkie keyed: raised toward the mouth (cfg.talk)
    this.tuckT = 0; // pulled back off a wall, a car or a crate in front (update's s.wallDist)
    this.pryT = 0; // forcing a car's boot with what is in the hand (update's s.pry)
    // pinned by a leaper (_push): 0-0.5 the weapon going down, 0.5-1 the hands coming up; the shove meter as the hands
    // show it; the thrust of the last presses; a throw-off's last shove
    this.pinT = 0;
    this.pinOn = false;
    this.pushing = false;
    this.pushLvl = 0;
    this.pushFull = false; // the meter has been full in this pin: the server throws it off on that command
    this.pushK = new Spring(260, 22);
    this.flingT = 0;
    this.flung = false;
    this.earsOn = false; // the hands are over the ears (s.ears) rather than on a leaper
    this.crouchT = 0;
    this.moveT = 0;
    this.bobPhase = 0;
    this.wasOnGround = true;
    this.land = new Spring(120, 22);
    this.recZ = new Spring(260, 22);
    this.recX = new Spring(200, 18);
    this.recY = new Spring(150, 16);
    this.swayX = new Spring(160, 25); // look lag, critically damped (no wobble)
    this.swayY = new Spring(160, 25);
    this.act = null; // {type, t, dur, heavy, perShell}
    this.fireT = 9; // time since last shot
    // a pair (setItem's opts.akimbo): the left gun's own view (_mirrorView), kick and time since its last shot
    this.akimbo = false;
    this.mirror = null;
    this.recZL = new Spring(260, 22);
    this.recXL = new Spring(200, 18);
    this.recYL = new Spring(150, 16);
    this.fireTL = 9;
    this.cycleT = 9; // bolt/pump cycle timer
    this.clawSide = 1;
    this.reloadHold = 0;
    this.cocked = true; // crossbow: string latched with a bolt on the rail (RPG: a grenade in the muzzle)
    this.cockHold = 0; // ...and how long to trust our own fire / reload over the caller's `loaded`
    this.hammerDown = false; // flare gun: the hammer has fallen and the reload has not cocked it yet
    this._nock = new THREE.Vector3(); // where the middle of the string is (weapon space)
    this.visible = true;
    this.muzzleLocal = new THREE.Vector3();
    // cached targets
    this._wp = new THREE.Vector3();
    this._wq = new THREE.Quaternion();
    this._lp = new THREE.Vector3();
    this._lq = new THREE.Quaternion();
    this._rp = new THREE.Vector3();
    this._rq = new THREE.Quaternion();
    this._wpL = new THREE.Vector3();
    this._wqL = new THREE.Quaternion();
    this._tmpP = new THREE.Vector3();
    this._tmpQ = new THREE.Quaternion();
    this.armR.setVisible(false);
    this.armL.setVisible(false);
  }

  _getItemView(itemId) {
    let v = this.items.get(itemId);
    if (v !== undefined) return v;
    const d = getVMData(itemId);
    const cfg = VM[itemId];
    if (!d || !cfg) {
      this.items.set(itemId, null);
      return null;
    }
    const root = new THREE.Group();
    root.visible = false;
    const mat = getViewWeaponMaterial();
    const parts = {};
    for (const name in d.parts) {
      const pd = d.parts[name];
      const mesh = new THREE.Mesh(pd.geometry, mat);
      mesh.position.copy(pd.pivot);
      mesh.frustumCulled = false;
      mesh.userData.base = pd.pivot.clone();
      root.add(mesh);
      parts[name] = mesh;
    }
    if (parts.shell) parts.shell.visible = false;
    if (parts.round) parts.round.visible = false;
    this.weaponRoot.add(root);
    const lp = cfg.lGrip && (cfg.lGrip.p ? new THREE.Vector3(...cfg.lGrip.p) : d.meta.leftHand && d.meta.leftHand.clone());
    const lGrip = lp ? { p: lp, q: cfg.lGrip.q, pose: cfg.lGrip.pose } : null;
    v = { itemId, cfg, d, root, parts, meta: d.meta, lGrip, rGrip: { p: new THREE.Vector3(...cfg.rGrip.p), q: cfg.rGrip.q }, tris: d.tris };
    this.items.set(itemId, v);
    return v;
  }

  // The left gun of a pair of the item: the same parts, in a root mirrored in X (its transform is the right gun's
  // mirrored, _placeMirror). Built the first time the item is held as a pair
  _mirrorView(cur) {
    if (cur.mirror) return cur.mirror;
    const root = new THREE.Group();
    root.scale.x = -1;
    root.visible = false;
    const parts = {};
    for (const name in cur.parts) {
      const src = cur.parts[name];
      const mesh = new THREE.Mesh(src.geometry, src.material);
      mesh.frustumCulled = false;
      root.add(mesh);
      parts[name] = mesh;
    }
    this.sway.add(root);
    return (cur.mirror = { root, parts });
  }

  setItem(itemId, opts = {}) {
    // nunchucks put away with a tuck (opts.tuck: the game's own change of weapon, not a warm-up or a sandbox): the
    // fold takes a fifth of a second, then whatever is next comes out - a little way into its draw already, so that
    // it is up by the time it can be used (DRAW_TIME in playersim.js)
    if (opts && opts.tuck && this.cur && this.cur.cfg.nunchaku && this.nk && this.visible && (itemId | 0) !== this.itemId && !(this.act && this.act.type === 'use')) {
      if (!this._nkAway) this.nk.core.holster();
      this._nkAway = { itemId, opts: { ...opts, tuck: false }, t: 0.19 };
      return;
    }
    const lead = this._nkAway ? 0.45 : 0;
    this._nkAway = null;
    this.pushing = false; // (hands on a leaper: _push puts the new item away and the arms on it again)
    const claws = !!(opts && opts.claws);
    if (this.cur) this.cur.root.visible = false;
    if (this.mirror) this.mirror.root.visible = false;
    if (this.flameAnchor.parent) this.flameAnchor.parent.remove(this.flameAnchor);
    this.claws = claws;
    this.itemId = claws ? 0 : itemId | 0;
    this.scoped = false;
    this.scopeOverlay.visible = false;
    this.group.userData.scoped = false;
    this.cur = claws ? null : this._getItemView(this.itemId);
    // (a pistol or a shotgun comes as a pair: shared/akimbo.js)
    this.akimbo = !!(opts && opts.akimbo) && !!this.cur && (this.cur.cfg.kind === 'pistol' || this.cur.cfg.kind === 'shotgun');
    this.mirror = this.akimbo ? this._mirrorView(this.cur) : null;
    this.fireTL = 9;
    this.recZL.x = this.recXL.x = this.recYL.x = 0;
    this.recZL.v = this.recXL.v = this.recYL.v = 0;
    this.act = null;
    this.kit.visible = false;
    this.drawT = lead;
    this.fireT = 9;
    this.cycleT = 9;
    this.reloadHold = 0;
    this.cocked = true;
    this.cockHold = 0;
    this.hammerDown = false;
    this.talkT = 0;
    this.recZ.x = this.recX.x = this.recY.x = 0;
    this.recZ.v = this.recX.v = this.recY.v = 0;
    const style = claws ? 'claw' : 'normal';
    this.armR.setStyle(style);
    this.armL.setStyle(style);
    // (nunchucks move the shoulders to a matched pair: back where everything else has them)
    this.armR.shoulder.position.copy(SHOULDER_R);
    this.armL.shoulder.position.copy(this.akimbo ? SHOULDER_L_PAIR : SHOULDER_L);
    if (this.nk) this.nk.meshes.trail.visible = false;
    if (this.cur && this.cur.cfg.nunchaku) this._nkView(this.cur).core.draw();
    if (this.cur) {
      this.cur.root.visible = true;
      for (const n in this.cur.parts) {
        const m = this.cur.parts[n];
        m.position.copy(m.userData.base);
        m.quaternion.identity();
        m.visible = n !== 'shell' && n !== 'round';
      }
      if (this.cur.meta.flame && this.itemId === ITEM.MOLOTOV) {
        this.cur.parts.body.add(this.flameAnchor);
        this.flameAnchor.position.copy(this.cur.meta.flame);
      }
      if (this.cur.meta.muzzle) this.muzzleLocal.copy(this.cur.meta.muzzle);
    }
    const armsOn = claws || !!this.cur;
    this.armR.setVisible(armsOn);
    this.armL.setVisible(claws || !!(this.cur && (this.cur.lGrip || this.akimbo)));
    this.armR.setPose(claws ? 'claw' : (this.cur && this.cur.cfg.rPose) || 'grip'); // (builds an item's own hand pose now, not mid-update)
    this.armL.setPose(claws ? 'claw' : this.akimbo ? this.cur.cfg.rPose || 'grip' : this.cur && this.cur.lGrip ? this.cur.lGrip.pose : 'grip');
    if (this.cat) this._catHands(); // (the weapon changed under the cat in our arms: it stays put away)
  }

  setVisible(v) {
    this.visible = v;
    this.group.visible = v;
  }

  /** hand: which gun of a pair went off (the 'fire' event's: -1 the left one), else 0 */
  fire(hand = 0) {
    if (!this.cur || this.cur.cfg.kind === 'melee' || this.cur.cfg.kind === 'throw') return;
    const rc = this.cur.cfg.recoil;
    const ads = 1 - this.adsT * 0.45;
    const left = this.akimbo && hand === -1;
    (left ? this.recZL : this.recZ).v += rc.z * 32 * ads;
    (left ? this.recXL : this.recX).v += rc.rx * 30 * ads;
    (left ? this.recYL : this.recY).v += (Math.random() - 0.5) * rc.ry * 40;
    if (left) return void (this.fireTL = 0); // (its slide and hammer: _placeMirror)
    this.fireT = 0;
    // (a pair's pump is not worked: there is no free hand for it)
    if ((this.cur.cfg.kind === 'shotgun' && !this.akimbo) || (this.cur.cfg.bolt && !this.cur.cfg.single)) this.cycleT = 0; // (single: the reload works the bolt)
    if (this.cur.cfg.crossbow || this.cur.cfg.rpg) {
      this.cocked = false;
      this.cockHold = 0.3;
    }
    if (this.cur.cfg.breakPistol || this.cur.cfg.revolver) this.hammerDown = true;
  }

  reload(duration = 2, perShell = false) {
    if (!this.cur || this.claws) return;
    const k = this.cur.cfg.kind;
    if (k !== 'rifle' && k !== 'shotgun' && k !== 'pistol') return;
    this.act = { type: 'reload', t: 0, dur: Math.max(0.2, duration), perShell: !!perShell };
  }

  /** Nunchucks: a move of the moveset begins (NK_MOVE, shared/nunchaku.js). */
  nkSwing(move) {
    if (this.cur && this.cur.cfg.nunchaku && !(this.act && this.act.type === 'use')) this._nkView(this.cur).core.swing(move);
  }
  /** Nunchucks: a blow landed. kind: 'flesh' | 'bone' | 'wood' | 'metal' | 'dirt'; n: the surface's normal, view space. */
  nkHit(kind, nx = 0, ny = 0, nz = 1, power = 1) {
    if (this.cur && this.cur.cfg.nunchaku) this._nkView(this.cur).core.hit(kind, nx, ny, nz, power);
  }
  /** Nunchucks: a flourish asked for. */
  nkFlourish() {
    return !!(this.cur && this.cur.cfg.nunchaku && !this.act && this._nkView(this.cur).core.flourish());
  }
  _nkView(cur) {
    if (!this.nk) {
      const nk = (this.nk = new NunchakuFP(getNunchakuGeo(true), getViewWeaponMaterial()));
      // the other handle and the links go beside the first handle (the clip check and the grip fitter measure what is
      // there); the streak behind them is no part of the item
      for (const m of [nk.meshes.handle, ...nk.meshes.links]) cur.root.add(m);
      this.sway.add(nk.meshes.trail);
    }
    return this.nk;
  }

  /** Pinned by a leaper: a press of the shove key (the simulation's 'shove'): both hands thrust at it. */
  shove() {
    this.pushK.v += PUSH_KICK;
  }

  melee(heavy = false) {
    if (this.claws) {
      this.clawSide = -this.clawSide;
      this.act = { type: 'claw', t: 0, dur: CLAW_SWING.dur, side: this.clawSide };
      return;
    }
    if (!this.cur) return;
    if (this.cur.cfg.nunchaku) return void this.nkSwing(heavy ? 9 : 0); // (the game names the move: nkSwing)
    const cfg = this.cur.cfg;
    const sw = (heavy && cfg.heavySwing) || cfg.swing || 'shove';
    this.act = { type: 'melee', t: 0, dur: SWINGS[sw].dur, swing: SWINGS[sw] };
  }

  throwItem() {
    if (!this.cur || this.cur.cfg.kind !== 'throw') return;
    this.act = { type: 'throw', t: 0, dur: 1.15 };
  }

  /** item: what is being used (food shows a tin instead of the medkit) */
  useItem(duration = 2, item = 0) {
    const food = !!CONSUMABLES[item]?.food;
    const meat = CONSUMABLES[item]?.meat || 0; // 1: a raw cut, 2: a cooked one
    this.drinking = !!CONSUMABLES[item]?.drink;
    this.kit.geometry = meat ? this.meatGeo[meat - 1] : food ? this.canGeo : this.drinking ? this.drinkGeo : this.kitGeo;
    this.kitGrip = food ? 0.068 : this.drinking ? 0.055 : 0.1;
    // the hand poses fitted to each prop's sides (left, right)
    this.usePose = meat ? ['meatL', 'meatR'] : food ? ['tinHold', 'tinHold'] : this.drinking ? ['drinkHold', 'drinkHold'] : ['kitHold', 'kitHold'];
    this.act = { type: 'use', t: 0, dur: Math.max(0.6, duration) + 0.35 };
  }

  /** The stray cat in both arms: a view of it for this scene (createCat(coat, seed, true)), drawn across the arms in
   *  place of the weapon; or null, and it is put down and the weapon comes back up. While it is held, update's s.pet
   *  (the fire button held) strokes it. */
  holdCat(view) {
    if ((view || null) === this.cat) return;
    if (this.cat) this.sway.remove(this.cat.object);
    this.cat = view || null;
    if (!this.cat) return void this.setItem(this.itemId, { claws: this.claws, akimbo: this.akimbo });
    this.sway.add(this.cat.object);
    this.cat.setLook(CAT_LOOK);
    this.catT = 0;
    this.petU = -1;
    this.petW = 0;
    this._catHands();
  }
  _catHands() {
    this.act = null;
    this.kit.visible = false;
    if (this.cur) this.cur.root.visible = false;
    this.scoped = false;
    this.scopeOverlay.visible = false;
    this.group.userData.scoped = false;
    this.armR.setStyle('normal');
    this.armL.setStyle('normal');
    this.armR.shoulder.position.copy(SHOULDER_R);
    this.armL.shoulder.position.copy(SHOULDER_L);
    this.armR.setVisible(true);
    this.armL.setVisible(true);
    this.armR.setPose('catBack');
    this.armL.setPose('catCup');
  }

  /** the item is put away before it is used up: the weapon is drawn again straight away */
  cancelUse() {
    if (!this.act || this.act.type !== 'use') return;
    this.act = null;
    this.kit.visible = false;
    this.drawT = 0;
    if (this.cur) this.cur.root.visible = true;
  }

  getMuzzle(out) {
    if (!this.cur || !this.cur.meta.muzzle) {
      return out.set(0.12, -0.12, -0.5);
    }
    out.copy(this.cur.meta.muzzle);
    if (this.akimbo && this.fireTL < this.fireT) {
      // (a pair whose left gun went off last: its muzzle, mirrored as the gun is, _placeMirror)
      out.applyQuaternion(this._wqL).add(this._wpL);
      out.x = -out.x;
    } else out.applyQuaternion(this._wq).add(this._wp);
    out.applyQuaternion(this.sway.quaternion).add(this.sway.position);
    return out;
  }

  // ---------------------------------------------------------------- update
  update(dt, s = {}) {
    dt = Math.min(0.1, Math.max(0, dt || 0));
    if (this._nkAway && (this._nkAway.t -= dt) <= 0) this.setItem(this._nkAway.itemId, this._nkAway.opts);
    // molotov rag flame: game shows its fire sprite at userData.flameAnchor while this is true
    this.group.userData.flameVisible = !!(this.cur && this.flameAnchor.parent && this.cur.root.visible && this.group.visible);
    this.time = s.time !== undefined ? s.time : this.time + dt;
    const t = this.time;
    const speed = s.speed || 0;
    const onGround = s.onGround !== false;
    const cur = this.cur;
    const kind = cur ? cur.cfg.kind : this.claws ? 'claws' : 'none';
    const isGun = kind === 'rifle' || kind === 'shotgun' || kind === 'pistol';
    const busy = this.act && (this.act.type === 'reload' || this.act.type === 'use' || this.act.type === 'throw');
    const wantAds = !!s.aiming && isGun && !busy && !s.sprint;
    const wantSprint = !!s.sprint && speed > 1 && !wantAds;
    const k = 1 - Math.exp(-dt * 12);
    this.adsT += ((wantAds ? 1 : 0) - this.adsT) * (1 - Math.exp(-dt * 14));
    this.fov = VM_FOV + (((isGun && cur.cfg.adsFov) || VM_FOV) - VM_FOV) * this.adsT;
    this.sprintT += ((wantSprint && (!this.act || this.act.type === 'draw') ? 1 : 0) - this.sprintT) * (1 - Math.exp(-dt * 9));
    this.crouchT += ((s.crouch ? 1 : 0) - this.crouchT) * k;
    this.moveT += ((onGround ? Math.min(1, speed / 4.3) : 0) - this.moveT) * k;
    this.drawT = Math.min(1, this.drawT + dt / 0.35);
    this.fireT += dt;
    this.fireTL += dt;
    this.cycleT += dt;
    if (this.mirror) this.mirror.root.visible = false; // (shown again with the right gun, _placeMirror)
    // landing
    if (onGround && !this.wasOnGround) this.land.v -= 0.9;
    this.wasOnGround = onGround;
    this.land.step(dt);
    // recoil springs
    this.recZ.step(dt);
    this.recX.step(dt);
    this.recY.step(dt);
    if (this.akimbo) {
      this.recZL.step(dt);
      this.recXL.step(dt);
      this.recYL.step(dt);
    }
    // look lag (lookDX/lookDY: camera rotation this frame, radians; +x = turning right, +y = looking down).
    // Kept small: the weapon trails the view by about a degree at normal turn rates.
    const ldx = Math.max(-0.08, Math.min(0.08, s.lookDX || 0));
    const ldy = Math.max(-0.08, Math.min(0.08, s.lookDY || 0));
    const swayGain = 1 - this.adsT * 0.7;
    this.swayX.v += ldx * 4.5 * swayGain;
    this.swayY.v += ldy * 4.5 * swayGain;
    this.swayX.step(dt);
    this.swayY.step(dt);
    // action timer
    if (this.act) {
      this.act.t += dt;
      if (this.act.t >= this.act.dur) {
        const done = this.act;
        this.act = null;
        if (done.type === 'use') this.drawT = 0;
        if (done.type === 'reload' && cur && (cur.cfg.crossbow || cur.cfg.rpg)) {
          this.cocked = true;
          this.cockHold = 0.3;
        }
        if ((done.type === 'throw' || done.type === 'use') && cur) cur.root.visible = true;
      }
    }
    this.reloadHold = this.act && this.act.type === 'reload' ? Math.min(1, this.reloadHold + dt * 6) : Math.max(0, this.reloadHold - dt * 3);

    // ---- sway root: CS-style, the arms stay almost still. A slow breathing figure-8 while idle, a small
    // smooth walk bob, a slight look lag and a landing dip. Rotations pivot about the hands (not the eye),
    // so they read as the arms settling rather than the whole weapon swinging across the screen.
    const bobAmp = this.moveT * (1 - this.adsT * 0.85) * (1 - this.crouchT * 0.4) * (1 + this.sprintT * 0.9);
    const bobRate = wantSprint ? 13.5 : 9.0 + speed * 0.4;
    this.bobPhase += dt * bobRate * (0.3 + this.moveT * 0.7);
    const bp = this.bobPhase;
    const bobX = Math.sin(bp * 0.5), bobY = (Math.cos(bp) - 1) * 0.5; // lateral sway per stride, dip per step
    const idleW = (1 - this.adsT * 0.75) * (1 - this.moveT * 0.6);
    const bt = t * IDLE_RATE;
    const lagX = softClamp(this.swayX.x, 0.035), lagY = softClamp(this.swayY.x, 0.03);
    _e1.set(
      lagY * 0.9 + Math.sin(bt + 0.6) * 0.006 * idleW + Math.sin(bp) * 0.003 * bobAmp + this.land.x * 0.2,
      lagX * 0.9 + Math.sin(bt * 0.5 + 0.4) * 0.005 * idleW + bobX * 0.003 * bobAmp,
      lagX * 0.35 + Math.sin(bt * 0.5 + 1.3) * 0.011 * idleW + bobX * 0.008 * bobAmp,
      'YXZ'
    );
    this.sway.quaternion.setFromEuler(_e1);
    _v1.copy(SWAY_PIVOT).applyQuaternion(this.sway.quaternion);
    this.sway.position.set(
      SWAY_PIVOT.x - _v1.x + Math.sin(bt * 0.5) * 0.0014 * idleW + bobX * 0.003 * bobAmp - lagX * 0.012,
      SWAY_PIVOT.y - _v1.y + Math.sin(bt) * 0.0024 * idleW + bobY * 0.0035 * bobAmp + lagY * 0.01 + this.land.x * 0.06 - this.crouchT * 0.006,
      SWAY_PIVOT.z - _v1.z
    );

    if (this._push(dt, s)) {
      if (this.cat) this.cat.object.visible = false; // (pinned: the server sets the cat down, and it is gone a moment on)
      return;
    }
    if (this.cat) {
      // the cat in our arms, unless an item is being used (the server sets the cat down for it: it is gone a moment on)
      const using = !!this.act && this.act.type === 'use';
      this.cat.object.visible = !using;
      if (!using) return this._animCat(dt, s, t);
    }
    if (this.claws) {
      this._updateClaws(dt, t);
      return;
    }
    if (!cur) {
      // no weapon: only the generic use animation shows hands
      if (this.act && this.act.type === 'use') this._animUse(this.act.t / this.act.dur, t);
      else if (this.armR.visible || this.armL.visible || this.kit.visible) {
        this.armR.setVisible(false);
        this.armL.setVisible(false);
        this.kit.visible = false;
      }
      return;
    }
    const cfg = cur.cfg;
    const meta = cur.meta;
    if (cfg.nunchaku) return this._updateNunchaku(dt, s, cur, wantSprint);

    // ---- base weapon pose (hip / ads / sprint)
    const P6 = _pose6;
    for (let i = 0; i < 6; i++) P6[i] = cfg.hip[i] + (this.akimbo ? PAIR_HIP[kind][i] : 0);
    if (isGun && this.adsT > 0.001) {
      // align the sight point on the view axis (optionally pitched around it by cfg.adsPitch)
      const pitch = cfg.adsPitch || 0;
      const c = Math.cos(pitch), sn = Math.sin(pitch);
      const sx = meta.sight.x, sy = meta.sight.y * c - meta.sight.z * sn, sz = meta.sight.y * sn + meta.sight.z * c;
      const a = this.adsT;
      P6[0] += (-sx - P6[0]) * a;
      P6[1] += (-sy - P6[1]) * a;
      P6[2] += (cfg.adsZ - sz - P6[2]) * a;
      P6[3] += (pitch - P6[3]) * a;
      P6[4] *= 1 - a;
      P6[5] *= 1 - a;
    }
    if (this.sprintT > 0.001) {
      const sp = this.akimbo ? PAIR_SPRINT[kind] : cfg.sprint;
      for (let i = 0; i < 6; i++) P6[i] += sp[i] * this.sprintT;
    }
    if (cfg.talk) {
      this.talkT += ((s.talk ? 1 : 0) - this.talkT) * (1 - Math.exp(-dt * 11));
      const tk = ease(this.talkT, 2);
      if (tk > 0.001) for (let i = 0; i < 6; i++) P6[i] += cfg.talk[i] * tk;
    }
    // draw (raise from below)
    const dr = 1 - ease(this.drawT, 2);
    P6[1] -= dr * 0.28;
    P6[3] -= dr * 0.9;
    P6[2] += dr * 0.05;

    // default hand poses / attachments
    let lPose = cur.lGrip ? cur.lGrip.pose : 'grip';
    let rPose = cfg.rPose || 'grip';
    let lVisible = !!cur.lGrip;
    // part animation defaults
    const parts = cur.parts;
    const act = this.act;
    const u = act ? act.t / act.dur : 0;
    let altLw = 0; // blend weight toward the reload target
    let altR = null, altRw = 0;

    // ---- firearm moving parts
    if (parts.slide) {
      const s1 = this.fireT < 0.09 ? Math.sin((this.fireT / 0.09) * PI) : 0;
      parts.slide.position.z = parts.slide.userData.base.z + s1 * 0.026;
    }
    if (parts.charge) {
      const s1 = cfg.chargeFire !== false && this.fireT < 0.07 ? Math.sin((this.fireT / 0.07) * PI) : 0;
      parts.charge.position.z = parts.charge.userData.base.z + s1 * 0.07;
    }
    if (parts.pump) {
      let pz = 0;
      if (cfg.kind === 'shotgun' && this.cycleT < 0.55 && !(act && act.type === 'reload')) {
        const c = this.cycleT;
        pz = smoothstep(0.14, 0.28, c) * (1 - smoothstep(0.32, 0.46, c)) * 0.085;
        P6[3] += pz * 0.8;
        P6[2] += pz * 0.25;
      }
      parts.pump.position.z = parts.pump.userData.base.z + pz;
    }
    if (parts.bolt) {
      let lift = 0, back = 0, rOnBolt = 0;
      if (cfg.bolt && this.cycleT < 0.95 && !(act && act.type === 'reload')) {
        const c = this.cycleT;
        rOnBolt = win(c, 0.22, 0.34, 0.8, 0.94);
        lift = smoothstep(0.34, 0.42, c) * (1 - smoothstep(0.66, 0.74, c));
        back = smoothstep(0.42, 0.52, c) * (1 - smoothstep(0.56, 0.66, c));
        P6[5] += rOnBolt * -0.3;
        P6[3] += rOnBolt * 0.06;
        P6[0] -= rOnBolt * 0.035;
        P6[1] += rOnBolt * 0.025;
      }
      if (act && act.type === 'reload' && cfg.single) {
        // opened as the reload starts, closed on the new round as it ends
        rOnBolt = win(u, 0.0, 0.035, 0.12, 0.17) + win(u, 0.8, 0.85, 0.975, 1.0);
        lift = smoothstep(0.035, 0.06, u) * (1 - smoothstep(0.93, 0.975, u));
        back = smoothstep(0.06, 0.1, u) * (1 - smoothstep(0.86, 0.92, u));
      } else if (act && act.type === 'reload') {
        rOnBolt = win(u, 0.0, 0.1, 0.86, 0.96);
        lift = smoothstep(0.08, 0.14, u) * (1 - smoothstep(0.78, 0.84, u));
        back = smoothstep(0.14, 0.22, u) * (1 - smoothstep(0.7, 0.78, u));
      }
      parts.bolt.rotation.z = lift * 1.2;
      parts.bolt.position.z = parts.bolt.userData.base.z + back * (cfg.boltTravel || 0.085);
      if (rOnBolt > 0.001) {
        altR = this._rBoltTarget || (this._rBoltTarget = new THREE.Vector3());
        // knob position follows the bolt transform
        altR.copy(meta.boltKnob).sub(parts.bolt.userData.base);
        altR.applyQuaternion(parts.bolt.quaternion).add(parts.bolt.position);
        altRw = rOnBolt;
        if (rOnBolt > 0.5) rPose = 'pinch';
      }
    }
    if (parts.barrels) parts.barrels.rotation.x = 0; // closed unless the reload opens it
    if (parts.barrel) parts.barrel.rotation.x = 0; // (the flare gun's: the same)
    if (parts.cyl) parts.cyl.rotation.z = 0; // (the revolver's cylinder: shut)
    if (parts.loader) parts.loader.visible = false;
    if (parts.hammer) {
      // falls the instant it is fired (a short swing past rest and back), stays down until the reload cocks it
      let fall = this.hammerDown ? Math.min(1, this.fireT / 0.025) : 0;
      if (act && act.type === 'reload' && cfg.breakPistol) fall *= 1 - smoothstep(0.86, 0.93, u); // thumbed back
      if (cfg.revolver && this.hammerDown) fall = this.fireT < 0.025 ? this.fireT / 0.025 : 1 - smoothstep(0.12, 0.3, this.fireT); // double action: it rises again with the next pull
      parts.hammer.rotation.x = -0.62 * fall + (this.hammerDown && this.fireT < 0.08 ? -0.08 * Math.sin((this.fireT / 0.08) * PI) : 0);
    }
    if (cfg.crossbow) {
      const reloading = !!act && act.type === 'reload';
      // fire() and the end of the reload animation flip `cocked` themselves; otherwise follow the caller
      if (this.cockHold > 0) this.cockHold -= dt;
      else if (!reloading && s.loaded !== undefined) this.cocked = !!s.loaded;
      // draw: hauled back during the reload, snapping forward (and ringing) right after a shot
      const ft = this.fireT;
      const draw = reloading ? smoothstep(0.2, 0.46, u) : this.cocked ? 1 : Math.max(0, 1 - ft / 0.035);
      const ring = !reloading && !this.cocked && ft < 0.3 ? -0.014 * Math.sin(ft * 120) * Math.exp(-ft / 0.06) : 0;
      this._poseCrossbow(cur, draw, ring);
      parts.arrow.visible = this.cocked && !reloading;
      parts.arrow.position.copy(parts.arrow.userData.base);
    }
    if (cfg.rpg) {
      // the grenade in the muzzle: fire() takes it away at once and the reload carries a new one in (_animReloadRPG);
      // otherwise it follows the caller, like the crossbow's bolt
      const reloading = !!act && act.type === 'reload';
      if (this.cockHold > 0) this.cockHold -= dt;
      else if (!reloading && s.loaded !== undefined) this.cocked = !!s.loaded;
      const wh = parts.warhead;
      wh.visible = this.cocked && !reloading;
      wh.position.copy(wh.userData.base);
      wh.quaternion.identity();
      this._rpgFollow = false;
    }
    if (parts.mag) {
      parts.mag.position.copy(parts.mag.userData.base);
      parts.mag.quaternion.identity();
      parts.mag.visible = true;
    }

    this._atFollow = false;
    if (cfg.single) parts.round.visible = parts.case.visible = false; // (shown by the reload only)

    // ---- actions
    if (act) {
      if (act.type === 'reload') {
        if (!this.akimbo) this._animReload(cur, u, P6, parts, meta); // (a pair goes down to be reloaded: below)
      }
      else if (act.type === 'melee') {
        evalSwing(act.swing, P6.slice ? P6 : P6, u, _pose6b);
        // (a pair shoves with both guns at once, each on its own side: the swing's jab without its turn across the
        // middle, where the left gun - this one mirrored - would meet it)
        if (this.akimbo) {
          _pose6b[0] = P6[0];
          _pose6b[4] = P6[4];
          _pose6b[5] = P6[5];
        }
        for (let i = 0; i < 6; i++) P6[i] = _pose6b[i];
      } else if (act.type === 'throw') {
        this._animThrow(u, P6, cur);
        // the fingers open as the item leaves the hand (it is hidden from 0.46), not before: opened round it, they
        // went straight through it
        if (u >= THROW_RELEASE && u < 0.72) rPose = 'open';
      } else if (act.type === 'use') {
        const up = win(u, 0.0, 0.18, 0.82, 1.0);
        P6[1] -= up * 0.35;
        P6[3] -= up * 0.6;
        cur.root.visible = up < 0.6;
      }
    }
    // pinned by a leaper: down out of the way of the hands (_push), and back up once they have dropped
    if (this.pinT > 0) {
      const d = smoothstep(0, 0.5, this.pinT);
      P6[1] -= d * 0.35;
      P6[3] -= d * 0.6;
    }
    const rs = this._reloadState;
    this._reloadState = null;
    if (rs) {
      altLw = rs.w;
      if (rs.pose && rs.w > 0.3) lPose = rs.pose;
      if (rs.rPose) rPose = rs.rPose;
    }
    // a pair is reloaded low, out of sight: both guns go down while the rounds go in, and come back up after
    if (this.akimbo && this.reloadHold > 0) {
      const h = smoothstep(0, 1, this.reloadHold);
      P6[1] -= 0.24 * h;
      P6[2] += 0.04 * h;
      P6[3] -= 0.8 * h;
    }
    // shotgun: tilt hold between per-shell reload calls
    if (cfg.kind === 'shotgun' && !cfg.breakAction && !this.akimbo && this.reloadHold > 0) {
      const h = smoothstep(0, 1, this.reloadHold);
      P6[5] -= 1.05 * h;
      P6[3] += 0.18 * h;
      P6[4] += 0.1 * h;
      P6[0] -= 0.05 * h;
      P6[1] += 0.05 * h;
    }

    // ---- sniper scope: full overlay once aimed in
    const scoped = !!cfg.scope && this.adsT > 0.92 && !busy;
    if (scoped !== this.scoped) {
      this.scoped = scoped;
      this.group.userData.scoped = scoped;
      this.scopeOverlay.visible = scoped;
      cur.root.visible = !scoped;
    }
    if (scoped) {
      this.armR.setVisible(false);
      this.armL.setVisible(false);
      // gentle sway of the reticle
      this.scopeOverlay.position.set(this.swayX.x * 0.01, this.swayY.x * 0.01 + this.recX.x * 0.05, 0);
      this._wp.set(P6[0], P6[1], P6[2]);
      _e1.set(P6[3], P6[4], P6[5], 'YXZ');
      this._wq.setFromEuler(_e1);
      return;
    }

    // ---- forcing a car's boot (s.pry, while the hold runs: shared/trunk.js). The whole weapon, hands and all, is put
    // forward and tipped down to the gap under the lid, and heaved on once every PRY_BEAT: a blade is worked in and
    // twisted, a bat or the nunchucks' handle is jammed in and leant on, the hammer's claw is hooked under and pulled.
    // (The hands stay as they hold the weapon: nothing of the grip changes, so nothing of it clips.)
    this.pryT += ((s.pry && kind === 'melee' ? 1 : 0) - this.pryT) * (1 - Math.exp(-dt * 9));
    if (this.pryT > 0.002) {
      const w = ease(this.pryT, 0);
      const ph = (t / PRY_BEAT) * PI * 2;
      const heave = Math.max(0, Math.sin(ph)) ** 2, back = Math.max(0, -Math.sin(ph));
      const blade = cfg.pry === 'blade', hammer = cfg.pry === 'hammer';
      P6[0] += w * -0.05;
      P6[1] += w * (-0.07 + 0.035 * heave);
      P6[2] += w * (-0.13 - (blade ? 0.02 : 0.06) * back);
      P6[3] += w * ((blade ? -0.5 : hammer ? -0.75 : -0.34) + (blade ? 0.3 : hammer ? 0.42 : 0.22) * heave);
      P6[4] += w * (blade ? 0.14 * Math.sin(ph * 0.5) : 0.05);
      P6[5] += w * (blade ? 0.5 * heave - 0.2 : hammer ? 0.12 * heave : -0.1 * heave);
    }
    // ---- tucked back off what is in front: the viewmodel is drawn over the world (its own pass, depth cleared), so
    // nothing cuts into it; but a muzzle or a blade reaching further than the wall the player stands at reads as gone
    // into it. s.wallDist (m, along the view; Game.weaponClearance) against how far the item reaches at the hip: the
    // gun comes up and back to high ready, a blade or a throwable back and down, by as much as it would go in
    if (cur.reach === undefined) cur.reach = this._itemReach(cur);
    const tuckTo = Math.min(1, Math.max(0, (cur.reach + TUCK_GAP - (s.wallDist ?? 99)) / TUCK_RANGE));
    this.tuckT += (tuckTo - this.tuckT) * (1 - Math.exp(-dt * 10));
    const tk = TUCK[kind];
    if (tk && this.tuckT > 0.001) {
      const w = ease(this.tuckT, 0) * (1 - 0.6 * this.adsT) * (act && act.type === 'melee' ? 0.35 : 1);
      for (let i = 0; i < 6; i++) P6[i] += tk[i] * w;
    }

    // ---- final weapon transform (+ recoil)
    const wp = this._wp.set(P6[0], P6[1], P6[2] + this.recZ.x);
    _e1.set(P6[3] + this.recX.x, P6[4] + this.recY.x, P6[5], 'YXZ');
    const wq = this._wq.setFromEuler(_e1);
    this.weaponRoot.position.copy(wp);
    this.weaponRoot.quaternion.copy(wq);
    if (this.akimbo) this._placeMirror(cur, P6);

    // ---- hands
    // right: grip frame (or bolt knob)
    const rg = cur.rGrip;
    const rp = this._rp.copy(rg.p).applyQuaternion(wq).add(wp);
    const rq = this._rq.copy(wq).multiply(rg.q);
    if (altR && altRw > 0) {
      _v1.copy(altR).applyQuaternion(wq).add(wp);
      rp.lerp(_v1, altRw);
      // pinch orientation: fingers toward the knob from above
      _q1.copy(wq).multiply(_q2.setFromEuler(_e1.set(0.4, 0.2, -1.2, 'YXZ')));
      rq.slerp(_q1, altRw);
    }
    this.armR.setPose(rPose);
    this.armR.setVisible(true);
    // (on the bolt the hand's grip center goes over to the pinch's with the blend, so the pose switch doesn't jump it)
    const rC = altR && altRw > 0 ? this._blendCenter(this.armR, cfg.rPose || 'grip', 'pinch', altRw) : cfg.kind === 'throw' ? cfg.rPose : undefined;
    // a long gun's butt swings across under the right forearm on a shove: the right elbow goes out to the side for it
    let poleR = cfg.poleR || POLE_R;
    if (act && act.type === 'melee' && !this.akimbo && (cfg.kind === 'rifle' || cfg.kind === 'shotgun')) poleR = _v8.copy(poleR).lerp(SHOVE_POLE_R, win(u, 0.0, 0.2, 0.7, 0.95));
    this._solveArm(this.armR, rp, rq, SHOULDER_R, poleR, rC);

    // left
    if (act && act.type === 'use') {
      this._animUse(u, t);
      return;
    } else {
      this.kit.visible = false;
    }
    if (this.akimbo) {
      // on the left gun of the pair, as the right hand is on the right one, mirrored (x -> -x; a turn's quaternion
      // (x, y, z, w) -> (x, -y, -z, w), which is how handQ builds a left hand from the right one's)
      const lp = this._lp.copy(rg.p).applyQuaternion(this._wqL).add(this._wpL);
      lp.x = -lp.x;
      const lq = this._lq.copy(this._wqL).multiply(rg.q);
      lq.set(lq.x, -lq.y, -lq.z, lq.w);
      this.armL.setPose(cfg.rPose || 'grip');
      this.armL.setVisible(true);
      _v7.copy(cfg.poleR || POLE_R);
      _v7.x = -_v7.x;
      this._solveArm(this.armL, lp, lq, SHOULDER_L_PAIR, _v7, undefined);
    } else if (cur.lGrip || altLw > 0) {
      const lp = this._lp;
      const lq = this._lq;
      if (cur.lGrip) {
        lp.copy(cur.lGrip.p);
        if (parts.pump) lp.z += parts.pump.position.z - parts.pump.userData.base.z;
        if (parts.barrels) lp.sub(parts.barrels.userData.base).applyQuaternion(parts.barrels.quaternion).add(parts.barrels.position);
        lp.applyQuaternion(wq).add(wp);
        lq.copy(wq);
        if (parts.barrels) lq.multiply(parts.barrels.quaternion); // (the hand turns with the fore-end it holds, as it closes)
        lq.multiply(cur.lGrip.q);
      } else {
        lp.set(-0.2, -0.45, -0.1);
        lq.copy(wq);
      }
      if (rs && altLw > 0) {
        // resolve A and B into sway space, mix, then blend from the grip
        if (rs.aCam) _v2.copy(rs.a);
        else _v2.copy(rs.a).applyQuaternion(wq).add(wp);
        if (rs.bCam) _v3.copy(rs.b);
        else _v3.copy(rs.b).applyQuaternion(wq).add(wp);
        _v2.lerp(_v3, rs.m);
        // (arc: an offset, weapon space, at the middle of the A to B move, to take the hand round something between)
        if (rs.arc) _v2.add(_v3.copy(rs.arc).applyQuaternion(wq).multiplyScalar(Math.sin(PI * rs.m)));
        lp.lerp(_v2, altLw);
        // ...and the same way round going back from B to the grip
        if (rs.arc && rs.m > 0) lp.add(_v3.copy(rs.arc).applyQuaternion(wq).multiplyScalar(Math.sin(PI * altLw) * rs.m));
        if (rs.aCam) _q1.copy(rs.qa);
        else _q1.copy(wq).multiply(rs.qa);
        if (rs.bCam) _q2.copy(rs.qb);
        else _q2.copy(wq).multiply(rs.qb);
        _q1.slerp(_q2, rs.m);
        lq.slerp(_q1, altLw);
      }
      this.armL.setPose(lPose);
      this.armL.setVisible(lVisible || altLw > 0.01);
      // the grip center blends from the grip's to the reload's (A to B by m) with the weight, as the pose switches
      let lC;
      if (rs && altLw > 0 && cur.lGrip) {
        const cr = this._blendCenter(this.armL, rs.poseA || rs.pose || lPose, rs.poseB || rs.pose || lPose, rs.m, _v4);
        lC = this.armL.gripCenter(_v5, cur.lGrip.pose).lerp(cr, altLw);
      }
      let poleL = cfg.poleL || POLE_L;
      // two hands on a bat: through the swing the left elbow drops and goes back, so the left forearm passes under the
      // right hand instead of through it
      if (cfg.swingPoleL && act && act.type === 'melee') poleL = _v7.copy(poleL).lerp(cfg.swingPoleL, win(u, 0.36, 0.46, 0.76, 0.88));
      if (rs && (rs.poleA || rs.poleB) && altLw > 0) {
        _v8.copy(rs.poleA || poleL).lerp(rs.poleB || poleL, rs.m);
        poleL = _v7.copy(poleL).lerp(_v8, altLw);
      }
      this._solveArm(this.armL, lp, lq, SHOULDER_L, poleL, lC);
      if (this._atFollow) {
        // the anti-tank round in the left hand: weapon space, held by its middle
        _q1.copy(wq).invert();
        const rd = parts.round;
        rd.position.copy(lp).sub(wp).applyQuaternion(_q1).sub(atHold(_v1, this._atTilt, this._atYaw));
      }
      if (cfg.rpg && this._rpgFollow) {
        // the RPG grenade in the left hand: weapon space, held under its bulb (its tilt set by _animReloadRPG)
        _q1.copy(wq).invert();
        const wh = parts.warhead;
        wh.position.copy(lp).sub(wp).applyQuaternion(_q1).sub(_v1.copy(meta.rpg.grab).applyQuaternion(wh.quaternion));
      }
    } else {
      this.armL.setVisible(false);
    }
  }

  // The left gun of a pair: the right one's hold (P6) with its own kick, mirrored across the middle of the view, and its
  // moving parts as the right one's but for what its own shots work - the slide, a revolver's hammer
  _placeMirror(cur, P6) {
    const m = this.mirror;
    const p = this._wpL.set(P6[0], P6[1], P6[2] + this.recZL.x);
    _e1.set(P6[3] + this.recXL.x, P6[4] + this.recYL.x, P6[5], 'YXZ');
    const q = this._wqL.setFromEuler(_e1);
    m.root.position.set(-p.x, p.y, p.z);
    m.root.quaternion.set(q.x, -q.y, -q.z, q.w);
    m.root.visible = cur.root.visible;
    for (const n in m.parts) {
      const a = cur.parts[n];
      const b = m.parts[n];
      b.position.copy(a.position);
      b.quaternion.copy(a.quaternion);
      b.visible = a.visible;
    }
    const ft = this.fireTL;
    if (m.parts.slide) m.parts.slide.position.z = cur.parts.slide.userData.base.z + (ft < 0.09 ? Math.sin((ft / 0.09) * PI) : 0) * 0.026;
    if (m.parts.hammer && cur.cfg.revolver) {
      const fall = ft < 0.025 ? ft / 0.025 : 1 - smoothstep(0.12, 0.3, ft);
      m.parts.hammer.rotation.x = -0.62 * fall + (ft < 0.08 ? -0.08 * Math.sin((ft / 0.08) * PI) : 0);
    }
  }

  // Nunchucks (models/nunchaku.js): the moves, both hands and the simulated chain are the core's; this puts the two
  // handles, the links and the arms where it has them. s.camQ: the camera's orientation in the world (so the chain
  // hangs down whichever way the eye looks, and swings when the view turns); s.acc: the eye's acceleration (view
  // space); s.nkWind: the heavy attack's wind-up clock.
  _updateNunchaku(dt, s, cur, sprint) {
    const nk = this._nkView(cur), core = nk.core, act = this.act;
    if (act && act.type === 'use') {
      // an item in the hands: the nunchucks are away, and come out again as from a draw
      cur.root.visible = false;
      nk.meshes.trail.visible = false;
      this._nkUse = true;
      this._animUse(act.t / act.dur, this.time);
      return;
    }
    if (this._nkUse) {
      this._nkUse = false;
      core.draw();
    }
    this.kit.visible = false;
    // off a wall in front: the whole of it, arms and all, comes back
    if (cur.reach === undefined) cur.reach = nk.reach;
    const tuckTo = Math.min(1, Math.max(0, (cur.reach + TUCK_GAP - (s.wallDist ?? 99)) / TUCK_RANGE));
    this.tuckT += (tuckTo - this.tuckT) * (1 - Math.exp(-dt * 10));
    this.sway.position.z += ease(this.tuckT, 0) * 0.12;
    this.sway.position.y -= ease(this.tuckT, 0) * 0.03;
    core.wind(s.nkWind || 0);
    core.update(dt, {
      qW: s.camQ ? _q1.copy(s.camQ).multiply(this.sway.quaternion) : this.sway.quaternion,
      acc: s.acc || null,
      stance: sprint ? 'carry' : s.crouch ? 'low' : 'guard',
      colliders: nk.colliders,
    });
    this.weaponRoot.position.set(0, 0, 0);
    this.weaponRoot.quaternion.identity();
    nk.meshes.place(core, cur.parts.body);
    nk.meshes.trail.visible = nk.meshes.trail.visible && cur.root.visible;
    this._wp.copy(core.stickP[core.anchor]);
    this._wq.copy(core.stickQ[core.anchor]);
    const hr = core.right, hl = core.left;
    this.armR.shoulder.position.copy(FP_SHOULDER_R);
    this.armL.shoulder.position.copy(FP_SHOULDER_L);
    this.armR.setPose(hr.pose);
    this.armL.setPose(hl.pose);
    this.armR.setVisible(true);
    this.armL.setVisible(true);
    this._solveArm(this.armR, hr.p, hr.q, FP_SHOULDER_R, hr.pole, 'nkGrip');
    this._solveArm(this.armL, hl.p, hl.q, FP_SHOULDER_L, hl.pole, 'nkGrip');
  }

  // crossbow limbs + string for a draw of 0 (loosed) .. 1 (latched); ring = the string's wobble along the rail (m).
  // The limbs are modelled latched, so they swing forward by whatever draw is missing. The string never
  // stretches: its middle sits as far behind the tips as its length allows. Leaves that point in this._nock.
  _poseCrossbow(cur, draw, ring) {
    const x = cur.meta.xbow, parts = cur.parts;
    const a = x.flex * (1 - draw), ca = Math.cos(a), sa = Math.sin(a);
    const tx = x.pivot.x + x.tip.x * ca + x.tip.z * sa; // right tip (the left one mirrors it)
    const tz = x.pivot.z - x.tip.x * sa + x.tip.z * ca;
    const nz = tz + Math.sqrt(Math.max(0, x.half * x.half - tx * tx)) + ring;
    const len = Math.hypot(tx, nz - tz), yaw = Math.atan2(tx, nz - tz);
    parts.limbR.rotation.y = a;
    parts.limbL.rotation.y = -a;
    parts.stringR.position.set(tx, x.pivot.y, tz);
    parts.stringR.rotation.y = -yaw;
    parts.stringR.scale.z = len;
    parts.stringL.position.set(-tx, x.pivot.y, tz);
    parts.stringL.rotation.y = yaw;
    parts.stringL.scale.z = len;
    this._nock.set(0, x.pivot.y, nz);
  }

  // RPG: the launcher comes down off the shoulder and swings its muzzle in toward the middle of the screen; the left
  // hand lets go of the front grip, goes down for a grenade (below the screen by u 0.16), brings it up under and ahead
  // of the muzzle (0.32..0.5), lifts it into line with the bore (0.5..0.6) and pushes it in tail first (seated at
  // 0.74), then goes back to the grip. Until it is seated the grenade rides in the left hand (update places it after
  // the arm is solved: this._rpgFollow).
  _animReloadRPG(u, P6, st, parts, meta) {
    const tilt = win(u, 0.0, 0.16, 0.84, 1.0);
    const seat = win(u, 0.72, 0.74, 0.76, 0.82); // the launcher nods back as the grenade bottoms out
    P6[0] -= tilt * 0.05;
    P6[1] -= tilt * 0.045;
    P6[2] += tilt * 0.1 + seat * 0.01;
    P6[3] += tilt * 0.1;
    P6[4] += tilt * 0.42;
    P6[5] += tilt * 0.2;
    const lift = smoothstep(0.5, 0.6, u);
    const push = smoothstep(0.6, 0.74, u);
    // the grenade relative to its seat: out along the bore by the stroke, and before it is lined up, lower, further
    // out and nose up (tail down), clear of the tube
    const wh = parts.warhead, g = meta.rpg, base = wh.userData.base;
    wh.quaternion.setFromAxisAngle(X_AXIS, 0.3 * (1 - lift));
    wh.position.set(base.x, base.y - 0.07 * (1 - lift), base.z - g.stroke * (1 - push) - 0.06 * (1 - lift));
    if (u >= 0.32) {
      wh.visible = true;
      this._rpgFollow = push < 1;
    }
    // left hand: front grip -> down for a grenade (A, below the screen) -> under the grenade's bulb (B, riding on it)
    st.a.set(-0.1, -0.55, -0.24);
    st.aCam = true;
    st.qa.setFromEuler(_e1.set(1.2, 0.0, 0.0, 'YXZ'));
    st.b.copy(g.grab).applyQuaternion(wh.quaternion).add(wh.position);
    st.qb.copy(wh.quaternion).multiply(this.cur.cfg.holdQ);
    st.m = smoothstep(0.32, 0.5, u);
    st.w = win(u, 0.04, 0.16, 0.8, 0.94);
    st.pose = 'rpgWarhead';
  }

  /** grip center of arm between poses a and b (weight k), into out */
  _blendCenter(arm, a, b, k, out = this._tmpP) {
    return arm.gripCenter(out, a).lerp(arm.gripCenter(_v6, b), k);
  }

  /** How far forward of the eye the item reaches at its hip pose (m): the furthest -z of its parts' bounds. */
  _itemReach(cur) {
    const h = cur.cfg.hip;
    _m1.compose(_v1.set(h[0], h[1], h[2]), _q1.setFromEuler(_e1.set(h[3], h[4], h[5], 'YXZ')), _v2.set(1, 1, 1));
    let reach = 0;
    for (const m of cur.root.children) {
      if (!m.isMesh) continue;
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
      const b = m.geometry.boundingBox;
      for (let i = 0; i < 8; i++) {
        _v3.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).add(m.userData.base).applyMatrix4(_m1);
        reach = Math.max(reach, -_v3.z);
      }
    }
    return reach;
  }

  _solveArm(arm, gripPos, handQ, shoulderPos, pole, centerPose) {
    // wrist = grip - handQ * gripCenter (centerPose: place the wrist as that pose would, e.g. a hand opening as it lets
    // go of a throwable stays where it held it)
    if (centerPose && centerPose.isVector3) _v3.copy(centerPose).applyQuaternion(handQ);
    else arm.gripCenter(_v3, centerPose).applyQuaternion(handQ);
    _v1.copy(gripPos).sub(_v3);
    ikTwoBone(shoulderPos, _v1, ARM_L1, ARM_L2, pole, _qU, _qL);
    arm.orient(_qU, _qL, handQ);
  }

  _animReload(cur, u, P6, parts, meta) {
    const kind = cur.cfg.kind;
    // left-hand override: blend weapon grip -> lerp(A, B, m) by weight w. A/B in weapon space unless *Cam.
    const st =
      this._rs ||
      (this._rs = { w: 0, m: 0, a: new THREE.Vector3(), b: new THREE.Vector3(), qa: new THREE.Quaternion(), qb: new THREE.Quaternion(), aCam: false, bCam: false, pose: null, poseA: null, poseB: null, poleA: null, poleB: null, arc: null });
    st.w = 0;
    st.m = 0;
    st.aCam = st.bCam = false;
    st.pose = null;
    st.poseA = st.poseB = null; // the poses at A and at B, when they differ (their grip centers are blended by m)
    st.poleA = st.poleB = null; // the left elbow's pole at A / B, when it isn't the grip's (blended by m and the weight)
    st.arc = null;
    st.rPose = null; // the gun hand's pose while it lasts, when it isn't the item's
    this._reloadState = st;
    if (cur.cfg.single) return this._animReloadSingle(u, P6, st, parts, meta);
    if (cur.cfg.rpg) return this._animReloadRPG(u, P6, st, parts, meta);
    if (cur.cfg.breakPistol) {
      // flare gun: muzzle down and canted in, the barrel tips open about its pin and the extractor kicks the spent case
      // out; the free hand fetches a fresh shell from below, drops it into the breech and thumbs it home, then a flick
      // of the wrist snaps the barrel shut and the hammer is thumbed back (update() eases it)
      const tilt = win(u, 0.0, 0.12, 0.84, 0.98);
      P6[3] -= tilt * FG_RELOAD.pitch;
      P6[5] += tilt * FG_RELOAD.roll;
      P6[4] += tilt * FG_RELOAD.yaw;
      P6[0] -= tilt * FG_RELOAD.x;
      P6[1] += tilt * FG_RELOAD.y;
      P6[2] -= tilt * FG_RELOAD.z;
      const open = smoothstep(0.08, 0.18, u) * (1 - smoothstep(0.76, 0.82, u));
      const flick = win(u, 0.74, 0.79, 0.81, 0.88); // the wrist snaps up to close it
      P6[3] += flick * 0.16;
      P6[1] += flick * 0.012;
      const br = parts.barrel;
      br.rotation.x = -open * FG_RELOAD.open;
      // the chamber mouth and the way into it (toward the muzzle), with the barrel as it is now
      const ch = _v1.copy(meta.chamber).sub(br.userData.base).applyQuaternion(br.quaternion).add(br.position);
      const fwd = _v3.set(0, 0, -1).applyQuaternion(br.quaternion);
      const sh = parts.shell;
      if (u < 0.4) {
        // the spent case, kicked up out of the breech and off to the right
        const kick = smoothstep(0.17, 0.22, u);
        const fly = smoothstep(0.22, 0.36, u);
        sh.visible = kick > 0.01 && fly < 0.98;
        sh.position.copy(ch).addScaledVector(fwd, -0.05 * kick);
        sh.position.x += fly * 0.12;
        sh.position.y += fly * 0.05 - fly * fly * 0.22;
        sh.position.z += fly * 0.04;
        sh.quaternion.copy(br.quaternion);
        sh.rotateZ(fly * 2.2);
        sh.rotateX(fly * 1.6);
      } else {
        const push = smoothstep(0.56, 0.68, u); // dropped in, then thumbed home
        sh.visible = true;
        sh.position.copy(ch).addScaledVector(fwd, -(1 - push) * 0.085);
        sh.quaternion.copy(br.quaternion);
        sh.visible = smoothstep(0.38, 0.52, u) > 0.3 && push < 0.97;
      }
      // A: below the screen (camera space), B: pinching the fresh shell's head, fingers down the bore
      st.a.set(-0.03, -0.5, -0.32);
      st.aCam = true;
      st.qa.setFromEuler(_e1.set(1.2, 0.0, 0.0, 'YXZ'));
      st.b.copy(sh.position).addScaledVector(fwd, -0.012);
      st.qb.copy(_q1.setFromEuler(_e1.set(P6[3], P6[4], P6[5], 'YXZ')).invert()).multiply(FG_RELOAD.q); // (camera -> weapon space)
      st.m = smoothstep(0.38, 0.52, u);
      st.w = win(u, 0.26, 0.38, 0.7, 0.8);
      st.pose = 'pinch';
      if (u > 0.93) this.hammerDown = false;
    } else if (cur.cfg.revolver) {
      // revolver: canted over to the left with the muzzle up, the cylinder swings out and the spent cases fall out of
      // it; the free hand fetches a speedloader from below, lines it up behind the chambers and pushes the rounds home,
      // lets go of it, then a flick of the wrist swings the cylinder shut
      const tilt = win(u, 0.0, 0.12, 0.84, 0.98);
      P6[5] += tilt * RV_RELOAD.roll;
      P6[3] += tilt * RV_RELOAD.pitch;
      P6[4] += tilt * RV_RELOAD.yaw;
      P6[0] -= tilt * RV_RELOAD.x;
      P6[1] += tilt * RV_RELOAD.y;
      P6[2] -= tilt * RV_RELOAD.z;
      const dump = win(u, 0.18, 0.24, 0.3, 0.38); // muzzle up to tip the cases out
      P6[3] += dump * 0.35;
      const open = smoothstep(0.08, 0.17, u) * (1 - smoothstep(0.76, 0.83, u));
      const flick = win(u, 0.74, 0.78, 0.81, 0.88);
      P6[5] -= flick * 0.18;
      const cy = parts.cyl;
      cy.rotation.z = open * RV_RELOAD.open;
      // where the rounds go in: the cylinder's rear face, with the cylinder as it is now
      const rear = _v1.copy(meta.cylRear).sub(cy.userData.base).applyQuaternion(cy.quaternion).add(cy.position);
      const ld = parts.loader;
      const push = smoothstep(0.56, 0.66, u);
      ld.visible = u > 0.36 && u < 0.71;
      ld.quaternion.copy(cy.quaternion);
      // up from below until it is behind the chambers, then in
      const rise = 1 - smoothstep(0.36, 0.54, u);
      ld.position.copy(rear);
      ld.position.z += (1 - push) * 0.05;
      ld.position.y -= rise * 0.12;
      ld.position.x -= rise * 0.03;
      // A: below the screen (camera space), B: on the speedloader's knob
      st.a.set(-0.04, -0.5, -0.3);
      st.aCam = true;
      st.qa.setFromEuler(_e1.set(1.2, 0.0, 0.0, 'YXZ'));
      st.b.copy(ld.position);
      st.b.x += RV_RELOAD.hand[0];
      st.b.y += RV_RELOAD.hand[1];
      st.b.z += RV_RELOAD.hand[2];
      st.qb.copy(_q1.setFromEuler(_e1.set(P6[3], P6[4], P6[5], 'YXZ')).invert()).multiply(RV_RELOAD.q); // (camera -> weapon space)
      // ...and once the rounds are in, back down below the screen and up to the grip again, round the gun, not through it
      st.m = smoothstep(0.36, 0.5, u) * (1 - smoothstep(0.68, 0.76, u));
      st.w = win(u, 0.26, 0.38, 0.8, 0.92);
      st.pose = 'pinch';
      if (open > 0.02) st.rPose = 'revolverOpen'; // the gun hand's thumb off the frame, out of the cylinder's way
    } else if (cur.cfg.crossbow) {
      // dip the nose, haul the string back to the latch (update() flexes the limbs to match), then fetch a
      // bolt from below, lay it in the groove and slide it back against the string
      const tilt = win(u, 0.0, 0.12, 0.9, 1.0);
      P6[0] -= tilt * 0.02;
      P6[1] += tilt * 0.035;
      P6[3] -= tilt * 0.2;
      P6[4] += tilt * 0.02;
      P6[5] += tilt * 0.12;
      const strain = win(u, 0.2, 0.3, 0.42, 0.5); // the stock digs in while the string comes back
      P6[2] += strain * 0.03;
      P6[3] -= strain * 0.05;
      const seat = smoothstep(0.82, 0.93, u);
      const ar = parts.arrow;
      if (u < 0.6) {
        // A: hooked over the string (follows it), B: below the screen (camera space)
        st.a.copy(this._nock);
        st.a.y += 0.012;
        st.qa.setFromEuler(_e1.set(-0.7, 0.3, -PI / 2, 'YXZ'));
        st.b.set(-0.02, -0.5, -0.32);
        st.bCam = true;
        st.qb.setFromEuler(_e1.set(1.2, 0.0, 0.0, 'YXZ'));
        st.m = smoothstep(0.49, 0.6, u);
      } else {
        // A: below the screen, B: the bolt, held over the rail and pressed home
        st.a.set(-0.02, -0.5, -0.32);
        st.aCam = true;
        st.qa.setFromEuler(_e1.set(1.2, 0.0, 0.0, 'YXZ'));
        st.b.copy(meta.xbow.rail);
        st.b.y += 0.02 + (1 - seat) * 0.03;
        st.b.z -= (1 - seat) * 0.06;
        st.qb.setFromEuler(_e1.set(-0.9, 0.3, -PI / 2, 'YXZ'));
        st.m = smoothstep(0.64, 0.78, u);
        ar.visible = st.m > 0.55;
        ar.position.set(ar.userData.base.x, ar.userData.base.y + (1 - seat) * 0.03, ar.userData.base.z - (1 - seat) * 0.06);
      }
      st.w = win(u, 0.08, 0.18, 0.93, 0.99);
      st.pose = u < 0.6 ? 'xbowString' : 'pinch';
      st.poleA = XBOW_HAUL_POLE; // the elbow up and out while it hauls the string, the forearm off the tiller
    } else if (kind === 'rifle' && !cur.cfg.bolt) {
      // AK: tilt, mag rock out, new mag in, charge
      const tilt = win(u, 0.0, 0.12, 0.86, 1.0);
      P6[5] += tilt * 0.42;
      P6[3] += tilt * 0.14;
      P6[0] -= tilt * 0.035;
      P6[1] += tilt * 0.02;
      const chRoll = smoothstep(0.68, 0.78, u) * (1 - smoothstep(0.88, 0.97, u));
      P6[5] += chRoll * 0.3;
      P6[0] -= chRoll * 0.03;
      P6[1] += chRoll * 0.03;
      const outRot = smoothstep(0.14, 0.22, u) * (1 - smoothstep(0.62, 0.7, u));
      const away = smoothstep(0.22, 0.4, u) * (1 - smoothstep(0.46, 0.62, u));
      parts.mag.rotation.x = outRot * 0.45;
      parts.mag.position.y = parts.mag.userData.base.y - away * 0.38;
      parts.mag.position.z = parts.mag.userData.base.z + away * 0.08;
      parts.mag.visible = u < 0.36 || u > 0.47;
      const pull = smoothstep(0.8, 0.84, u) * (1 - smoothstep(0.86, 0.88, u));
      const travel = cur.cfg.chargeTravel ?? 0.1;
      parts.charge.position.z = parts.charge.userData.base.z + pull * travel;
      // A: on the magazine (follows it), B: on the charging handle
      st.a.copy(meta.magGrab).sub(parts.mag.userData.base).applyQuaternion(parts.mag.quaternion).add(parts.mag.position);
      st.a.x -= 0.02;
      st.qa.setFromEuler(_e1.set(PI / 2 + 0.35 + parts.mag.rotation.x, 0.15, 0.0, 'YXZ'));
      st.b.copy(meta.chargeKnob);
      st.b.z += pull * travel;
      st.b.x += 0.004;
      st.b.y += 0.006;
      const cq = cur.cfg.chargeQ;
      st.qb.setFromEuler(cq ? _e1.set(cq[0], cq[1], cq[2], 'YXZ') : _e1.set(0.35, PI, 0.1, 'YXZ'));
      st.w = win(u, 0.06, 0.16, 0.9, 0.98);
      st.m = smoothstep(0.7, 0.78, u);
      st.poseA = cur.cfg.magPose || 'support';
      st.poseB = travel ? 'pinch' : 'open';
      st.pose = st.m > 0.5 ? st.poseB : st.poseA;
      st.arc = RIFLE_RELOAD_ARC; // from the charging handle back to the handguard round under it, not through it
    } else if (kind === 'pistol') {
      // tilt and lift the gun toward the middle so the magazine change stays on screen
      const tilt = win(u, 0.0, 0.12, 0.86, 1.0);
      P6[5] += tilt * 0.3;
      P6[3] += tilt * 0.2;
      P6[0] -= tilt * 0.04;
      P6[1] += tilt * 0.1;
      P6[2] -= tilt * 0.07;
      const ax = meta.magAxis;
      const drop = smoothstep(0.1, 0.22, u) * (1 - smoothstep(0.58, 0.7, u));
      const fall = smoothstep(0.22, 0.34, u) * (1 - smoothstep(0.44, 0.58, u));
      parts.mag.position.copy(parts.mag.userData.base).addScaledVector(ax, drop * 0.1 + fall * 0.3);
      parts.mag.visible = u < 0.3 || u > 0.46;
      const pull = smoothstep(0.78, 0.83, u) * (1 - smoothstep(0.85, 0.87, u));
      parts.slide.position.z = parts.slide.userData.base.z + pull * 0.03;
      if (u < 0.6) {
        // A: below the screen (camera space), B: holding the new magazine
        st.a.set(-0.05, -0.5, -0.3);
        st.aCam = true;
        st.qa.setFromEuler(_e1.set(1.2, 0.0, 0.0, 'YXZ'));
        st.b.copy(parts.mag.position).addScaledVector(ax, 0.1);
        st.b.x -= 0.02;
        st.qb.setFromEuler(_e1.set(0.3, 0.4, 0.5, 'YXZ'));
        st.m = smoothstep(0.4, 0.5, u);
        st.pose = 'pistolMag';
      } else {
        // A: magazine, B: slide (overhand rack)
        st.a.copy(parts.mag.position).addScaledVector(ax, 0.1);
        st.a.x -= 0.02;
        st.qa.setFromEuler(_e1.set(0.3, 0.4, 0.5, 'YXZ'));
        st.b.set(0, meta.slideGrab.y + 0.02, meta.slideGrab.z + 0.01 + pull * 0.03);
        st.qb.setFromEuler(_e1.set(-0.3, -0.2, -PI / 2 - 0.2, 'YXZ'));
        st.m = smoothstep(0.7, 0.76, u);
        st.poseA = 'pistolMag';
        st.poseB = 'rackPinch';
        st.pose = st.m > 0.5 ? st.poseB : st.poseA;
        // the elbow out to the left and up for the rack, so the forearm comes over the gun from the side instead of
        // up through the right hand on the grip
        st.poleB = PISTOL_RACK_POLE;
        st.arc = PISTOL_RACK_ARC; // from the magazine up to the slide out round the left of the right hand
      }
      st.w = win(u, 0.08, 0.2, 0.88, 0.96);
    } else if (cur.cfg.breakAction) {
      // double-barrel: tilt, break open, fetch two shells from below, thumb them into the chambers, snap shut
      const tilt = win(u, 0.0, 0.12, 0.84, 0.98);
      P6[0] -= tilt * 0.1;
      P6[1] += tilt * 0.06;
      P6[2] -= tilt * 0.04;
      P6[3] -= tilt * 0.05;
      P6[4] += tilt * 0.25;
      P6[5] -= tilt * 0.3;
      const open = smoothstep(0.08, 0.2, u) * (1 - smoothstep(0.8, 0.87, u));
      const br = parts.barrels;
      br.rotation.x = -open * 0.62;
      // chambers + barrel axis (toward the breech) in weapon space
      const ch = _v1.copy(meta.chamber).sub(br.userData.base).applyQuaternion(br.quaternion).add(br.position);
      const back = _v3.set(0, 0, 1).applyQuaternion(br.quaternion);
      const push = smoothstep(0.54, 0.68, u);
      const sh = parts.shell;
      st.a.set(-0.02, -0.5, -0.32);
      st.aCam = true;
      st.qa.setFromEuler(_e1.set(1.2, 0.0, 0.0, 'YXZ'));
      st.b.copy(ch).addScaledVector(back, 0.07 + (1 - push) * 0.07);
      st.b.y += 0.02;
      st.qb.setFromEuler(_e1.set(-0.2 - open * 0.62, 0.5, -PI / 2 - 0.4, 'YXZ'));
      st.m = smoothstep(0.3, 0.48, u);
      st.w = win(u, 0.12, 0.24, 0.7, 0.8);
      st.pose = 'pinch';
      st.arc = DB_LOAD_ARC; // up from below round the left of the gun, not through it
      st.poleB = DB_LOAD_POLE; // the elbow up and out: the forearm comes over the open breech, clear of the barrels
      sh.visible = st.m > 0.3 && push < 0.97 && st.w > 0.3;
      sh.position.copy(ch).addScaledVector(back, (1 - push) * 0.07);
      sh.quaternion.copy(br.quaternion);
    } else if (kind === 'shotgun') {
      // one shell: fetch from below the screen, push into the loading port, return to the pump
      const push = smoothstep(0.55, 0.72, u);
      const sh = parts.shell;
      st.a.set(0.0, -0.5, -0.32);
      st.aCam = true;
      st.qa.setFromEuler(_e1.set(1.2, 0.0, 0.0, 'YXZ'));
      st.b.copy(meta.loadPort);
      st.b.y -= 0.03;
      st.b.z += 0.02 - push * 0.03;
      st.qb.setFromEuler(_e1.set(-0.3, 0.2, -PI / 2 - 0.3, 'YXZ'));
      st.m = smoothstep(0.28, 0.5, u);
      st.w = win(u, 0.0, 0.18, 0.8, 0.96);
      st.pose = 'pinch';
      sh.visible = st.m > 0.3 && push < 0.95;
      sh.position.set(meta.loadPort.x, meta.loadPort.y - 0.005 - (1 - push) * 0.012, meta.loadPort.z + 0.06 - push * 0.07);
      sh.quaternion.identity();
    } else if (cur.cfg.bolt) {
      // hunting rifle: bolt open (handled in the bolt block), insert two rounds, close
      const tilt = win(u, 0.0, 0.1, 0.88, 1.0);
      P6[5] -= tilt * 0.28;
      P6[3] += tilt * 0.1;
      P6[0] -= tilt * 0.02;
      const rd = parts.round;
      let m = 0, press = 0;
      for (let i = 0; i < 2; i++) {
        const a = 0.22 + i * 0.26;
        const mi = win(u, a + 0.06, a + 0.12, a + 0.2, a + 0.25);
        if (mi > m) {
          m = mi;
          press = smoothstep(a + 0.13, a + 0.19, u);
        }
      }
      st.a.set(0.0, -0.5, -0.32);
      st.aCam = true;
      st.qa.setFromEuler(_e1.set(1.2, 0.0, 0.0, 'YXZ'));
      st.b.copy(meta.port);
      st.b.y += 0.02 - press * 0.03;
      st.b.x -= 0.01;
      st.qb.setFromEuler(_e1.set(-0.9, 0.3, -PI / 2, 'YXZ'));
      st.m = m;
      st.w = win(u, 0.18, 0.24, 0.74, 0.8);
      st.pose = 'pinch';
      rd.visible = m > 0.4 && press < 0.95;
      rd.position.set(meta.port.x, meta.port.y - 0.02 - press * 0.02, meta.port.z + 0.02);
    }
  }

  // Anti-tank rifle (cfg.single): one big round fed by hand. The right hand throws the bolt open (the bolt block in
  // update) and the spent case flies out; the left hand goes down to a pouch on the belt for a long beat, brings a
  // round up over the port, lays it in and presses it home (seated at u 0.62), and goes back to the handguard while
  // the right hand closes the bolt on it (0.86..0.98). Until it is laid in, the round rides in the left hand
  // (update places it after the arm is solved: this._atFollow).
  _animReloadSingle(u, P6, st, parts, meta) {
    // the gun cants left to turn the port up, and sags while the left hand is away from it
    const tilt = win(u, 0.0, 0.1, 0.86, 1.0);
    const sag = win(u, 0.12, 0.24, 0.62, 0.74);
    P6[5] += tilt * 0.32;
    P6[3] -= tilt * 0.05 + sag * 0.05;
    P6[1] -= tilt * 0.012 + sag * 0.025;
    P6[0] -= tilt * 0.025;
    const seat = meta.seat, travel = this.cur.cfg.boltTravel || 0.085;
    // the spent case: drawn back with the bolt face, then flung up and out to the right
    const c = parts.case;
    if (u > 0.06 && u < 0.15) {
      c.visible = true;
      const e = Math.max(0, (u - 0.095) / 0.055);
      c.position.set(seat.x + e * 0.28, seat.y + e * 0.4 - e * e * 0.6, seat.z + smoothstep(0.06, 0.1, u) * travel + e * 0.08);
      c.rotation.set(-e * 4, e * 2.5, e * 1.5);
    }
    // the new round: in the hand (follow), then from over the port down into it, nose first
    const rd = parts.round;
    const lay = smoothstep(0.57, 0.615, u);
    const press = win(u, 0.6, 0.62, 0.64, 0.665);
    const AT = this._atAbove || (this._atAbove = new THREE.Vector3());
    AT.set(seat.x + 0.014 * (1 - lay), seat.y + 0.07 * (1 - lay), seat.z + 0.03 * (1 - lay));
    this._atTilt = -0.35 * (1 - lay);
    this._atYaw = 1.35 * (1 - smoothstep(0.55, 0.6, u)); // carried crosswise in the fingers, turned to the bore over the port
    if (u >= 0.57) {
      rd.visible = u < 0.92;
      rd.position.copy(AT);
      rd.rotation.set(this._atTilt, this._atYaw, 0);
    } else if (u > 0.45) {
      rd.visible = true;
      rd.rotation.set(this._atTilt, this._atYaw, 0);
      this._atFollow = true;
    }
    // left hand: forend -> the pouch (A, below the screen) -> over the port with the round (B, riding on it) -> forend
    st.a.set(-0.06, -0.55, -0.22);
    st.aCam = true;
    st.qa.setFromEuler(_e1.set(1.2, 0.0, 0.0, 'YXZ'));
    atHold(st.b, this._atTilt, this._atYaw).add(AT);
    st.b.y -= press * 0.006;
    st.qb.setFromEuler(_e1.set(-0.9, 0.3, -PI / 2, 'YXZ'));
    st.m = smoothstep(0.5, 0.57, u);
    st.w = win(u, 0.1, 0.17, 0.66, 0.76);
    st.pose = 'pinch';
  }

  _animThrow(u, P6, cur) {
    // wind up (0..0.38), throw (0.38..0.5), release at ~0.46, lower (0.5..0.75), re-draw (0.75..1)
    const wind = smoothstep(0.0, 0.38, u) * (1 - smoothstep(0.38, 0.5, u));
    const thr = smoothstep(0.38, 0.5, u) * (1 - smoothstep(0.55, 0.75, u));
    const low = smoothstep(0.55, 0.75, u) * (1 - smoothstep(0.78, 1.0, u));
    P6[0] += wind * 0.17 - thr * 0.1;
    P6[1] += wind * 0.17 + thr * 0.1 - low * 0.35;
    P6[2] += wind * 0.1 - thr * 0.26;
    P6[3] += -wind * 0.6 + thr * 0.9 - low * 0.4;
    P6[5] += wind * 0.35 - thr * 0.2;
    cur.root.visible = u < THROW_RELEASE || u > 0.8;
    if (u > 0.8) {
      const r = smoothstep(0.8, 1.0, u);
      P6[1] -= (1 - r) * 0.1;
    }
  }

  // Pinned by a leaper (s.pinned, s.shove): the weapon goes down, then both hands come up flat against it, further out
  // the further it has been shoved off (the meter), thrusting at every press (shove()) and shaking with the struggle.
  // Thrown off, they finish the shove at full stretch before they drop and the weapon comes back up. True while the
  // hands have the view. Deafened by a scream (s.ears) the same way, the hands over the ears instead.
  _push(dt, s) {
    if (this.claws) {
      // (turned: nothing to shove with, and setItem has put the arms back)
      this.pinT = this.flingT = this.pushLvl = 0;
      this.pinOn = this.flung = false;
      return false;
    }
    const pinned = !!s.pinned;
    const ears = !!s.ears && !pinned;
    if (ears) this.earsOn = true;
    else if (pinned) this.earsOn = false;
    if ((pinned || ears) && this.act && this.act.type !== 'use') this.act = null;
    if (pinned && !this.pinOn) {
      this.pinOn = true;
      this.flingT = 0;
      this.flung = false;
      this.pushFull = false;
      if (this.act && this.act.type !== 'use') this.act = null; // (a reload, a swing, a throw: the hands are wanted)
    } else if (!pinned && this.pinOn) {
      this.pinOn = false;
      // (let go once the meter was full: they threw it, though it has slipped a little while the server's word came.
      // Shot off them, or let go in its time, the hands just drop)
      if (this.pushFull && this.pinT > 0.5) {
        this.flingT = PUSH_FLING;
        this.flung = true;
        this.pushLvl = 1;
      }
    }
    if (pinned && s.shove >= 1) this.pushFull = true;
    if (this.flingT > 0) this.flingT = Math.max(0, this.flingT - dt);
    this.pinT = pinned || ears || this.flingT > 0 ? Math.min(1, this.pinT + dt / PUSH_IN) : Math.max(0, this.pinT - dt / PUSH_OUT);
    if (pinned) this.pushLvl += ((s.shove || 0) - this.pushLvl) * (1 - Math.exp(-dt * 18));
    else if (this.pinT <= 0) this.pushLvl = 0;
    this.pushK.step(dt);
    if (this.pinT < 0.5) {
      if (this.pushing) {
        // the hands are down: back to the weapon
        this.pushing = false;
        this.flung = false;
        this.earsOn = false;
        this.armR.shoulder.position.copy(SHOULDER_R);
        this.armL.shoulder.position.copy(SHOULDER_L);
        if (this.cur) this.cur.root.visible = true;
      }
      return false;
    }
    if (!this.pushing) {
      this.pushing = true;
      if (this.cur) this.cur.root.visible = false;
      if (this.nk) this.nk.meshes.trail.visible = false;
      if (this.cur && this.cur.cfg.nunchaku) this._nkUse = true; // (they come out again as from a draw: _updateNunchaku)
      this.kit.visible = false;
      this.armR.shoulder.position.copy(FP_SHOULDER_R);
      this.armL.shoulder.position.copy(FP_SHOULDER_L);
    }
    const up = smoothstep(0.5, 1, this.pinT);
    if (this.earsOn) {
      const t = this.time;
      for (let side = -1; side <= 1; side += 2) {
        const arm = side < 0 ? this.armL : this.armR;
        // pressed hard against the head, trembling, and swaying with it
        _v1.set(
          side * (0.2 + Math.sin(t * 29 + side) * 0.003) + Math.sin(t * 3.1) * 0.01,
          -0.02 + Math.sin(t * 23 + side * 2.1) * 0.003 - (1 - up) * 0.3,
          -0.19,
        );
        _q1.copy(side < 0 ? EARS_Q_L : EARS_Q_R);
        if (up < 1) _q1.premultiply(_q2.setFromAxisAngle(X_AXIS, -(1 - up) * 0.9));
        arm.setVisible(true);
        arm.setPose('shove');
        this._solveArm(arm, _v1, _q1, side < 0 ? FP_SHOULDER_L : FP_SHOULDER_R, side < 0 ? POLE_L : POLE_R);
      }
      return true;
    }
    const fl = this.flung ? smoothstep(0, 0.1, PUSH_FLING - this.flingT) : 0;
    const m = this.pushLvl, k = this.pushK.x, t = this.time;
    const shake = (1 - fl) * (0.6 + 0.4 * (1 - m)); // (it bears down hardest while it is still close)
    for (let side = -1; side <= 1; side += 2) {
      const arm = side < 0 ? this.armL : this.armR;
      _v1.set(
        side * (0.125 - 0.015 * m - 0.01 * fl) + Math.sin(t * 21 + side * 1.7) * 0.004 * shake,
        -0.175 + 0.05 * m + 0.03 * fl + Math.sin(t * 27 + side) * 0.005 * shake - (1 - up) * 0.32,
        -0.3 - 0.12 * m - k - 0.08 * fl,
      );
      _q1.copy(side < 0 ? PUSH_Q_L : PUSH_Q_R);
      if (up < 1) _q1.premultiply(_q2.setFromAxisAngle(X_AXIS, -(1 - up) * 0.9)); // (coming up from below, fingers first)
      arm.setVisible(true);
      arm.setPose('shove');
      this._solveArm(arm, _v1, _q1, side < 0 ? FP_SHOULDER_L : FP_SHOULDER_R, side < 0 ? POLE_L : POLE_R);
    }
    return true;
  }

  _animUse(u, t) {
    // kit held in front with both hands on its sides; small fiddling motion while "using". A drink goes up instead,
    // its lid to the mouth under the eyes and tipped past level, so it is the side and the bottom that are seen
    const up = win(u, 0.05, 0.25, 0.78, 0.95);
    const sip = this.drinking ? win(u, 0.2, 0.42, 0.66, 0.84) : 0;
    const fid = up * (1 - sip);
    const kitPos = _v2.set(0.0, -0.13 - (1 - up) * 0.3 + sip * DRINK_LIFT[0] + Math.sin(t * 5.3) * 0.004 * fid, -0.38 + sip * DRINK_LIFT[1]);
    this.kit.visible = up > 0.02;
    this.kit.position.copy(kitPos);
    this.kit.quaternion.setFromEuler(_e1.set(0.35 - (1 - up) * 0.6 + sip * DRINK_LIFT[2], Math.sin(t * 3.1) * 0.12 * fid, Math.sin(t * 4.3) * 0.08 * fid, 'YXZ'));
    _q2.setFromAxisAngle(X_AXIS, PI / 2); // palm on the side, fingers forward, index up
    _q1.copy(this.kit.quaternion).multiply(_q2);
    for (let side = -1; side <= 1; side += 2) {
      const arm = side < 0 ? this.armL : this.armR;
      _v1.set(side * this.kitGrip, -0.012, 0.0).applyQuaternion(this.kit.quaternion).add(kitPos);
      arm.setVisible(up > 0.02);
      arm.setPose(this.usePose[side < 0 ? 0 : 1]);
      this._solveArm(arm, _v1, _q1, side < 0 ? SHOULDER_L : SHOULDER_R, side < 0 ? POLE_L : POLE_R);
    }
  }

  // the stray cat across our arms (holdCat): the left hand under it, the right on its back or stroking it
  _animCat(dt, s, t) {
    const view = this.cat;
    const o = view.object;
    if (this.cur) this.cur.root.visible = false;
    this.catT = Math.min(1, this.catT + dt / CAT_RAISE);
    const up = ease(this.catT, 2);
    // a stroke, once begun, runs to its end (a click is one whole stroke), and goes round again while it is held
    if (this.petU >= 0) {
      this.petU += dt / CAT_STROKE.dur;
      if (this.petU >= 1) this.petU = s.pet ? this.petU - 1 : -1;
    } else if (s.pet) this.petU = 0;
    const stroking = this.petU >= 0;
    this.petW += ((stroking ? 1 : 0) - this.petW) * (1 - Math.exp(-dt * 12));
    o.position.set(CAT_AT.x, CAT_AT.y - (1 - up) * 0.32, CAT_AT.z);
    o.rotation.set(CAT_TIP - (1 - up) * 0.5, CAT_YAW, 0, 'XYZ');
    view.update(dt, stroking ? CANIM.PET : CANIM.HELD, 0, t);
    o.updateMatrix();
    // the left hand under its belly
    _v1.copy(CAT_CUP.p).applyMatrix4(o.matrix);
    _q1.copy(o.quaternion).multiply(CAT_CUP.q);
    this._solveArm(this.armL, _v1, _q1, SHOULDER_L, POLE_L);
    // the right on its back: resting, or along it from behind the neck to the hips, then back clear of it
    const st = CAT_STROKE;
    let z = CAT_BACK.z;
    let lift = 0;
    if (this.petW > 0.001) {
      const u = Math.max(0, this.petU);
      const along = u < st.along;
      const k = along ? smoothstep(0, st.along, u) : 1 - smoothstep(st.along, 1, u);
      z += (st.z0 + (st.z1 - st.z0) * k - z) * this.petW;
      lift = along ? 0 : Math.sin((PI * (u - st.along)) / (1 - st.along)) * st.lift * this.petW;
    }
    _v1.set(CAT_BACK.x, catBackY(z, CAT_PALM[0], CAT_PALM[1]) + st.clear + lift, z).applyMatrix4(o.matrix);
    _q1.copy(o.quaternion).multiply(CAT_BACK.q);
    this._solveArm(this.armR, _v1, _q1, SHOULDER_R, CAT_POLE_R);
  }

  _updateClaws(dt, t) {
    const act = this.act && this.act.type === 'claw' ? this.act : null;
    const P6 = _pose6, idle = _pose6b;
    for (let side = 1; side >= -1; side -= 2) {
      const arm = side > 0 ? this.armR : this.armL;
      // right-hand-space idle (mirrored below for the left hand)
      idle[0] = CLAW_IDLE[0];
      idle[1] = CLAW_IDLE[1] + Math.sin(t * 1.9 + side) * 0.006;
      idle[2] = CLAW_IDLE[2] + Math.sin(t * 1.3 + side) * 0.006;
      idle[3] = CLAW_IDLE[3] + Math.sin(t * 2.3 + side * 2) * 0.03;
      idle[4] = CLAW_IDLE[4];
      idle[5] = CLAW_IDLE[5];
      if (act && act.side === side) evalSwing(CLAW_SWING, idle, act.t / act.dur, P6);
      else for (let i = 0; i < 6; i++) P6[i] = idle[i];
      if (side < 0) {
        P6[0] = -P6[0];
        P6[4] = -P6[4];
        P6[5] = -P6[5];
      }
      const dr = 1 - ease(this.drawT, 2);
      P6[1] -= dr * 0.3;
      P6[3] -= dr * 0.6;
      _v1.set(P6[0], P6[1], P6[2]);
      _q1.setFromEuler(_e1.set(P6[3], P6[4], P6[5], 'YXZ'));
      // base hand frame: palm facing forward (-Z), fingers up
      if (side > 0) _m1.makeBasis(_v2.set(0, 0, 1), _v3.set(0, -1, 0), this._tmpP.set(1, 0, 0));
      else _m1.makeBasis(_v2.set(0, 0, -1), _v3.set(0, -1, 0), this._tmpP.set(-1, 0, 0));
      _q2.setFromRotationMatrix(_m1);
      _q3.copy(_q1).multiply(_q2); // hand orientation
      arm.setVisible(true);
      arm.setPose('claw');
      ikTwoBone(side > 0 ? SHOULDER_R : SHOULDER_L, _v1, ARM_L1, ARM_L2, side > 0 ? POLE_R : POLE_L, _qU, _qL);
      arm.orient(_qU, _qL, _q3);
    }
  }
}

/** Debug/tuning access to pose tables (sandbox only). */
// (the arms of a survivor at the bars of a moped or the wheel of a car are these, in the world: game/vehicles.js)
export { VMArm, handQ, ARM_L1, ARM_L2 };
export const VM_DEBUG = { VM, CLAW_IDLE, SWINGS, CLAW_SWING, HAND_POSES, HAND_MAT, handQ, FG_RELOAD, FINGERS, PHALANX_R, THUMB_MCP };
/** Debug: hand geometry. */
export function getHandGeoForDebug(pose, side) {
  return getHandGeo(pose, pose === 'claw' ? 'claw' : 'glove', side);
}
/** Debug: triangle counts for the viewmodel of an item. */
export function viewModelTris(itemId) {
  const d = getVMData(itemId);
  return d ? d.tris : 0;
}
export function handTris() {
  let n = 0;
  for (const p of ['grip', 'support', 'pinch', 'open', 'claw', 'knife']) {
    const g = getHandGeo(p, p === 'claw' ? 'claw' : 'glove', 1);
    n = Math.max(n, g.index.count / 3);
  }
  return n;
}
