// The ground past the edge of the map, as a few thousand triangles (world.far: the island's hills on down to its shore
// and the shelf under the shallows, the mainland's far hills; shared/coast.js), and the island's sea round it.
//
// A ring of rows out from the map's edge, along the way out from its middle (as shared/coast.js measures it). The first
// row is the map's own edge: its points are the terrain's edge vertices (every other one), with the terrain's own
// normals and ground layers, so the two meet without a seam. The rows after it halve their points as they go out, each
// pair stitched without a crack, to a coarse ring that is only seen at a distance and through the haze. On the island
// the rows follow its shore (fractions of the way to it, the shore itself a row, then the shelf), so the coast is drawn
// where the field map draws it. Nobody walks any of it: no collider, nothing on the server.
import * as THREE from 'three';
import { WATER_LEVEL, GRID_STEP } from '../../shared/constants.js';
import { WORLD } from '../../shared/acts.js';
import { SHORE, islandLand } from '../../shared/coast.js';
import { smoothstep } from '../../shared/rng.js';

const PLANS = new WeakMap();
// a point a fraction f round the map's square of half side h (from its north-west corner, clockwise seen from above)
export function perim(f, h) {
  const s = (((f % 1) + 1) % 1) * 4;
  const side = s | 0;
  const t = s - side;
  return side === 0 ? [-h + 2 * h * t, -h] : side === 1 ? [h, -h + 2 * h * t] : side === 2 ? [h - 2 * h * t, h] : [-h, h - 2 * h * t];
}

// rows: [{ n, x, z: Float32Array(n), edge: the map's own edge }] from the edge out (their heights: buildRing); water: the island's rows that carry its sea (from a little
// inland of the shore out past the shelf) with how much of the sea bed shows through at each (aSolid: 0 shows, 1 none)
export function ringPlan(world) {
  let P = PLANS.get(world);
  if (P) return P;
  const H = world.half;
  const island = world.kind === WORLD.ISLAND;
  const isle = island ? islandLand(world.seed) : null;
  // [points round, the distance out at reach r (the island's shore, that way) ]
  const specs = island
    ? [[640, () => 0], [320, (r) => Math.min(6, 0.15 * r)], [160, (r) => Math.min(16, 0.35 * r)], [160, (r) => 0.55 * r], [160, (r) => 0.75 * r], [160, (r) => 0.9 * r], [160, (r) => r], [160, (r) => r + 6], [160, (r) => r + 16], [160, (r) => r + SHORE.SHELF + 2]]
    : [[1280, () => 0], [640, () => 8], [320, () => 24], [160, () => 50], [160, () => 90], [160, () => 140], [160, () => 200], [160, () => 270]];
  const rows = specs.map(([n, dist]) => {
    const x = new Float32Array(n);
    const z = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const [qx, qz] = perim(i / n, H);
      const l = Math.hypot(qx, qz);
      const d = dist(isle ? isle.reach(qx, qz) : 0);
      x[i] = qx + (qx / l) * d;
      z[i] = qz + (qz / l) * d;
    }
    return { n, x, z, edge: dist === specs[0][1] };
  });
  P = { rows, water: island ? { from: 5, solid: [0, 0, 0, 0.55, 1] } : null };
  PLANS.set(world, P);
  return P;
}

// Triangles between row a and row b (b has as many points as a, or half as many), onto idx by sector: a triangle goes to
// the sector its first point of a is in. off: each row's first vertex in the buffer.
function stitch(a, b, oa, ob, sectors, put) {
  const S = sectors.length;
  if (b.n === a.n) {
    for (let i = 0; i < a.n; i++) {
      const i1 = (i + 1) % a.n;
      const s = sectors[Math.floor((i / a.n) * S)];
      put(s, oa + i, ob + i, oa + i1);
      put(s, oa + i1, ob + i, ob + i1);
    }
  } else {
    for (let j = 0; j < b.n; j++) {
      const j1 = (j + 1) % b.n;
      const i0 = 2 * j;
      const i1 = 2 * j + 1;
      const i2 = (2 * j + 2) % a.n;
      const s = sectors[Math.floor((j / b.n) * S)];
      put(s, oa + i0, ob + j, oa + i1);
      put(s, oa + i1, ob + j, ob + j1);
      put(s, oa + i1, ob + j1, oa + i2);
    }
  }
}

