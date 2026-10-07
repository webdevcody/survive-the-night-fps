// The island's shore, and where the run's two maps lie to each other. Drawn by the client only (the ground and the sea
// round the island, the bridge seen from its shore, the field map, the minimap): nothing here is simulated, so the
// server never imports it, no collider or spot moves for it, and the world's fingerprint does not change.
//
// THE ISLAND. The valley a run is played in (world.js) is 640 m square, and its ground rises into a ring of hills at
// the edge (edgeRise): that square is all the survey covers and all anybody walks. Past it the island goes on - the
// far side of those hills - down to a shore of its own: cliffs where the hills come close to the sea, beaches where
// they stand back. `islandShore(seed, edgeAt)` is that ground: along every way out from the middle of the valley it
// starts at the height of the valley's edge and falls to the water `reach` metres further on, a reach that wanders
// with the bearing (so the island is round where the valley is square), then the sea bed falls away under the water.
//
// THE CROSSING. The bridge (bridge.js) runs due east from the island to the mainland, BRIDGE.SPANS spans of
// BRIDGE.SPAN m. On the mainland it comes ashore at the Bridgehead (mainland.js: its end at x = COAST + 6, on the
// line z = zb). Its island end stands on a bluff on the island's east shore, LAND m in from the water like its other
// end, on the line through the middle of the valley (island z = 0). So one point of the island's frame is one point of
// the mainland's, and `geography(seed)` turns either into the other. (The mainland's renderer stands a silhouette of
// the island in the fog off the bridge's far end - client/render/bridge.js buildIsland - near enough the same place.)
import { MAP_HALF, WATER_LEVEL } from './constants.js';
import { MAINLAND_SIZE } from './acts.js';
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

const LUT = 2048; // the reach and the lie of the shore, by bearing
const SHAPES = new Map(); // seed -> shape (a world's map, minimap, terrain and bridge all ask)

