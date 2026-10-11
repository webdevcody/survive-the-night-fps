// The splash's backdrop once the views are built: the game itself, played out in five short scenes on one stretch of
// road in the valley the page is about to join (issue #290). Like the walk round the valley (menutour.js), which plays
// until this is ready and wherever it cannot be, it is camera shots with a fade at each cut; unlike it, there are
// survivors and the dead in them, doing what a run is made of:
//   1. day: two survivors run up the road picking up what lies on it - planks, nails, a fuel can, parts for the car
//   2. dusk: they board the road across with walls and barricades, set the mounted gun up behind them, light torches
//   3. night: the horde comes up the road out of the dark at the camp
//   4. one on the mounted gun, the other with a rifle and a flashlight, holding the line as the dead come at the walls
//   5. dawn: the car, mended, its headlamps on, two of them in it, away down the road
// Each scene's line comes up under the scene (Splash.setReel), so the kind of game it is reads in seconds.
//
// What it costs. It is its own chunk, imported only after the shader warm-up behind the splash is done (Game.loadReel),
// so nothing of it is in the page's first load or holds its first picture. Everything in it is what the warm-up has
// built already - the survivors, the dead (drawn by the crowd, a few draw calls for all of them), the structures, the
// pickups, the car - so it compiles no shader of its own; it is put together on a black frame. Its few lights are the
// scene's own fixed ones (fires, the two remote spots, the muzzle flash), so it adds none. The dead in it are fewer on
// the Low preset. Nothing in it makes a sound: the splash keeps its own music.
import * as THREE from 'three';
import { ITEM, STRUCT, ZTYPE, ZANIM, ZOMBIE_DEFS, IMPACT } from '../../shared/defs.js';
import { COL, footprintContains, groundAt, deepWaterAt } from '../../shared/collision.js';
import { CHARACTER_COUNT } from '../../shared/characters.js';
import { GUN } from '../../shared/mountedgun.js';
import { VEH } from '../../shared/vehicles.js';
import { createSurvivor, createZombie, setZombieViewer } from '../render/models/characters.js';
import { createStructure, createGhost } from '../render/models/structures.js';
import { createPickup } from '../render/models/pickups.js';
import { createGunMount, createGunStand } from '../render/models/mountedgun.js';
import { VehicleModel } from '../render/models/vehicles.js';
import { seatBody } from './vehicles.js';
import { TEX } from '../render/effects.js';

const FADE = 0.6; // s to black and back at a scene's cut
// the scenes: how long each is (s), the time of day it is in (Environment cycle: 0.25 noon, 0.5 sundown, 0.75
// midnight), how far the fog is pushed back (1: as the hour has it), and its line
const SCENES = [
  { name: 'scavenge', len: 9.5, cycle: 0.31, fog: 1, line: 'Scavenge by day' },
  { name: 'fortify', len: 8.5, cycle: 0.47, fog: 1, line: 'Board up before dark' },
  { name: 'horde', len: 7.5, cycle: 0.7, fog: 0.55, line: 'Then the night comes' },
  { name: 'hold', len: 11, cycle: 0.72, fog: 0.6, line: 'Hold the line together' },
  { name: 'drive', len: 9, cycle: 0.035, fog: 0.8, line: 'Fix the car. Get out.' },
];
const RUN = 6.4; // m/s, a survivor running up the road (between a walk and a sprint)
const PICK = 0.55; // s crouched over what is picked up
const CAMP_BEFORE = 16; // m of road the camp needs behind its line...
const CAMP_AFTER = 62; // ...and in front of it, where the day's run and the horde come up
const DRIVE_LEN = 150; // m of road the drive takes
const DRIVE_SPEED = 13.5; // m/s
const HORDE = 30; // the dead in the night's scenes (fewer on Low)
const HORDE_LOW = 18;
// the line across the road: [STRUCT, metres right of the road's middle] - walls at the ends, waist-high barricades in
// the middle for the gun and the rifle to shoot over. The two builders take a side each, outside in.
const LINE = [
  [STRUCT.WALL, -4.5],
  [STRUCT.BARRICADE, -1.5],
  [STRUCT.WALL, 4.5],
  [STRUCT.BARRICADE, 1.5],
];
const GUN_V = -0.9; // where the mounted gun stands across the road, behind the barricades
const GUN_U = -1.1; // ...and behind the line
const RIFLE_V = 1.4;
const TORCHES = [
  [-1.4, -3.1],
  [-1.4, 3.1],
];
const FIRE_AT = [-6.5, 3.4]; // the campfire, back from the line
// the night's parachute flare (a flare gun's, shared/skyflare.js): over the road in front of the line, coming down,
// lighting the dead under it (Lights.setSky, as skyflares.js lights one)
const FLARE = { horde: [24, 31], hold: [15, 27], sink: 0.7, ground: 4.5, reach: 70, color: 0xffc8b4 };
// what lies on the road in the day: [item, how far up the road from the line, how far across], in the order it is
// picked up (the run comes down the road toward the line)
const LOOT = [
  [ITEM.WOOD, 44, -0.6],
  [ITEM.FUEL_CAN, 33, 1.1],
  [ITEM.NAILS, 24, -1.2],
  [ITEM.CAR_BATTERY, 15, 0.6],
];
const LOOT2 = [
  [ITEM.SPARE_TIRE, 38, -2.6],
  [ITEM.SCRAP, 20, 2.4],
];

const smooth = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const _q = [];
const _v = new THREE.Vector3();
const _look = new THREE.Vector3();
const _muz = new THREE.Vector3();

// ---------------------------------------------------------------- the road
// A road as a path: its points, how far along it each is, and its length
function roadPath(road) {
  const p = road.pts;
  const xs = [];
  const zs = [];
  for (let i = 0; i < p.length; i += 2) {
    xs.push(p[i]);
    zs.push(p[i + 1]);
  }
  const cum = [0];
  for (let i = 1; i < xs.length; i++) cum.push(cum[i - 1] + Math.hypot(xs[i] - xs[i - 1], zs[i] - zs[i - 1]));
  return { road, xs, zs, cum, len: cum[cum.length - 1] };
}

