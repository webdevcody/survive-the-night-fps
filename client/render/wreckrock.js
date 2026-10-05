// A wreck rocking when a swing lands on it (IMPACT.WRECK). The blow lifts the struck side off its wheels about the
// far bottom edge; it drops back, and bounces a time or two before it settles. Presentation only: the colliders
// never move. Wrecks are part of the merged static world (staticworld.js), so one cannot be moved as an object:
// every static material is patched (patchRock) to carry the vertices inside a rocking wreck's box through that
// wreck's rotation, a handful of uniforms shared by all of them.
import * as THREE from 'three';
import { PROPS } from '../../shared/props.js';

const SLOTS = 3; // wrecks rocking at once
const MARGIN = 0.08; // m round a wreck's colliders that still counts as the wreck (its mesh keeps inside them)
const BELOW = 0.25; // m under its base: a sunk wheel or a belly in the ground goes with it
const REF_VOL = 12.8; // m³ a car's box: the reference for how far a blow rocks a wreck
const TILT = 0.045; // rad a blow tips a car (about 8 cm up at the struck side)
const MAX_TILT = 0.07;
const MIN_TILT = 0.006; // rad below which a wreck is too heavy to be seen to move (a bus barely, an airliner never)
const DAMP = 0.2; // the spring's damping ratio
const BOUNCE = 0.3; // what is left of its speed when it comes back down on the far edge's wheels

const box = [];
const ext = [];
const mtx = [];
for (let i = 0; i < SLOTS; i++) {
  box.push(new THREE.Vector4());
  ext.push(new THREE.Vector4(-1, 0, 0, -1));
  mtx.push(new THREE.Matrix4());
}
const uniforms = { uRockBox: { value: box }, uRockExt: { value: ext }, uRockM: { value: mtx } };

const ROCK_PARS = /* glsl */ `
uniform vec4 uRockBox[ ${SLOTS} ];
uniform vec4 uRockExt[ ${SLOTS} ];
uniform mat4 uRockM[ ${SLOTS} ];
`;
// (only what is drawn in world space - the static world's meshes, at the origin - and not instanced: anything else
// that shares a material is left alone)
const ROCK_MAIN = /* glsl */ `
#if !defined( USE_INSTANCING ) && !defined( USE_BATCHING ) && !defined( USE_SKINNING )
if ( dot( modelMatrix[ 3 ].xyz, modelMatrix[ 3 ].xyz ) == 0.0 ) {
  for ( int i = 0; i < ${SLOTS}; i ++ ) {
    vec4 rb = uRockBox[ i ];
    vec4 re = uRockExt[ i ];
    vec2 rd = transformed.xz - rb.xy;
    vec2 rl = vec2( rb.z * rd.x - rb.w * rd.y, rb.w * rd.x + rb.z * rd.y );
    if ( abs( rl.x ) < re.x && abs( rl.y ) < re.w && transformed.y > re.y && transformed.y < re.z ) {
      transformed = ( uRockM[ i ] * vec4( transformed, 1.0 ) ).xyz;
      break;
    }
  }
}
#endif
`;

const patched = new WeakSet();
/** Lets a static-world material carry a rocking wreck's vertices (once per material; chains its own patch). */
export function patchRock(mat) {
  if (patched.has(mat)) return;
  patched.add(mat);
  const key = mat.customProgramCacheKey();
  const before = mat.onBeforeCompile;
  mat.onBeforeCompile = function (sh, renderer) {
    before.call(this, sh, renderer);
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>\n${ROCK_PARS}`).replace('#include <begin_vertex>', `#include <begin_vertex>\n${ROCK_MAIN}`);
  };
  mat.customProgramCacheKey = () => `${key}|rock`;
}

// a prop type's solid box in its own frame: [x0, x1, y0, y1, z0, z1] round its colliders
const BOUNDS = {};
function boundsOf(type) {
  if (type in BOUNDS) return BOUNDS[type];
  const def = PROPS[type];
  let b = null;
  const grow = (x0, x1, y0, y1, z0, z1) => {
    b = b ? [Math.min(b[0], x0), Math.max(b[1], x1), Math.min(b[2], y0), Math.max(b[3], y1), Math.min(b[4], z0), Math.max(b[5], z1)] : [x0, x1, y0, y1, z0, z1];
  };
  for (const [lx, ly, lz, sx, sy, sz] of def.boxes || []) grow(lx - sx / 2, lx + sx / 2, ly - sy / 2, ly + sy / 2, lz - sz / 2, lz + sz / 2);
  for (const [lx, lz, r, h] of def.cyls || []) grow(lx - r, lx + r, 0, h, lz - r, lz + r);
  if (!b && def.size) grow(-def.size[0] / 2, def.size[0] / 2, 0, def.size[1], -def.size[2] / 2, def.size[2] / 2);
  return (BOUNDS[type] = b);
}

const _axis = new THREE.Vector3();
const _t = new THREE.Matrix4();

