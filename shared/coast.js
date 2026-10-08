// The island's land and shore, and where the run's two maps lie to each other.
//
// THE ISLAND. The valley a run is played in (world.js) is the 640 m square that is surveyed and walked; the island goes on
// past it to a shore of its own. Its outline is round, never square (shapeOf): a coast that wanders with the bearing,
// cliffs where it comes close and beaches where it stands back, and a ring of hills between the valley floor and the
// sea whose foot and crest wander too. world.js builds the island's ground with islandLand - the valley's relief, the
// hills on it and the fall to the sea - inside the valley and past its edge alike, so the ground runs on across the
// edge unbroken; its heightfield is the part inside, and world.far is the rest, which the client draws (farField: the
// terrain round the valley, the field map's layer round its bake, the minimap). The edge itself is only where the
// survey and the walking stop.
//
// THE CROSSING. The bridge (bridge.js) runs due east from the island to the mainland, BRIDGE.SPANS spans of
// BRIDGE.SPAN m. On the mainland it comes ashore at the Bridgehead (mainland.js: its end at x = COAST + 6, on the
// line z = zb). Its island end stands on a bluff on the island's east shore, LAND m in from the water like its other
// end, on the line through the middle of the valley (island z = 0). So one point of the island's frame is one point of
// the mainland's, and `geography(seed)` turns either into the other. (The mainland's renderer stands a silhouette of
// the island in the fog off the bridge's far end - client/render/bridge.js buildIsland - near enough the same place.)
import { MAP_HALF, WATER_LEVEL } from './constants.js';
import { MAINLAND_SIZE, WORLD } from './acts.js';
import { BRIDGE, planBridge } from './bridge.js';
import { mulberry32, createNoise2D, smoothstep, lerp, clamp } from './rng.js';

export const SHORE = {
  REACH_MIN: 24, // the shore is never nearer than this past the valley's edge (where the hills come down to the sea)...
  REACH_MAX: 210, // ...nor further than this (where they stand furthest back)
  SHELF: 34, // the sea bed falls to its depth over this many metres past a beach (a cliff's goes down sooner)
  DEPTH: 7, // m under the water line: the sea bed off the shore (the mainland's is as deep: mainland.js)
  MARGIN: 246, // past the valley's edge everything of the shore is inside this: the furthest beach and its shelf
  LAND: 6, // the bridge's island end stands this far in from the island's shore, as its mainland end does there
};
// what mainland.js builds the bridge on (scripts/test-coast.js holds these to the mainland it makes)
export const MAINLAND_COAST = -MAINLAND_SIZE / 2 + 78; // x of the mainland's shoreline (mainland.js COAST)
export const BRIDGE_DECK = 9; // the roadway's height: the bluff it lands on (mainland.js BLUFF)
export const BRIDGE_LEN = BRIDGE.SPANS * BRIDGE.SPAN;

// z of the line the bridge runs on in the mainland's frame: the first thing mainland.js draws from its plan's stream
export const bridgeLine = (seed) => mulberry32((seed ^ 0x9e1b3) >>> 0).range(-80, 80);

const LUT = 2048; // the outline, by bearing
const SHAPES = new Map(); // seed -> shape (a world, its map, minimap, terrain and bridge all ask)