// The point s m along a path and `off` m to the right of it (facing up the path), and the way up it as a yaw
// (yaw 0 faces -Z): out.x, out.z, out.yaw
function onPath(path, s, off, out) {
  const { xs, zs, cum } = path;
  const last = xs.length - 1;
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= s) lo = mid;
    else hi = mid;
  }
  const seg = cum[hi] - cum[lo] || 1;
  const t = (s - cum[lo]) / seg;
  let tx = (xs[hi] - xs[lo]) / seg;
  let tz = (zs[hi] - zs[lo]) / seg;
  // (the way is eased across a point, so a camera or a car going round a bend turns and does not snap)
  const next = Math.min(last, hi + 1);
  if (next !== hi && t > 0.5) {
    const s2 = cum[next] - cum[hi] || 1;
    const k = (t - 0.5) * 0.5;
    tx = lerp(tx, (xs[next] - xs[hi]) / s2, k);
    tz = lerp(tz, (zs[next] - zs[hi]) / s2, k);
  }
  const l = Math.hypot(tx, tz) || 1;
  tx /= l;
  tz /= l;
  out.x = xs[lo] + (xs[hi] - xs[lo]) * t - tz * off;
  out.z = zs[lo] + (zs[hi] - zs[lo]) * t + tx * off;
  out.yaw = Math.atan2(-tx, -tz);
  return out;
}

// could a survivor stand at (x, z)? (menutour.js: nothing solid from the knees to over the head, no deep water)
function standable(world, x, z) {
  const y = groundAt(world, x, z, world.heightAt(x, z) + 0.5);
  if (deepWaterAt(world, x, z, y)) return false;
  for (const grid of world.colliderGrids) {
    for (const c of grid.query(x, z, 0.7, _q)) {
      if (c.flags & COL.NOBLOCK) continue;
      if (c.y1 > y + 0.4 && c.y0 < y + 2.2 && footprintContains(c, x, z, 0.5)) return false;
    }
  }
  return true;
}

const ground = (world, x, z) => groundAt(world, x, z, world.heightAt(x, z) + 0.5);

// The camp: a stretch of road nearly straight and level for CAMP_BEFORE + CAMP_AFTER m, flat across where the line
// goes, with nothing standing on it, away from the car. { path, s } (s: where the line is; up the road is the outside),
// or null. The cheap tests (the road's own bends and the heightfield) sort every place on every road; the first of the
// best that nothing stands on is the one.
function findCamp(world, rnd) {
  const cands = [];
  const p = { x: 0, z: 0, yaw: 0 };
  const car = world.car;
  for (const road of world.roads) {
    if (road.length < CAMP_BEFORE + CAMP_AFTER + 20) continue;
    const path = roadPath(road);
    for (let s = CAMP_BEFORE + 4; s < path.len - CAMP_AFTER - 4; s += 7) {
      for (const dir of [1, -1]) {
        // (dir -1: the outside is down the road instead - the path is walked backwards)
        const at = (ds, off) => onPath(path, s + ds * dir, off * dir, p);
        const y0 = world.heightAt(at(0, 0).x, p.z);
        const yaw0 = p.yaw;
        if (car && Math.hypot(p.x - car.x, p.z - car.z) < 45) continue;
        let flat = 0;
        for (const v of [-6, -3, 3, 6]) flat = Math.max(flat, Math.abs(world.heightAt(at(0, v).x, p.z) - y0));
        if (flat > 1.4) continue;
        let bend = 0;
        let rise = 0;
        for (let ds = -CAMP_BEFORE; ds <= CAMP_AFTER; ds += 6) {
          at(ds, 0);
          bend = Math.max(bend, Math.abs(wrap(p.yaw - yaw0)));
          rise = Math.max(rise, Math.abs(world.heightAt(p.x, p.z) - y0));
        }
        if (bend > 0.45 || rise > 8) continue;
        cands.push({ path, s, dir, score: bend * 6 + flat * 1.5 + rise * 0.25 + rnd() * 1.2 });
      }
    }
  }
  cands.sort((a, b) => a.score - b.score);
  for (const c of cands.slice(0, 40)) {
    const at = (ds, off) => onPath(c.path, c.s + ds * c.dir, off * c.dir, p);
    let ok = true;
    for (let ds = -CAMP_BEFORE; ds <= CAMP_AFTER && ok; ds += 2.5) {
      for (const v of [-3, 0, 3]) {
        at(ds, v);
        if (!standable(world, p.x, p.z)) {
          ok = false;
          break;
        }
      }
    }
    if (ok) return c;
  }
  return null;
}

// The drive: DRIVE_LEN m of road, Route 9's if it has them, with room for the car in the right-hand lane all the way,
// clear of the camp and the broken-down car. { path, s, dir } or null
function findDrive(world, camp, rnd) {
  const p = { x: 0, z: 0, yaw: 0 };
  const roads = world.roads.filter((r) => r.length > DRIVE_LEN + 30).sort((a, b) => (b === world.highway) - (a === world.highway) || b.length - a.length);
  const keepOff = [];
  if (camp) keepOff.push(onPath(camp.path, camp.s, 0, { x: 0, z: 0, yaw: 0 }));
  if (world.car) keepOff.push(world.car);
  for (const road of roads.slice(0, 6)) {
    const path = roadPath(road);
    const starts = [];
    for (let s = 10; s < path.len - DRIVE_LEN - 10; s += 15) starts.push(s);
    for (let i = starts.length - 1; i > 0; i--) {
      const j = (rnd() * (i + 1)) | 0;
      [starts[i], starts[j]] = [starts[j], starts[i]];
    }
    for (const s of starts.slice(0, 12)) {
      const dir = rnd() < 0.5 ? 1 : -1;
      const s0 = dir > 0 ? s : s + DRIVE_LEN;
      let ok = true;
      for (let ds = -10; ds <= DRIVE_LEN + 45 && ok; ds += 3) {
        onPath(path, Math.max(0, Math.min(path.len, s0 + ds * dir)), 1.6 * dir, p);
        if (keepOff.some((k) => Math.hypot(p.x - k.x, p.z - k.z) < 40)) ok = false;
        else ok = standable(world, p.x, p.z);
      }
      if (ok) return { path, s: s0, dir };
    }
  }
  return null;
}

