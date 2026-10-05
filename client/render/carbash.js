// A melee hit on a car (IMPACT.BASH / BASH_HARD). The body rocks on its suspension, a dent stays in the
// panel, and scrap metal breaks off, tumbles and lands. The static world is one mesh per material, so the
// rock is a vertex-shader shove of whatever sits inside that car's box (client/render/staticworld.js installs
// it). The car the team came in on the mainland is drawn on its own, and that one is rocked as an object.
// Dents and the fallen pieces last until dawn (EVT.REGROWN), which is when the wreck gives scrap again.
import * as THREE from 'three';
import { bashCarAt, carBounds, carContains, createSpring, springImpulse, springStep, makeShards, makeDent, stepShard, worldToCar } from '../../shared/carbash.js';

const MAX_SHARDS = 40;
const MAX_DENTS = 24;
const DENTS_PER_CAR = 6;

// shared by every static-world material, so one hit moves every part of that one car together
export const carBashUniforms = {
  uBash: { value: new THREE.Vector4() }, // xyz: prop origin, w: 1 while a car is rocking
  uBashBox: { value: new THREE.Vector4() }, // half extents, and the box's local centre y
  uBashYaw: { value: new THREE.Vector4() }, // cos, sin, local centre x, local centre z
  uBashMove: { value: new THREE.Vector4() }, // lift (m), roll, pitch (rad)
};

const BASH_VERT = /* glsl */ `
{
  if (uBash.w > 0.5) {
    float c = uBashYaw.x;
    float s = uBashYaw.y;
    vec3 d = transformed - uBash.xyz;
    float lx = c * d.x - s * d.z - uBashYaw.z;
    float ly = d.y - uBashBox.w;
    float lz = s * d.x + c * d.z - uBashYaw.w;
    if (abs(lx) < uBashBox.x && abs(ly) < uBashBox.y && abs(lz) < uBashBox.z) {
      float cr = cos(uBashMove.y);
      float sr = sin(uBashMove.y);
      float cp = cos(uBashMove.z);
      float sp = sin(uBashMove.z);
      float x1 = lx * cr - ly * sr;
      float y1 = lx * sr + ly * cr;
      float z1 = lz * cp - y1 * sp;
      float y2 = lz * sp + y1 * cp + uBashMove.x;
      lx = x1 + uBashYaw.z;
      ly = y2 + uBashBox.w;
      lz = z1 + uBashYaw.w;
      transformed.x = uBash.x + c * lx + s * lz;
      transformed.y = uBash.y + ly;
      transformed.z = uBash.z - s * lx + c * lz;
    }
  }
}
`;

const _cache = new WeakMap();

