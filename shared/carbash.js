// What a melee hit does to a car, besides the scrap it already pays (Game.gatherHit).
// Pure: the client plays it (client/render/carbash.js) and the tests step it. No three.js.
// A car, van, truck or bus. Planes, tractors and generators still give scrap, and they do not rock.
import { PROPS } from './props.js';

export const CAR_BASH = new Set([
  'car',
  'car_wreck',
  'car_burnt',
  'pickup_truck',
  'van_wreck',
  'camper',
  'ambulance',
  'school_bus',
  'city_bus',
  'box_truck',
  'dump_truck',
  'fire_truck',
  'army_truck',
  'fuel_truck',
]);

// knife / machete, and a bat (Combat.melee sends IMPACT.BASH / BASH_HARD)
export const BASH_SOFT = 0.85;
export const BASH_HARD = 1.55;

const GRAV = 11;

// prop local frame: origin at the prop's ground point, yaw pr.ry, front along -Z
export function worldToCar(pr, x, y, z) {
  const c = Math.cos(pr.ry);
  const s = Math.sin(pr.ry);
  const dx = x - pr.x;
  const dz = z - pr.z;
  return { x: c * dx - s * dz, y: y - pr.y, z: s * dx + c * dz };
}

export function carToWorld(pr, lx, ly, lz) {
  const c = Math.cos(pr.ry);
  const s = Math.sin(pr.ry);
  return { x: pr.x + c * lx + s * lz, y: pr.y + ly, z: pr.z - s * lx + c * lz };
}

// the union of a prop's collision boxes, in its own frame
export function carBounds(type) {
  const boxes = PROPS[type]?.boxes;
  if (!boxes?.length) return null;
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (const [cx, cy, cz, sx, sy, sz] of boxes) {
    x0 = Math.min(x0, cx - sx / 2);
    x1 = Math.max(x1, cx + sx / 2);
    y0 = Math.min(y0, cy - sy / 2);
    y1 = Math.max(y1, cy + sy / 2);
    z0 = Math.min(z0, cz - sz / 2);
    z1 = Math.max(z1, cz + sz / 2);
  }
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, cz: (z0 + z1) / 2, hx: (x1 - x0) / 2, hy: (y1 - y0) / 2, hz: (z1 - z0) / 2 };
}

// the hit (x,y,z) lands on this car's body. pad covers a swing that stops on the skin.
export function carContains(pr, x, y, z, pad = 0.4) {
  if (!CAR_BASH.has(pr.type)) return false;
  const boxes = PROPS[pr.type]?.boxes;
  if (!boxes) return false;
  const p = worldToCar(pr, x, y, z);
  for (const [cx, cy, cz, sx, sy, sz] of boxes) {
    if (Math.abs(p.x - cx) <= sx / 2 + pad && Math.abs(p.y - cy) <= sy / 2 + pad && Math.abs(p.z - cz) <= sz / 2 + pad) return true;
  }
  return false;
}

// the car a hit landed on, or null. Two stacked wrecks: the one whose centre is nearer.
export function bashCarAt(props, x, y, z) {
  let best = null;
  let bd = Infinity;
  for (const pr of props) {
    if (!carContains(pr, x, y, z)) continue;
    const d = (pr.x - x) ** 2 + (pr.y - y) ** 2 + (pr.z - z) ** 2;
    if (d < bd) {
      bd = d;
      best = pr;
    }
  }
  return best;
}

// ---------------------------------------------------------------- the body, on a spring (lift, roll, pitch)
export function createSpring() {
  return { lift: 0, liftV: 0, roll: 0, rollV: 0, pitch: 0, pitchV: 0 };
}

// lx, lz: where the hit landed in the car's frame, so the near side gives
export function springImpulse(sp, lx, lz, strength) {
  const k = 0.55 + strength;
  sp.liftV += 1.7 * k;
  sp.rollV += Math.max(-1, Math.min(1, lx / 1.1)) * 2.4 * k;
  sp.pitchV += Math.max(-1, Math.min(1, lz / 2.2)) * 1.15 * k;
}

function springOnce(sp, dt) {
  const tick = (x, v, stiff, damp) => {
    v += (-stiff * x - damp * v) * dt;
    x += v * dt;
    return [x, v];
  };
  [sp.lift, sp.liftV] = tick(sp.lift, sp.liftV, 95, 10);
  [sp.roll, sp.rollV] = tick(sp.roll, sp.rollV, 78, 8.5);
  [sp.pitch, sp.pitchV] = tick(sp.pitch, sp.pitchV, 78, 8.5);
  sp.lift = Math.max(-0.015, Math.min(0.085, sp.lift));
  sp.roll = Math.max(-0.065, Math.min(0.065, sp.roll));
  sp.pitch = Math.max(-0.045, Math.min(0.045, sp.pitch));
}