// ---------------------------------------------------------------- a run up the road
// From (s, v) through legs [{ s, v, stop }] at `speed`: a timed list of what the runner is doing. stop: s crouched
// at the end of the leg (picking something up)
function plan(from, legs, speed, t0 = 0) {
  const out = [];
  let t = t0;
  let at = from;
  for (const leg of legs) {
    const d = Math.hypot(leg.s - at.s, leg.v - at.v);
    out.push({ t0: t, t1: t + d / speed, s0: at.s, v0: at.v, s1: leg.s, v1: leg.v, moving: true });
    t += d / speed;
    if (leg.stop) {
      out.push({ t0: t, t1: t + leg.stop, s0: leg.s, v0: leg.v, s1: leg.s, v1: leg.v, moving: false, pick: leg.pick });
      t += leg.stop;
    }
    at = leg;
  }
  return out;
}
function sample(segs, t, out) {
  let k = 0;
  while (k < segs.length - 1 && segs[k].t1 < t) k++;
  const g = segs[k];
  const u = g.t1 > g.t0 ? Math.max(0, Math.min(1, (t - g.t0) / (g.t1 - g.t0))) : 1;
  out.s = lerp(g.s0, g.s1, u);
  out.v = lerp(g.v0, g.v1, u);
  out.moving = g.moving && u < 1 && t <= g.t1;
  out.seg = g;
  out.u = u;
  return out;
}

// ---------------------------------------------------------------- the reel
export class MenuReel {
  constructor(game) {
    this.g = game;
    this.world = game.world;
    this.reel = true;
    this.k = 0; // the scene
    this.t = 0; // s into it
    this.clock = 0;
    this.cycle = SCENES[0].cycle;
    this.fogMul = 1;
    this.fires = [];
    this.flashes = [];
    this.line = '';
    this.fresh = true;
    this.root = new THREE.Group();
    this.root.name = 'menu-reel';
    let seed = (this.world.seed * 2654435761) >>> 0 || 7;
    this.rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    this.camp = findCamp(this.world, this.rnd);
    this.drive = this.camp && findDrive(this.world, this.camp, this.rnd);
    this.fov0 = game.camera.fov;
    if (!this.camp || !this.drive) return;
    this.build();
    game.scene.add(this.root);
  }

  // could it be put together in this valley? (if not, the walk goes on)
  get ready() {
    return !!(this.camp && this.drive);
  }

  // where the camp's frame puts (u up the road from the line, v to the right of it): out.x, out.y, out.z, out.yaw
  // (yaw: facing up the road, outward)
  at(u, v, out = { x: 0, y: 0, z: 0, yaw: 0 }) {
    const c = this.camp;
    onPath(c.path, c.s + u * c.dir, v * c.dir, out);
    if (c.dir < 0) out.yaw = wrap(out.yaw + Math.PI);
    out.y = ground(this.world, out.x, out.z);
    return out;
  }

  build() {
    const g = this.g;
    const root = this.root;
    const shadow = (o) => o.traverse((m) => m.isMesh && (m.castShadow = m.receiveShadow = true));
    // the two survivors: two of the roster, different ones
    const a = (this.rnd() * CHARACTER_COUNT) | 0;
    const b = (a + 1 + ((this.rnd() * (CHARACTER_COUNT - 1)) | 0)) % CHARACTER_COUNT;
    this.sv = [a, b].map((ch, i) => {
      const sv = createSurvivor(101 + i * 37, ch);
      shadow(sv.object);
      sv.object.rotation.order = 'YXZ';
      root.add(sv.object);
      return { sv, weapon: -1, yaw: 0, st: { speed: 0, sprint: false, crouch: false, pitch: 0, onGround: true, time: 0 } };
    });
    // (each weapon they will hold, taken in hand once now: its mesh is built on this black frame, not mid-scene)
    for (const it of [ITEM.MACHETE, ITEM.PISTOL, ITEM.HAMMER, ITEM.HUNTING_RIFLE, 0]) for (const s of this.sv) s.sv.setWeapon(it);
    // the line across the road, its ghosts, the torches, the fire
    const p = { x: 0, y: 0, z: 0, yaw: 0 };
    this.pieces = LINE.map(([type, v]) => {
      this.at(0, v, p);
      const obj = createStructure(type);
      shadow(obj);
      const ghost = createGhost(type);
      for (const o of [obj, ghost]) {
        o.position.set(p.x, p.y, p.z);
        o.rotation.y = p.yaw;
        root.add(o);
      }
      return { obj, ghost, type, v, x: p.x, y: p.y, z: p.z };
    });
    this.torches = TORCHES.map(([u, v]) => {
      this.at(u, v, p);
      const obj = createStructure(STRUCT.TORCH);
      shadow(obj);
      obj.position.set(p.x, p.y, p.z);
      root.add(obj);
      return { obj, x: p.x, y: p.y, z: p.z, em: null, src: { x: p.x, y: p.y + 0.5, z: p.z, intensity: 0 } };
    });
    this.at(FIRE_AT[0], FIRE_AT[1], p);
    const fire = createStructure(STRUCT.CAMPFIRE);
    shadow(fire);
    fire.position.set(p.x, p.y, p.z);
    root.add(fire);
    this.fire = { obj: fire, x: p.x, y: p.y, z: p.z, em: null, src: { x: p.x, y: p.y, z: p.z, intensity: 0, big: true } };
    // the mounted gun: its tripod facing up the road, the gun on it
    this.at(GUN_U, GUN_V, p);
    this.nest = { x: p.x, y: p.y, z: p.z, ry: p.yaw };
    this.gun = new THREE.Group();
    this.gun.rotation.order = 'YXZ';
    this.gunModel = createGunMount();
    this.gun.add(createGunStand(), this.gunModel);
    shadow(this.gun);
    this.gun.position.set(p.x, p.y, p.z);
    this.gun.rotation.y = p.yaw;
    this.gunModel.position.y = GUN.pivotY;
    root.add(this.gun);
    this.aim = { yaw: p.yaw, pitch: 0 };
    // the day's finds
    this.loot = [...LOOT, ...LOOT2].map(([item, u, v]) => {
      const obj = createPickup(item);
      shadow(obj);
      this.at(u, v, p);
      obj.position.set(p.x, p.y, p.z);
      obj.rotation.y = this.rnd() * 6.28;
      root.add(obj);
      return { obj, u, v, x: p.x, y: p.y, z: p.z };
    });
    // the dead
    const n = g.renderer.quality === 'low' ? HORDE_LOW : HORDE;
    const types = [ZTYPE.TANK, ZTYPE.BOOMER, ZTYPE.SPITTER];
    while (types.length < n) types.push(this.rnd() < 0.28 ? ZTYPE.RUNNER : ZTYPE.WALKER);
    // (shuffled, so where each is put - by its place in the list - leaves the big ones among the rest, not in front)
    for (let i = types.length - 1; i > 0; i--) {
      const j = (this.rnd() * (i + 1)) | 0;
      [types[i], types[j]] = [types[j], types[i]];
    }
    this.horde = types.map((type, k) => {
      const view = createZombie(type, 900 + k * 13);
      view.object.traverse((o) => o.isMesh && (o.castShadow = true));
      g.scene.add(view.object); // (the crowd takes it from there into its holder: drawn with all the rest of the dead)
      if (view.member) g.crowd.add(view.member);
      const def = ZOMBIE_DEFS[type];
      return { view, type, def, k, u: 0, v: 0, yaw: 0, anim: ZANIM.WALK, speed: def.speed, alive: true, hits: 0, deadT: 0, wobble: this.rnd() * 6.28 };
    });
    // the car, and its headlamp's light
    this.car = new VehicleModel(VEH.CAR, 2);
    shadow(this.car.group);
    this.car.setLamps(true, false);
    root.add(this.car.group);
    this.lamp = { pos: new THREE.Vector3(), dir: new THREE.Vector3(), lamp: true, wide: 0.72, power: 260 };
    this.seatPose = [{}, {}];
    // the rifle's flashlight: its beam (Entities' teammate cone) and its light
    this.cone = new THREE.Mesh(g.entities.coneGeo, g.entities.coneMat);
    root.add(this.cone);
    this.torch = { pos: new THREE.Vector3(), dir: new THREE.Vector3() };
    this.start(0);
  }