// The island's outline for a seed, by bearing (radians from +x towards +z), as radii from the middle of the valley:
//   coast   where the shore is: a wobbly round (a radius and a few harmonics of the bearing), kept off the valley by a
//           rounded square through its corners, REACH_MIN out - so the valley's corners come near it as capes and the
//           middles of its sides stand well back
//   foot    where the island's hills start to rise out of the valley floor: another wobbly round, well inside the
//           valley's edge all the way round (a superellipse, nothing like the square, with a wander of its own)
//   crest   the top of those hills, part of the way from the foot to the shore
// and the hills' height and how much of a cliff (1) or a beach (0) the shore is there. Nothing in it is square: the
// valley's edge is only where the survey, and the walking, stop.
function shapeOf(seed) {
  let s = SHAPES.get(seed);
  if (s) return s;
  const H = MAP_HALF;
  const rng = mulberry32((seed ^ 0x5407e) >>> 0);
  const R0 = rng.range(455, 495);
  const harm = [[2, 34], [3, 30], [4, 18], [5, 16], [7, 10], [11, 6], [17, 3]].map(([k, a]) => [k, a * rng.range(0.7, 1.2), rng.range(0, Math.PI * 2)]);
  const lieH = [[2, 0.35], [3, 0.3], [7, 0.15]].map(([k, a]) => [k, a, rng.range(0, Math.PI * 2)]);
  const footH = [[3, 15], [4, 10], [5, 9], [7, 6], [11, 4]].map(([k, a]) => [k, a * rng.range(0.7, 1.2), rng.range(0, Math.PI * 2)]);
  const hillH = [[2, 0.5], [3, 0.4], [5, 0.3], [9, 0.18]].map(([k, a]) => [k, a, rng.range(0, Math.PI * 2)]);
  const P = 3; // (the nearest the shore comes: a superellipse through the valley's corners, round enough to show none)
  const S = H * 2 ** (1 / P);
  const PF = 2.2; // (the foot's: nearly round, and well inside the valley's edge all the way round)
  const SF = 244;
  const coast = new Float32Array(LUT);
  const reach = new Float32Array(LUT);
  const lie = new Float32Array(LUT);
  const foot = new Float32Array(LUT);
  const crest = new Float32Array(LUT);
  const hill = new Float32Array(LUT);
  for (let i = 0; i < LUT; i++) {
    const a = (i / LUT) * Math.PI * 2;
    const ca = Math.abs(Math.cos(a));
    const sa = Math.abs(Math.sin(a));
    const out = H / Math.max(ca, sa); // (where the way out leaves the valley)
    let R = R0;
    for (const [k, amp, ph] of harm) R += amp * Math.sin(k * a + ph);
    R = Math.max(R, S / (ca ** P + sa ** P) ** (1 / P) + SHORE.REACH_MIN);
    const r = clamp(R - out, SHORE.REACH_MIN, SHORE.REACH_MAX);
    reach[i] = r;
    coast[i] = out + r;
    let c = 1 - (r - SHORE.REACH_MIN) / 120;
    for (const [k, amp, ph] of lieH) c += amp * Math.sin(k * a + ph);
    lie[i] = clamp(c, 0, 1);
    let f = SF / (ca ** PF + sa ** PF) ** (1 / PF);
    for (const [k, amp, ph] of footH) f += amp * Math.sin(k * a + ph);
    foot[i] = Math.min(f, out - 18);
    crest[i] = foot[i] + 0.42 * (coast[i] - foot[i]);
    let h = 0;
    for (const [k, amp, ph] of hillH) h += amp * Math.sin(k * a + ph);
    hill[i] = 23 + 7 * clamp(h, -1, 1);
  }
  // the bridge's island end: on the bearing due east, LAND in from the shore
  s = { coast, reach, lie, foot, crest, hill, end: H + reach[0] - SHORE.LAND };
  SHAPES.set(seed, s);
  if (SHAPES.size > 4) SHAPES.delete(SHAPES.keys().next().value);
  return s;
}

// One point of each frame is the same place: the island's frame is the mainland's moved by (ix, iz), the middle of
// the valley in the mainland's frame.
export function geography(seed) {
  const zb = bridgeLine(seed);
  const end = shapeOf(seed).end; // island x of the bridge's island end
  const x1 = MAINLAND_COAST + SHORE.LAND; // the mainland end of the bridge (the abutment on the Bridgehead's bluff)
  const x0 = x1 - BRIDGE_LEN; // its island end
  const ix = x0 - end;
  const iz = zb;
  return {
    zb,
    end,
    island: { x: ix, z: iz, half: MAP_HALF }, // the middle of the valley, in the mainland's frame
    mainland: { x: 0, z: 0, half: MAINLAND_SIZE / 2 },
    toMainland: (x, z) => [x + ix, z + iz],
    toIsland: (x, z) => [x - ix, z - iz],
    // the bridge's plan in the frame of either map (the same bridge: the same spans, holes and wrecks, moved)
    bridge: (onIsland) => planBridge({ seed, z: onIsland ? 0 : zb, shore: onIsland ? MAINLAND_COAST - ix : MAINLAND_COAST, deckY: BRIDGE_DECK }),
    // what the field map's widest view takes in: both maps and the sea between them, with a little round them; square,
    // as the view is (the mainland goes on north and south past its survey, out of the top and bottom of it)
    extent: (onIsland) => {
      const pad = 40;
      const xa = ix - MAP_HALF - SHORE.MARGIN - pad;
      const xb = MAINLAND_SIZE / 2 + pad;
      let za = Math.min(-MAINLAND_SIZE / 2, iz - MAP_HALF - SHORE.MARGIN) - pad;
      let zb2 = Math.max(MAINLAND_SIZE / 2, iz + MAP_HALF + SHORE.MARGIN) + pad;
      const mid = (za + zb2) / 2;
      za = Math.min(za, mid - (xb - xa) / 2);
      zb2 = Math.max(zb2, mid + (xb - xa) / 2);
      return onIsland ? { x0: xa - ix, x1: xb - ix, z0: za - iz, z1: zb2 - iz } : { x0: xa, x1: xb, z0: za, z1: zb2 };
    },
  };
}