const SECTORS = 4;
// The shore's mesh in the terrain's material. fields: the terrain's ground layers (terrain.js groundFields).
export function buildRing(world, mat, fields, MultiMesh, ALWAYS, roadReach) {
  const { rows } = ringPlan(world);
  const H = world.half;
  const N = world.gridN;
  let count = 0;
  const offs = rows.map((r) => {
    const o = count;
    count += r.n;
    return o;
  });
  const pos = new Float32Array(count * 3);
  rows.forEach((r, k) => {
    for (let i = 0; i < r.n; i++) {
      const v = offs[k] + i;
      pos[v * 3] = r.x[i];
      pos[v * 3 + 1] = r.edge ? world.heightAt(r.x[i], r.z[i]) : world.far(r.x[i], r.z[i]);
      pos[v * 3 + 2] = r.z[i];
    }
  });
  // triangles, each wound to face up, in sectors (so what is behind the camera is not drawn)
  const parts = Array.from({ length: SECTORS }, () => []);
  const sectors = parts.map((_, s) => s);
  // (on the mainland, what lies past its edge under the sea is under water drawn opaque there: left out)
  const sunk = world.kind === WORLD.ISLAND ? () => false : (a, b, c) => Math.max(pos[a * 3 + 1], pos[b * 3 + 1], pos[c * 3 + 1]) < WATER_LEVEL - 1 && Math.min(Math.max(Math.abs(pos[a * 3]), Math.abs(pos[a * 3 + 2])), Math.max(Math.abs(pos[b * 3]), Math.abs(pos[b * 3 + 2])), Math.max(Math.abs(pos[c * 3]), Math.abs(pos[c * 3 + 2]))) >= H;
  const put = (s, a, b, c) => {
    if (sunk(a, b, c)) return;
    const ux = pos[b * 3] - pos[a * 3], uz = pos[b * 3 + 2] - pos[a * 3 + 2];
    const vx = pos[c * 3] - pos[a * 3], vz = pos[c * 3 + 2] - pos[a * 3 + 2];
    if (uz * vx - ux * vz > 0) parts[s].push(a, b, c);
    else parts[s].push(a, c, b);
  };
  for (let k = 0; k + 1 < rows.length; k++) stitch(rows[k], rows[k + 1], offs[k], offs[k + 1], sectors, put);
  const idx = new Uint32Array(parts.reduce((a, p) => a + p.length, 0));
  const runs = [];
  let o = 0;
  for (const p of parts) {
    idx.set(p, o);
    let lx = Infinity, hx = -Infinity, ly = Infinity, hy = -Infinity, lz = Infinity, hz = -Infinity;
    for (const v of p) {
      lx = Math.min(lx, pos[v * 3]); hx = Math.max(hx, pos[v * 3]);
      ly = Math.min(ly, pos[v * 3 + 1]); hy = Math.max(hy, pos[v * 3 + 1]);
      lz = Math.min(lz, pos[v * 3 + 2]); hz = Math.max(hz, pos[v * 3 + 2]);
    }
    runs.push({ first: o, count: p.length, x: (lx + hx) / 2, y: (ly + hy) / 2, z: (lz + hz) / 2, r: Math.hypot(hx - lx, hy - ly, hz - lz) / 2, chunk: ALWAYS, maxDist: Infinity });
    o += p.length;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  const nrm = geo.attributes.normal.array;
  const splat = new Float32Array(count * 4);
  const extra = new Float32Array(count * 4);
  const road = new Float32Array(count * 4);
  const odds = world.flora ? world.flora.treeOdds : null;
  const grid = (x, z) => Math.round((z + H) / GRID_STEP) * N + Math.round((x + H) / GRID_STEP);
  rows.forEach((r, k) => {
    for (let i = 0; i < r.n; i++) {
      const v = offs[k] + i;
      road[v * 4] = roadReach; // (no road)
      if (k === 0) {
        // the map's own edge: the terrain's normal and layers there, exactly
        const g = grid(r.x[i], r.z[i]);
        for (let c = 0; c < 3; c++) nrm[v * 3 + c] = fields.nrm[g * 3 + c];
        for (let c = 0; c < 4; c++) splat[v * 4 + c] = fields.base[g * 4 + c];
        extra[v * 4 + 1] = fields.ao[g];
        extra[v * 4 + 2] = fields.wet[g];
        extra[v * 4 + 3] = fields.rock[g];
        continue;
      }
      // past it: meadow, the woods where they stand thick (as the trees drawn there: shared/coast.js farFlora), the
      // shore's mud by the water, rock where it is steep
      const h = pos[v * 3 + 1];
      const mud = smoothstep(WATER_LEVEL + 1.3, WATER_LEVEL + 0.2, h);
      const forest = odds ? smoothstep(0.4, 0.9, odds(r.x[i], r.z[i])) * 0.75 : 0;
      let s0 = (1 - forest) * (1 - mud), s1 = forest * (1 - mud), s2 = mud;
      let ao = 1 - 0.25 * forest;
      let wet = smoothstep(WATER_LEVEL + 2.5, WATER_LEVEL + 0.4, h);
      let rock = smoothstep(0.16, 0.27, 1 - nrm[v * 3 + 1]);
      if (k === 1) {
        // (the first row out takes half of the edge's layers, so the ground changes no faster than the terrain's)
        const e = offs[0] + Math.round((i / r.n) * rows[0].n) % rows[0].n;
        s0 = (s0 + splat[e * 4]) / 2;
        s1 = (s1 + splat[e * 4 + 1]) / 2;
        s2 = (s2 + splat[e * 4 + 2]) / 2;
        ao = (ao + extra[e * 4 + 1]) / 2;
        wet = (wet + extra[e * 4 + 2]) / 2;
        rock = (rock + extra[e * 4 + 3]) / 2;
      }
      splat[v * 4] = s0;
      splat[v * 4 + 1] = s1;
      splat[v * 4 + 2] = s2;
      extra[v * 4 + 1] = ao;
      extra[v * 4 + 2] = wet;
      extra[v * 4 + 3] = rock;
    }
  });
  geo.setAttribute('aSplat', new THREE.BufferAttribute(splat, 4));
  geo.setAttribute('aExtra', new THREE.BufferAttribute(extra, 4));
  geo.setAttribute('aRoad', new THREE.BufferAttribute(road, 4));
  const mesh = new MultiMesh(geo, mat, runs);
  mesh.name = 'shore';
  mesh.receiveShadow = true;
  mesh.renderOrder = 1;
  return mesh;
}

// The island's sea: its rows from a little inland of the shore out past the shelf (the shallows show the sea bed, as
// the lakes do; past the shelf it is opaque), and from the last of them out to FAR all round. Pushed onto the water's
// positions (x, 0, z per vertex, as triangles) and solid (a value per vertex).
export function islandSea(world, pos, solid, FAR = 2600) {
  const P = ringPlan(world);
  if (!P.water) return;
  const rows = P.rows.slice(P.water.from);
  const vert = (x, z, s) => {
    pos.push(x, 0, z);
    solid.push(s);
  };
  const tri = (a, b, c) => {
    // (wound to face up)
    if ((b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]) > 0) for (const p of [a, b, c]) vert(p[0], p[1], p[2]);
    else for (const p of [a, c, b]) vert(p[0], p[1], p[2]);
  };
  const band = (ra, sa, rb, sb, n) => {
    for (let i = 0; i < n; i++) {
      const i1 = (i + 1) % n;
      const a0 = [ra.x[i], ra.z[i], sa], a1 = [ra.x[i1], ra.z[i1], sa];
      const b0 = [rb.x[i], rb.z[i], sb], b1 = [rb.x[i1], rb.z[i1], sb];
      tri(a0, b0, a1);
      tri(a1, b0, b1);
    }
  };
  for (let k = 0; k + 1 < rows.length; k++) band(rows[k], P.water.solid[k], rows[k + 1], P.water.solid[k + 1], rows[k].n);
  // ...and out to the horizon
  const last = rows[rows.length - 1];
  const out = { x: new Float32Array(last.n), z: new Float32Array(last.n) };
  for (let i = 0; i < last.n; i++) [out.x[i], out.z[i]] = perim(i / last.n, FAR);
  band(last, 1, out, 1, last.n);
}