  // ---------------------------------------------------------------- the scenes
  start(k) {
    this.k = k;
    this.t = 0;
    this.fresh = true;
    const sc = SCENES[k];
    this.cycle = sc.cycle;
    this.g.env.cycle = sc.cycle; // (on black: the hour is changed at once, not eased round to)
    this.fogMul = sc.fog;
    this.line = sc.line;
    this.shot = -1;
    const night = sc.name === 'horde' || sc.name === 'hold';
    // the line is up from the moment it is built until the next day's run
    const built = night;
    for (const pc of this.pieces) {
      pc.obj.visible = built;
      pc.obj.scale.set(1, 1, 1);
      pc.ghost.visible = false;
      pc.done = built;
    }
    this.gun.visible = night || sc.name === 'fortify';
    this.gunUp = night;
    this.lightTorches(night);
    this.fire.obj.visible = night || sc.name === 'fortify';
    for (const l of this.loot) {
      l.obj.visible = sc.name === 'scavenge';
      l.obj.scale.setScalar(1);
      l.obj.position.set(l.x, l.y, l.z);
      l.taken = -1;
    }
    for (const z of this.horde) z.view.object.visible = false;
    this.car.group.visible = sc.name === 'drive';
    this.cone.visible = false;
    for (const s of this.sv) {
      s.sv.object.visible = true;
      s.sv.object.quaternion.identity();
      s.sv.object.rotation.set(0, 0, 0);
      if (s.sv._inst) s.sv._inst.sitW = 0;
      if (s.sv.object.parent !== this.root) this.root.add(s.sv.object);
    }
    this[`${sc.name}Start`]?.();
  }

  lightTorches(on) {
    const fx = this.g.effects;
    for (const t of this.torches) {
      if (on && !t.em) t.em = fx.createEmitter('torch', t.x, t.y + 1.76, t.z);
      if (!on && t.em) {
        fx.removeEmitter(t.em);
        t.em = null;
      }
      t.src.intensity = on ? 1 : 0;
    }
    const f = this.fire;
    if (on && !f.em) f.em = fx.createEmitter('campfire', f.x, f.y + 0.2, f.z);
    if (!on && f.em) {
      fx.removeEmitter(f.em);
      f.em = null;
    }
    f.src.intensity = on ? 1 : 0;
  }

  // a survivor where the camp's frame says, turned to yaw, posed as `st` says (and holding `weapon`)
  pose(i, u, v, yaw, weapon, dt, st) {
    const s = this.sv[i];
    if (weapon !== s.weapon) {
      s.weapon = weapon;
      s.sv.setWeapon(weapon);
    }
    const p = this.at(u, v, this._p || (this._p = { x: 0, y: 0, z: 0, yaw: 0 }));
    s.yaw = this.fresh ? yaw : s.yaw + wrap(yaw - s.yaw) * Math.min(1, dt * 10);
    s.sv.object.position.set(p.x, p.y, p.z);
    s.sv.object.rotation.set(0, s.yaw, 0);
    Object.assign(s.st, { speed: 0, sprint: false, crouch: false, pitch: 0, grips: false, sit: false, onGround: true, time: this.clock }, st);
    s.sv.update(dt, s.st);
    return p;
  }

  // the camera at (u, v, h over the ground there), looking at (lu, lv, lh)
  camAt(cam, u, v, h, lu, lv, lh, fov) {
    const p = this.at(u, v, this._c || (this._c = { x: 0, y: 0, z: 0, yaw: 0 }));
    cam.position.set(p.x, p.y + h, p.z);
    const q = this.at(lu, lv, this._l || (this._l = { x: 0, y: 0, z: 0, yaw: 0 }));
    _look.set(q.x, q.y + lh, q.z);
    cam.lookAt(_look);
    this.fov = fov;
  }