// The mainland's shore as it might be guessed from the sea before anybody has been there: the wander of mainland.js's
// shoreX without the bay and the headland, whose places are only known once the mainland is built. (An outline only:
// the field map draws it as unsurveyed.)
export function mainlandShoreGuess(seed) {
  const nE = createNoise2D(seed + 15);
  const zb = bridgeLine(seed);
  return (z) => MAINLAND_COAST + (nE(z * 0.011, 3.7) * 22 + nE(z * 0.045, 9.1) * 6) * smoothstep(34, 70, Math.abs(z - zb));
}

/**
 * The lie of the island's land (world.js builds its ground with it, inside the valley and past its edge alike):
 *   lift(x, z)       the island's hills: nothing on the valley floor inside their foot, rising to their crest
 *   land(x, z, h)    the ground at (x, z) made of the valley's own relief h there: h with the hills on it, falling past
 *                    the crest to the shore - a beach, or a cliff - and under the sea past that; and the bluff the
 *                    bridge stands on
 *   reach(x, z)      how far past the valley's edge the shore is, on the way out through (x, z)
 *   coast(x, z)      signed metres from the shore along that way (< 0 on land, > 0 at sea)
 *   end              island x of the bridge's island end (on z = 0)
 */
export function islandLand(seed) {
  const H = MAP_HALF;
  const shape = shapeOf(seed);
  // a bearing's place in the tables (a fraction of LUT), and a table read there
  const at = (x, z) => ((Math.atan2(z, x) / (Math.PI * 2) + 1) % 1) * LUT;
  const read = (L, f) => {
    const i = f | 0;
    const t = f - i;
    return L[i % LUT] * (1 - t) + L[(i + 1) % LUT] * t;
  };
  const nz = createNoise2D(seed + 0x5407);
  const end = shape.end;
  const reach = (x, z) => read(shape.reach, at(x, z));
  const coast = (x, z) => Math.hypot(x, z) - read(shape.coast, at(x, z));
  const hillsAt = (x, z, r, f) => {
    const r0 = read(shape.foot, f);
    const r1 = read(shape.crest, f);
    if (r <= r0) return 0;
    const u = Math.min(1, (r - r0) / (r1 - r0));
    // (the hills are no smooth ridge: their height wanders along them, and over them)
    return smoothstep(0, 1, u) * (read(shape.hill, f) + nz(x * 0.012, z * 0.012) * 6 * u);
  };
  const lift = (x, z) => hillsAt(x, z, Math.hypot(x, z), at(x, z));
  // (inside the foot of the hills whichever way: the valley's own ground, and most of the valley is)
  let footMin = Infinity;
  for (let i = 0; i < LUT; i++) footMin = Math.min(footMin, shape.foot[i]);
  const land = (x, z, h0) => {
    const r = Math.hypot(x, z);
    if (r <= footMin && x <= H) return h0;
    const f = at(x, z);
    const rc = read(shape.coast, f);
    const rk = read(shape.crest, f);
    const c = lerp(read(shape.lie, f), 1, x > H ? 1 - smoothstep(14, 34, Math.abs(z)) : 0); // (a cliff under the bridge)
    // (the sea bed: nothing of the land in it)
    if (r >= rc) return WATER_LEVEL - SHORE.DEPTH * smoothstep(0, lerp(SHORE.SHELF, 8, c), r - rc);
    let h = h0 + hillsAt(x, z, r, f);
    if (r > rk) {
      // past the crest down to the top of the beach, then the beach down to the water line, which is the shore. A
      // beach's hillside falls away from the crest and eases out at the sand, so the sea is in sight from the top; a
      // cliff keeps its height and goes down at the end
      const bw = lerp(18, 3, c);
      if (r < rc - bw) h = lerp(h, WATER_LEVEL + 1.3, lerp(1 - (1 - (r - rk) / (rc - bw - rk)) ** 1.7, ((r - rk) / (rc - bw - rk)) ** 2.2, c));
      else h = lerp(WATER_LEVEL + 1.3, WATER_LEVEL, (r - (rc - bw)) / bw);
    }
    // the bluff the bridge stands on, on its line out of the east side: level at the deck's height from a way inland of
    // the abutment out to the shore, which is a cliff there (as the mainland's)
    const w = x > H && Math.abs(z) < 22 ? (1 - smoothstep(9, 22, Math.abs(z))) * smoothstep(end - 46, end - 18, x) : 0;
    return w > 0 ? lerp(h, BRIDGE_DECK, w) : h;
  };
  return { lift, land, reach, coast, end };
}

