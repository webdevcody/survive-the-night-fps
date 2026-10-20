// Game: shots as they are seen - somebody else's (EVT.SHOT), a flamethrower's stream, and our own, judged here as the
// server will judge them so that what they strike shows at once.
import * as THREE from 'three';
import { WEAPONS, ZOMBIE_DEFS, SOUND, ZANIM, IMPACT, greenBlood } from '../../../shared/defs.js';
import { ENT, PFLAG } from '../../../shared/protocol.js';
import { WEAPON_LIST } from '../../../shared/weapons/index.js';
import { shotDirections } from '../../../shared/playersim.js';
import { raycastWorld } from '../../../shared/collision.js';
import { zombieHitbox, playerHitbox, rayHitbox } from '../../../shared/hitbox.js';
import { difficultyOf } from '../../../shared/difficulty.js';
import { deerHitbox } from '../../../shared/deer.js';
import { MOUNTED_GUN } from '../../../shared/mountedgun.js';

// the shot the others hear, by the gun (`shotSound` in its file, shared/weapons/)
const SHOT_SOUND = Object.fromEntries(WEAPON_LIST.filter((w) => w.shotSound).map((w) => [w.id, SOUND[w.shotSound]]));
// first-person muzzle flash scale + camera shake per shot (`kick` in the gun's file; default [1, 0.06])
const SHOT_KICK = Object.fromEntries(WEAPON_LIST.filter((w) => w.kick).map((w) => [w.id, w.kick]));
const _ray = { t: -1, col: null, terrain: false };
const _dirs = new Float32Array(48);
const _shotHits = [];
const _hbPos = { x: 0, y: 0, z: 0 };
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _aim = { x: 0, y: 0, z: 0 };
const _hand = { x: 0, y: 0, z: 0 };
const OWN_IMPACTS_MAX = 48; // our own impacts kept for the server's word on them (sameAsOwn)...
const OWN_IMPACT_WAIT = 2; // ...for this many seconds at most

// which way a shot's eye looks (ev: yaw, pitch; yaw 0 faces -Z), into out
function aimOf(ev, out) {
  const cp = Math.cos(ev.pitch);
  out.x = -Math.sin(ev.yaw) * cp;
  out.y = Math.sin(ev.pitch);
  out.z = -Math.cos(ev.yaw) * cp;
  return out;
}

// where our own shot is drawn from: ahead m along the aim from a point low on the right of the eye, about where the
// muzzle is (ev: the eye and its aim), into out
function handOf(ev, ahead, out) {
  const cp = Math.cos(ev.pitch);
  const side = ev.hand === -1 ? -0.12 : 0.12; // (the left gun of a pair: shared/akimbo.js)
  out.x = ev.x + Math.cos(ev.yaw) * side - Math.sin(ev.yaw) * cp * ahead;
  out.y = ev.y - 0.12 + Math.sin(ev.pitch) * ahead;
  out.z = ev.z - Math.sin(ev.yaw) * side - Math.cos(ev.yaw) * cp * ahead;
  return out;
}