  // 1. Day. The two of them come down the road toward where the line will be, stopping for what lies on it.
  scavengeStart() {
    this.runs = [
      plan({ s: 56, v: 0.2 }, [...LOOT.map(([, u, v], i) => ({ s: u + 0.6, v, stop: PICK, pick: i })), { s: 4, v: -0.5 }], RUN),
      plan({ s: 61, v: -1.6 }, [...LOOT2.map(([, u, v], i) => ({ s: u + 0.6, v, stop: PICK, pick: LOOT.length + i })), { s: 6, v: 1.8 }], RUN * 0.92, 0.4),
    ];
  }
  scavenge(dt, cam) {
    const t = this.t;
    const r = this._r || (this._r = {});
    let lead = null;
    for (let i = 0; i < 2; i++) {
      sample(this.runs[i], t, r);
      const seg = r.seg;
      // (facing the way they are going: on to the next thing, or on down the road)
      const segs = this.runs[i];
      const next = r.moving ? seg : segs[Math.min(segs.length - 1, segs.indexOf(seg) + 1)];
      const here = this.at(r.s, r.v, this._h || (this._h = { x: 0, y: 0, z: 0, yaw: 0 }));
      const there = this.at(next.s1, next.v1, this._n || (this._n = { x: 0, y: 0, z: 0, yaw: 0 }));
      const yaw = Math.hypot(there.x - here.x, there.z - here.z) > 0.3 ? Math.atan2(-(there.x - here.x), -(there.z - here.z)) : this.sv[i].yaw;
      const crouch = !r.moving && seg.pick !== undefined;
      const p = this.pose(i, r.s, r.v, yaw, i === 0 ? ITEM.MACHETE : ITEM.PISTOL, dt, { speed: r.moving ? (i === 0 ? RUN : RUN * 0.92) : 0, sprint: r.moving, crouch, pitch: crouch ? -0.5 : -0.05 });
      if (i === 0) lead = { s: r.s, v: r.v, y: p.y };
      // what they stop for goes up into their hands, and is gone
      if (crouch && r.u > 0.35) {
        const l = this.loot[seg.pick];
        if (l.taken < 0) l.taken = t;
      }
    }
    for (const l of this.loot) {
      if (l.taken < 0) continue;
      const k = Math.min(1, (t - l.taken) / 0.3);
      l.obj.position.y = l.y + k * 0.9;
      l.obj.scale.setScalar(Math.max(0.01, 1 - k));
      l.obj.visible = k < 1;
    }
    // the camera runs ahead of the first of them, low, turned back on them
    const s = lead.s;
    this.camAt(cam, s - 5.2 - Math.sin(t * 0.3) * 0.5, 1.9 + t * 0.06, 1.35, s + 1.5, lead.v * 0.6, 1.1, 52);
    cam.position.y += Math.sin(t * 9.5) * 0.01; // (hand-held)
    return 0;
  }

  // 2. Dusk. They put the line up across the road a piece each, outside in, then the gun behind it and the torches.
  fortifyStart() {
    this.builds = [
      { piece: 0, from: -6.2, start: 0.35, i: 0 },
      { piece: 2, from: 6.2, start: 0.55, i: 1 },
      { piece: 1, from: -4.5, start: 2.75, i: 0 },
      { piece: 3, from: 4.5, start: 2.95, i: 1 },
    ];
    this.gun.visible = false;
    this.fire.obj.visible = true;
  }
  fortify(dt, cam) {
    const t = this.t;
    const fx = this.g.effects;
    // each builder: walk to the piece, three blows of the hammer at its ghost, and it is up
    for (let i = 0; i < 2; i++) {
      const mine = this.builds.filter((b) => b.i === i);
      let job = mine[0];
      for (const b of mine) if (t >= b.start - 0.75) job = b;
      const pc = this.pieces[job.piece];
      const walk = Math.min(1, Math.max(0, (t - job.start + 0.75) / 0.75)); // (0.75 s from the last piece to this one)
      const v = lerp(job.from, pc.v, smooth(0, 1, walk));
      const hammering = t >= job.start && t < job.start + 1.4;
      const swing = Math.floor((t - job.start) / 0.45);
      if (hammering && swing !== job.swing) {
        job.swing = swing;
        this.sv[i].sv.melee();
        if (swing > 0) fx.impact(IMPACT.WOOD, pc.x, pc.y + 1.0, pc.z, 0, 0, 0);
      }
      pc.ghost.visible = t >= job.start - 0.4 && t < job.start + 1.4;
      if (t >= job.start + 1.4 && !pc.done) {
        pc.done = true;
        pc.doneT = t;
        for (let k = 0; k < 4; k++) fx.impact(IMPACT.WOOD, pc.x + (this.rnd() - 0.5) * 2, pc.y + 0.4 + this.rnd() * 1.6, pc.z, 0, 0, 0);
      }
      if (pc.done) {
        pc.obj.visible = true;
        pc.obj.scale.set(1, Math.min(1, 0.15 + (t - pc.doneT) / 0.25 * 0.85), 1);
      }
      // after the last piece: back from the line, one to set the gun up, the other to the torches
      const after = Math.max(0, t - 4.6);
      const backU = -1.6 - Math.min(1, after / 0.8) * (i === 0 ? 0.6 : 1.4);
      const backV = i === 0 ? lerp(v, GUN_V - 0.5, smooth(0, 1, after / 0.8)) : lerp(v, TORCHES[1][1] - 0.6, smooth(0, 1, after / 0.8));
      const moving = (walk > 0 && walk < 1) || (after > 0 && after < 0.8);
      const yaw = this.at(0, 0, this._y || (this._y = { x: 0, y: 0, z: 0, yaw: 0 })).yaw;
      this.pose(i, after > 0 ? backU : -1.6, after > 0 ? backV : v, yaw, after > 0.8 && i === 0 ? 0 : ITEM.HAMMER, dt, { speed: moving ? 3.2 : 0 });
    }
    if (t > 5.6 && !this.gun.visible) {
      this.gun.visible = true;
      fx.impact(IMPACT.DIRT, this.nest.x, this.nest.y + 0.1, this.nest.z, 0, 1, 0);
    }
    if (t > 6.0 && !this.torches[0].em) this.lightTorches(true);
    this.aimGun(dt, this.nest.ry, 0.02);
    // the darkening sky as they work
    this.cycle = lerp(SCENES[1].cycle, 0.535, smooth(0, SCENES[1].len, t));
    // from behind the camp, low, coming in: the backs of the two of them, the line going up, the road beyond it
    this.camAt(cam, -10.2 + t * 0.18, -1.6 + t * 0.3, 2.8 - t * 0.04, 1.5, 0, 1.0, 54);
    return 0;
  }

  // 3. Night. Over the camp from behind and above it: the torches, the line, the two of them at their posts, and up the
  // road the dead coming out of the dark.
  hordeStart() {
    const n = this.horde.length;
    this.horde.forEach((z, k) => {
      const fast = z.def.speed > 3.5;
      z.u = 17 + (k / n) * 36 + this.rnd() * 5;
      z.v = (this.rnd() * 2 - 1) * 4.6;
      z.alive = true;
      z.anim = fast ? ZANIM.RUN : ZANIM.WALK;
      z.speed = fast ? z.def.speed * 0.55 : z.def.speed * 0.9; // (the quick ones held back with the pack, for now)
      z.view.object.visible = true;
    });
  }
  nightfall(dt, cam) {
    const t = this.t;
    this.posts(dt, false);
    this.moveHorde(dt);
    const rise = smooth(0, SCENES[2].len, t);
    this.camAt(cam, -10.5 + rise * 1.5, 1.2, 5.8 - rise * 1.6, 26, 0, 0.6, 46);
    return 0;
  }