// The island's outline for a seed, by bearing (radians from +x towards +z): how far past the valley's edge its shore
// is, and how much of a cliff (1) or a beach (0). The shore is a wobbly round - a radius and a few harmonics of the
// bearing - kept off the valley by a rounded square (a superellipse through the valley's corners, REACH_MIN out), so
// the valley's corners come near it as capes, the middles of its sides stand back, and no corner of the square shows.
function shapeOf(seed) {
  let s = SHAPES.get(seed);
  if (s) return s;
  const H = MAP_HALF;
  const rng = mulberry32((seed ^ 0x5407e) >>> 0);
  const R0 = rng.range(455, 495);
  const harm = [[2, 34], [3, 30], [4, 18], [5, 16], [7, 10], [11, 6], [17, 3]].map(([k, a]) => [k, a * rng.range(0.7, 1.2), rng.range(0, Math.PI * 2)]);
  const lieH = [[2, 0.35], [3, 0.3], [7, 0.15]].map(([k, a]) => [k, a, rng.range(0, Math.PI * 2)]);
  const P = 4.5;
  const S = H * 2 ** (1 / P);
  const reach = new Float32Array(LUT);
  const lie = new Float32Array(LUT);
  for (let i = 0; i < LUT; i++) {
    const a = (i / LUT) * Math.PI * 2;
    const ca = Math.abs(Math.cos(a));
    const sa = Math.abs(Math.sin(a));
    let R = R0;
    for (const [k, amp, ph] of harm) R += amp * Math.sin(k * a + ph);
    R = Math.max(R, S / (ca ** P + sa ** P) ** (1 / P) + SHORE.REACH_MIN);
    const r = clamp(R - H / Math.max(ca, sa), SHORE.REACH_MIN, SHORE.REACH_MAX);
    reach[i] = r;
    let c = 1 - (r - SHORE.REACH_MIN) / 120;
    for (const [k, amp, ph] of lieH) c += amp * Math.sin(k * a + ph);
    lie[i] = clamp(c, 0, 1);
  }
  // the bridge's island end: on the bearing due east, LAND in from the shore
  s = { reach, lie, end: H + reach[0] - SHORE.LAND };
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
 * The island past the valley's edge. edgeAt(x, z): the valley's ground at a point of its edge (world.heightAt, or a
 * profile kept of it). Returns:
 *   reach(x, z)     how far past the valley's edge the shore is, on the way out through (x, z)
 *   coast(x, z)     signed metres from the shore along that way (< 0 on land, > 0 at sea)
 *   heightAt(x, z)  the ground outside the valley (inside it: the valley's own heights, not these)
 *   end             island x of the bridge's island end (on z = 0)
 */
export function islandShore(seed, edgeAt) {
  const H = MAP_HALF;
  const shape = shapeOf(seed);
  // a bearing's place in the tables (a fraction of LUT), and a table read there
  const at = (x, z) => ((Math.atan2(z, x) / (Math.PI * 2) + 1) % 1) * LUT;
  const read = (L, f) => {
    const i = f | 0;
    const t = f - i;
    return L[i % LUT] * (1 - t) + L[(i + 1) % LUT] * t;
  };
  // how far past the valley's edge (x, z) is, along the way out through it (0 inside the valley)
  const past = (x, z) => {
    const m = Math.max(Math.abs(x), Math.abs(z));
    return m > H ? Math.hypot(x, z) * (1 - H / m) : 0;
  };
  const nz = createNoise2D(seed + 0x5407);
  // the bluff the bridge stands on, on its line out of the east side: level at the deck's height from a way inland of
  // the abutment out to the shore, which is a cliff there (the bridge stands on it, as on the mainland's)
  const end = shape.end;
  const reach = (x, z) => read(shape.reach, at(x, z));
  const coast = (x, z) => past(x, z) - reach(x, z);
  const heightAt = (x, z) => {
    const m = Math.max(Math.abs(x), Math.abs(z));
    if (m <= H) return edgeAt(x, z);
    const k = H / m;
    const d = Math.hypot(x, z) * (1 - k);
    const f = at(x, z);
    const r = read(shape.reach, f);
    const c = lerp(read(shape.lie, f), 1, x > H ? 1 - smoothstep(14, 34, Math.abs(z)) : 0); // (a cliff under the bridge)
    // (the sea bed: no ground of the valley's edge in it)
    if (d >= r) return WATER_LEVEL - SHORE.DEPTH * smoothstep(0, lerp(SHORE.SHELF, 8, c), d - r);
    const e = edgeAt(x * k, z * k);
    let h;
    // down from the crest of the hills to the top of the beach, then the beach down to the water line, which is at the
    // reach. A beach's hillside falls away from the crest and eases out at the sand, so the sea is in sight from the
    // top; a cliff keeps its height and goes down at the end
    const bw = lerp(18, 3, c);
    if (d < r - bw) {
      const t = d / (r - bw);
      h = lerp(e, WATER_LEVEL + 1.3, lerp(1 - (1 - t) ** 1.7, t ** 2.2, c));
      h += nz(x * 0.018, z * 0.018) * 3.2 * Math.sin(Math.PI * t) ** 2; // (no hill is smooth; nor is it at the crest or the beach)
    } else h = lerp(WATER_LEVEL + 1.3, WATER_LEVEL, (d - (r - bw)) / bw);
    const w = x > H && Math.abs(z) < 22 ? (1 - smoothstep(9, 22, Math.abs(z))) * smoothstep(end - 46, end - 18, x) : 0;
    return w > 0 ? lerp(h, BRIDGE_DECK, w) : h;
  };
  return { reach, coast, heightAt, end };
}

// The valley's edge as a profile (a height every metre round it), for drawing the island where its world is not built:
// edgeAt from it. [north (z = -H, x from -H), south, west (x = -H, z from -H), east]
export function edgeProfile(heightAt) {
  const H = MAP_HALF;
  const n = 2 * H + 1;
  const p = new Float32Array(4 * n);
  for (let i = 0; i < n; i++) {
    p[i] = heightAt(-H + i, -H);
    p[n + i] = heightAt(-H + i, H);
    p[2 * n + i] = heightAt(-H, -H + i);
    p[3 * n + i] = heightAt(H, -H + i);
  }
  return p;
}
export function edgeFromProfile(p) {
  const H = MAP_HALF;
  const n = 2 * H + 1;
  const at = (o, v) => {
    const f = clamp(v + H, 0, n - 1.001);
    const i = f | 0;
    return p[o + i] + (p[o + i + 1] - p[o + i]) * (f - i);
  };
  return (x, z) => (z <= -H + 0.01 ? at(0, x) : z >= H - 0.01 ? at(n, x) : x <= -H + 0.01 ? at(2 * n, z) : at(3 * n, z));
}