export const methods = {
  remoteShot(ev) {
    if (ev.weapon === MOUNTED_GUN) return this.gun.remoteShot(ev); // (from its muzzle, not from the gunner's hands)
    const def = WEAPONS[ev.weapon];
    if (!def) return;
    const shooter = this.entities.ents.get(ev.shooter);
    let mx = ev.x;
    let my = ev.y - 0.15;
    let mz = ev.z;
    if (shooter?.view) {
      shooter.view.getMuzzleWorld(_v);
      mx = _v.x;
      my = _v.y;
      mz = _v.z;
      _v.set(mx, my, mz);
    } else _v.set(mx, my, mz);
    if (def.flame) return this.flamePuff(ev.shooter, ev, mx, my, mz, def);
    if (!def.quiet) {
      this.effects.worldMuzzle(_v, def.rocket || def.bossMul ? 1.8 : def.pellets > 1 ? 1.3 : 1);
      this.lights.flashMuzzle(_v, 0.8);
    }
    this.audio.play(SHOT_SOUND[ev.weapon] || SOUND.PISTOL, { x: mx, y: my, z: mz });
    if (def.rocket) {
      // no tracer: the grenade is a projectile of its own (entities.js). The backblast out of the back of the tube
      const { x: fx, y: fy, z: fz } = aimOf(ev, _aim);
      this.effects.backblast(mx - fx, my - fy, mz - fz, -fx, -fy, -fz);
      return;
    }
    if (def.skyflare) return; // (no bullet: the flare is a projectile of its own, game/skyflares.js)
    const n = shotDirections(ev.yaw, ev.pitch, ev.recoilPitch, ev.spread, def.pellets, ev.seed, _dirs);
    for (let i = 0; i < n; i++) {
      const dx = _dirs[i * 3];
      const dy = _dirs[i * 3 + 1];
      const dz = _dirs[i * 3 + 2];
      raycastWorld(this.world, ev.x, ev.y, ev.z, dx, dy, dz, def.range, _ray);
      const dist = _ray.t >= 0 ? _ray.t : Math.min(def.range, 80);
      this.predictPellet(ev, def, i, dx, dy, dz, false); // (the hole each pellet leaves, if no body stopped it)
      if (def.pellets > 1 && i % 2) continue;
      if (def.quiet) this.effects.boltTrail(mx, my, mz, dx, dy, dz, dist);
      else this.effects.tracer(mx, my, mz, dx, dy, dz, dist, 0.8);
    }
  },

  // One puff of a flamethrower's stream, ours or someone else's: the fire, its light, and the roar while it lasts.
  // (mx,my,mz) = the nozzle; the stream follows the aim from the eye (ev)
  flamePuff(id, ev, mx, my, mz, def) {
    const { x: dx, y: dy, z: dz } = aimOf(ev, _aim);
    raycastWorld(this.world, ev.x, ev.y, ev.z, dx, dy, dz, def.range, _ray);
    const ahead = (mx - ev.x) * dx + (my - ev.y) * dy + (mz - ev.z) * dz; // the nozzle is this far along the stream
    const dist = Math.max(0.3, (_ray.t >= 0 ? _ray.t : def.range) - ahead);
    this.effects.flameJet(mx, my, mz, dx, dy, dz, dist, def.flame.cone);
    _v.set(mx + dx * 1.2, my + dy * 1.2 + 0.25, mz + dz * 1.2);
    this.lights.flashMuzzle(_v, 0.3, 0.12);
    // the stream lights up everything round it like a big fire: its light sits well short of where the fire ends
    // (a light right on the wall it splashes on burns that wall white), no more than 4.5 m out, so the shooter
    // stands in it too. Sprayed point-blank into something, the fire is smothered and lights less
    const k = Math.min(4.5, Math.max(dist * 0.4, dist - 1.8));
    let f = this.flames.get(id);
    if (!f) {
      _v.set(mx + dx * k, my + dy * k - 0.9, mz + dz * k); // (the light pool lifts a big fire's light 0.9 m)
      this.flames.set(id, (f = { loop: undefined, t: 0, glow: 0, at: _v.clone(), light: { x: _v.x, y: _v.y, z: _v.z, intensity: 0, big: true, color: 0xff9440 } }));
    }
    if (f.loop === undefined) f.loop = this.audio.createLoop?.('flamethrower', mx, my, mz) || null;
    f.loop?.setPosition(mx, my, mz);
    f.t = 0.2;
    f.glow = (1.05 + Math.random() * 0.4) * Math.min(1, 0.4 + dist * 0.2); // each puff a little brighter or dimmer than the last: it flickers
    f.at.set(mx + dx * k, my + dy * k - 0.9, mz + dz * k);
  },

  // A shot of our own, as the simulation fires it (its 'fire' event): the muzzle flash, the sound, and what each pellet
  // strikes, shown now (predictPellet); a rocket or a flare flown on from here; the view's punch and shake
  ownShot(ev) {
    const def = WEAPONS[ev.weapon];
    this.vm.fire(ev.hand);
    if (def.flame) {
      // a stream of fire, not a shot: it leaves the nozzle, ahead of the eye and low on the right
      this.vm.getMuzzle(_v);
      this.effects.vmMuzzle(_v, 0.55, 0.1);
      this.renderer.vmMuzzle.intensity = 3;
      this.vmMuzzleT = 0.12;
      const nozzle = handOf(ev, 0.7, _hand);
      this.flamePuff(-1, ev, nozzle.x, nozzle.y, nozzle.z, def);
      this.shakeView(0.012);
      return;
    }
    this.audio.playLocal(def.sound || 'pistol');
    const kick = SHOT_KICK[ev.weapon];
    if (!def.quiet) {
      this.vm.getMuzzle(_v);
      this.effects.vmMuzzle(_v, kick ? kick[0] : 1);
      this.renderer.vmMuzzle.intensity = 6;
      this.vmMuzzleT = 0.05;
      // world muzzle light at the camera
      _v2.set(-Math.sin(ev.yaw), 0, -Math.cos(ev.yaw));
      _v.set(ev.x + _v2.x * 0.8, ev.y - 0.1, ev.z + _v2.z * 0.8);
      this.lights.flashMuzzle(_v, 1);
    }
    if (def.rocket) {
      // No pellets: a grenade, flown on from here by game/rockets.js along the line the server flies it. It
      // leaves the muzzle on the right shoulder, and the backblast leaves the back of the tube behind it
      shotDirections(ev.yaw, ev.pitch, ev.recoilPitch, ev.spread, 1, ev.seed, _dirs);
      const { x: fx, y: fy, z: fz } = aimOf(ev, _aim);
      const rx = Math.cos(ev.yaw) * 0.16;
      const rz = -Math.sin(ev.yaw) * 0.16;
      this.rockets.fire(def, ev.x, ev.y, ev.z, _dirs[0], _dirs[1], _dirs[2], ev.x + rx + fx * 0.8, ev.y - 0.1 + fy * 0.8, ev.z + rz + fz * 0.8);
      this.effects.backblast(ev.x + rx - fx * 0.5, ev.y - 0.1 - fy * 0.5, ev.z + rz - fz * 0.5, -fx, -fy, -fz);
      this.punchView(def, ev.aiming);
      this.shakeView(kick[1]);
      return;
    }
    if (def.skyflare) {
      // no bullet: the flare, flown from the eye along the aim (as the server will) and drawn off the gun's
      // muzzle, low on the right ahead of the eye
      shotDirections(ev.yaw, ev.pitch, ev.recoilPitch, ev.spread, 1, ev.seed, _dirs);
      const muzzle = handOf(ev, 0.5, _hand);
      this.skyflares.fire(ev, _dirs[0], _dirs[1], _dirs[2], muzzle.x, muzzle.y, muzzle.z);
      this.punchView(def, ev.aiming);
      this.shakeView(kick ? kick[1] : 0.06);
      return;
    }
    // Tracers from the gun, and what every pellet strikes (predictPellet): the blood or the puff off the wall is
    // shown now, not a round trip later. The damage and the hit marker are still the server's alone
    const n = shotDirections(ev.yaw, ev.pitch, ev.recoilPitch, ev.spread, def.pellets, ev.seed, _dirs);
    const { x: sx, y: sy, z: sz } = handOf(ev, 0.5, _hand);
    for (let i = 0; i < n; i++) {
      const dx = _dirs[i * 3];
      const dy = _dirs[i * 3 + 1];
      const dz = _dirs[i * 3 + 2];
      raycastWorld(this.world, ev.x, ev.y, ev.z, dx, dy, dz, def.range, _ray);
      const end = this.predictPellet(ev, def, i, dx, dy, dz);
      if (def.pellets > 1 && i % 2) continue;
      const dist = end >= 0 ? end : Math.min(def.range, 90);
      if (def.quiet) this.effects.boltTrail(sx, sy, sz, dx, dy, dz, dist);
      else if (Math.random() < (def.pellets > 1 ? 1 : 0.6)) this.effects.tracer(sx, sy, sz, dx, dy, dz, dist, 1);
    }
    this.punchView(def, ev.aiming);
    this.shakeView(kick ? kick[1] : 0.06);
  },

  // One pellet of our own shot, judged the way the server will judge it (Combat.fire): against the world (_ray holds
  // that already) and against the hitboxes of the dead where they are drawn - the server rewinds its own to the same
  // moment, so the two agree. What the pellet strikes is shown now (ownImpact) instead of a round trip later, when
  // the server says so. Only the look of it: the damage and the hit marker wait for the server.
  // Returns how far the pellet flies before something stops it, -1 if nothing does.
  // own: false for somebody else's pellet (EVT.SHOT): the server tells of the bodies it struck, so only what it
  // does to the world is shown - the hole it leaves, where no body stood in its way.
  predictPellet(ev, def, i, dx, dy, dz, own = true) {
    const wall = _ray.t;
    const wallT = wall >= 0 ? wall : def.range;
    const col = _ray.col;
    const terrain = _ray.terrain;
    const hits = _shotHits;
    hits.length = 0;
    for (const e of this.entities.ents.values()) {
      const zdef = e.kind === ENT.ZOMBIE ? ZOMBIE_DEFS[e.ztype] : null;
      const deer = e.kind === ENT.DEER; // (hunted through the same path as the dead are shot: shared/deer.js)
      if (zdef || deer ? e.dead : e.kind !== ENT.PLAYER || e.id === (own ? this.myId : ev.shooter) || (e.q[5] & (PFLAG.ZOMBIE | PFLAG.DEAD)) !== PFLAG.ZOMBIE) continue;
      // (first by how far the ray passes from it: most of them are nowhere near)
      const rx = e.rx - ev.x;
      const ry = e.ry + 0.8 - ev.y;
      const rz = e.rz - ev.z;
      const along = rx * dx + ry * dy + rz * dz;
      if (along < -1 || along > wallT + 2 || rx * rx + ry * ry + rz * rz - along * along > 16) continue;
      const hb = deer ? deerHitbox(e.ryaw, e.q[4]) : zdef ? zombieHitbox(zdef, e.ryaw, e.q[7], e.q[4] === ZANIM.AIRBORNE, difficultyOf(this.room?.difficulty).aim, e.perched) : playerHitbox(true, !!(e.q[5] & PFLAG.CROUCH));
      _hbPos.x = e.rx;
      _hbPos.y = e.ry;
      _hbPos.z = e.rz;
      const t = rayHitbox(_hbPos, hb, ev.x, ev.y, ev.z, dx, dy, dz, wallT);
      if (t >= 0) hits.push({ t, e });
    }
    hits.sort((a, b) => a.t - b.t);
    const pierce = def.pierce || 1;
    for (let k = 0; own && k < hits.length && k < pierce; k++) {
      const { t, e } = hits[k];
      const z = e.kind === ENT.ZOMBIE;
      const green = z && greenBlood(e.ztype);
      // (a shade pinned by light is stone: the bullet chips it)
      this.ownImpact(z && e.q[4] === ZANIM.FROZEN ? IMPACT.DIRT : green ? IMPACT.GREEN_BLOOD : IMPACT.BLOOD, ev.x + dx * t, ev.y + dy * t, ev.z + dz * t, -dx, -dy, -dz);
    }
    if (hits.length) return hits.length >= pierce ? hits[pierce - 1].t : wall;
    // nothing in the way but the world: the hole every pellet leaves in what it struck, the dust or the sparks off
    // it (Impacts.shot: by what that is made of), and the window it went through on its way. The server's word of
    // the same impact, a round trip later, is dropped (sameAsOwn).
    this.impacts.shot(ev.weapon ?? MOUNTED_GUN, ev.x, ev.y, ev.z, dx, dy, dz, wall, col, terrain, def.range); // (a round with no weapon named is the mounted gun's)
    if (wall >= 0) this.rememberOwnImpact(ev.x + dx * wall, ev.y + dy * wall, ev.z + dz * wall);
    return wall;
  },

  // A round of ours that no weapon in the hands fired (the mounted gun's: its own row `def`, one pellet along
  // dx,dy,dz), judged like any other. Returns how far it flies, -1 if nothing stops it.
  predictShot(ev, def, dx, dy, dz) {
    raycastWorld(this.world, ev.x, ev.y, ev.z, dx, dy, dz, def.range, _ray);
    return this.predictPellet(ev, def, 0, dx, dy, dz);
  },

  // An impact of our own shot, shown as it is fired. The server sends word of the same impact a round trip later,
  // and sameAsOwn drops that one.
  ownImpact(kind, x, y, z, nx, ny, nz) {
    this.rememberOwnImpact(x, y, z);
    this.eventHandler.impact(kind, x, y, z, nx, ny, nz, true);
  },

  // an impact of ours shown already, for sameAsOwn to know the server's word on it when it comes
  rememberOwnImpact(x, y, z) {
    const list = this.ownImpacts || (this.ownImpacts = []);
    if (list.length >= OWN_IMPACTS_MAX) list.shift();
    list.push({ x, y, z, t: this.time });
  },

  // Is this impact from the server one that was shown already (ownImpact)? It is when one of ours from the last two
  // seconds struck within a metre of it: the server judges the shot against the picture we aimed at, so the two land
  // together. That one of ours is then spent. One that is never answered (the server saw a miss) just lapses.
  sameAsOwn(x, y, z) {
    const list = this.ownImpacts;
    if (!list || !list.length) return false;
    while (list.length && this.time - list[0].t > OWN_IMPACT_WAIT) list.shift();
    let best = -1;
    let bd = 1;
    for (let i = 0; i < list.length; i++) {
      const d = Math.hypot(list[i].x - x, list[i].y - y, list[i].z - z);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    if (best < 0) return false;
    list.splice(best, 1);
    return true;
  },

  // a flamethrower's roar stops a moment after its last puff; its light dies down with the fire it left
  updateFlames(dt) {
    this.flameLights.length = 0;
    for (const [id, f] of this.flames) {
      const L = f.light;
      if (f.t > 0) {
        L.intensity += (f.glow - L.intensity) * Math.min(1, dt * 18);
        if ((f.t -= dt) <= 0) {
          f.loop?.stop();
          f.loop = undefined;
        }
      } else if ((L.intensity -= dt * 3.5) <= 0) {
        this.flames.delete(id);
        continue;
      }
      const m = Math.min(1, dt * 14); // (it follows the aim, not jumping puff to puff)
      L.x += (f.at.x - L.x) * m;
      L.y += (f.at.y - L.y) * m;
      L.z += (f.at.z - L.z) * m;
      this.flameLights.push(L);
    }
  },
};