  // 4. On the gun: from over the gunner's shoulder down the road, then from out on the verge in front of the line as
  // the dead go by at it.
  holdStart() {
    const n = this.horde.length;
    this.horde.forEach((z, k) => {
      const fast = z.def.speed > 3.5;
      z.u = 10 + (k / n) * 50 + this.rnd() * 4;
      z.v = (this.rnd() * 2 - 1) * 4.6;
      z.alive = true;
      z.anim = fast ? ZANIM.RUN : ZANIM.WALK;
      z.speed = fast ? z.def.speed * 0.8 : z.def.speed;
      z.hits = 0;
      z.view.object.visible = true;
    });
    this.target = null;
    this.rifleTarget = null;
    this.nextShot = 0.4;
    this.rifleT = 0.8;
  }
  hold(dt, cam) {
    const t = this.t;
    this.posts(dt, true);
    this.moveHorde(dt);
    this.shootGun(dt);
    this.shootRifle(dt);
    const shot = t < 5.4 ? 0 : 1;
    if (shot !== this.shot) {
      this.shot = shot;
      this.camYaw = null;
    }
    if (shot === 0) {
      // over the gunner's right shoulder, following the gun round
      const n = this.nest;
      this.camYaw = this.camYaw == null ? this.aim.yaw : this.camYaw + wrap(this.aim.yaw - this.camYaw) * Math.min(1, dt * 2.5);
      const fx = -Math.sin(this.camYaw);
      const fz = -Math.cos(this.camYaw);
      cam.position.set(n.x - fx * 2.9 - fz * 0.6, n.y + 2.35, n.z - fz * 2.9 + fx * 0.6);
      _look.set(n.x + fx * 22, n.y + 0.6, n.z + fz * 22);
      cam.lookAt(_look);
      this.fov = 48;
    } else {
      // up behind the camp on the rifle's side, closing in: the two of them at the line, the gun's tracers going out
      // down the road, the dead dropping in the flare's light
      const u = t - 5.4;
      this.camAt(cam, -7.5 + u * 0.3, 3.4 - u * 0.1, 3.6 - u * 0.12, 10, -0.5, 0.4, 50);
    }
    return 0;
  }

  // the two of them at their posts: one at the gun's grips, the other at the barricade with a rifle, flashlight on
  posts(dt, firing) {
    const n = this.nest;
    // the gunner behind the grips, turned with the gun
    const s = this.sv[0];
    if (s.weapon !== 0) {
      s.weapon = 0;
      s.sv.setWeapon(0);
    }
    s.sv.object.position.set(n.x + Math.sin(this.aim.yaw) * GUN.back * 1.05, n.y, n.z + Math.cos(this.aim.yaw) * GUN.back * 1.05);
    s.sv.object.rotation.set(0, this.aim.yaw, 0);
    Object.assign(s.st, { speed: 0, sprint: false, crouch: false, sit: false, grips: true, pitch: this.aim.pitch, onGround: true, time: this.clock });
    s.sv.update(dt, s.st);
    if (!firing) this.aimGun(dt, n.ry + Math.sin(this.clock * 0.5) * 0.25, -0.02);
    // the rifle at the barricade, aimed at what it is shooting at (or up the road)
    const base = this.at(0, 0, this._y || (this._y = { x: 0, y: 0, z: 0, yaw: 0 })).yaw;
    const rt = this.rifleTarget;
    let yaw = base + Math.sin(this.clock * 0.7) * 0.2;
    let pitch = -0.04;
    const me = this.at(-0.9, RIFLE_V, this._p2 || (this._p2 = { x: 0, y: 0, z: 0, yaw: 0 }));
    if (firing && rt && rt.alive) {
      const o = rt.view.object.position;
      yaw = Math.atan2(-(o.x - me.x), -(o.z - me.z));
      pitch = Math.atan2(o.y + 1.2 - (me.y + 1.5), Math.hypot(o.x - me.x, o.z - me.z));
    }
    this.pose(1, -0.9, RIFLE_V, yaw, ITEM.HUNTING_RIFLE, dt, { pitch });
    // its flashlight: from the light on them, along the aim
    const r = this.sv[1];
    const a = r.sv.flashlightAnchor;
    if (a) a.getWorldPosition(this.torch.pos);
    else this.torch.pos.set(me.x, me.y + 1.4, me.z);
    const cp = Math.cos(pitch);
    this.torch.dir.set(-Math.sin(r.yaw) * cp, Math.sin(pitch), -Math.cos(r.yaw) * cp);
    this.cone.visible = true;
    this.cone.position.copy(this.torch.pos);
    this.cone.lookAt(_v.copy(this.torch.pos).add(this.torch.dir));
  }

  // the gun turned toward (yaw, pitch), within its arc
  aimGun(dt, yaw, pitch) {
    const n = this.nest;
    const d = Math.max(-GUN.arc, Math.min(GUN.arc, wrap(yaw - n.ry)));
    const k = this.fresh ? 1 : Math.min(1, dt * 7);
    this.aim.yaw = wrap(this.aim.yaw + wrap(n.ry + d - this.aim.yaw) * k);
    this.aim.pitch += (pitch - this.aim.pitch) * k;
    this.gunModel.rotation.set(this.aim.pitch, wrap(this.aim.yaw - n.ry), 0);
  }

  // The dead walk (or run) down the road at the line; at it they claw at the walls. The killed lie where they fell.
  moveHorde(dt) {
    const p = this._z || (this._z = { x: 0, y: 0, z: 0, yaw: 0 });
    const cam = this.g.camera.position;
    setZombieViewer(cam.x, cam.y, cam.z);
    const inward = wrap(this.at(0, 0, this._y || (this._y = { x: 0, y: 0, z: 0, yaw: 0 })).yaw + Math.PI);
    for (const z of this.horde) {
      if (!z.view.object.visible) continue;
      if (z.alive) {
        // (the line stops them; between its two barricades and its walls there is no way through)
        const stop = 0.75 + (z.k % 3) * 0.25;
        z.u = Math.max(stop, z.u - z.speed * dt);
        if (z.u <= stop) z.anim = ZANIM.ATTACK;
        z.v += Math.sin(this.clock * 1.3 + z.wobble) * 0.25 * dt;
        z.v = Math.max(-5.6, Math.min(5.6, z.v));
      }
      this.at(z.u, z.v, p);
      const o = z.view.object;
      o.position.set(p.x, p.y, p.z);
      o.rotation.y = z.alive ? inward + Math.sin(this.clock * 0.9 + z.wobble) * 0.15 : o.rotation.y;
      const far = (p.x - cam.x) ** 2 + (p.z - cam.z) ** 2 > 40 * 40;
      if (!far || ((this.frame + z.k) & 1) === 0) z.view.update(far ? dt * 2 : dt, z.alive ? z.anim : ZANIM.DEAD, z.alive && z.anim !== ZANIM.ATTACK ? z.speed : 0, this.clock, true);
    }
  }