// returns true while it is still moving
export function springStep(sp, dt) {
  const n = Math.max(1, Math.min(8, Math.ceil(dt / 0.02)));
  const h = dt / n;
  for (let i = 0; i < n; i++) springOnce(sp, h);
  return Math.abs(sp.lift) + Math.abs(sp.liftV) + Math.abs(sp.rollV) + Math.abs(sp.pitchV) > 0.012;
}

// ---------------------------------------------------------------- scrap that breaks off and falls
// rng: () => 0..1. The first piece is a panel; the rest are smaller bits. A bat (strength > 1.2) throws more.
export function makeShards(x, y, z, nx, ny, nz, strength, rng) {
  const n = strength > 1.2 ? 3 : strength > 0.9 ? 2 : 1;
  const out = [];
  const len = Math.hypot(nx, ny, nz) || 1;
  nx /= len;
  ny /= len;
  nz /= len;
  for (let i = 0; i < n; i++) {
    const panel = i === 0;
    const speed = (panel ? 2.4 : 3.6) * (0.65 + strength * 0.45);
    out.push({
      x: x + nx * (panel ? 0.08 : 0.05),
      y: y + ny * 0.05 + 0.02,
      z: z + nz * (panel ? 0.08 : 0.05),
      vx: nx * speed + (rng() - 0.5) * 1.6,
      vy: 1.1 + rng() * 1.6 + strength * 0.35,
      vz: nz * speed + (rng() - 0.5) * 1.6,
      rx: rng() * Math.PI,
      ry: rng() * Math.PI,
      rz: rng() * Math.PI,
      wx: (rng() - 0.5) * 16,
      wy: (rng() - 0.5) * 10,
      wz: (rng() - 0.5) * 16,
      sx: panel ? 0.46 : 0.07 + rng() * 0.1,
      sy: panel ? 0.02 : 0.012 + rng() * 0.016,
      sz: panel ? 0.28 : 0.05 + rng() * 0.09,
      nx, ny, nz,
      panel,
      sleep: false,
      age: 0,
    });
  }
  return out;
}

// a scrape left in the panel, slid a little so two hits do not stack on one point
export function makeDent(x, y, z, nx, ny, nz, rng) {
  const len = Math.hypot(nx, ny, nz) || 1;
  nx /= len;
  ny /= len;
  nz /= len;
  let tx = rng() - 0.5;
  let ty = rng() - 0.5;
  let tz = rng() - 0.5;
  const dot = tx * nx + ty * ny + tz * nz;
  tx -= nx * dot;
  ty -= ny * dot;
  tz -= nz * dot;
  const sc = 0.14;
  return {
    x: x + nx * 0.028 + tx * sc,
    y: y + ny * 0.028 + ty * sc,
    z: z + nz * 0.028 + tz * sc,
    nx, ny, nz,
    spin: (rng() - 0.5) * 0.5,
  };
}

// groundY: the floor under the piece. inside(x,y,z): still in the car's body, so it is pushed back out.
export function stepShard(s, groundY, dt, inside) {
  if (s.sleep) return;
  const n = Math.max(1, Math.min(6, Math.ceil(dt / 0.02)));
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    s.age += h;
    s.vy -= GRAV * h;
    s.x += s.vx * h;
    s.y += s.vy * h;
    s.z += s.vz * h;
    s.rx += s.wx * h;
    s.ry += s.wy * h;
    s.rz += s.wz * h;
    if (inside && inside(s.x, s.y, s.z)) {
      s.x += s.nx * 0.06;
      s.y += s.ny * 0.06 + 0.02;
      s.z += s.nz * 0.06;
      const vn = s.vx * s.nx + s.vy * s.ny + s.vz * s.nz;
      if (vn < 0) {
        s.vx -= 1.7 * vn * s.nx;
        s.vy -= 1.7 * vn * s.ny;
        s.vz -= 1.7 * vn * s.nz;
      }
    }
    const rest = groundY + s.sy * 0.5;
    if (s.y <= rest) {
      s.y = rest;
      if (Math.abs(s.vy) < 0.85) {
        s.vy = 0;
        s.vx *= 0.45;
        s.vz *= 0.45;
        s.wx *= 0.35;
        s.wy *= 0.35;
        s.wz *= 0.35;
      } else {
        s.vy = -s.vy * 0.3;
        s.vx *= 0.6;
        s.vz *= 0.6;
        s.wx *= 0.65;
        s.wz *= 0.65;
      }
      if (s.vx * s.vx + s.vy * s.vy + s.vz * s.vz < 0.08) {
        s.sleep = true;
        s.vx = s.vy = s.vz = 0;
        s.wx = s.wy = s.wz = 0;
        if (s.panel) {
          s.rx = 0.12;
          s.rz = 0.35;
        }
      }
    }
  }
  if (!s.sleep && s.age > 5) {
    s.sleep = true;
    s.vx = s.vy = s.vz = 0;
    s.wx = s.wy = s.wz = 0;
  }
}