// The static world's copy of a material, with the car-rock shader on it. A material the static world does not
// already own (a shared one) is cloned first, so a prop drawn on its own does not rock in its own local space.
export function bashMaterial(mat) {
  if (!mat) return mat;
  const hit = _cache.get(mat);
  if (hit) return hit;
  const owned = !!(mat.userData.staticGrime || mat.userData.staticPaint || mat.userData.carBash);
  const v = owned ? mat : mat.clone();
  if (v !== mat) v.userData = { ...mat.userData };
  if (!v.userData.carBash) {
    v.userData.carBash = true;
    const prev = v.onBeforeCompile;
    const prevKey = v.customProgramCacheKey;
    v.onBeforeCompile = function (shader) {
      if (prev) prev.call(this, shader);
      if (shader.vertexShader.includes('/*carbash*/')) return;
      shader.uniforms.uBash = carBashUniforms.uBash;
      shader.uniforms.uBashBox = carBashUniforms.uBashBox;
      shader.uniforms.uBashYaw = carBashUniforms.uBashYaw;
      shader.uniforms.uBashMove = carBashUniforms.uBashMove;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform vec4 uBash;\nuniform vec4 uBashBox;\nuniform vec4 uBashYaw;\nuniform vec4 uBashMove;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>\n/*carbash*/\n${BASH_VERT}`);
    };
    v.customProgramCacheKey = function () {
      return (prevKey ? prevKey.call(this) : '') + '|carbash';
    };
  }
  _cache.set(mat, v);
  if (v !== mat) _cache.set(v, v);
  return v;
}

const _z = new THREE.Vector3(0, 0, 1);
const _n = new THREE.Vector3();

function lambert(color) {
  const m = new THREE.MeshLambertMaterial({ color });
  m.polygonOffset = true;
  m.polygonOffsetFactor = -1;
  m.polygonOffsetUnits = -2;
  return m;
}

export class CarBash {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.group = new THREE.Group();
    this.group.name = 'car-bash';
    scene.add(this.group);
    this.box = new THREE.BoxGeometry(1, 1, 1);
    this.dentGeo = new THREE.BoxGeometry(0.36, 0.22, 0.016);
    this.dentBack = new THREE.BoxGeometry(0.58, 0.4, 0.016);
    this.paint = lambert(0xc4a06a); // a torn panel: rusty steel, so it reads on grass
    this.scrap = lambert(0x5c4632);
    this.dentMat = lambert(0xfff3dc); // bare metal
    this.dentDark = lambert(0x1a120c); // the paint torn back around it
    this.shards = []; // { s, mesh }
    this.dents = []; // { mesh, key }
    this.perCar = new Map(); // car key -> how many dents
    this.hits = new Map(); // car key -> how many hits, so each throw differs
    this.spring = createSpring();
    this.springOn = false;
    this.prop = null; // the car rocking in the static world
    this.body = null; // or the live group's object
    this.clearMove();
  }

  clearMove() {
    carBashUniforms.uBash.value.set(0, 0, 0, 0);
    carBashUniforms.uBashMove.value.set(0, 0, 0, 0);
  }

  // a hit at x,y,z, normal pointing back out of the panel. strength: BASH_SOFT / BASH_HARD
  hit(x, y, z, nx, ny, nz, strength) {
    const pr = bashCarAt(this.world?.props || [], x, y, z);
    if (!pr) return;
    const key = `${pr.x.toFixed(2)},${pr.z.toFixed(2)}`;
    const n = (this.hits.get(key) || 0) + 1;
    this.hits.set(key, n);
    const rng = hashRng(Math.round(x * 64) ^ Math.round(z * 64) ^ (n * 131));
    const local = worldToCar(pr, x, y, z);
    this.retarget(pr);
    springImpulse(this.spring, local.x, local.z, strength);
    this.springOn = true;
    this.apply();
    for (const s of makeShards(x, y, z, nx, ny, nz, strength, rng)) this.addShard(s, pr);
    if ((this.perCar.get(key) || 0) < DENTS_PER_CAR) this.addDent(makeDent(x, y, z, nx, ny, nz, rng), key);
  }

  retarget(pr) {
    if (this.prop === pr) return;
    this.restoreBody();
    this.clearMove();
    this.prop = pr;
    this.body = null;
    this.spring = createSpring();
  }

  // the mainland car is a live object (cutscene.js). Game passes it once it exists.
  setLive(obj) {
    if (!this.prop?.live || this.body === obj) return;
    this.body = obj || null;
    if (this.body && !this.body.userData.bashBase) this.capture(this.body);
  }

  capture(obj) {
    if (obj.rotation.order !== 'YXZ') {
      const y = obj.rotation.y;
      obj.rotation.order = 'YXZ';
      obj.rotation.set(0, y, 0);
    }
    obj.userData.bashBase = { y: obj.position.y, x: obj.rotation.x, z: obj.rotation.z };
  }

  restoreBody() {
    const obj = this.body;
    const b = obj?.userData.bashBase;
    if (!b) return;
    obj.position.y = b.y;
    obj.rotation.x = b.x;
    obj.rotation.z = b.z;
  }

  addShard(s, pr) {
    while (this.shards.length >= MAX_SHARDS) {
      const i = this.shards.findIndex((e) => e.s.sleep);
      this.dropShard(i < 0 ? 0 : i);
    }
    const mesh = new THREE.Mesh(this.box, s.panel ? this.paint : this.scrap);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.scale.set(s.sx, s.sy, s.sz);
    this.group.add(mesh);
    this.shards.push({ s, mesh, pr });
    this.placeShard(this.shards[this.shards.length - 1]);
  }

  dropShard(i) {
    const e = this.shards[i];
    if (!e) return;
    this.group.remove(e.mesh);
    this.shards.splice(i, 1);
  }

  addDent(d, key) {
    while (this.dents.length >= MAX_DENTS) this.dropDent(0);
    const mesh = new THREE.Group();
    _n.set(d.nx, d.ny, d.nz);
    if (_n.lengthSq() < 1e-6) _n.set(0, 0, 1);
    else _n.normalize();
    const ring = new THREE.Mesh(this.dentBack, this.dentDark);
    const face = new THREE.Mesh(this.dentGeo, this.dentMat);
    ring.position.z = 0.01;
    face.position.z = 0.022;
    mesh.add(ring, face);
    mesh.position.set(d.x, d.y, d.z);
    mesh.quaternion.setFromUnitVectors(_z, _n);
    mesh.rotateZ(d.spin);
    this.group.add(mesh);
    this.dents.push({ mesh, key });
    this.perCar.set(key, (this.perCar.get(key) || 0) + 1);
  }

  dropDent(i) {
    const e = this.dents[i];
    if (!e) return;
    this.group.remove(e.mesh);
    this.dents.splice(i, 1);
    this.perCar.set(e.key, Math.max(0, (this.perCar.get(e.key) || 1) - 1));
  }

  placeShard(e) {
    const s = e.s;
    e.mesh.position.set(s.x, s.y, s.z);
    e.mesh.rotation.set(s.rx, s.ry, s.rz);
  }

  apply() {
    const sp = this.spring;
    if (this.body) {
      const b = this.body.userData.bashBase;
      if (b) {
        this.body.position.y = b.y + sp.lift;
        this.body.rotation.x = b.x + sp.pitch;
        this.body.rotation.z = b.z + sp.roll;
      }
      this.clearMove();
      return;
    }
    const pr = this.prop;
    const box = pr && carBounds(pr.type);
    if (!pr || !box) return void this.clearMove();
    const pad = 0.12;
    const c = Math.cos(pr.ry);
    const s = Math.sin(pr.ry);
    carBashUniforms.uBash.value.set(pr.x, pr.y, pr.z, 1);
    carBashUniforms.uBashBox.value.set(box.hx + pad, box.hy + pad, box.hz + pad, box.cy);
    carBashUniforms.uBashYaw.value.set(c, s, box.cx, box.cz);
    carBashUniforms.uBashMove.value.set(sp.lift, sp.roll, sp.pitch, 0);
  }

  update(dt, liveCar) {
    if (this.prop?.live) this.setLive(liveCar);
    if (this.springOn) {
      this.springOn = springStep(this.spring, dt);
      if (!this.springOn) {
        this.spring = createSpring();
        this.restoreBody();
        this.clearMove();
      } else this.apply();
    }
    const world = this.world;
    const ground = (x, y, z) => (world.floorAt ? world.floorAt(x, z, y) : world.heightAt(x, z));
    for (const e of this.shards) {
      if (e.s.sleep) continue;
      const pr = e.pr;
      stepShard(e.s, ground(e.s.x, e.s.y, e.s.z), dt, pr ? (x, y, z) => carContains(pr, x, y, z, 0.05) : null);
      this.placeShard(e);
    }
  }

  // dawn: the cars give again, and the dents and loose metal are gone with the night's prying
  clearMarks() {
    while (this.shards.length) this.dropShard(0);
    while (this.dents.length) this.dropDent(0);
    this.perCar.clear();
    this.hits.clear();
    this.springOn = false;
    this.spring = createSpring();
    this.restoreBody();
    this.clearMove();
    this.prop = null;
    this.body = null;
  }

  dispose() {
    this.clearMarks();
    this.scene.remove(this.group);
    this.box.dispose();
    this.dentGeo.dispose();
    this.dentBack.dispose();
    this.paint.dispose();
    this.scrap.dispose();
    this.dentMat.dispose();
    this.dentDark.dispose();
  }
}

// a small deterministic rng, so every client throws the same pieces off the same hit
function hashRng(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