  // the nearest of the dead still up within `reach` m of the line (null: none)
  nearest(reach, not) {
    let best = null;
    for (const z of this.horde) {
      if (!z.alive || !z.view.object.visible || z === not || z.u > reach) continue;
      if (!best || z.u < best.u) best = z;
    }
    return best;
  }

  // a round from (from) at z: its tracer, the blood where it lands; `kill` - the round that drops it
  hit(from, z, kill, bright) {
    const fx = this.g.effects;
    const o = z.view.object.position;
    const h = (z.def.height || 1.8) * (0.55 + this.rnd() * 0.3);
    _v.set(o.x + (this.rnd() - 0.5) * 0.3, o.y + h, o.z + (this.rnd() - 0.5) * 0.3).sub(from);
    const d = _v.length();
    _v.divideScalar(d);
    fx.tracer(from.x, from.y, from.z, _v.x, _v.y, _v.z, d, bright);
    fx.impact(z.type === ZTYPE.SPITTER || z.type === ZTYPE.BOOMER ? IMPACT.GREEN_BLOOD : IMPACT.BLOOD, from.x + _v.x * d, from.y + _v.y * d, from.z + _v.z * d, -_v.x, -_v.y, -_v.z);
    if (kill) {
      z.alive = false;
      z.anim = ZANIM.DEAD;
    }
  }

  // the gunner: bursts at whatever is nearest the line, three or four rounds to a body (the big one takes a belt)
  shootGun(dt) {
    const n = this.nest;
    let tz = this.target;
    if (!tz || !tz.alive) tz = this.target = this.nearest(34, this.rifleTarget);
    if (tz) {
      const o = tz.view.object.position;
      const yaw = Math.atan2(-(o.x - n.x), -(o.z - n.z));
      const pitch = Math.atan2(o.y + 1.1 - (n.y + GUN.pivotY), Math.hypot(o.x - n.x, o.z - n.z));
      this.aimGun(dt, yaw, pitch);
    } else this.aimGun(dt, n.ry, 0);
    this.nextShot -= dt;
    if (!tz || this.nextShot > 0) return;
    // on target? (the gun swings round before it fires)
    const o = tz.view.object.position;
    if (Math.abs(wrap(Math.atan2(-(o.x - n.x), -(o.z - n.z)) - this.aim.yaw)) > 0.08) return;
    this.nextShot = 0.11;
    const cp = Math.cos(this.aim.pitch);
    _muz.set(n.x - Math.sin(this.aim.yaw) * cp * GUN.barrel, n.y + GUN.pivotY + Math.sin(this.aim.pitch) * GUN.barrel, n.z - Math.cos(this.aim.yaw) * cp * GUN.barrel);
    this.g.effects.worldMuzzle(_muz, 1.3);
    this.g.lights.flashMuzzle(_muz, 1.4, 0.05);
    this.gunModel.position.z = 0.035; // (the kick)
    tz.hits++;
    const need = tz.type === ZTYPE.TANK ? 12 : 5 + (tz.k & 1) * 2;
    this.hit(_muz, tz, tz.hits >= need, 1);
    if (tz.hits >= need) {
      this.target = null;
      this.nextShot = 0.22; // (the next one picked, and swung round to)
    }
  }

  // the rifle: a round every so often at one of the quick ones
  shootRifle(dt) {
    this.rifleT -= dt;
    let rt = this.rifleTarget;
    if (!rt || !rt.alive) rt = this.rifleTarget = this.nearest(26, this.target);
    if (!rt || this.rifleT > 0) return;
    this.rifleT = 1.4;
    const s = this.sv[1];
    s.sv.fire();
    const at = s.sv.getMuzzleWorld?.(_muz) || _muz.set(s.sv.object.position.x, s.sv.object.position.y + 1.45, s.sv.object.position.z);
    this.g.effects.worldMuzzle(at, 0.8);
    rt.hits++;
    this.hit(at, rt, rt.hits >= 2, 0.7);
  }