/**
 * The ground past a world's edge, as the client draws it (the terrain round the valley, the field map's layer round
 * its bake, the minimap): world.far sampled every STEP m over the world's square and MARGIN m round it, the world's
 * own heights inside the edge (so the two meet exactly). Worked out once a world. { x0, z0, step, n, h: Float32Array
 * n*n, at(x, z): bilinear, cubic(x, z): Catmull-Rom (the map's contours stay smooth between samples) }
 */
const FIELDS = new WeakMap();
export const FAR_STEP = 8;
// how far past the map's edge the far field reaches (the woods and the grass out there are grown within it)...
export function farMargin(world) {
  return world.kind === WORLD.MAINLAND ? 200 : Math.ceil(SHORE.MARGIN / FAR_STEP) * FAR_STEP;
}
// ...and how far the field map draws it (on the island all its shore and shallows; on the mainland a band of its far
// country, as far as the closer views can pan - past it the widest view's coarse picture)
export function mapMargin(world) {
  return world.kind === WORLD.MAINLAND ? 100 : farMargin(world);
}
export const FAR_PARTS = 8; // (worked out a band of rows at a time, when the client does it while the page is idle)
const PARTS = new WeakMap(); // world -> the field while it is being worked out { h, n, x0, done: [bool] }
export function farFieldPart(world, k) {
  if (FIELDS.has(world)) return;
  let P = PARTS.get(world);
  if (!P) {
    const H = world.half;
    const M = farMargin(world);
    const n = (2 * (H + M)) / FAR_STEP + 1;
    P = { h: new Float32Array(n * n), n, x0: -H - M, done: new Array(FAR_PARTS).fill(false) };
    PARTS.set(world, P);
  }
  if (P.done[k]) return;
  P.done[k] = true;
  const { h, n, x0 } = P;
  const H = world.half;
  for (let j = Math.floor((k * n) / FAR_PARTS); j < Math.floor(((k + 1) * n) / FAR_PARTS); j++) {
    const z = x0 + j * FAR_STEP;
    for (let i = 0; i < n; i++) {
      const x = x0 + i * FAR_STEP;
      h[j * n + i] = Math.abs(x) <= H && Math.abs(z) <= H ? world.heightAt(x, z) : world.far(x, z);
    }
  }
}
export function farField(world) {
  let F = FIELDS.get(world);
  if (F) return F;
  for (let k = 0; k < FAR_PARTS; k++) farFieldPart(world, k);
  const { h, n, x0 } = PARTS.get(world);
  PARTS.delete(world);
  const step = FAR_STEP;
  const M = farMargin(world);
  const idx = (i, j) => h[clamp(j, 0, n - 1) * n + clamp(i, 0, n - 1)];
  const at = (x, z) => {
    const fx = clamp((x - x0) / step, 0, n - 1.001);
    const fz = clamp((z - x0) / step, 0, n - 1.001);
    const i = fx | 0;
    const j = fz | 0;
    const tx = fx - i;
    const tz = fz - j;
    const a = idx(i, j) + (idx(i + 1, j) - idx(i, j)) * tx;
    const b = idx(i, j + 1) + (idx(i + 1, j + 1) - idx(i, j + 1)) * tx;
    return a + (b - a) * tz;
  };
  const cr = (p0, p1, p2, p3, t) => p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
  const cubic = (x, z) => {
    const fx = clamp((x - x0) / step, 0, n - 1.001);
    const fz = clamp((z - x0) / step, 0, n - 1.001);
    const i = fx | 0;
    const j = fz | 0;
    const tx = fx - i;
    const tz = fz - j;
    const row = (jj) => cr(idx(i - 1, jj), idx(i, jj), idx(i + 1, jj), idx(i + 2, jj), tx);
    return cr(row(j - 1), row(j), row(j + 1), row(j + 2), tz);
  };
  F = { x0, z0: x0, step, n, h, at, cubic, margin: M };
  FIELDS.set(world, F);
  return F;
}