export class WreckRock {
  constructor(world) {
    // every wreck of the static world, with its box, and whether it can rock at all
    this.wrecks = [];
    for (const pr of world.props) {
      if (pr.live || !PROPS[pr.type]?.salvage) continue;
      const b = boundsOf(pr.type);
      if (!b) continue;
      const hx = (b[1] - b[0]) / 2 + MARGIN;
      const hz = (b[5] - b[4]) / 2 + MARGIN;
      const c = Math.cos(pr.ry);
      const s = Math.sin(pr.ry);
      const lx = (b[0] + b[1]) / 2;
      const lz = (b[4] + b[5]) / 2;
      const vol = (b[1] - b[0]) * (b[3] - b[2]) * (b[5] - b[4]);
      this.wrecks.push({ x: pr.x + c * lx + s * lz, z: pr.z - s * lx + c * lz, y: pr.y, c, s, hx, hz, y0: pr.y + b[2] - BELOW, y1: pr.y + b[3] + MARGIN, r: Math.hypot(hx, hz), tilt: Math.min(MAX_TILT, TILT * Math.sqrt(REF_VOL / vol)), pinned: false });
    }
    // one with another wreck stacked on it (the scrapyard's piles) is held down by it
    for (const a of this.wrecks) {
      for (const o of this.wrecks) {
        if (o !== a && o.y > a.y + 0.5 && o.y < a.y1 + 0.5 && Math.hypot(o.x - a.x, o.z - a.z) < a.r + o.r - 0.5) a.pinned = true;
      }
    }
    this.rocks = []; // { w, side, bx, bz, ext, theta, omega, f }
  }

  // The wreck this point is on (within a few cm of its box), or null
  find(x, y, z) {
    const pad = 0.2;
    for (const w of this.wrecks) {
      const dx = x - w.x;
      const dz = z - w.z;
      if (dx * dx + dz * dz > (w.r + pad) ** 2 || y < w.y0 - pad || y > w.y1 + pad) continue;
      const lx = w.c * dx - w.s * dz;
      const lz = w.s * dx + w.c * dz;
      if (Math.abs(lx) < w.hx + pad && Math.abs(lz) < w.hz + pad) return w;
    }
    return null;
  }

  // A swing struck a wreck at x,y,z; (nx, nz) points back toward whoever swung
  hit(x, y, z, nx, nz) {
    const w = this.find(x, y, z);
    if (!w || w.pinned || w.tilt < MIN_TILT) return;
    const dx = x - w.x;
    const dz = z - w.z;
    const lx = w.c * dx - w.s * dz;
    const lz = w.s * dx + w.c * dz;
    // the face it struck: a side tips it over its far side, an end over its far end (that one barely: its whole length
    // has to come up with it)
    const sideways = Math.abs(lx) / w.hx >= Math.abs(lz) / w.hz;
    const side = sideways ? (lx < 0 ? 0 : 1) : lz < 0 ? 2 : 3;
    // the way the blow pushes it, along its own axis, in the world (local x is (c, -s), local z is (s, c))
    const sign = side === 0 || side === 2 ? 1 : -1;
    const bx = sideways ? w.c * sign : w.s * sign;
    const bz = sideways ? -w.s * sign : w.c * sign;
    if (bx * -nx + bz * -nz < -0.2) return; // (a glancing blow from inside its box: nothing to push against)
    const reach = sideways ? w.hx : w.hz;
    let rock = this.rocks.find((r) => r.w === w);
    if (rock && rock.side !== side) {
      this.rocks.splice(this.rocks.indexOf(rock), 1);
      rock = null;
    }
    if (!rock) {
      if (this.rocks.length >= SLOTS) this.rocks.shift();
      const f = 2.6 * Math.sqrt(w.hx / reach); // Hz: it rocks faster across than end to end
      rock = { w, side, bx, bz, reach, theta: 0, omega: 0, f };
      this.rocks.push(rock);
    }
    const tilt = w.tilt * (sideways ? 1 : w.hx / w.hz) * (0.85 + Math.random() * 0.3);
    rock.omega += tilt * 2 * Math.PI * rock.f;
  }

  update(dt) {
    const step = Math.min(dt, 0.05) / 4;
    for (let i = this.rocks.length - 1; i >= 0; i--) {
      const r = this.rocks[i];
      const w0 = 2 * Math.PI * r.f;
      for (let k = 0; k < 4; k++) {
        r.omega += (-w0 * w0 * r.theta - 2 * DAMP * w0 * r.omega) * step;
        r.theta += r.omega * step;
        if (r.theta < 0) {
          r.theta = 0;
          r.omega = r.omega < -0.03 ? -r.omega * BOUNCE : 0;
        }
      }
      if (r.theta === 0 && r.omega === 0) this.rocks.splice(i, 1);
    }
    for (let i = 0; i < SLOTS; i++) {
      const r = this.rocks[i];
      if (!r) {
        ext[i].x = ext[i].w = -1;
        continue;
      }
      const w = r.w;
      box[i].set(w.x, w.z, w.c, w.s);
      ext[i].set(w.hx, w.y0, w.y1, w.hz);
      // about the far bottom edge: up × the push, through the point of its base the push leads to
      const px = w.x + r.bx * r.reach;
      const pz = w.z + r.bz * r.reach;
      _axis.set(r.bz, 0, -r.bx);
      mtx[i].makeTranslation(px, w.y, pz).multiply(_t.makeRotationAxis(_axis, r.theta)).multiply(_t.makeTranslation(-px, -w.y, -pz));
    }
  }
}