  // 5. Dawn. The car, mended, down the road with the two of them in it: from behind it, then from the verge as it goes by.
  driveStart() {
    for (const s of this.sv) {
      s.weapon = -1;
      if (s.sv._inst) s.sv._inst.sitW = 1;
    }
    this.cone.visible = false;
    this.lightTorches(false);
    this.roll = 0;
    this.carPose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
    // (the verge for the second camera: one with room on it)
    const d = this.drive;
    const p = { x: 0, z: 0, yaw: 0 };
    this.side2 = -1;
    for (const side of [-1, 1]) {
      onPath(d.path, d.s + (4.6 * DRIVE_SPEED + 34) * d.dir, side * 4.4 * d.dir, p);
      if (standable(this.world, p.x, p.z)) {
        this.side2 = side;
        break;
      }
    }
  }
  // where the car is s m on from the drive's start, a lane right of the middle: out.x, y, z, yaw, pitch
  carAt(s, out) {
    const d = this.drive;
    const w = this.world;
    const ss = Math.max(0, Math.min(d.path.len, d.s + s * d.dir));
    onPath(d.path, ss, 1.6 * d.dir, out);
    if (d.dir < 0) out.yaw = wrap(out.yaw + Math.PI);
    out.y = ground(w, out.x, out.z);
    // pitched to the road from its back wheels to its front
    const fx = -Math.sin(out.yaw);
    const fz = -Math.cos(out.yaw);
    const yf = w.heightAt(out.x + fx * 1.4, out.z + fz * 1.4);
    const yb = w.heightAt(out.x - fx * 1.4, out.z - fz * 1.4);
    out.pitch = Math.atan2(yf - yb, 2.8);
    return out;
  }
  driveBy(dt, cam) {
    const t = this.t;
    const s = t * DRIVE_SPEED;
    const P = this.carAt(s, this.carPose);
    const m = this.car;
    const prevYaw = this._prevYaw ?? P.yaw;
    const turn = this.fresh ? 0 : wrap(P.yaw - prevYaw) / Math.max(dt, 1e-3);
    this._prevYaw = P.yaw;
    m.group.position.set(P.x, P.y, P.z);
    m.group.rotation.set(P.pitch, P.yaw, 0);
    this.roll += DRIVE_SPEED * dt;
    m.setWheels(this.roll, Math.max(-0.35, Math.min(0.35, (-turn * 2.6) / DRIVE_SPEED)));
    m.setDash(0.6, 0.8);
    m.lampWorld(this.lamp.pos, this.lamp.dir);
    // the two of them in it: the driver's hands on the wheel, the other turned to the window with the rifle
    for (let i = 0; i < 2; i++) {
      const sv = this.sv[i];
      const weapon = i === 0 ? 0 : ITEM.HUNTING_RIFLE;
      if (weapon !== sv.weapon) {
        sv.weapon = weapon;
        sv.sv.setWeapon(weapon);
      }
      sv.sv.object.rotation.set(0, P.yaw + (i === 1 ? 0.9 : 0), 0);
      const pose = seatBody(m, VEH.CAR, i, sv.sv, this.seatPose[i]);
      Object.assign(sv.st, { speed: 0, sprint: false, crouch: false, grips: false, sit: true, onGround: true, pitch: 0, time: this.clock, reach: pose.reach, sitT: pose.sitT, sitK: pose.sitK, sitSplay: pose.sitSplay, sitLean: pose.sitLean, sitTwist: pose.sitTwist, feet: pose.feet, sitNow: 1 });
      sv.sv.update(dt, sv.st);
    }
    const d = this.drive;
    const c = this._c || (this._c = { x: 0, y: 0, z: 0, yaw: 0 });
    if (t < 4.6) {
      // behind it and over it, close: the lamps on the road ahead
      const back = this.carAt(s - 7.5, c);
      const fx = -Math.sin(back.yaw);
      const fz = -Math.cos(back.yaw);
      cam.position.set(back.x - fz * 0.5, back.y + 2.6, back.z + fx * 0.5);
      _look.set(P.x + fx * 8, P.y + 1.0, P.z + fz * 8);
      this.fov = 52;
    } else {
      // down on the verge ahead of it: it comes up the road at the lens and is gone past
      onPath(d.path, d.s + (4.6 * DRIVE_SPEED + 34) * d.dir, this.side2 * 4.4 * d.dir, c);
      cam.position.set(c.x, ground(this.world, c.x, c.z) + 0.9, c.z);
      _look.set(P.x, P.y + 0.9, P.z);
      this.fov = 44;
    }
    cam.lookAt(_look);
    cam.position.y += Math.sin(t * 17) * 0.006;
    this.cycle = lerp(SCENES[4].cycle, 0.075, smooth(0, SCENES[4].len, t));
    return 0;
  }

  // the flare: high over the road at `at` [u, metres up], coming down; its light on the ground, its sparks and its glow
  flare(dt, at) {
    const p = this.at(at[0], 0.6, this._f || (this._f = { x: 0, y: 0, z: 0, yaw: 0 }));
    const h = at[1] - this.t * FLARE.sink;
    const y = p.y + h;
    const fx = this.g.effects;
    const k = this.flareK || (this.flareK = { acc: 0, x: p.x, y, z: p.z });
    if (this.fresh) Object.assign(k, { x: p.x, y: y + 0.01, z: p.z });
    const glow = 0.85 + Math.sin(this.clock * 13) * 0.05 + Math.sin(this.clock * 31) * 0.04;
    fx.skyflare(k, k.x, k.y, k.z, p.x, y, p.z, dt, false, glow);
    fx.add.emit(p.x, y, p.z, 0, 0, 0, 0.05, 1.6, 1.6, 1, 0.86, 0.8, 1, 1, 0.8, 0.7, 0.9, 0, 0, TEX.GLOW);
    Object.assign(k, { x: p.x, y, z: p.z });
    this.g.lights.setSky(p.x, y, p.z, h, FLARE.ground * glow, FLARE.reach, FLARE.color);
  }

  // ---------------------------------------------------------------- the frame
  // Moves on by dt and puts `cam` where the scene's camera is. Returns how far the picture is faded to black (0..1).
  update(dt, cam) {
    if (this.pinned) dt = 0; // (held still on one moment: a screenshot's)
    this.t += dt;
    this.clock += dt;
    this.frame = (this.frame || 0) + 1;
    const sc = SCENES[this.k];
    if (this.t > sc.len) {
      this.start((this.k + 1) % SCENES.length);
      return this.update(0, cam);
    }
    this.flashes.length = 0;
    this.cone.visible = false;
    this.gunModel.position.z *= 0.6;
    if (sc.name === 'scavenge') this.scavenge(dt, cam);
    else if (sc.name === 'fortify') this.fortify(dt, cam);
    else if (sc.name === 'horde') this.nightfall(dt, cam);
    else if (sc.name === 'hold') this.hold(dt, cam);
    else this.driveBy(dt, cam);
    if (sc.name === 'hold' || sc.name === 'horde') {
      this.flashes.push(this.torch);
      this.flare(dt, FLARE[sc.name]);
    } else this.g.lights.setSky(0, 0, 0, 0, 0, 0);
    if (sc.name === 'drive') this.flashes.push(this.lamp);
    this.fires.length = 0;
    for (const t of this.torches) if (t.src.intensity > 0) this.fires.push(t.src);
    if (this.fire.src.intensity > 0) this.fires.push(this.fire.src);
    for (const f of this.g.staticFires) this.fires.push(f);
    if (Math.abs(cam.fov - this.fov) > 0.01) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
    this.fresh = false;
    return 1 - Math.min(smooth(0, FADE, this.t), smooth(sc.len, sc.len - FADE, this.t));
  }

  // jump to scene k, t s into it (a screenshot's: the scene is run up to there in small steps)
  seek(k, t, cam, pin = true) {
    this.pinned = false;
    this.start(k);
    for (let u = 0; u < t; u += 1 / 30) this.update(1 / 30, cam);
    this.pinned = pin;
  }

  dispose() {
    const g = this.g;
    if (this.camp && this.drive) {
      this.lightTorches(false);
      g.lights.setSky(0, 0, 0, 0, 0, 0);
      for (const z of this.horde) {
        if (z.view.member) g.crowd.remove(z.view.member);
        g.scene.remove(z.view.object);
        z.view.dispose();
      }
      for (const s of this.sv) s.sv.dispose();
      g.scene.remove(this.root);
    }
    if (g.camera.fov !== this.fov0) {
      g.camera.fov = this.fov0;
      g.camera.updateProjectionMatrix();
    }
  }
}