/**
 * The woods past a world's edge, as the client draws them (shared/coast.js farField's ground; nothing
 * of it has a collider, nobody gets there): the world's own forest goes on over the island's hills and into the
 * mainland's far hills by the same odds it was planted by inside (world.flora.treeOdds), as thick as it stands just
 * inside the edge and thinning out further off, so no line of trees marks where the map stops. { trees }: Float32Array,
 * stride 6 [x, y, z, scale, rot, variant], as world.trees is.
 */
const FLORA = new WeakMap();
// (as thick as inside at the edge, thinning out to THIN of it by FADE m past it: nobody comes near any of it, and
// through the haze a few trees read as woods; the scrub is left out - too small to see from inside)
const THIN = 0.22;
const FADE = 140;
const farThin = (d) => 1 - (1 - THIN) * smoothstep(0, FADE, d);
// how many trees a square metre stand past the edge at (x, z), on average (the widest view's woods, too small to dot:
// the same woods as farFlora's, and on past them)
export function farTreeDensity(world) {
  const fl = world.flora;
  if (!fl) return () => 0;
  const k = (fl.tries / (2 * (world.half - 4)) ** 2) * farFlora(world).kT;
  return (x, z) => fl.treeOdds(x, z) * k * farThin(Math.max(Math.abs(x), Math.abs(z)) - world.half);
}
export function farFlora(world) {
  let out = FLORA.get(world);
  if (out) return out;
  out = { trees: new Float32Array(0), kT: 0 };
  FLORA.set(world, out);
  const fl = world.flora;
  if (!fl || !world.far) return out;
  const F = farField(world);
  const H = world.half;
  const lim = H - 4;
  const area = (2 * lim) ** 2;
  const rng = mulberry32((world.seed ^ 0xf10a) >>> 0);
  // how thick it stands in a band just inside the edge, against what its odds alone would give there (the woods are
  // thinned inside by what else wants the ground: the places, the roads, room for each tree)
  const band = (x, z) => {
    const m = Math.max(Math.abs(x), Math.abs(z));
    return m > H - 70 && m < H - 8;
  };
  let want = 0;
  // (the band, every 8 m: round the four sides)
  for (let a = -H + 8; a < H - 8; a += 8) {
    for (let d = 12; d < 70; d += 8) {
      for (const [x, z] of [[a, -H + d], [a, H - d], [-H + d, a], [H - d, a]]) {
        if (!band(x, z) || world.heightAt(x, z) < WATER_LEVEL + 1.5) continue;
        want += fl.treeOdds(x, z) * 64 * (fl.tries / area);
      }
    }
  }
  let have = 0;
  for (let i = 0; i < world.trees.length; i += 6) if (band(world.trees[i], world.trees[i + 2])) have++;
  const kT = want > 0 ? Math.min(1, have / want) : 0;
  out.kT = kT;
  const reach = H + F.margin - 6;
  const ground = (x, z) => {
    const y = F.at(x, z);
    const slope = Math.hypot(F.at(x + 2, z) - F.at(x - 2, z), F.at(x, z + 2) - F.at(x, z - 2)) / 4;
    return y > WATER_LEVEL + 1.6 && slope < 0.75 ? y : null;
  };
  const kinds = fl.kinds;
  const pick = () => {
    let r = rng();
    for (const [v, w] of kinds) if ((r -= w) <= 0) return v;
    return kinds[0][0];
  };
  // every so many square metres a try, as inside, over the ring between the edge and the far field's margin
  const ring = (2 * reach) ** 2 - (2 * H) ** 2;
  const trees = [];
  for (let n = Math.round((ring * fl.tries) / area), a = 0; a < n; a++) {
    const x = (rng() * 2 - 1) * reach;
    const z = (rng() * 2 - 1) * reach;
    const d = Math.max(Math.abs(x), Math.abs(z)) - H;
    if (d <= 0.5) continue;
    if (rng() > fl.treeOdds(x, z) * kT * farThin(d)) continue;
    const y = ground(x, z);
    if (y === null) continue;
    trees.push(x, y, z, 0.75 + rng() * 0.55, rng() * Math.PI * 2, pick());
  }
  out.trees = new Float32Array(trees);
  return out;
}
