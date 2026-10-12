// The mainland: the second map of a run (act 2, shared/acts.js), built from the same seed as the island the team
// escaped from and with the same kit (worldkit.js), so it is drawn, walked and fought on by the code that runs the
// island. Its layout is "Mainland Layout 12" (issue #232), one to one: mainland-layout.js holds the picture's coast,
// islands, lake, river, mountains, tunnels, roads and places as fractions of the map square, and this file builds
// them at MAINLAND_SIZE (2048 m across). In short:
//
//   the sea and its islands along the west | the bridge from the island comes ashore at the Industrial Docks |
//   Town Center, the two Suburbs, North Coast Village, Pine Lake and the Gas Station on the city side |
//   The Ridge, a range of mountains north to south, and the river down its far side: nobody crosses either |
//   the airport on the far side, reached only by the north road (North Pass, a tunnel; North Ridge Outpost; East
//   Pass) or under the ground (South Forest, the Quarry, the South Passage Mines, under the river)
//
// What a seed changes is what stands in every place and on every lot, and everything scattered: never where a
// place, a road, the coast, the lake, the river or a mountain is.
//
// A world made here has every field createWorld's has (world.js); what the island has and this map does not (the
// railway, the fair, the clinic, the cemetery) is null. On top of those:
//   bridge   where the bridge is (bridge.js): the cutscene drives the car along it, and the client draws it
//   runway   the runway and what stands on it: { x, z, ry (its heading: the plane takes off along -Z turned by it),
//            z0, z1 (its ends along that line, from its middle), half (its half width), y, truck: { x, y, z, ry } }
//   car      is the plane: the thing this act's supplies go into and its final stand is fought at (plane: true)
//   partSpots[i].supply   which of the plane's parts lies there (an index into PLANE_PARTS): they are at set places
//   props[i].live   set on the car at the bridgehead and on the plane: the client draws those two itself, because its
//            cutscenes move them (the car drives to that very spot; the plane is swapped for the one that flies)
//   city     { x, z, pitch, grid, lots: [{ x, z, w, d, ry, what }] }: what was built on every lot of Town Center; and
//            what its buildings are drawn from (buildings, rooms, shells, heaps, fallen, pancakes, signs: see
//            "What the city is drawn from" below, and client/render/citykit.js)
//   parts[i].hidden   a solid that is not drawn as the box it is (the kit draws that building, wall or heap)
//   river    { pts, hw, bridges, flow(x, z) }: its middle line, half its width, where a road crosses it, and its current
//   walls    the outline of every mountain, as the lines its hidden walls stand along: [[x, z, ...], ...]
//   cliffAt(x, z)   how far (x, z) is inside a mountain (m; negative outside it)
//   tunnels  [{ name, a: [x, z], b: [x, z], y0, y1, len }]: the road tunnels, mouth to mouth
//   mine     the South Passage Mines' workings (mine.js), under the river
import { GRID_STEP, WATER_LEVEL } from './constants.js';
import { ZONE, CONT } from './defs.js';
import { PROPS, collidersOf } from './props.js';
import { mulberry32, createNoise2D, fbm, smoothstep, lerp, clamp, hash2 } from './rng.js';
import { makeCyl, makeBox, makeTree, COL } from './collision.js';
import { ROAD } from './layout.js';
import { createKit } from './worldkit.js';
import { WORLD, MAINLAND_SIZE } from './acts.js';
import { POS_SCALE_WIDE } from './protocol.js';
import { planBridge } from './bridge.js';
import { OUTLYING, house } from './mainland-places.js';
import { SEA, LAKE, RIVER, CREEK, MOUNTAINS, TUNNELS, ROADS, PLACES, AREAS, FOREST } from './mainland-layout.js';
import { fillPolys, signedDistance, signedDistanceNear, decodeForest, maskEdges, lineDist } from './mainland-ground.js';
import { planPassage, MINE_R } from './mine.js';
import { dressMine } from './minedress.js';

const PI = Math.PI;
const SIZE = MAINLAND_SIZE;
const HALF = SIZE / 2;
const N = SIZE / GRID_STEP + 1;
const FLOOR = WATER_LEVEL + 1.2; // soft floor of the land (only the sea, the lake and the river hold water)
const BLUFF = 4.5; // the bridge comes ashore on a bluff this high (m over the water line it is BLUFF - WATER_LEVEL): the docks' quays are a little lower

// The city's grid: streets PITCH apart, each STREET wide between the kerbs, GRID blocks each way.
const PITCH = 56;
const STREET = 12;
const GRID = 6;
const BLOCK = PITCH - STREET; // a block is this far across
const PAVED = PITCH - 7.4; // ...and its paving this far: the lots, and a pavement round them out to the kerb of the roadway
const CITY_R = (GRID * PITCH) / 2 + 18; // the levelled ground reaches this far from the middle of the city
const BIG_BLOCKS = 6; // blocks that are one lot each, whatever the seed (the two tallest towers stand on them)...
const QUAD_BLOCKS = 13; // ...and blocks of four small lots (the shops and stations the run needs go on those)
const LONG_BLOCKS = 2; // ...and blocks of two long lots (the car park and the cinema go on those)
const PAVE = 0.1; // a block's paving stands this far over the city's level (the roadway lies a little under it)
const FLOOR_Y = 0.12; // ...and a room's floor this far (Builder.room's slab)
const QUAY_LX = -150; // the docks' quay edge, m west of the middle of the place (where the picture's piers start)
const QUAY_HZ = 128; // ...and how far it runs north and south of it
const LEDGES = 0; // (the mountains' faces stepped in ledges, 0..1: mountainUp - off: they did not read from the ground, and the dead's grid and the hitbox sweep took the steps for standing room)
const SETBACK = 1.2; // a building's front wall stands this far in from the edge of its lot
const HALL_UP = 0.34; // the town hall stands on a plinth this high over the square, its portico up its steps (its floor no higher than the dead's grid walks onto - a slab over half a metre is a deck to server/nav.js)
const CARPARK_DECK = 3.2; // from one deck of the multi-storey car park to the next
const SITE_FLAT = 5.5; // the ground is levelled this far round a roadside site
const ROADBLOCKS = 5; // stretches of street the army barricaded, and died at
const JAMS = 6; // ...and stretches where the traffic stopped for good, bumper to bumper
const SINKHOLES = 2; // ...and where the street fell in
const SMOKES = 9; // columns of smoke standing over the city (world.lights 'smoke'), and FIRES still burning under them
const FIRES = 3;
const JAM_EVERY = 150; // a pile-up on a main road about this often (m)
// what is drawn for a lot nothing was dealt to, by weight: [kind, weight]
// (what a lot the run does not ask for has on it: as the picture draws the town, a building on nearly every one - a
// few ruins and burnt shells, an open lot or a car park here and there)
const SMALL_LOTS = [['grocery', 0.9], ['diner', 0.7], ['pharmacy', 0.4], ['hardware', 0.5], ['liquor', 0.4], ['pawn', 0.3], ['laundry', 0.3], ['bakery', 0.3], ['bar', 0.4], ['books', 0.3], ['flats', 3.6], ['office', 0.9], ['ruin', 0.7], ['burnt', 1.0], ['gas', 0.25], ['green', 0.2]];
const LONG_LOTS = [['terrace', 3], ['block', 3], ['carpark', 0.3], ['parking', 0.15], ['cinema', 0.3], ['warehouse', 1.2]];
const LONGISH = new Set(['car_wreck', 'car_burnt', 'car_open', 'pickup_truck', 'van_wreck', 'ambulance', 'box_truck', 'city_bus', 'army_truck', 'semi_truck', 'police_car', 'taxi']); // (what the streets' traffic is)
const BIG_LOTS = [['collapse', 1.4], ['tower', 1], ['depot', 0.5], ['parking', 0.15]];

// The river: fast water in a ravine. RIVER_HW is the half width it is measured against (riverAt below: the picture's
// own width is in the layout, and riverAt is shifted by it so that RIVER_HW is the bank everywhere).
const RIVER_HW = 9;
const RIVER_REACH = 48; // how far from its banks the river's distance is kept (m)
const RIVER_BANK = 14; // its ravine: the ground comes down to the water over this much
const RIVER_DEPTH = 3.6; // deep enough to be swept off your feet anywhere in it
const RIVER_FLOW = 3.4; // m/s: the current (a survivor swims 2.4, 3.6 flat out)
const BRIDGE_UP = 2.4; // a bridge's deck over the water
const CREEK_HW = 2.2; // the creek north of the airport: shallow, walked through
// The mountains: their outline is a cliff (CLIFF metres within CLIFF_IN of the foot), and along the foot a wall
// nobody sees stands WALL_T thick, so that nothing climbs, drives or is shot over the cliff's lip. (A car at full
// speed moves 1.25 m in a tick: a thin wall would let it through.)
const CLIFF = 18;
const CLIFF_IN = 7;
// Over the cliff a mountain goes on up as a range: its mass rises with the distance in from the foot (MASS at the most,
// most of it within MASS_IN: the line furthest from every foot is the range's crest), and the peaks stand on that
// (PEAK at the most: ridged noise, sharp along its crests, with gullies down the faces). A range is 150-250 m high,
// its highest peaks near 300 m.
const MASS = 150;
const MASS_IN = 65;
const PEAK = 110;
const FOOTHILL = 18; // the ground outside a mountain rises toward its foot by up to this...
const FOOTHILL_IN = 110; // ...over this far (the forested foothills under the cliffs)
const WALL_T = 4;
const WALL_H = 60;
// The road tunnels: a corridor cut through the mountain, CUT_HW either side of the road, a gallery in it TUNNEL_HW
// either side and TUNNEL_H high, and a cutting CUT_LEN long in front of either mouth.
const CUT_HW = 8;
const TUNNEL_HW = 5.6;
const TUNNEL_H = 6.6;
const CUT_LEN = 34;

// The airport (the local frame of its runway: the plane at its south end facing along -Z, the frame turned by AIR.ry
// as the picture's runway is turned off north)
const RUNWAY_LEN = 320;
const RUNWAY_HALF = 12;

// vegetation: the island's variants (TREE_TYPES / ROCK_TYPES in world.js, by index)
const TREE_R = [0.42, 0.4, 0.38, 0.3, 0.3, 0.24, 0.34];
const ROCK_R = [0.9, 1.2, 0.7];

// a point of the picture (fractions of the map square) -> world metres
const FX = (f) => (f - 0.5) * SIZE;
const P = (p) => [FX(p[0]), FX(p[1])];

export function createMainland(seed) {
  const rng = mulberry32((seed ^ 0x3a17d) >>> 0); // (streams of its own: the island of the same seed draws from others)
  const nA = createNoise2D(seed + 11);
  const nB = createNoise2D(seed + 12);
  const nD = createNoise2D(seed + 14);
  const nE = createNoise2D(seed + 15);
  const nP = createNoise2D(seed + 16);
  const prng = mulberry32((seed ^ 0x9e1b3) >>> 0);

  // ---------------------------------------------------------------- the plan
  const G2 = (GRID * PITCH) / 2; // from the middle of the city to its edge streets
  // Town Center: the picture's grid inside its ring road. The city's grid of GRID x GRID blocks stands where that is
  // (its edge streets are the ring road), and a road of the picture that comes to the ring comes to the city's edge
  // at the same place along it - on the street nearest that, so it carries on down one.
  const RING = [0.257, 0.397, 0.402, 0.528];
  const city = { x: FX(0.3295), z: FX(0.455) };
  const onRing = (p) => p[0] >= RING[0] - 0.006 && p[0] <= RING[2] + 0.006 && p[1] >= RING[1] - 0.006 && p[1] <= RING[3] + 0.006;
  const snap = (v) => Math.round(v / PITCH) * PITCH;
  // (the city's grid is a little bigger than the picture's ring: what stands just outside the ring is pushed out with
  // it, less and less the further out it is, so that it stays outside the city and nothing further off moves)
  const RC = [(RING[0] + RING[2]) / 2, (RING[1] + RING[3]) / 2];
  const RH = [(RING[2] - RING[0]) / 2, (RING[3] - RING[1]) / 2];
  const GROW = [G2 / (RH[0] * SIZE), G2 / (RH[1] * SIZE)];
  const WARP = 0.07; // (fractions of the map past the ring where the push has died away)
  const W = (p) => {
    if (!onRing(p)) {
      const d = Math.hypot(Math.max(0, Math.abs(p[0] - RC[0]) - RH[0]), Math.max(0, Math.abs(p[1] - RC[1]) - RH[1]));
      if (d >= WARP) return P(p);
      const t = smoothstep(0, WARP, d);
      const at = (k) => FX(RC[k]) + (p[k] - RC[k]) * SIZE * lerp(GROW[k], 1, t) + (k ? city.z - FX(RC[1]) : city.x - FX(RC[0])) * (1 - t);
      return [at(0), at(1)];
    }
    let lx = ((clamp(p[0], RING[0], RING[2]) - RING[0]) / (RING[2] - RING[0])) * GRID * PITCH - G2;
    let lz = ((clamp(p[1], RING[1], RING[3]) - RING[1]) / (RING[3] - RING[1])) * GRID * PITCH - G2;
    // (on the ring: out to the edge street it is on, along it to the nearest crossing)
    const ex = Math.min(lx + G2, G2 - lx);
    const ez = Math.min(lz + G2, G2 - lz);
    if (ex < ez) {
      lx = lx < 0 ? -G2 : G2;
      lz = snap(lz);
    } else {
      lz = lz < 0 ? -G2 : G2;
      lx = snap(lx);
    }
    return [city.x + lx, city.z + lz];
  };
  const zb = FX(0.443); // where the bridge comes ashore...
  const SHORE = FX(0.2); // ...and the shore it comes to there
  const head = { x: SHORE + 44, z: zb };
  const inCity = (x, z, pad) => Math.abs(x - city.x) < G2 + pad && Math.abs(z - city.z) < G2 + pad;
  // The picture's Town Center: a plain grid, and in its middle a square, the town hall on it. The four blocks round
  // the middle are the square (Main Street runs through it; the cross street does not). (bi, bj: a block's column and
  // row.) The blocks on the diagonals once had avenues through them, corner to corner, out to the ring: they are
  // ordinary blocks now, of small lots, and come last in the blocks' shuffle so that it deals the others as it did.
  const SQ0 = GRID / 2 - 1, SQ1 = GRID / 2;
  const onSquare = (bi, bj) => bi >= SQ0 && bi <= SQ1 && bj >= SQ0 && bj <= SQ1;
  const onDiagonal = (bi, bj) => !onSquare(bi, bj) && (bi === bj || bi + bj === GRID - 1);
  // ...and its ring road is no square: as the picture draws it, it runs down the grid's edges and rounds each corner on
  // a curve of RING_R about the square's corner (RING_C in from the edge each way). Inside a corner the ring takes
  // the corner block and the outer corner of the two blocks beside it, whose paving follows the curve and whose lot
  // there is given up. (lx, lz: in the city's frame)
  const RING_R = 2 * PITCH;
  const RING_C = G2 - RING_R;
  const ringAt = (a) => (a <= RING_C ? G2 : RING_C + Math.sqrt(Math.max(0, RING_R * RING_R - (Math.min(a, G2) - RING_C) ** 2))); // (how far out the ring is, at |x| (or |z|) = a)
  const inRing = (lx, lz, margin = 0) => {
    const ax = Math.abs(lx), az = Math.abs(lz);
    if (ax > RING_C && az > RING_C) return Math.hypot(ax - RING_C, az - RING_C) <= RING_R - margin;
    return ax <= G2 - margin && az <= G2 - margin;
  };
  const RING_DIAG = RING_C + RING_R / Math.SQRT2; // (where the ring crosses a diagonal, each way from the middle)
  // ...and round it all the outer ring, as the picture draws the town's: out past the grid's own ring by thirty to fifty
  // metres to the north, the east and the south, never the same width twice, and into it on the west, where the bridge
  // and the docks come. Between the two the suburbs' lanes and houses come up to the grid. (a: the angle from the
  // middle, atan2(lz, lx))
  const RIN = new Float32Array(721); // (how far out the grid's ring is, every half degree)
  for (let k = 0; k <= 720; k++) {
    const a = (k / 720) * 2 * PI - PI;
    let lo = 0, hi = 260;
    for (let it = 0; it < 30; it++) {
      const m = (lo + hi) / 2;
      if (inRing(Math.cos(a) * m, Math.sin(a) * m, 0)) lo = m;
      else hi = m;
    }
    RIN[k] = lo;
  }
  const rIn = (a) => {
    const f = ((a + PI) / (2 * PI)) * 720;
    const k = Math.max(0, Math.min(719, Math.floor(f)));
    return RIN[k] + (RIN[k + 1] - RIN[k]) * (f - k);
  };
  const BAND_A = 0.7 * PI; // (past this angle either way - the west - the two rings are one)
  const bandW = (a) => (1 - smoothstep(0.52 * PI, BAND_A, Math.abs(a))) * (40 + 7 * Math.sin(3 * a + 1) + 5 * Math.sin(5 * a + 2));
  const rOut = (a) => rIn(a) + bandW(a);
  const goneBlock = (bi, bj) => (bi === 0 || bi === GRID - 1) && (bj === 0 || bj === GRID - 1); // (a corner: the ring's)
  const trimBlock = (bi, bj) => !goneBlock(bi, bj) && (bi === 0 || bi === GRID - 1 || bj === 0 || bj === GRID - 1) && (bi <= 1 || bi >= GRID - 2) && (bj <= 1 || bj >= GRID - 2);
  const cityW = [city.x - G2, city.z];
  const cityE = [city.x + G2, city.z];

  // ---- the airport: the runway's frame. The picture's runway runs from AIR_S (its south end) to AIR_N
  const AIR_S = P(PLACES.rwS);
  const AIR_N = P(PLACES.rwN);
  const AIR = { x: (AIR_S[0] + AIR_N[0]) / 2, z: (AIR_S[1] + AIR_N[1]) / 2, ry: Math.atan2(-(AIR_N[0] - AIR_S[0]), -(AIR_N[1] - AIR_S[1])) };
  const ac = Math.cos(AIR.ry);
  const as = Math.sin(AIR.ry);
  // the airport's frame -> world, and back (as a Builder at AIR turned by AIR.ry has it)
  const aw = (lx, lz) => [AIR.x + ac * lx + as * lz, AIR.z - as * lx + ac * lz];
  const al = (x, z) => [ac * (x - AIR.x) - as * (z - AIR.z), as * (x - AIR.x) + ac * (z - AIR.z)];
  const field = { x: AIR.x, z: AIR.z };
  const plane = aw(0, RUNWAY_LEN / 2 - 26);
  const APRON = { lx: 44, lz: 62, hx: 30, hz: 70 }; // (a rectangle of concrete east of the runway's south half)
  const HANGARS_AT = { lx: 96, lz: 70 };
  const TERMINAL_AT = { lx: -76, lz: -96 };
  const DEPOT_AT = { lx: 168, lz: -84 };
  const GATE_AT = { lx: -106, lz: -96 }; // where the road in from East Pass comes through the perimeter
  const FENCE = { x0: -100, x1: 128, z0: -176, z1: 172 }; // the perimeter, in the runway's frame (its south-west corner is the river's bank)
  const onField = (x, z, pad) => {
    const [lx, lz] = al(x, z);
    return lx > FENCE.x0 - pad && lx < FENCE.x1 + pad && lz > FENCE.z0 - pad && lz < FENCE.z1 + pad;
  };

  // ---- the water. The sea and the lake are the picture's outlines filled onto the heightfield; sd: signed distance
  // from their shore in metres (positive out on the water)
  const toW = (polys) => polys.map((poly) => poly.map(P));
  let seaMask = fillPolys(toW(SEA), N, GRID_STEP, HALF);
  let lakeMask = fillPolys(toW(LAKE), N, GRID_STEP, HALF);
  const seaD = signedDistance(seaMask, N, GRID_STEP, 160);
  const lakeD = signedDistanceNear(lakeMask, N, GRID_STEP, 80);
  const vi = (x) => clamp(Math.round((x + HALF) / GRID_STEP), 0, N - 1);
  const seaAt = (x, z) => seaD[vi(z) * N + vi(x)];
  const lakeAt = (x, z) => lakeD[vi(z) * N + vi(x)];
  // the islets: land the mainland's own does not join (a flood fill of the land from the middle of the city), 1 in the
  // sea, 2 in Pine Lake
  let islets = new Uint8Array(N * N);
  {
    const q = new Int32Array(N * N);
    const seen = new Uint8Array(N * N);
    let tail = 0;
    const k0 = vi(city.z) * N + vi(city.x);
    seen[k0] = 1;
    q[tail++] = k0;
    for (let h = 0; h < tail; h++) {
      const k = q[h];
      const i = k % N;
      for (let m = 0; m < 4; m++) {
        const nk = m === 0 ? (i > 0 ? k - 1 : -1) : m === 1 ? (i < N - 1 ? k + 1 : -1) : m === 2 ? k - N : k + N;
        if (nk < 0 || nk >= N * N || seen[nk] || seaMask[nk] || lakeMask[nk]) continue;
        seen[nk] = 1;
        q[tail++] = nk;
      }
    }
    for (let k = 0; k < N * N; k++) if (!seen[k] && !seaMask[k] && !lakeMask[k]) islets[k] = lakeD[k] > seaD[k] ? 2 : 1;
  }
  const isletAt = (x, z) => islets[vi(z) * N + vi(x)];
  // The river: a line through the picture's points (a point every few metres), run on past the south edge. riverD:
  // how far every vertex of the heightfield is from its bank, as if it were RIVER_HW wide everywhere (its width
  // changes as the picture's does; out to 110 m, further is 1e4).
  const riverPts = [];
  const riverW = [];
  {
    const ctrl = RIVER.map(([x, y, w]) => [FX(x), FX(y), Math.max(6.5, w * SIZE)]);
    const last = ctrl[ctrl.length - 1];
    const prev = ctrl[ctrl.length - 2];
    const ex = last[0] - prev[0];
    const ez = last[1] - prev[1];
    const el = Math.hypot(ex, ez);
    ctrl.push([last[0] + (ex / el) * 60, last[1] + (ez / el) * 60, last[2]]);
    for (let i = 0; i < ctrl.length - 1; i++) {
      const [p0, p1, p2, p3] = [ctrl[Math.max(0, i - 1)], ctrl[i], ctrl[i + 1], ctrl[Math.min(ctrl.length - 1, i + 2)]];
      const steps = Math.max(2, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 4));
      for (let s = 0; s < steps; s++) {
        const t = s / steps;
        const f = (a, b, c, d) => 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (3 * b - a - 3 * c + d) * t * t * t);
        riverPts.push(f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1]));
        riverW.push(lerp(p1[2], p2[2], t));
      }
    }
    riverPts.push(ctrl[ctrl.length - 1][0], ctrl[ctrl.length - 1][1]);
    riverW.push(ctrl[ctrl.length - 1][2]);
  }
  // (out to RIVER_REACH from its banks - nothing asks further than 30 m - and 1e4 past that)
  const riverD = new Float32Array(N * N).fill(1e4);
  const reach = RIVER_REACH + Math.max(0, Math.max(...riverW) - RIVER_HW);
  for (let s = 0; s < riverPts.length / 2 - 1; s++) {
    const [ax, az, bx, bz] = [riverPts[s * 2], riverPts[s * 2 + 1], riverPts[s * 2 + 2], riverPts[s * 2 + 3]];
    const el2 = (bx - ax) ** 2 + (bz - az) ** 2 || 1;
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - reach + HALF) / GRID_STEP));
    const i1 = Math.min(N - 1, Math.ceil((Math.max(ax, bx) + reach + HALF) / GRID_STEP));
    const j0 = Math.max(0, Math.floor((Math.min(az, bz) - reach + HALF) / GRID_STEP));
    const j1 = Math.min(N - 1, Math.ceil((Math.max(az, bz) + reach + HALF) / GRID_STEP));
    for (let j = j0; j <= j1; j++) {
      const z = -HALF + j * GRID_STEP;
      for (let i = i0; i <= i1; i++) {
        const x = -HALF + i * GRID_STEP;
        const t = clamp(((x - ax) * (bx - ax) + (z - az) * (bz - az)) / el2, 0, 1);
        const ex = x - ax - (bx - ax) * t;
        const ez = z - az - (bz - az) * t;
        const w = lerp(riverW[s], riverW[s + 1], t) - RIVER_HW;
        const lim = Math.min(RIVER_REACH, riverD[j * N + i]) + w; // (no nearer than what is there already: no root taken)
        if (lim <= 0 || ex * ex + ez * ez >= lim * lim) continue;
        const d = Math.hypot(ex, ez) - w;
        if (d < RIVER_REACH && d < riverD[j * N + i]) riverD[j * N + i] = d;
      }
    }
  }
  const riverAt = (x, z) => riverD[vi(z) * N + vi(x)];
  // which way the river runs at (x, z), and how far from its bank (as riverAt): { d, dx, dz, cx, cz }
  const riverP = new Float32Array(riverPts);
  // (and the nearest point of its middle line: cx, cz)
  const flow = (x, z) => {
    const { leg, t } = lineDist(riverP, x, z);
    const ex = riverP[leg * 2 + 2] - riverP[leg * 2];
    const ez = riverP[leg * 2 + 3] - riverP[leg * 2 + 1];
    const el = Math.hypot(ex, ez) || 1;
    return { d: riverAt(x, z), dx: ex / el, dz: ez / el, cx: riverP[leg * 2] + ex * t, cz: riverP[leg * 2 + 1] + ez * t };
  };
  const creekP = new Float32Array(CREEK.flatMap(P));
  const creekBox = [Infinity, Infinity, -Infinity, -Infinity];
  for (let k = 0; k < creekP.length; k += 2) creekBox.splice(0, 4, Math.min(creekBox[0], creekP[k] - 16), Math.min(creekBox[1], creekP[k + 1] - 16), Math.max(creekBox[2], creekP[k] + 16), Math.max(creekBox[3], creekP[k + 1] + 16));
  const creekAt = (x, z) => (x < creekBox[0] || z < creekBox[1] || x > creekBox[2] || z > creekBox[3] ? 1e4 : lineDist(creekP, x, z).d);

  // ---- the mountains: every outline filled (one over another is still mountain), less the river's deep water where it
  // runs at their foot. tunnels: where a road goes through one, the corridor it is cut along.
  // (a foot is no straight line between the points it was traced by: every outline is cut into lengths of WOB_LEN and
  // each point moved in or out along the outline's normal by up to WOB metres, by a noise of the ground there)
  let mtnMask = new Uint8Array(N * N);
  const WOB = 9;
  const WOB_LEN = 6;
  for (const m of MOUNTAINS) {
    const pts = m.pts.map(P);
    const out = [];
    for (let a = 0; a < pts.length; a++) {
      const [ax, az] = pts[a];
      const [bx, bz] = pts[(a + 1) % pts.length];
      const len = Math.hypot(bx - ax, bz - az);
      const steps = Math.max(1, Math.ceil(len / WOB_LEN));
      for (let k = 0; k < steps; k++) {
        const x = ax + ((bx - ax) * k) / steps;
        const z = az + ((bz - az) * k) / steps;
        // (out along the edge's normal; on the map's edge the outline stays where it is)
        const w = Math.abs(x) > HALF - 1 || Math.abs(z) > HALF - 1 ? 0 : WOB * fbm(nP, x * 0.016 + 11.1, z * 0.016 - 5.5, 2);
        out.push([x - ((bz - az) / (len || 1)) * w, z + ((bx - ax) / (len || 1)) * w]);
      }
    }
    fillPolys([out], N, GRID_STEP, HALF, mtnMask, true);
  }
  // (the river's deep water is no mountain; its banks under a cliff are, so the wall at a cliff's foot stands in the
  // water and no strip of bank runs along under it)
  for (let k = 0; k < N * N; k++) if (riverD[k] < RIVER_HW - 2.5 || seaMask[k] || lakeMask[k]) mtnMask[k] = 0;
  const tunnels = TUNNELS.map((t) => {
    const a = P(t.a);
    const b = P(t.b);
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return { name: t.name, a, b, len, dx: (b[0] - a[0]) / len, dz: (b[1] - a[1]) / len };
  });
  // how far (x, z) is from the line of a tunnel's road and along it (from mouth a), over its cuttings
  const tunnelOf = (x, z, pad = 0) => {
    for (const t of tunnels) {
      const s = (x - t.a[0]) * t.dx + (z - t.a[1]) * t.dz;
      if (s < -CUT_LEN - pad || s > t.len + CUT_LEN + pad) continue;
      const lat = Math.abs(-(x - t.a[0]) * t.dz + (z - t.a[1]) * t.dx);
      if (lat < CUT_HW + pad) return { t, s, lat };
    }
    return null;
  };
  let cut = new Uint8Array(N * N); // the corridors, where they are in a mountain
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const k = j * N + i;
      if (mtnMask[k] && tunnelOf(-HALF + i * GRID_STEP, -HALF + j * GRID_STEP)) cut[k] = 1;
    }
  }
  let wallMask = new Uint8Array(N * N);
  for (let k = 0; k < N * N; k++) wallMask[k] = mtnMask[k] && !cut[k] ? 1 : 0;
  const mtnD = signedDistance(wallMask, N, GRID_STEP, 260);
  // The heights go by the mountains as they are drawn, the tunnels' corridors and all (mtnH): the mountain is whole
  // up to the edge of a corridor, which is cut down into it afterwards, and the cap over the gallery is that whole
  // mountain (below). The walls, and everything that asks how far it is inside a mountain (cliffAt), go by the
  // mountains less the corridors (mtnD).
  // (near a foot the distance is smoothed - a 5 x 5 box, twice - so that the cliff over it does not rise in 2 m steps
  // where the foot runs aslant of the grid)
  const mtnH = signedDistance(mtnMask, N, GRID_STEP, 260);
  for (let pass = 0; pass < 2; pass++) {
    const src = mtnH.slice();
    for (let j = 2; j < N - 2; j++) {
      for (let i = 2; i < N - 2; i++) {
        const k = j * N + i;
        if (src[k] > 24 || src[k] < -24) continue;
        let s = 0;
        for (let dj = -2 * N; dj <= 2 * N; dj += N) s += src[k + dj - 2] + src[k + dj - 1] + src[k + dj] + src[k + dj + 1] + src[k + dj + 2];
        mtnH[k] = s / 25;
      }
    }
  }
  const cliffAt = (x, z) => mtnD[vi(z) * N + vi(x)];
  const mtnAt = (x, z) => mtnH[vi(z) * N + vi(x)];

  // ---- the forest of the picture, as a field over the map (0 none .. 1 dense)
  const FOR = decodeForest(FOREST);
  const forestAt = (x, z) => {
    const n = FOREST.n;
    const fx = clamp(((x + HALF) / SIZE) * n - 0.5, 0, n - 1.001);
    const fz = clamp(((z + HALF) / SIZE) * n - 0.5, 0, n - 1.001);
    const i = fx | 0;
    const j = fz | 0;
    const u = fx - i;
    const v = fz - j;
    const a = FOR[j * n + i] + (FOR[j * n + i + 1] - FOR[j * n + i]) * u;
    const b = FOR[(j + 1) * n + i] + (FOR[(j + 1) * n + i + 1] - FOR[(j + 1) * n + i]) * u;
    return (a + (b - a) * v) / 9;
  };

  // ---- the places. Each where the picture has it, on ground of its own (flat: how far it is levelled)
  const spots = [];
  const spot = (id, at, flat, ry = 0, more = {}) => {
    const sp = { id, x: at[0], z: at[1], flat, ry, ...more };
    spots.push(sp);
    return sp;
  };
  // (which way a place faces: its front (-Z) to a point, a quarter turn at a time - its walls lie along the nav grid)
  const facing = (from, to) => Math.round(Math.atan2(from[0] - to[0], from[1] - to[1]) / (PI / 2)) * (PI / 2);
  spot(ZONE.BRIDGEHEAD, [head.x, head.z], 26, -PI / 2);
  const docks = spot(ZONE.INDUSTRIAL, P([0.222, 0.565]), 58, 0);
  spot(ZONE.SUBURB, W(PLACES.suburbsNE), 44, 0);
  spot(ZONE.WESTGATE, W(PLACES.suburbsE), 44, 0);
  spot(ZONE.NORTH_COAST, P([0.212, 0.142]), 52, 0);
  const gas = W([0.512, 0.596]);
  spot(ZONE.TRUCKSTOP, gas, 30, facing(gas, W([0.507, 0.612])));
  spot(ZONE.OUTPOST, P([0.903, 0.152]), 50, 0);
  spot(ZONE.TERMINAL, aw(TERMINAL_AT.lx, TERMINAL_AT.lz), 30, AIR.ry + PI / 2);
  spot(ZONE.HANGARS, aw(HANGARS_AT.lx, HANGARS_AT.lz), 50, AIR.ry + PI / 2); // (their doors face west: the apron)
  spot(ZONE.FUEL_DEPOT, aw(DEPOT_AT.lx, DEPOT_AT.lz), 31, AIR.ry - PI / 2); // (to the corners of its fence)
  const quarry = spot(ZONE.AGGREGATES, P([0.585, 0.834]), OUTLYING[ZONE.AGGREGATES].flat, 0);
  spot(ZONE.PASSAGE, P([0.833, 0.788]), 34, 0);
  spot(ZONE.SOUTH_FOREST, P(PLACES.camp1), 14, 0);
  {
    const lh = P(PLACES.lighthouse);
    spot(ZONE.LIGHTHOUSE, lh, 12, facing(lh, P([0.098, 0.718]))); // (its front to the islet's middle)
  }
  // the picture's lesser buildings: the marina's dock on the lake's south shore, the cabins and the logging road on
  // its east shore, the firehouse's yard east of the suburbs
  {
    const m = P(PLACES.marinaS);
    const lc = P(PLACES.lake);
    spot(ZONE.MARINA, m, OUTLYING[ZONE.MARINA].flat, Math.atan2(lc[0] - m[0], lc[1] - m[1]), { fixed: true }); // (its pier, +Z, out over the water)
  }
  {
    const lc = P([0.630, 0.236]);
    spot(ZONE.LOGGING, lc, OUTLYING[ZONE.LOGGING].flat, facing(lc, P([0.626, 0.214]))); // (between the lake and the Ridge, its front to the road)
  }
  spot(ZONE.FIREHOUSE, W([0.569, 0.541]), OUTLYING[ZONE.FIREHOUSE].flat, 0);
  const camps = [P(PLACES.camp2), P(PLACES.camp3)];
  // the portals of the South Passage Mines (the workings are cut once everything else stands: below)
  const passageW = P(PLACES.mineB);
  const passageE = P([0.805, 0.8]); // (the other two camps of South Forest: sites, below)

  const zones = [];
  const put = (id, x, z, ry, spec) => zones.push({ id, x, z, ry, h: 0, blend: 26, ...spec });
  put(ZONE.CITY, city.x, city.z, 0, { flat: CITY_R, clear: CITY_R + 6, blend: 34, dirt: 1 });
  const SPECS = {
    [ZONE.BRIDGEHEAD]: { clear: 30, dirt: 0.35, blend: 22 }, // (its front faces east: inland)
    [ZONE.INDUSTRIAL]: { clear: 62, dirt: 0.8, blend: 20 },
    [ZONE.SUBURB]: { clear: 0, dirt: 0.15, blend: 40 },
    [ZONE.WESTGATE]: { clear: 0, dirt: 0.15, blend: 40 },
    [ZONE.NORTH_COAST]: { clear: 0, dirt: 0.2, blend: 30 },
    [ZONE.TRUCKSTOP]: { clear: 34, dirt: 0.3 },
    [ZONE.OUTPOST]: { clear: 16, dirt: 0.5 }, // (the woods come up to its wire: inside it is cleared, below)
    [ZONE.TERMINAL]: { clear: 36 }, // (its front faces west: the road in)
    [ZONE.HANGARS]: { clear: 54 },
    [ZONE.FUEL_DEPOT]: { clear: 32, dirt: 0.5 },
    [ZONE.PASSAGE]: { clear: 30, dirt: 0.7 },
    [ZONE.SOUTH_FOREST]: { clear: 10, dirt: 0.3, blend: 10 },
    [ZONE.LIGHTHOUSE]: { clear: 10, dirt: 0.2, blend: 6 },
  };
  for (const sp of spots) {
    const o = OUTLYING[sp.id];
    put(sp.id, sp.x, sp.z, sp.ry, { flat: sp.flat, fixed: sp.fixed, ...(o ? { clear: o.clear, dirt: o.dirt, raise: o.raise, inner: o.inner, street: o.street } : SPECS[sp.id]) });
  }
  const zoneById = {};
  for (const z of zones) zoneById[z.id] = z;
  // the lake, for whatever asks where it is (its middle and how far its shore is from that, about)
  const lake = { x: FX(PLACES.lake[0]), z: FX(PLACES.lake[1]), r: 0.1 * SIZE };
  const ponds = [];

  // ---------------------------------------------------------------- terrain
  // Lowland along the coast that rises into wooded hills inland; the mountains stand out of it on cliffs.
  const relief = (x, z) => fbm(nA, x * 0.0028, z * 0.0028, 4) * 9 + fbm(nB, x * 0.013, z * 0.013, 3) * 2.4 + (1 - Math.abs(nE(x * 0.006 + 5.1, z * 0.006 - 2.3))) ** 2 * 3;
  // the peaks: ridged noise (1 - |n| is sharp along the noise's zero lines: crests), a broad octave for the peaks, a
  // finer one for the spurs off them and a third for the gullies down their faces
  const ridged = (x, z) => {
    const a = 1 - Math.abs(nD(x * 0.0072, z * 0.0072));
    const b = 1 - Math.abs(nE(x * 0.019 + 3.3, z * 0.019 - 7.1));
    const c = 1 - Math.abs(nP(x * 0.047 - 1.9, z * 0.047 + 4.4));
    return a * a * a * 0.62 + b * b * (0.12 + 0.18 * a) + c * c * 0.08;
  };
  const RL = 4;
  const RLN = SIZE / RL + 2;
  let reliefGrid = new Float32Array(RLN * RLN);
  for (let j = 0; j < RLN; j++) for (let i = 0; i < RLN; i++) reliefGrid[j * RLN + i] = relief(-HALF + i * RL, -HALF + j * RL);
  const reliefAt = (x, z) => {
    const fx = clamp((x + HALF) / RL, 0, RLN - 1.001);
    const fz = clamp((z + HALF) / RL, 0, RLN - 1.001);
    const i = fx | 0;
    const j = fz | 0;
    const k = j * RLN + i;
    const a = reliefGrid[k] + (reliefGrid[k + 1] - reliefGrid[k]) * (fx - i);
    const b = reliefGrid[k + RLN] + (reliefGrid[k + RLN + 1] - reliefGrid[k + RLN]) * (fx - i);
    return a + (b - a) * (fz - j);
  };
  const H0 = (x, z) => {
    const micro = fbm(nD, x * 0.09, z * 0.09, 2) * 0.22;
    const inland = smoothstep(-10, 260, -seaAt(x, z)); // (how far it is from the sea)
    const hills = 0.35 + forestAt(x, z) * 0.75;
    const a = (FLOOR + 1 + inland * (3 + Math.max(0, reliefAt(x, z)) * hills) - FLOOR) * 0.9;
    return FLOOR + 0.5 * (a + Math.sqrt(a * a + 4)) + micro + foothill(x, z, mtnAt(x, z)) * smoothstep(-10, 80, -seaAt(x, z));
  };
  // inside a mountain: the cliff at its foot, then the range over it - its mass up to the crest, the peaks on that
  // (the cliff is no even band: its height and how far in it climbs come and go along the foot, and over it the
  // mountain goes on up at once; a range rises and falls along its length)
  // A range is a row of peaks, as the picture draws it: pyramids, each of four faces turned its own way (a face is a
  // plane falling away from the summit at PEAK_SLOPE; where two meet is an arete, between two peaks a saddle), put down a
  // PEAK_GAP apart over every mountain where it is wide enough, the higher the further in. The pyramids are held under
  // the range's envelope - the cliff at the foot, then the mass up to the crest - so the foot follows the outline.
  const PEAK_GAP = 64;
  const PEAK_SLOPE = 1.25;
  const peaks = []; // [x, z, height, c0, s0, c1, s1] (the faces' directions: (c0, s0), (c1, s1) and their opposites)
  const peakCells = new Map(); // 128 m cells -> the peaks whose pyramid reaches into them
  {
    const pr = mulberry32((seed ^ 0x51ee7) >>> 0);
    for (let gz = -HALF; gz < HALF; gz += PEAK_GAP) {
      for (let gx = -HALF; gx < HALF; gx += PEAK_GAP) {
        const x = gx + pr() * PEAK_GAP;
        const z = gz + pr() * PEAK_GAP;
        const r0 = pr();
        const a = pr() * PI;
        const t = (pr() - 0.5) * 0.7;
        const d = mtnH[vi(z) * N + vi(x)];
        if (d < 22) continue;
        const h = (Math.min(d, 150) * 1.15 + 70) * (0.72 + 0.56 * r0);
        peaks.push([x, z, h, Math.cos(a), Math.sin(a), Math.cos(a + PI / 2 + t), Math.sin(a + PI / 2 + t)]);
      }
    }
    for (const pk of peaks) {
      const reach = pk[2] / PEAK_SLOPE;
      for (let ci = Math.floor((pk[0] - reach) / 128); ci <= Math.floor((pk[0] + reach) / 128); ci++) {
        for (let cj = Math.floor((pk[1] - reach) / 128); cj <= Math.floor((pk[1] + reach) / 128); cj++) {
          const key = ci * 1024 + cj;
          if (!peakCells.has(key)) peakCells.set(key, []);
          peakCells.get(key).push(pk);
        }
      }
    }
  }
  const pyramids = (x, z) => {
    let best = 0;
    for (const pk of peakCells.get(Math.floor(x / 128) * 1024 + Math.floor(z / 128)) || []) {
      const dx = x - pk[0];
      const dz = z - pk[1];
      const e = Math.hypot(dx, dz);
      if (pk[2] - PEAK_SLOPE * e * 0.75 <= best) continue;
      const f = Math.max(Math.abs(dx * pk[3] + dz * pk[4]), Math.abs(dx * pk[5] + dz * pk[6]));
      const h = pk[2] - PEAK_SLOPE * (f * 0.7 + e * 0.3);
      if (h > best) best = h;
    }
    return best;
  };
  const mountainUp = (x, z, d) => {
    if (d <= 0) return 0;
    const v = 0.5 + 0.5 * nB(x * 0.011 + 9.3, z * 0.011 - 4.1);
    const inTo = CLIFF_IN * (0.7 + 0.8 * v);
    // (cut by gullies: where a narrow band of the noise crosses the foot the cliff stands half as high, a notch a few
    // metres wide down the face)
    const notch = smoothstep(0.82, 0.97, 1 - Math.abs(nP(x * 0.043 + 2.7, z * 0.043 - 9.1)));
    const cliff = CLIFF * (0.6 + 0.8 * v) * smoothstep(0, inTo, d) * (1 - 0.5 * notch);
    const env = cliff + MASS * 1.9 * (1 - Math.exp(-d / (MASS_IN * 1.5)));
    // (gullies down the faces, spurs between them: ridged noise, more of it the higher up)
    const g = (ridged(x, z) - 0.35) * PEAK * 0.22 * smoothstep(inTo, 50, d);
    // (and crags: the faces broken up into buttresses and ledges a few metres deep)
    const crag = (Math.abs(nP(x * 0.031 + 4.2, z * 0.031 - 8.8)) * 2 - 0.6) * 10 + nB(x * 0.083, z * 0.083) * 3.2;
    // (and from its very foot the rock is broken: slabs, ribs and ledges a metre or three proud, every few metres - the
    // face a survivor stands under is no smooth bank)
    const rough = nB(x * 0.21 + 1.7, z * 0.21 - 3.3) * 1.5 + Math.abs(nP(x * 0.11 - 2.4, z * 0.11 + 5.1)) * 3.4 - 1.3;
    const hm = Math.max(cliff + d * 0.9, Math.min(env, pyramids(x, z) + g)) + crag * smoothstep(inTo, 36, d) + rough * smoothstep(0, 8, d);
    // (and the faces stepped in ledges: a band of rock 8-13 m high, its riser near sheer, its ledge nearly flat - where
    // a few trees take hold - the bands wandering across the face, so it reads as strata and shelves, not one smooth bank)
    const L = 8 + 5 * (0.5 + 0.5 * nB(x * 0.017 + 3.3, z * 0.017 - 1.1));
    const off = (0.5 + 0.5 * nB(x * 0.009 - 5.1, z * 0.009 + 2.2)) * L;
    const t = (hm + off) / L;
    const stepped = (Math.floor(t) + smoothstep(0.3, 0.95, t - Math.floor(t))) * L - off;
    return lerp(hm, stepped, 0.8 * smoothstep(2, 14, d) * LEDGES);
  };
  // outside one, near its foot: the foothills, rising toward the cliff (none of it on the water)
  const foothill = (x, z, d) => (d > -FOOTHILL_IN ? FOOTHILL * (1 - smoothstep(0, FOOTHILL_IN, -d)) ** 1.6 * (0.55 + 0.45 * (0.5 + 0.5 * nB(x * 0.008 - 2.2, z * 0.008 + 6.4))) : 0);
  // the quarry's pit: terraces down into the ground, a ramp round them
  // Five benches, each a ledge of level ground 6.4 m wide and a face of rock nearly sheer under it (the face itself is
  // built - pitFaces, below - over the heightfield's riser), down to a floor 52 m across; the haul road cut down round
  // them from the rim to the floor (ramp: from angle a0 at the rim, turning `turn` by the floor, hw half its width).
  const PIT = { x: FX(PLACES.quarry[0]), z: FX(PLACES.quarry[1]), r: 58, steps: 5, drop: 4.8, floor: 26, turn: PI * 1.4, hw: 4 };
  // (it is cut into a rise of its own, high enough that its floor stays over the water: the ground round it comes up to
  // its rim over 60 m)
  PIT.top = Math.max(H0(PIT.x, PIT.z), WATER_LEVEL + 2 + PIT.steps * PIT.drop);
  PIT.bw = (PIT.r - PIT.floor) / PIT.steps;
  {
    const yd = zoneById[ZONE.AGGREGATES];
    PIT.a0 = Math.atan2(yd.x - PIT.x, yd.z - PIT.z) + 0.55; // (the ramp starts beside the belt's line up to the yard)
  }
  // a point's distance out from the pit's middle as its benches are laid out (they wander a few metres round)
  const pitD = (x, z) => Math.hypot(x - PIT.x, z - PIT.z) + nE(x * 0.05, z * 0.05) * 3;
  // the haul road at a point: [how far along it, 0 at the rim .. 1 on the floor; how far off its middle] (null: not near)
  const pitRamp = (x, z, d) => {
    let rel = Math.atan2(x - PIT.x, z - PIT.z) - PIT.a0;
    rel = ((rel % (PI * 2)) + PI * 2) % (PI * 2);
    const s = rel / PIT.turn;
    if (s > 1.08) return null;
    const rad = PIT.r - 1.5 - Math.min(1, Math.max(0, s)) * (PIT.r - 1.5 - (PIT.floor - 3));
    return [s, Math.abs(d - rad)];
  };
  // the ground of the built-up places is one level each: the city's, the airfield's
  const cityH = Math.max(FLOOR + 1.4, H0(city.x, city.z) * 0.5 + 1);
  const fieldH = Math.max(FLOOR + 1.4, H0(field.x, field.z) * 0.6 + 1.5);
  for (const zn of zones) {
    if (zn.id === ZONE.BRIDGEHEAD) zn.h = BLUFF;
    else if (zn.id === ZONE.CITY) zn.h = cityH;
    else if (zn.id === ZONE.TERMINAL || zn.id === ZONE.HANGARS || zn.id === ZONE.FUEL_DEPOT) zn.h = fieldH;
    else if (zn.id === ZONE.MARINA) zn.h = WATER_LEVEL + 1.5;
    else if (zn.id === ZONE.INDUSTRIAL) zn.h = cityH; // (its quays at the city's level: the two meet)
    else if (zn.id === ZONE.AGGREGATES) zn.h = PIT.top; // (the quarry's yard is on the rise its pit is cut into)
    else zn.h = Math.max(FLOOR + 1, H0(zn.x, zn.z) * 0.55 + 0.8 + (zn.raise || 0));
  }
  // rectangles of level ground [x, z, half x, half z, height, blend, turned]: the airfield, the city, the quay
  const flats = [
    [AIR.x, AIR.z, (FENCE.x1 - FENCE.x0) / 2 + 10, (FENCE.z1 - FENCE.z0) / 2 + 10, fieldH, 40, AIR.ry, (FENCE.x0 + FENCE.x1) / 2, (FENCE.z0 + FENCE.z1) / 2], // (to past its fence)
    [SHORE + 26, zb, 26, 10, BLUFF, 9], // the bluff out to the abutment: the road off the bridge
    [docks.x - 22, docks.z, 70, 128, cityH, 16], // the docks, out to their quays
    [city.x, city.z, G2 + 16, G2 + 16, cityH, 30], // the city, to its corners (they lie outside the circle of its zone)
    [city.x - G2 - PITCH / 2 + 2, city.z + G2 - PITCH, PITCH / 2 + 4, PITCH + 4, cityH, 12], // the harbour streets, between the two (below)
  ];
  // (H1 is asked of every vertex of the heightfield, a million of them: what only depends on a flat or a zone is worked
  // out once, and the distance to a zone only taken where it can matter)
  for (const f of flats) {
    while (f.length < 9) f.push(0); // (not turned, no offset)
    f.push(Math.cos(f[6]), Math.sin(f[6]));
  }
  // (which zones and flats can reach into each 64 m cell, in their own order: a vertex asks only those)
  const ZC = 64;
  const ZCN = Math.ceil(SIZE / ZC);
  const zoneCells = Array.from({ length: ZCN * ZCN }, () => []);
  const flatCells = Array.from({ length: ZCN * ZCN }, () => []);
  const cellsOf = (x, z, r, into, item) => {
    for (let j = Math.max(0, Math.floor((z - r + HALF) / ZC)); j <= Math.min(ZCN - 1, Math.floor((z + r + HALF) / ZC)); j++) for (let i = Math.max(0, Math.floor((x - r + HALF) / ZC)); i <= Math.min(ZCN - 1, Math.floor((x + r + HALF) / ZC)); i++) into[j * ZCN + i].push(item);
  };
  for (const zn of zones) cellsOf(zn.x, zn.z, zn.flat + zn.blend, zoneCells, zn);
  for (const f of flats) cellsOf(f[0], f[1], Math.hypot(f[2] + Math.abs(f[7]), f[3] + Math.abs(f[8])) + f[5], flatCells, f);
  const VILLAGE = [FX(AREAS.village[0]), FX(AREAS.village[1]), FX(AREAS.village[2]), FX(AREAS.village[3])];
  const H1 = (x, z) => {
    const dM = mtnAt(x, z);
    let h = H0(x, z);
    const zc = Math.min(ZCN - 1, Math.max(0, Math.floor((z + HALF) / ZC))) * ZCN + Math.min(ZCN - 1, Math.max(0, Math.floor((x + HALF) / ZC)));
    const zoneHere = zoneCells[zc];
    for (const zn of zoneHere) {
      const lim = zn.flat + zn.blend;
      if ((x - zn.x) ** 2 + (z - zn.z) ** 2 >= lim * lim) continue;
      const d = Math.hypot(x - zn.x, z - zn.z);
      if (d < lim) h = lerp(h, zn.h, 1 - smoothstep(zn.flat, lim, d));
    }
    for (const [fx, fz, hx, hz, fh, blend, , ox, oz, c, s] of flatCells[zc]) {
      const lx = c * (x - fx) - s * (z - fz) - ox;
      const lz = s * (x - fx) + c * (z - fz) - oz;
      const d = Math.hypot(Math.max(0, Math.abs(lx) - hx), Math.max(0, Math.abs(lz) - hz));
      if (d < blend) h = lerp(h, fh, 1 - smoothstep(0, blend, d));
    }
    // the quarry's pit: its benches, level ledges with a riser nearly sheer between them (the rock face built over it),
    // and the haul road down round them
    {
      const d = (x - PIT.x) ** 2 + (z - PIT.z) ** 2 < (PIT.r + 64) ** 2 ? pitD(x, z) : 1e4;
      if (d < PIT.r + 60) h = Math.max(h, lerp(h, PIT.top, 1 - smoothstep(PIT.r, PIT.r + 60, d)));
      if (d < PIT.r + 4) {
        const ring = clamp((PIT.r - d) / PIT.bw, 0, PIT.steps);
        const k = Math.floor(ring);
        const f = ring - k;
        const rim = smoothstep(-4, 2, PIT.r - d);
        const benches = h - (k + smoothstep(0.84, 0.99, f)) * PIT.drop * rim;
        const ramp = pitRamp(x, z, d);
        h = benches;
        if (ramp && ramp[1] < PIT.hw + 3) {
          const road = PIT.top - clamp(ramp[0], 0, 1) * PIT.steps * PIT.drop;
          h = lerp(benches, Math.min(road, h), (1 - smoothstep(PIT.hw, PIT.hw + 3, ramp[1])) * rim);
        }
      }
    }
    // the mountains
    h += mountainUp(x, z, dM);
    // (the marina's yard stays as it was levelled, up to where its pier starts: the lake's shore wanders, the yard's does not)
    const mz = zoneById[ZONE.MARINA];
    const mzd = Math.hypot(x - mz.x, z - mz.z);
    const keepYard = mzd < mz.flat + mz.blend ? (1 - smoothstep(mz.flat, mz.flat + mz.blend, mzd)) * (1 - smoothstep(9.5, 13.5, (x - mz.x) * Math.sin(mz.ry) + (z - mz.z) * Math.cos(mz.ry))) : 0;
    // the lake (as the island's are dug: a shore, then a bowl)
    const dl = lakeAt(x, z);
    if (dl > -50) {
      h = lerp(h, Math.min(h, WATER_LEVEL + 1.0), 1 - smoothstep(-2, 40, -dl) * 1);
      if (dl > -6) h = Math.min(h, lerp(WATER_LEVEL + 1.0, WATER_LEVEL - 5.5, smoothstep(-2, 26, dl)));
      // (an islet of the lake: a wooded mound)
      if (isletAt(x, z) === 2) h = Math.max(h, WATER_LEVEL + 0.9 + Math.min(-dl, 26) * 0.34 * smoothstep(0, 4, -dl) + (0.5 + 0.5 * nB(x * 0.07, z * 0.07)) * smoothstep(0, 5, -dl));
    }
    // the river: a ravine down to the water, the bed well under it, steep at its banks
    const dR = riverAt(x, z);
    if (dR < RIVER_HW + RIVER_BANK + 4) {
      const dn = dR + nE(x * 0.04, z * 0.04) * 1.6;
      h = lerp(h, Math.min(h, WATER_LEVEL + 1.1), 1 - smoothstep(RIVER_HW + 1.5, RIVER_HW + RIVER_BANK, dn));
      h = lerp(h, WATER_LEVEL - RIVER_DEPTH, 1 - smoothstep(RIVER_HW * 0.6, RIVER_HW + 0.4, dn));
    }
    // the creek: a shallow bed, waded
    const dc = creekAt(x, z);
    if (dc < CREEK_HW + 8) {
      h = lerp(h, Math.min(h, WATER_LEVEL + 0.5), 1 - smoothstep(CREEK_HW, CREEK_HW + 8, dc));
      h = lerp(h, WATER_LEVEL - 0.3, 1 - smoothstep(CREEK_HW * 0.5, CREEK_HW, dc));
    }
    if (keepYard > 0) h = lerp(h, mz.h, keepYard);
    // (a place's yard keeps its level, whatever the shore of the lake or the creek does round it)
    for (const zn of zoneHere) {
      if (zn.id === ZONE.CITY || zn.id === ZONE.MARINA || zn.id === ZONE.LIGHTHOUSE || (x - zn.x) ** 2 + (z - zn.z) ** 2 >= zn.flat * zn.flat) continue;
      const d = Math.hypot(x - zn.x, z - zn.z);
      if (d < zn.flat) h = lerp(h, zn.h, 1 - smoothstep(zn.flat - 4, zn.flat, d));
    }
    // the sea: the land goes down to the beach and on under the water. The bluff at the bridge falls straight in.
    const s = -seaAt(x, z); // (positive on land)
    // (at the bridge's bluff and along the docks' quays the land stands to the water's edge and drops into it)
    const bluff = x < SHORE + 120 ? 1 - smoothstep(34, 70, Math.abs(z - zb)) : 0;
    const near = Math.max(bluff, 1 - smoothstep(docks.flat + 8, docks.flat + 30, Math.hypot(x - docks.x, z - docks.z)));
    const beach = 1 - smoothstep(-2, lerp(40, 10, near), s);
    // (the coast is rock for long stretches, as the picture draws it - a low cliff into deep water - and coves and
    // beaches between; an islet is rock all round, a mound of it)
    const isl = isletAt(x, z) === 1;
    // (not along the village: its houses come down to its shore)
    const villageD = Math.hypot(Math.max(0, VILLAGE[0] - x, x - VILLAGE[2]), Math.max(0, VILLAGE[1] - z, z - VILLAGE[3]));
    const rocky = isl ? 1 : (1 - near) * smoothstep(-0.12, 0.22, nP(x * 0.0055 + 7.7, z * 0.0055 - 1.3)) * smoothstep(15, 60, villageD);
    if (rocky > 0.001 && s > -40 && s < 60) {
      const top = 2.5 + 6.5 * (0.5 + 0.5 * nP(x * 0.031 - 3.1, z * 0.031 + 2.2));
      const rough = (1 - Math.abs(nE(x * 0.11 + 1.3, z * 0.11 - 0.7))) * 1.6;
      const rise = isl ? (top + Math.min(s, 34) * 0.5) * smoothstep(-0.5, 3, s) + rough * smoothstep(0, 4, s) : top * smoothstep(-0.5, 3.5, s) * (1 - 0.55 * smoothstep(8, 40, s)) + rough * smoothstep(0, 4, s) * (1 - smoothstep(10, 30, s));
      let hr = s <= 0 ? lerp(WATER_LEVEL - 9, WATER_LEVEL - 1.2, smoothstep(-16, 0, s)) : Math.max(isl ? WATER_LEVEL : h, WATER_LEVEL + rise);
      // (the lighthouse's islet has a level top round the tower)
      if (isl) {
        const lh = zoneById[ZONE.LIGHTHOUSE];
        const dl = Math.hypot(x - lh.x, z - lh.z);
        if (dl < 18 && s > 0) hr = lerp(Math.min(hr, WATER_LEVEL + 4.2), hr, smoothstep(9, 18, dl));
      }
      const hb = lerp(lerp(h, WATER_LEVEL + 0.6, beach * (1 - near * smoothstep(-2, 10, s))), WATER_LEVEL - 7, 1 - smoothstep(-34, lerp(-1, 4, near), s));
      h = lerp(hb, hr, rocky);
    } else {
      h = lerp(h, WATER_LEVEL + 0.6, beach * (1 - near * smoothstep(-2, 10, s)));
      h = lerp(h, WATER_LEVEL - 7, 1 - smoothstep(-34, lerp(-1, 4, near), s));
    }
    // THE DOCKS' QUAY: the ground stands level out to its edge and drops there into water dredged deep, the length of
    // the waterfront (its face is the quay wall: the docks, below)
    {
      const ql = x - (docks.x + QUAY_LX); // (+ inland of the edge)
      const qz = Math.abs(z - docks.z);
      if (qz < QUAY_HZ + 30 && ql > -120 && ql < 110) {
        const along = 1 - smoothstep(QUAY_HZ, QUAY_HZ + 30, qz);
        if (ql < 0) h = lerp(h, Math.min(h, WATER_LEVEL - 7), along * (1 - smoothstep(-120, -95, ql)));
        else h = lerp(h, zoneById[ZONE.INDUSTRIAL].h, along * (1 - smoothstep(80, 110, ql)));
      }
    }
    // (the bluff the bridge lands on, out to the abutment: whatever the shore does)
    const db = Math.hypot(Math.max(0, Math.abs(x - SHORE - 26) - 26), Math.max(0, Math.abs(z - zb) - 10));
    if (db < 9) h = lerp(h, BLUFF, 1 - smoothstep(0, 9, db));
    // (...and the yard of the bridgehead on it, whatever the city's ground does beyond)
    const dh = Math.hypot(x - head.x, z - head.z);
    if (dh < 70) h = lerp(h, BLUFF, 1 - smoothstep(26, 70, dh));
    return h;
  };

  const heights = new Float32Array(N * N);
  const roadDist = new Float32Array(N * N).fill(1e4);
  const roadKind = new Uint8Array(N * N);
  let roadH = new Float32Array(N * N);
  let roadDir = new Float32Array(N * N * 2);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) heights[j * N + i] = H1(-HALF + i * GRID_STEP, -HALF + j * GRID_STEP);
  // the tunnels' corridors: the road's own level from mouth to mouth (the ground in front of either mouth), cut down
  // into the mountain with a cutting either side
  for (const t of tunnels) {
    const ground = (x, z) => H1(x, z) - mountainUp(x, z, mtnAt(x, z));
    t.y0 = ground(t.a[0] - t.dx * (CUT_LEN + 10), t.a[1] - t.dz * (CUT_LEN + 10));
    t.y1 = ground(t.b[0] + t.dx * (CUT_LEN + 10), t.b[1] + t.dz * (CUT_LEN + 10));
    // where the gallery is: the stretch of the road's line that is in the mountain
    let s0 = Infinity;
    let s1 = -Infinity;
    for (let s = -CUT_LEN; s <= t.len + CUT_LEN; s += 1) {
      if (mtnMask[vi(t.a[1] + t.dz * s) * N + vi(t.a[0] + t.dx * s)]) {
        s0 = Math.min(s0, s);
        s1 = Math.max(s1, s);
      }
    }
    if (s0 > s1) continue;
    t.s0 = Math.max(-CUT_LEN + 4, s0 - 3);
    t.s1 = Math.min(t.len + CUT_LEN - 4, s1 + 3);
    // The cap: the mountain as it stood over the gallery, before its corridor was cut (the heightfield is one level:
    // the road's, inside), drawn by the client over the gallery's roof so the mountain is whole over the tunnel and its
    // mouths are holes in a rock face, not the ends of a slot. Over the first metres in from either mouth it comes down
    // to the top of the face over the mouth. A grid CAP_STEP apart, along the road (s) and across it (lat).
    const level = (s) => lerp(t.y0, t.y1, clamp((s + CUT_LEN) / (t.len + CUT_LEN * 2), 0, 1));
    const CAP_STEP = 2;
    const CAP_LAT = CUT_HW + 5;
    const n = Math.ceil((t.s1 - t.s0) / CAP_STEP) + 1;
    const m = Math.round((CAP_LAT * 2) / CAP_STEP) + 1;
    const h = new Float32Array(n * m);
    for (let a = 0; a < n; a++) {
      const s = Math.min(t.s1, t.s0 + a * CAP_STEP);
      const top = level(s) + TUNNEL_H + 6.9;
      const inMouth = Math.min(s - t.s0, t.s1 - s);
      for (let b = 0; b < m; b++) {
        const lat = -CAP_LAT + b * CAP_STEP;
        const x = t.a[0] + t.dx * s - t.dz * lat;
        const z = t.a[1] + t.dz * s + t.dx * lat;
        h[a * m + b] = Math.max(top, Math.min(heights[vi(z) * N + vi(x)], top + Math.max(0, inMouth - 1.4) * 1.3));
      }
    }
    t.cap = { s0: t.s0, step: CAP_STEP, lat: CAP_LAT, n, m, h };
  }
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = -HALF + i * GRID_STEP;
      const z = -HALF + j * GRID_STEP;
      const on = tunnelOf(x, z, 6);
      if (!on || cliffAt(x, z) < -16) continue;
      const { t, s, lat } = on;
      const level = lerp(t.y0, t.y1, clamp((s + CUT_LEN) / (t.len + CUT_LEN * 2), 0, 1));
      const k = j * N + i;
      heights[k] = lerp(level, heights[k], smoothstep(CUT_HW - 1, CUT_HW + 5, lat));
    }
  }
  const grid = (v) => clamp((v + HALF) / GRID_STEP, 0, N - 1.001);
  const rawH = (x, z) => {
    const fx = grid(x);
    const fz = grid(z);
    const i = fx | 0;
    const j = fz | 0;
    const k = j * N + i;
    const a = heights[k] + (heights[k + 1] - heights[k]) * (fx - i);
    const b = heights[k + N] + (heights[k + N + 1] - heights[k + N]) * (fx - i);
    return a + (b - a) * (fz - j);
  };

  // ---------------------------------------------------------------- roads
  // No router: every road is the picture's, a curve through the points it was traced by.
  const roads = [];
  // level: a road of a place keeps to the place's ground (a street, the runway); otherwise its heights are the
  // ground's, smoothed along it
  // endH: the height of the road it ends on, which it comes down (or up) to over its last stretch
  const buildRoad = (ctrl, kind, width, name = '', level = null, endH = null) => {
    const pts = [];
    // (a Catmull-Rom curve through its points, with each leg's two tangents held to the leg's own length: a short
    // leg after a long one would otherwise be overshot, and the road double back on itself)
    for (let i = 0; i < ctrl.length - 1; i++) {
      const p0 = ctrl[Math.max(0, i - 1)];
      const p1 = ctrl[i];
      const p2 = ctrl[i + 1];
      const p3 = ctrl[Math.min(ctrl.length - 1, i + 2)];
      const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
      const held = (ax, az) => {
        const l = Math.hypot(ax, az);
        return l > len ? [(ax * len) / l, (az * len) / l] : [ax, az];
      };
      const m1 = held((p2[0] - p0[0]) / 2, (p2[1] - p0[1]) / 2);
      const m2 = held((p3[0] - p1[0]) / 2, (p3[1] - p1[1]) / 2);
      const steps = Math.max(2, Math.ceil(len / 2));
      for (let s = 0; s < steps; s++) {
        const t = s / steps;
        const [a, b2, c, d] = [2 * t * t * t - 3 * t * t + 1, t * t * t - 2 * t * t + t, -2 * t * t * t + 3 * t * t, t * t * t - t * t];
        pts.push(a * p1[0] + b2 * m1[0] + c * p2[0] + d * m2[0], a * p1[1] + b2 * m1[1] + c * p2[1] + d * m2[1]);
      }
    }
    pts.push(ctrl[ctrl.length - 1][0], ctrl[ctrl.length - 1][1]);
    const n = pts.length / 2;
    const hs = new Float32Array(n);
    for (let i = 0; i < n; i++) hs[i] = level ?? rawH(pts[i * 2], pts[i * 2 + 1]);
    // (over the river it is a bridge: the deck is this far over the water, whatever the bed does under it)
    const wet = (i) => riverAt(pts[i * 2], pts[i * 2 + 1]);
    if (level === null) for (let i = 0; i < n; i++) if (wet(i) < RIVER_HW + 12) hs[i] = Math.max(hs[i], WATER_LEVEL + BRIDGE_UP);
    if (level === null) {
      // (through a tunnel it is the corridor's level, not the mountain's over it)
      for (let i = 0; i < n; i++) {
        const on = tunnelOf(pts[i * 2], pts[i * 2 + 1]);
        if (on && on.lat < CUT_HW) hs[i] = lerp(on.t.y0, on.t.y1, clamp((on.s + CUT_LEN) / (on.t.len + CUT_LEN * 2), 0, 1));
      }
      for (let pass = 0; pass < 3; pass++) {
        const src = hs.slice();
        for (let i = 0; i < n; i++) {
          let s = 0;
          let c = 0;
          for (let k = Math.max(0, i - 8); k <= Math.min(n - 1, i + 8); k++) {
            s += src[k];
            c++;
          }
          hs[i] = s / c;
        }
      }
      // ...and it meets a place at the level of its ground
      for (let i = 0; i < n; i++) {
        for (const zn of zones) {
          const d = Math.hypot(pts[i * 2] - zn.x, pts[i * 2 + 1] - zn.z);
          if (d < zn.flat + 12) hs[i] = lerp(hs[i], zn.h, 1 - smoothstep(zn.flat, zn.flat + 12, d));
        }
        if (inCity(pts[i * 2], pts[i * 2 + 1], 6)) hs[i] = cityH;
        if (onField(pts[i * 2], pts[i * 2 + 1], -8)) hs[i] = fieldH;
      }
    }
    if (endH !== null) {
      let d = 0;
      for (let i = n - 1; i >= 0 && d < 30; i--) {
        hs[i] = lerp(endH, hs[i], smoothstep(0, 30, d));
        if (i) d += Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]);
      }
    }
    let length = 0;
    for (let i = 1; i < n; i++) length += Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]);
    // spans: [first, last] points of each stretch of it that is over the river
    const spans = [];
    for (let i = 0; i < n; i++) {
      if (level !== null || wet(i) >= RIVER_HW + 1) continue;
      if (spans.length && spans[spans.length - 1][1] === i - 1) spans[spans.length - 1][1] = i;
      else spans.push([i, i]);
    }
    // (its deck is level from bank to bank - one height, so it is one thing to walk on - and the road comes up to
    // that over a few metres either side)
    for (const [i0, i1] of spans) {
      const [a, e] = [Math.max(0, i0 - 3), Math.min(n - 1, i1 + 3)];
      let top = WATER_LEVEL + BRIDGE_UP;
      for (let i = a; i <= e; i++) top = Math.max(top, hs[i]);
      for (let i = a; i <= e; i++) hs[i] = top;
      for (let k = 1; k <= 6; k++) {
        if (a - k >= 0) hs[a - k] = lerp(top, hs[a - k], k / 7);
        if (e + k < n) hs[e + k] = lerp(top, hs[e + k], k / 7);
      }
    }
    const road = { pts: new Float32Array(pts), hs, kind, width, name, length, spans };
    roads.push(road);
    return road;
  };
  // a to b by way of `n` points that wander up to `amp` of the leg off the straight line
  const wander = (a, b, n, amp) => {
    const out = [a];
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const len = Math.hypot(dx, dz);
    let s = rng.chance(0.5) ? 1 : -1;
    for (let k = 1; k <= n; k++) {
      const t = k / (n + 1);
      const o = s * rng.range(0.35, 1) * amp * len;
      s = -s;
      out.push([a[0] + dx * t - (dz / len) * o, a[1] + dz * t + (dx / len) * o]);
    }
    out.push(b);
    return out;
  };
  // Route 9 comes off the bridge, over the bluff and down Main Street through the city
  const highway = buildRoad([[head.x - 30, zb], [head.x + 20, zb], [cityW[0] - 34, lerp(zb, city.z, 0.7)], cityW, cityE], ROAD.ASPHALT, 3.8, 'Route 9');
  // the city's streets (Main Street is Route 9 itself)
  // the ring road: down the grid's edges, round each corner on its curve (a point every 6 degrees), all the way round
  {
    const ring = [];
    for (const [sx, sz, a0] of [[1, -1, -PI / 2], [1, 1, 0], [-1, 1, PI / 2], [-1, -1, PI]]) {
      for (let k = 0; k <= 15; k++) {
        const a = a0 + (k / 15) * (PI / 2);
        ring.push([city.x + sx * RING_C + Math.cos(a) * RING_R, city.z + sz * RING_C + Math.sin(a) * RING_R]);
      }
    }
    ring.push(ring[0]);
    buildRoad(ring, ROAD.ASPHALT, 3.6, 'Ring Road', cityH);
  }
  // the grid's streets inside it, each from the ring to the ring
  for (let i = 1; i < GRID; i++) {
    const o = -G2 + i * PITCH;
    const e = ringAt(Math.abs(o));
    if (i === GRID / 2) {
      // (the cross street up the middle stops at the square, from the north and from the south)
      buildRoad([[city.x + o, city.z - e], [city.x + o, city.z - PITCH]], ROAD.ASPHALT, 3.4, '', cityH);
      buildRoad([[city.x + o, city.z + PITCH], [city.x + o, city.z + e]], ROAD.ASPHALT, 3.4, '', cityH);
    } else buildRoad([[city.x + o, city.z - e], [city.x + o, city.z + e]], ROAD.ASPHALT, 3.4, '', cityH);
    if (i !== GRID / 2) buildRoad([[city.x - e, city.z + o], [city.x + e, city.z + o]], ROAD.ASPHALT, 3.4, '', cityH);
  }
  // the harbour streets: the town's grid carried out past the ring's south-west curve to the docks, as the picture has
  // them joined - its two streets west from the ring, and one down to the docks' road (two blocks between: below)
  {
    const xw = city.x - G2 - PITCH;
    buildRoad([[city.x - G2, city.z + PITCH], [xw, city.z + PITCH]], ROAD.ASPHALT, 3.4, '', cityH);
    buildRoad([[city.x - ringAt(2 * PITCH), city.z + 2 * PITCH], [xw, city.z + 2 * PITCH]], ROAD.ASPHALT, 3.4, '', cityH);
    buildRoad([[xw, city.z + PITCH], [xw, city.z + G2]], ROAD.ASPHALT, 3.4, '', cityH);
  }
  // ...and the streets out of the ring into the suburbs, as the picture runs them on: north from its top and south
  // from its foot, down the grid's lines, out until they meet a road, or the water, the rock or a place, or run 150 m
  {
    const hitsRoad = (x, z, self) => roads.some((r) => r !== self && r.width < 6 && (() => {
      const p = r.pts;
      for (let k = 0; k < p.length; k += 2) if (Math.abs(p[k] - x) < 5 && Math.abs(p[k + 1] - z) < 5) return true;
      return false;
    })());
    for (const [lx, sz] of [[0, -1], [PITCH, -1], [2 * PITCH, -1], [-PITCH, 1], [PITCH, 1]]) {
      const x = city.x + lx;
      const z0 = city.z + sz * ringAt(Math.abs(lx));
      let len = 0;
      for (let d = 12; d <= 150; d += 3) {
        const z = z0 + sz * d;
        if (seaAt(x, z) > -10 || lakeAt(x, z) > -10 || cliffAt(x, z) > -8 || riverAt(x, z) < RIVER_HW + 10 || zones.some((zn) => zn.id !== ZONE.CITY && Math.hypot(zn.x - x, zn.z - z) < zn.flat + 6)) break;
        len = d;
        if (d > 24 && hitsRoad(x, z, null)) break;
      }
      if (len >= 40) buildRoad([[x, z0], [x, z0 + sz * len]], ROAD.ASPHALT, 2.6, '', null);
    }
  }
  // the airfield: the runway, the taxiway down the apron, the perimeter road, the road in through the gate
  const runwayRoad = buildRoad([aw(0, -RUNWAY_LEN / 2), aw(0, RUNWAY_LEN / 2)], ROAD.ASPHALT, RUNWAY_HALF, 'Runway 36', fieldH);
  buildRoad([aw(RUNWAY_HALF + 8, -RUNWAY_LEN / 2 + 20), aw(RUNWAY_HALF + 8, APRON.lz - APRON.hz), aw(APRON.lx, APRON.lz - APRON.hz - 6)], ROAD.ASPHALT, 2.8, '', fieldH);
  {
    // (the perimeter road keeps to the fence: a rectangle with its corners rounded, not the oval a curve through its four
    // corners would be)
    const [x0, z0, x1, z1, rc] = [FENCE.x0 + 6, FENCE.z0 + 6, FENCE.x1 - 6, FENCE.z1 - 6, 16];
    const ring = [];
    for (const [cx, cz, a0] of [[x1 - rc, z0 + rc, -PI / 2], [x1 - rc, z1 - rc, 0], [x0 + rc, z1 - rc, PI / 2], [x0 + rc, z0 + rc, PI]]) for (let k = 0; k <= 3; k++) ring.push([cx + Math.cos(a0 + (k / 3) * (PI / 2)) * rc, cz + Math.sin(a0 + (k / 3) * (PI / 2)) * rc]);
    ring.push(ring[0]);
    buildRoad(ring.map(([lx, lz]) => aw(lx, lz)), ROAD.ASPHALT, 2.4, '', fieldH);
  }
  buildRoad([aw(GATE_AT.lx - 30, GATE_AT.lz - 14), aw(GATE_AT.lx, GATE_AT.lz), aw(TERMINAL_AT.lx - 26, TERMINAL_AT.lz)], ROAD.ASPHALT, 2.8, '', fieldH);
  // ...and every road of the picture
  const KIND = { main: [ROAD.ASPHALT, 3.6], secondary: [ROAD.ASPHALT, 2.8], dirt: [ROAD.DIRT, 2.4], trail: [ROAD.TRAIL, 1.3], lane: [ROAD.ASPHALT, 2.3] };
  for (const r of ROADS) {
    if (!KIND[r.kind]) continue; // (the airport's perimeter: its own, above)
    const ctrl = r.pts.map(W);
    // (a road the picture runs down to the river ends on its bank: nothing but the bridge's road goes over it)
    while (ctrl.length > 2 && riverAt(...ctrl[ctrl.length - 1]) < RIVER_HW + 5) ctrl.pop();
    while (ctrl.length > 2 && riverAt(...ctrl[0]) < RIVER_HW + 5) ctrl.shift();
    // (...and one it runs up into a mountain ends at its foot, unless it goes through it by a tunnel)
    while (ctrl.length > 2 && cliffAt(...ctrl[ctrl.length - 1]) > -6 && !tunnelOf(...ctrl[ctrl.length - 1], 4)) ctrl.pop();
    while (ctrl.length > 2 && cliffAt(...ctrl[0]) > -6 && !tunnelOf(...ctrl[0], 4)) ctrl.shift();
    // (two points of the picture's ring the city's grid puts on one crossing: once)
    for (let i = ctrl.length - 1; i > 0; i--) if (Math.hypot(ctrl[i][0] - ctrl[i - 1][0], ctrl[i][1] - ctrl[i - 1][1]) < 1) ctrl.splice(i, 1);
    // (a road that comes to a crossing of the grid's edge round a corner, where the ring is a curve, goes on in to it:
    // down the street's line to where that comes to the ring, or from the corner itself down the diagonal)
    const inTo = (q) => {
      const [lx, lz] = [q[0] - city.x, q[1] - city.z];
      if (inRing(lx, lz, -0.5) || Math.max(Math.abs(lx), Math.abs(lz)) > G2 + 0.5) return null;
      if (Math.abs(lx) > G2 - 0.5 && Math.abs(lz) > G2 - 0.5) return [city.x + Math.sign(lx) * RING_DIAG, city.z + Math.sign(lz) * RING_DIAG];
      if (Math.abs(lx) > G2 - 0.5) return [city.x + Math.sign(lx) * ringAt(Math.abs(lz)), q[1]];
      return [q[0], city.z + Math.sign(lz) * ringAt(Math.abs(lx))];
    };
    if (ctrl.length >= 2 && inTo(ctrl[ctrl.length - 1])) ctrl.push(inTo(ctrl[ctrl.length - 1]));
    if (ctrl.length >= 2 && inTo(ctrl[0])) ctrl.unshift(inTo(ctrl[0]));
    if (ctrl.length < 2) continue;
    if (r.name === 'airport spur') ctrl[ctrl.length - 1] = aw(GATE_AT.lx - 30, GATE_AT.lz - 14); // (to the road in through the gate)
    buildRoad(ctrl, KIND[r.kind][0], KIND[r.kind][1], r.name);
  }
  // the outer ring (after the picture's roads, which come to the grid's ring across it), and the grid's streets carried
  // on across to it where nothing already crosses there
  {
    const hitsRoad = (x, z) => roads.some((r) => r.width < 6 && (() => {
      const p = r.pts;
      for (let k = 0; k < p.length; k += 2) if (Math.abs(p[k] - x) < 5 && Math.abs(p[k + 1] - z) < 5) return true;
      return false;
    })());
    const outer = [];
    for (let a = -BAND_A; a <= BAND_A + 1e-6; a += PI / 180) outer.push([city.x + Math.cos(a) * rOut(a), city.z + Math.sin(a) * rOut(a)]);
    buildRoad(outer, ROAD.ASPHALT, 3.5, 'Outer Ring', cityH); // (a town's road: no pile-up, billboard or pole line of the highways' along it)
    const across = (lx, lz, ux, uz) => {
      let d = 0;
      while (d < 80 && Math.hypot(lx + ux * d, lz + uz * d) < rOut(Math.atan2(lz + uz * d, lx + ux * d))) d += 0.5;
      return d;
    };
    for (let i = 1; i < GRID; i++) {
      const o = -G2 + i * PITCH;
      const e = ringAt(Math.abs(o));
      for (const [lx, lz, ux, uz] of [[o, -e, 0, -1], [o, e, 0, 1], [e, o, 1, 0]]) {
        const d = across(lx, lz, ux, uz);
        const mx = city.x + lx + (ux * d) / 2, mz = city.z + lz + (uz * d) / 2;
        if (d < 18 || hitsRoad(mx, mz)) continue;
        buildRoad([[city.x + lx, city.z + lz], [city.x + lx + ux * (d + 1), city.z + lz + uz * (d + 1)]], ROAD.ASPHALT, 3.4, '', cityH);
      }
    }
  }
  // a place the picture's roads pass near but do not reach has a track of its own down to the nearest of them
  for (const zn of zones) {
    if (zn.id === ZONE.CITY || zn.id === ZONE.LIGHTHOUSE || zn.id === ZONE.BRIDGEHEAD) continue;
    let best = null;
    let bd = Infinity;
    for (const r of roads) {
      if (r.width > 6) continue;
      for (let k = 0; k < r.pts.length; k += 2) {
        const d = Math.hypot(r.pts[k] - zn.x, r.pts[k + 1] - zn.z);
        if (d < bd) {
          bd = d;
          best = [r.pts[k], r.pts[k + 1], r.hs[k >> 1]];
        }
      }
    }
    if (!best || bd < zn.flat + 4) continue;
    const ux = (best[0] - zn.x) / bd;
    const uz = (best[1] - zn.z) / bd;
    buildRoad([[zn.x + ux * (zn.flat + 1), zn.z + uz * (zn.flat + 1)], [zn.x + ux * (zn.flat + 7), zn.z + uz * (zn.flat + 7)], [best[0], best[1]]], ROAD.DIRT, 2.4, '', null, best[2]);
  }
  // the far portal of the passage under the river: the picture's track from it ends in the woods, so a track runs on
  // from its end to the nearest road of the airfield's side - whoever comes up out of the mines walks it to the
  // airfield (it was the woods). The nearest point of a road the straight way to which crosses neither the river nor
  // a mountain, of a road that is not one of the mines' own tracks
  {
    // (the end of the road that reaches the portal, the end further from it; or the portal itself)
    let from = passageE;
    for (const r of roads) {
      const n = r.pts.length;
      const d0 = Math.hypot(r.pts[0] - passageE[0], r.pts[1] - passageE[1]);
      const d1 = Math.hypot(r.pts[n - 2] - passageE[0], r.pts[n - 1] - passageE[1]);
      if (Math.min(d0, d1) < 25 && r.length > 40) from = d0 < d1 ? [r.pts[n - 2], r.pts[n - 1], r] : [r.pts[0], r.pts[1], r];
    }
    // (found over the ground, round what is in the way: a grid of 8 m cells, none in a mountain, the river, the lake
    // or the sea, a steep one dear; to the first cell a road of another kind passes through)
    const C8 = 8, NC = Math.ceil(SIZE / C8);
    const ci = (x) => clamp(Math.floor((x + HALF) / C8), 0, NC - 1);
    const roadCell = new Map();
    for (const r of roads) {
      if (r === from[2] || /^mine /.test(r.name || '') || r.width > 6) continue;
      for (let k = 0; k < r.pts.length; k += 2) roadCell.set(ci(r.pts[k + 1]) * NC + ci(r.pts[k]), [r.pts[k], r.pts[k + 1], r.hs[k >> 1]]);
    }
    const ok = new Map();
    const pass = (k) => {
      let v = ok.get(k);
      if (v === undefined) {
        const x = -HALF + ((k % NC) + 0.5) * C8, z = -HALF + (((k / NC) | 0) + 0.5) * C8;
        v = cliffAt(x, z) < -10 && riverAt(x, z) > RIVER_HW + 8 && lakeAt(x, z) < -6 && seaAt(x, z) < -6 && !tunnelOf(x, z, 8) && Math.abs(x) < HALF - 20 && Math.abs(z) < HALF - 20;
        // (round a place's yard, not through what will stand in it - out of the one it starts in by the shortest way)
        if (v && Math.hypot(x - from[0], z - from[1]) > 24) v = zones.every((zn) => Math.hypot(x - zn.x, z - zn.z) > zn.flat + 4);
        ok.set(k, v);
      }
      return v;
    };
    const cost = new Map(), prev = new Map(), open = [];
    const s0 = ci(from[1]) * NC + ci(from[0]);
    cost.set(s0, 0);
    open.push([0, s0]);
    let goal = -1;
    for (let guard = 0; open.length && guard < 200000; guard++) {
      let bi = 0;
      for (let q = 1; q < open.length; q++) if (open[q][0] < open[bi][0]) bi = q;
      const [c, k] = open[bi];
      open[bi] = open[open.length - 1];
      open.pop();
      if (c > cost.get(k)) continue;
      if (roadCell.has(k) && c > 30) { goal = k; break; }
      const kx = k % NC, kz = (k / NC) | 0;
      for (const [dx, dz, w] of [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]]) {
        const nx = kx + dx, nz = kz + dz;
        if (nx < 0 || nz < 0 || nx >= NC || nz >= NC) continue;
        const m = nz * NC + nx;
        if (!pass(m)) continue;
        const h0 = rawH(-HALF + (kx + 0.5) * C8, -HALF + (kz + 0.5) * C8), h1 = rawH(-HALF + (nx + 0.5) * C8, -HALF + (nz + 0.5) * C8);
        const nc = c + w * C8 * (1 + 6 * Math.max(0, Math.abs(h1 - h0) / (w * C8) - 0.08));
        if (nc < (cost.get(m) ?? Infinity)) { cost.set(m, nc); prev.set(m, k); open.push([nc, m]); }
      }
    }
    if (goal >= 0) {
      const cells = [];
      for (let k = goal; k !== undefined; k = prev.get(k)) cells.push(k);
      cells.reverse();
      const ctrl = [[from[0], from[1]]];
      for (let q = 3; q < cells.length - 1; q += 3) ctrl.push([-HALF + ((cells[q] % NC) + 0.5) * C8, -HALF + (((cells[q] / NC) | 0) + 0.5) * C8]);
      const end = roadCell.get(goal);
      ctrl.push([end[0], end[1]]);
      buildRoad(ctrl, ROAD.DIRT, 2.4, 'track from the mines', null, end[2]);
    }
  }
  // the docks' own: the quay road along the waterfront and the road in to it from the city's south-west corner (the
  // picture's road out of the ring there runs in from it down the diagonal)
  buildRoad([[docks.x - 40, docks.z - 120], [docks.x - 40, docks.z], [docks.x - 38, docks.z + 118]], ROAD.ASPHALT, 2.8, '', zoneById[ZONE.INDUSTRIAL].h);
  buildRoad([[city.x - G2, city.z + G2], [docks.x - 10, city.z + G2], [docks.x - 40, city.z + G2]], ROAD.ASPHALT, 2.8, '');

  // roads into the heightfield (as world.js does it)
  const ROAD_BLEND = 7.5;
  for (const road of roads) {
    const p = road.pts;
    const reach = road.width + ROAD_BLEND;
    for (let s = 0; s < p.length / 2 - 1; s++) {
      const ax = p[s * 2];
      const az = p[s * 2 + 1];
      const ex = p[s * 2 + 2] - ax;
      const ez = p[s * 2 + 3] - az;
      const el2 = ex * ex + ez * ez || 1;
      const el = Math.sqrt(el2);
      const i0 = Math.max(0, Math.floor((Math.min(ax, ax + ex) - reach + HALF) / GRID_STEP));
      const i1 = Math.min(N - 1, Math.ceil((Math.max(ax, ax + ex) + reach + HALF) / GRID_STEP));
      const j0 = Math.max(0, Math.floor((Math.min(az, az + ez) - reach + HALF) / GRID_STEP));
      const j1 = Math.min(N - 1, Math.ceil((Math.max(az, az + ez) + reach + HALF) / GRID_STEP));
      for (let j = j0; j <= j1; j++) {
        const z = -HALF + j * GRID_STEP;
        for (let i = i0; i <= i1; i++) {
          const x = -HALF + i * GRID_STEP;
          const t = clamp(((x - ax) * ex + (z - az) * ez) / el2, 0, 1);
          const d = Math.hypot(x - ax - ex * t, z - az - ez * t) - (road.width - 2.6);
          const k = j * N + i;
          if (riverD[k] < RIVER_HW + 0.6) continue; // (the river runs on under its bridge)
          if (d < roadDist[k]) {
            roadDist[k] = d;
            roadKind[k] = road.kind;
            roadH[k] = road.hs[s] + (road.hs[s + 1] - road.hs[s]) * t;
            roadDir[k * 2] = ex / el;
            roadDir[k * 2 + 1] = ez / el;
          }
        }
      }
    }
  }
  // (...but not into the yard of a place a road runs past: the yard keeps its level, and a road in it is at that level)
  const yardOf = (x, z) => zones.find((zn) => zn.id !== ZONE.CITY && Math.hypot(x - zn.x, z - zn.z) < zn.flat - 1);
  for (let k = 0; k < N * N; k++) {
    const d = roadDist[k];
    if (d >= 2.6 + ROAD_BLEND) continue;
    const yd = yardOf(-HALF + (k % N) * GRID_STEP, -HALF + Math.floor(k / N) * GRID_STEP);
    if (yd && d > 3) continue;
    heights[k] = lerp(heights[k], roadH[k] - 0.05, 1 - smoothstep(3, 2.6 + ROAD_BLEND, d));
  }

  const heightAt = (x, z) => {
    const fx = grid(x);
    const fz = grid(z);
    const i = fx | 0;
    const j = fz | 0;
    const tx = fx - i;
    const tz = fz - j;
    const k = j * N + i;
    // (triangle-consistent, as the mesh is split: world.js)
    if (tx + tz <= 1) return heights[k] + (heights[k + 1] - heights[k]) * tx + (heights[k + N] - heights[k]) * tz;
    return heights[k + N + 1] + (heights[k + N] - heights[k + N + 1]) * (1 - tx) + (heights[k + 1] - heights[k + N + 1]) * (1 - tz);
  };
  // (is the ground under a prop's footprint level enough to set it down on: within 0.8 m corner to corner?)
  const levelUnder = (type, x, z, ry) => {
    const [sx, , sz] = PROPS[type]?.size || [2, 1, 4];
    const c = Math.cos(ry);
    const sn = Math.sin(ry);
    let lo = Infinity;
    let hi = -Infinity;
    for (const [lx, lz] of [[-sx / 2, -sz / 2], [sx / 2, -sz / 2], [sx / 2, sz / 2], [-sx / 2, sz / 2]]) {
      const h = heightAt(x + c * lx + sn * lz, z - sn * lx + c * lz);
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
    // (...and no hollow under its middle: it is seated on its lowest corner, and over a ditch it would hang in the air)
    return hi - lo < 0.8 && heightAt(x, z) > lo - 0.06;
  };
  const sampleGrid = (arr, x, z) => arr[clamp(Math.round((z + HALF) / GRID_STEP), 0, N - 1) * N + clamp(Math.round((x + HALF) / GRID_STEP), 0, N - 1)];
  const roadDistAt = (x, z) => sampleGrid(roadDist, x, z);
  const roadKindAt = (x, z) => sampleGrid(roadKind, x, z);
  const inWater = (x, z) => heightAt(x, z) < WATER_LEVEL + 0.35;
  const nearZone = (x, z, pad) => zones.find((zn) => Math.hypot(x - zn.x, z - zn.z) < zn.flat + pad) || null;

  // ---------------------------------------------------------------- what it is built with
  const kit = createKit({ rng, heightAt, half: HALF });
  const { staticGrid, structGrid, parts, props, lootSpawns, containers, partSpots, openings, extraTrees, lights, roofs, clears, addPropColliders, seatY, propBlocked, Builder, door, win, gap } = kit;
  const place = (id, build) => {
    const zn = zoneById[id];
    const b = new Builder(zn.x, zn.z, zn.ry, zn.h);
    b.zone = id;
    b.yard = { x: zn.x, z: zn.z, flat: zn.flat - 2.5 }; // (what stands nearer the edge of the levelled ground than a cell of the heightfield stands on the ground as it is)
    build(b, zn);
  };
  // a hiding place of the plane's part `supply` (PLANE_PARTS[supply]) in the builder's frame
  const part = (b, supply, lx, lz, ly = 0.02) => {
    b.partSpot(lx, lz, ly);
    partSpots[partSpots.length - 1].supply = supply;
  };
  const spawnPoints = [];
  // a window with the glass gone (a way in, over the sill), and a city window: as often broken as not
  const hole = (at, w = 1.2, y0 = 1.05, y1 = 2.0) => ({ at, w, y0, y1 });
  const cw = (...a) => (rng.chance(0.55) ? hole(...a) : win(...a));
  // what has grown since: a clump of weeds or brush at a spot of a builder's frame (they go in with the bushes)
  const weeds = [];
  const weed = (b, lx, lz, scale = 1, ly = null, variant = null) => weeds.push([b.wx(lx, lz), b.wz(lx, lz), scale, ly === null ? null : b.y0 + ly, variant]);
  // what the field map names inside a place (the city's hospital, its station...): { x, z, name }
  const landmarks = [];
  // columns of smoke and fires still burning (world.lights: the client's effects draw them, and they are what the
  // skyline is known by from the bridge): so many to a map, the first that ask
  let towers = 0; // (how many big towers have a name so far)
  let smokes = 0;
  let fires = 0;
  const smoke = (b, lx, ly, lz) => smokes++ < SMOKES && b.light(lx, ly, lz, 'smoke');
  const fire = (b, lx, ly, lz) => fires++ < FIRES && b.light(lx, ly, lz, 'fire');
  const afloat = (p) => {
    props[props.length - 1].afloat = true; // (a boat on the water: nothing is under it, and nothing should be)
    return p;
  };
  const K = { rng, door, win, gap, hole, afloat }; // (what a place of mainland-places.js is built with)

  // THE BRIDGEHEAD: the bluff the bridge comes ashore on. The car is where it stopped, the span behind it in the
  // water; a checkpoint somebody held here once, and gave up.
  const bridge = planBridge({ seed, z: zb, shore: SHORE, deckY: BLUFF });
  place(ZONE.BRIDGEHEAD, (b) => {
    // (local frame: -Z is east, inland; +Z is back out along the bridge; +X is north)
    // (live: the client draws these two itself - the crossing's cutscene drives the car to this very spot)
    b.prop('car', 0, 16, 0.08, { seed: 7 });
    props[props.length - 1].live = true;
    for (let i = 0; i < 8; i++) spawnPoints.push({ x: b.wx(-5 + (i % 4) * 3.2, -2 - Math.floor(i / 4) * 3), z: b.wz(-5 + (i % 4) * 3.2, -2 - Math.floor(i / 4) * 3) });
    // what is left of the last span's end: the edge of the abutment, shut off
    for (const lx of [-3.6, 3.6]) b.prop('jersey_barrier', lx, 37.4, 0, { seed: 1 }); // (the car came through between them)
    b.prop('road_sign', -6.4, 30, PI, { seed: 3 });
    // the checkpoint
    b.prop('military_tent', 13, -6, PI / 2, { seed: 1 });
    b.prop('sandbags', -7, -9, 0.1, { seed: 0 });
    b.prop('sandbags', -9.4, -7, PI / 2 - 0.2, { seed: 1 });
    b.prop('sandbags', 7.4, 4, PI / 2, { seed: 0 });
    b.cont(CONT.AMMO_BOX, 9.4, -9.6, { prop: 'military_crate', ry: 0.3 });
    b.cont(CONT.DUFFEL, 8.6, -1.2, { prop: 'duffel_bag', ry: 0.7, nocollide: true });
    b.cont(CONT.CRATE, -11, 3, { prop: 'crate', ry: 0.2 });
    b.prop('barrel', -8.6, -11.4, 0, { seed: 2 });
    b.light(-8.6, 1.0, -11.4, 'embers');
    b.wreck('pickup_truck', -5.5, -19, 0.2, { seed: 1 });
    b.wreck('car_wreck', 5.4, -14, PI - 0.3, { seed: 2 });
    b.prop('jersey_barrier', 3.4, -20.5, 0.5, { seed: 2 });
    b.prop('streetlight', -6.5, -4, PI / 2, { seed: 0 });
    b.prop('body_bag', 15.5, 1.5, 0.3, { nocollide: true, seed: 0 });
    b.prop('body_bag', 16.6, 2.2, 0.2, { nocollide: true, seed: 1 });
    b.loot(-10, -4);
    b.loot(11, -3);
    b.loot(2, -8);
    b.clear(0, 6, 14);
  });

  // PORT CALDER -----------------------------------------------------------------------------------------------
  // GRID x GRID blocks. Every block is paved and split into lots - four small ones round a cross of alleys, two long
  // ones back to back, or one big one - and what stands on a lot is drawn from the seed, after the places the run
  // needs have been dealt out (the plane's magneto is in a parts shop; two blocks are big, for the towers).
  const lots = [];
  {
    const order = [];
    for (let k = 0; k < GRID * GRID; k++) if (!onSquare((k / GRID) | 0, k % GRID) && !onDiagonal((k / GRID) | 0, k % GRID)) order.push(k);
    for (let i = order.length - 1; i > 0; i--) {
      const j = rng.int(0, i);
      [order[i], order[j]] = [order[j], order[i]];
    }
    // (the diagonal blocks after them, of small lots: the town as dense as the picture draws it)
    for (let k = 0; k < GRID * GRID; k++) if (onDiagonal((k / GRID) | 0, k % GRID) && !goneBlock((k / GRID) | 0, k % GRID)) order.push(k);
    // (the first BIG_BLOCKS of the shuffle are one lot each, the next QUAD_BLOCKS four: the rest as the seed has it.
    // The blocks the ring trims are of small lots whatever their place in it - one dealt a big lot hands it on to the
    // first of the others dealt small ones - and of the rest LONG_BLOCKS are always of two long lots)
    const trim = (k) => trimBlock((k / GRID) | 0, k % GRID);
    const layoutOf = new Map(order.map((k, n) => [k, onDiagonal((k / GRID) | 0, k % GRID) ? 'quad' : n < BIG_BLOCKS ? 'big' : n < BIG_BLOCKS + QUAD_BLOCKS ? 'quad' : null]));
    for (const k of order) {
      if (!trim(k) || layoutOf.get(k) !== 'big') continue;
      const to = order.find((q) => !trim(q) && layoutOf.get(q) === 'quad');
      if (to !== undefined) layoutOf.set(to, 'big');
      layoutOf.set(k, 'quad');
    }
    let longs = [...layoutOf.values()].filter((v) => v === 'long').length;
    for (const k of order) if (longs < LONG_BLOCKS && !trim(k) && layoutOf.get(k) === null) (layoutOf.set(k, 'long'), longs++);
    for (let bi = 0; bi < GRID; bi++) {
      for (let bj = 0; bj < GRID; bj++) {
        const bx = city.x - G2 + (bi + 0.5) * PITCH;
        const bz = city.z - G2 + (bj + 0.5) * PITCH;
        if (onSquare(bi, bj)) continue; // (the square: below)
        const b = new Builder(bx, bz, 0, cityH);
        b.zone = ZONE.CITY;
        b.clear(0, 0, PITCH * 0.72);
        if (goneBlock(bi, bj)) continue; // (the ring's: its curve, verges inside it)
        // which way a lot faces: out of the block, onto the street it stands on. face: the world direction [dx, dz]
        const lot = (lx, lz, w, d, face) => lots.push({ x: bx + lx, z: bz + lz, w, d, ry: Math.atan2(-face[0], -face[1]), bi, bj, what: '' });
        if (trimBlock(bi, bj)) {
          // a block the ring's curve cuts the outer corner off: its paving in quarters, the corner's quarter in strips
          // that stop at the ring's kerb, and a small lot on each of the other three
          const [ox, oz] = [bi < GRID / 2 ? -1 : 1, bj < GRID / 2 ? -1 : 1]; // (which corner is the ring's)
          const Q = PAVED / 2;
          for (const sx of [-1, 1]) {
            for (const sz of [-1, 1]) {
              if (sx !== ox || sz !== oz) {
                b.box((sx * Q) / 2, 0, (sz * Q) / 2, Q, PAVE, Q, 'concrete');
                lot(sx * 11.25, sz * 11.25, 19.5, 19.5, rng.chance(0.5) ? [sx, 0] : [0, sz]);
                continue;
              }
              // (strips 2.5 m wide across the quarter, each out to where the kerb of the ring is: 3.7 m in from its
              // middle, as a street's is)
              const SW = 2.5;
              for (let u = 0; u < Q - 0.01; u += SW) {
                const w = Math.min(SW, Q - u);
                const far = bx - city.x + sx * (u + w); // (the strip's outer side across, in the city's frame)
                const lim = Math.sqrt(Math.max(0, (RING_R - 3.7) ** 2 - (Math.abs(far) - RING_C) ** 2)) + RING_C - Math.abs(bz - city.z); // (how far out from the block's middle along)
                const len = Math.min(Q, lim);
                if (len < 1.5) continue;
                b.box(sx * (u + w / 2), 0, (sz * len) / 2, w, PAVE, len, 'concrete');
              }
            }
          }
          continue;
        }
        b.box(0, 0, 0, PAVED, PAVE, PAVED, 'concrete'); // the pavement, out to the kerb
        const r = rng();
        const layout = layoutOf.get(bi * GRID + bj) || (r < 0.45 ? 'quad' : r < 0.9 ? 'long' : 'big');
        if (layout === 'quad') {
          for (const sx of [-1, 1]) for (const sz of [-1, 1]) lot(sx * 11.25, sz * 11.25, 19.5, 19.5, rng.chance(0.5) ? [sx, 0] : [0, sz]);
        } else if (layout === 'long') {
          if (rng.chance(0.5)) for (const sx of [-1, 1]) lot(sx * 11.25, 0, 42, 19.5, [sx, 0]);
          else for (const sz of [-1, 1]) lot(0, sz * 11.25, 42, 19.5, [0, sz]);
        } else lot(0, 0, 42, 42, [[1, 0], [-1, 0], [0, 1], [0, -1]][rng.int(0, 3)]);
      }
    }
  }
  // The buildings. Each is given a builder at the middle of its lot, front (-Z) on the street, and the lot's size.
  // A building's front wall stands SETBACK in from the lot's edge; a room's floor is FLOOR_Y over the pavement.
  // F, the frame of a room: { w, d, cz, front, back, L, R } - its size, the middle of it, and where its walls are.
  const frame = (L, w, d) => {
    const cz = -L.d / 2 + SETBACK + d / 2;
    return { w, d, cz, front: cz - d / 2, back: cz + d / 2, L: -w / 2, R: w / 2 };
  };
  const WALL = 0.125 + 0.06; // from a wall's line to the face of what stands against it (half the wall, and a gap)
  // (What stands against a wall faces the room: a prop's front is its -Z, which a Builder's ry turns to (-sin ry,
  // -cos ry) - so 0 against the back wall, PI against the front, -PI / 2 against the left, PI / 2 against the right.)
  const backZ = (F, depth) => F.back - WALL - depth / 2;
  const leftX = (F, depth) => F.L + WALL + depth / 2;
  const rightX = (F, depth) => F.R - WALL - depth / 2;
  const inside = { ly: FLOOR_Y };
  const cont = (b, ctype, prop, x, z, ry, o = {}) => b.cont(ctype, x, z, { prop, ry, ly: FLOOR_Y, ...o });

  // ---- What the city is drawn from. The storeys over a ground floor, the walls of a shell, a heap of rubble and
  // the length of a tower lying in the street are solid here (boxes, hidden: nothing draws them as boxes) and are
  // said here for the client's building kit (client/render/citykit.js), which builds what is seen of each: walls
  // with their windows, cornices, fire escapes, storeys cut open on their rooms, rubble that looks like rubble.
  const buildings = []; // a block of storeys: { x, z, ry, y, w, d, floors, fh, style, mat, seed, cut, wear, burnt, blank, ground, top }
  const rooms = []; // a room that is walked into: its walls are parts; the kit lines them, ceils them, hangs its sign
  const shells = []; // walls with the sky behind them: { x0, z0, x1, z1, y, t, mat, fh, heights, seed, soot, inner }
  const heaps = []; // { x, y, z, ry, rx, rz, h, seed, brick }
  const ships = []; // a ship at a quay, drawn only (its solids are hidden parts): { type, x, y, z, ry } (client/render/ships.js)
  const fallenBits = []; // a length of tower lying where it fell: { x, y, z, ry, len, w, h, fh, style, mat, seed }
  const pancakes = []; // floors come down one on another: { x, y, z, ry, w, d, n, seed }
  const signs = []; // a board or a mark from the city's atlas, anywhere: { x, y, z, ry, w, h, cell, ... }
  const hide = () => (parts[parts.length - 1].hidden = true);
  // a solid nothing draws as it is
  const solid = (b, lx, ly, lz, sx, sy, sz, mat, o = {}) => {
    b.box(lx, ly, lz, sx, sy, sz, mat, o);
    hide();
    return parts[parts.length - 1];
  };
  // A block of storeys on (cx, cz) of a builder's frame, w by d, its foot at y0, `floors` of them fh high, in a
  // style of the kit's (walkup, shopflat, slab, office, glass, warehouse, stone) and a wall material. o:
  //   lost   how many of its top storeys are broken: each stands on less of the footprint than the one under it
  //   open   a whole end of it fallen away from storey `from` up (-1 / 1: its -x / +x end), further with every storey
  //   burnt  it burnt out: no glass, soot over every opening
  //   blank  bits: which of its faces (front, right, back, left) are blind walls
  //   top    'slab': its roof is gone, what is left on the slab is under the sky
  // Returns the height of what still stands whole.
  const block = (b, cx, cz, w, d, y0, floors, fh, style, mat, o = {}) => {
    const seed = rng.int(1, 99999);
    const lost = Math.min(o.lost ?? 0, floors - 1);
    const sx = rng.chance(0.5) ? 1 : -1;
    const sz = rng.chance(0.5) ? 1 : -1;
    const open = o.open || 0;
    const from = o.from ?? 1;
    const hw = w / 2;
    const hd = d / 2;
    const cut = [];
    let gone = 0; // how much of the open end is gone at this storey
    for (let f = 0; f < floors; f++) {
      let R = [-hw, hw, -hd, hd];
      const step = rng.range(2, 6.5);
      const bite = rng.chance(0.5);
      if (open && f >= from) {
        if (bite || f === from) gone = Math.min(w * 0.62, gone + step); // (in bites: a storey or two stand on the same line, then more is gone)
        R = open > 0 ? [-hw, hw - gone, -hd, hd] : [-hw + gone, hw, -hd, hd];
      }
      const k = f - (floors - lost);
      if (k >= 0) {
        const left = 1 - (k + 1) / (lost + 1.3); // the share of the floor still there
        const pw = w * (0.42 + 0.5 * left);
        const pd = d * (0.48 + 0.45 * left);
        const S = [sx > 0 ? hw - pw : -hw, sx > 0 ? hw : -hw + pw, sz > 0 ? hd - pd : -hd, sz > 0 ? hd : -hd + pd];
        R = [Math.max(R[0], S[0]), Math.min(R[1], S[1]), Math.max(R[2], S[2]), Math.min(R[3], S[3])];
        if (R[1] - R[0] < 2.5 || R[3] - R[2] < 2.5) {
          floors = f; // (nothing worth the name left of it: the building ends here)
          break;
        }
      }
      cut.push(R[0] === -hw && R[1] === hw && R[2] === -hd && R[3] === hd ? null : R.map((v) => Math.round(v * 100) / 100));
    }
    // (solid: one box for every run of storeys that stand on the same footprint)
    for (let f = 0; f < floors; ) {
      let g = f + 1;
      while (g < floors && JSON.stringify(cut[g]) === JSON.stringify(cut[f])) g++;
      const R = cut[f] || [-hw, hw, -hd, hd];
      solid(b, cx + (R[0] + R[1]) / 2, y0 + f * fh, cz + (R[2] + R[3]) / 2, R[1] - R[0], (g - f) * fh, R[3] - R[2], mat);
      f = g;
    }
    const whole = cut.findIndex((R) => R);
    buildings.push({ x: b.wx(cx, cz), z: b.wz(cx, cz), ry: b.ry, y: b.y0 + y0, w, d, floors, fh, style, mat, seed, cut: cut.some((R) => R) ? cut : undefined, wear: o.wear ?? rng.range(0.35, 0.9), burnt: o.burnt ? 1 : 0, blank: o.blank || 0, ground: y0 - PAVE, top: o.top });
    if ((lost > 1 || open) && rng.chance(0.4)) smoke(b, cx, y0 + floors * fh, cz);
    return y0 + (whole < 0 ? floors : whole) * fh;
  };
  // A room that is walked into, as Builder.room builds it, said for the kit as well: what its openings are, how it
  // is lined. o (besides Builder.room's): tint (which of the kit's paints its walls have), lino (tile on its floor)
  // or boards (floorboards), ceiling ('plaster': a home's, not an office's tiles), ceil (how high it hangs, if lower
  // than the slab), homely (a home: pictures on its walls), burnt (burnt out: sooted, no ceiling), sign (the board
  // over its front: a cell of the city's atlas), plain (a shed: no lining). Returns what it said, for partition(),
  // zone() and lino() to add to: the room's inner walls, the rooms they make of it, what is laid on its floor.
  const groundRoom = (b, cx, cz, w, d, h, mat, sides, o = {}) => {
    b.room(cx, cz, w, d, h, mat, sides, o);
    const R = { x: b.wx(cx, cz), z: b.wz(cx, cz), ry: b.ry, y: b.y0, w, d, h, t: o.t || 0.25, mat, sides, tint: o.tint ?? rng.int(0, 5), floor: o.lino ? 'lino' : o.boards ? 'boards' : undefined, ceiling: o.burnt ? undefined : o.ceiling || (o.roof === 'flat' ? 'ceiling' : undefined), ceil: o.ceil, homely: o.homely ? 1 : undefined, burnt: o.burnt ? 1 : undefined, sign: o.sign, seed: rng.int(1, 99999), walls: [], zones: [], patches: [], cx, cz };
    if (!o.plain) rooms.push(R);
    return R;
  };
  // an inner wall of such a room (as Builder.wall), lined on both faces
  const partition = (b, R, x0, z0, x1, z1, h, mat, ops = []) => {
    b.wall(x0, z0, x1, z1, h, 0.18, mat, ops);
    R.walls.push([x0 - R.cx, z0 - R.cz, x1 - R.cx, z1 - R.cz, h, ops]);
  };
  // one of the rooms the partitions make of it, x0..x1 by z0..z1 of the builder's frame: painted its own colour
  // (tint: one of the kit's paints)
  const r2 = (v) => Math.round(v * 100) / 100;
  const zone = (R, x0, z0, x1, z1, tint) => R.zones.push([r2(Math.min(x0, x1) - R.cx), r2(Math.min(z0, z1) - R.cz), r2(Math.max(x0, x1) - R.cx), r2(Math.max(z0, z1) - R.cz), tint]);
  // ...and tile laid on that room's floor (a kitchen's, a bathroom's), a hand's width in from its walls
  const lino = (R, x0, z0, x1, z1, tint) => R.patches.push([r2(Math.min(x0, x1) - R.cx + 0.13), r2(Math.min(z0, z1) - R.cz + 0.13), r2(Math.max(x0, x1) - R.cx - 0.13), r2(Math.max(z0, z1) - R.cz - 0.13), tint]);
  // is (x, z) of the builder's frame within pad of one of the room's partitions? (What is scattered on a floor does
  // not lie through a wall.)
  const atPartition = (R, x, z, pad) => {
    if (!R) return false;
    for (const [x0, z0, x1, z1] of R.walls) {
      const ax = x0 + R.cx, az = z0 + R.cz, dx = x1 - x0, dz = z1 - z0;
      const t = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz), 0, 1);
      if (Math.hypot(x - ax - dx * t, z - az - dz * t) < pad) return true;
    }
    return false;
  };
  // a fire somebody keeps in a drum, in a room: the one light in it that is not the day's
  const drumFire = (b, lx, lz) => {
    b.prop('barrel', lx, lz, 0, { ly: FLOOR_Y, seed: 2 });
    b.light(lx, FLOOR_Y + 1.0, lz, 'embers');
  };
  // What is left of a wall, from (x0, z0) to (x1, z1) along one axis of the builder's frame: lengths of it, each
  // broken off at its own height (up to H), its window openings holes with the sky in them. soot: it burnt.
  // inner: what its other face is made of (the plaster of the rooms that stood against it).
  const jagged = (b, x0, z0, x1, z1, y0, H, mat, collide = true, o = {}) => {
    const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
    const len = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(2, Math.round(len / 2.6));
    const seg = len / n;
    const heights = [];
    let h = H * rng.range(0.6, 1);
    for (let k = 0; k < n; k++) {
      h = clamp(h + rng.range(-0.4, 0.3) * H, H * 0.14, H);
      const t = (k + 0.5) / n;
      const [cx, cz] = [x0 + (x1 - x0) * t, z0 + (z1 - z0) * t];
      solid(b, cx, y0, cz, alongX ? seg + 0.02 : 0.4, h, alongX ? 0.4 : seg + 0.02, mat, { collide });
      heights.push(Math.round(h * 100) / 100);
    }
    shells.push({ x0: b.wx(x0, z0), z0: b.wz(x0, z0), x1: b.wx(x1, z1), z1: b.wz(x1, z1), y: b.y0 + y0, t: 0.4, mat, fh: 3, heights, seed: rng.int(1, 99999), soot: o.soot ? 1 : 0, inner: o.inner });
  };
  // A heap of what a building came down as, rx by rz across and h high: solid in steps a survivor climbs (0.4 m
  // each: under STEP_HEIGHT), drawn by the kit as rubble. across: it lies in a road (worldcheck.js lets it).
  const heap = (b, lx, lz, rx, rz, h, o = {}) => {
    const ry = o.ry ?? 0;
    const ly = o.ly ?? PAVE;
    const n = Math.max(1, Math.round(h / 0.4));
    for (let k = 0; k < n; k++) {
      // (the mound's own width at the top of this step: the kit's profile is h * (1 - t^2)^0.85)
      const e = Math.sqrt(Math.max(0, 1 - Math.pow(((k + 1) * 0.4) / (h + 0.05), 1 / 0.85)));
      if (e * Math.min(rx, rz) < 0.35) break;
      solid(b, lx, ly, lz, rx * 2 * e * 0.86, (k + 1) * 0.4, rz * 2 * e * 0.86, 'concrete', { ry });
      if (o.across) parts[parts.length - 1].across = true;
    }
    heaps.push({ x: b.wx(lx, lz), y: b.y0 + ly, z: b.wz(lx, lz), ry: b.ry + ry, rx, rz, h, seed: rng.int(1, 99999), brick: o.brick ?? 0.3, ash: o.ash ? 1 : undefined });
    clears.push([b.wx(lx, lz), b.wz(lx, lz), Math.max(rx, rz) + 0.5]);
  };
  // a board or a mark of the city's atlas: its middle at (lx, ly, lz) of the builder's frame, facing the builder's
  // -Z turned by ry
  const signAt = (b, lx, ly, lz, ry, w, h, cell, o = {}) => signs.push({ x: b.wx(lx, lz), y: b.y0 + ly, z: b.wz(lx, lz), ry: b.ry + ry, w, h, cell, ...o });
  // Does a prop of this type fit at (lx, lz) of a builder's frame: clear of every solid prop, of the walls and posts
  // built so far, and of the doorways (a metre and a half of each is kept open), with room left to reach what is
  // searched or picked up beside it? For what is added to a place after what it needs has been put down.
  // (two long vehicles end to end can meet further apart than propBlocked looks - a bus, an articulated truck:
  // none is put down in that band of another)
  const LONG = { semi_truck: 1, school_bus: 1, city_bus: 1 };
  const longClear = (type, x, z) => !LONG[type] || props.every((p) => !LONG[p.type] || Math.max(Math.abs(p.x - x), Math.abs(p.z - z)) <= 12 || Math.hypot(p.x - x, p.z - z) > 13.8);
  // (the parts by 32 m cells, indexed as they are asked for: parts is only pushed to while the world is built)
  const partIndex = new Map();
  let partsIndexed = 0;
  const _pn = [];
  const partsNear = (x, z) => {
    for (; partsIndexed < parts.length; partsIndexed++) {
      const p = parts[partsIndexed];
      const key = Math.floor(p.x / 32) * 4096 + Math.floor(p.z / 32);
      let arr = partIndex.get(key);
      if (!arr) partIndex.set(key, (arr = []));
      arr.push(partsIndexed);
    }
    _pn.length = 0;
    for (let i = Math.floor((x - 30) / 32); i <= Math.floor((x + 30) / 32); i++) for (let j = Math.floor((z - 30) / 32); j <= Math.floor((z + 30) / 32); j++) for (const k of partIndex.get(i * 4096 + j) || []) _pn.push(k);
    return _pn;
  };
  const fits = (b, type, lx, lz, ry = 0, ly = 0) => {
    if (!PROPS[type]) return false;
    const x = b.wx(lx, lz);
    const z = b.wz(lx, lz);
    const wry = b.ry + ry;
    if (propBlocked(type, x, z, wry) || !longClear(type, x, z)) return false;
    const mine = kit.solidsOf(type, x, z, wry);
    if (!mine.length) return true;
    const y0 = b.y0 + ly;
    const y1 = y0 + (PROPS[type]?.size[1] ?? 1);
    const reach = Math.hypot(PROPS[type].size[0], PROPS[type].size[2]) / 2;
    for (const o of openings) if (Math.hypot(o.x - x, o.z - z) < reach + 1.15) return false;
    for (const o of containers) if (Math.hypot(o.x - x, o.z - z) < reach + 0.85) return false;
    for (const o of lootSpawns) if (Math.hypot(o.x - x, o.z - z) < reach + 0.75) return false;
    for (const o of partSpots) if (Math.hypot(o.x - x, o.z - z) < reach + 0.9) return false;
    for (const i of partsNear(x, z)) {
      const p = parts[i];
      if (Math.abs(p.x - x) > 30 || Math.abs(p.z - z) > 30 || p.rx || p.rz || (p.shape !== 'box' && p.shape !== 'cyl')) continue;
      if (p.y + p.sy / 2 < y0 + 0.2 || p.y - p.sy / 2 > y1 - 0.05) continue;
      const q = { x: p.x, z: p.z, hx: p.shape === 'box' ? p.sx / 2 : 0, hz: p.shape === 'box' ? p.sz / 2 : 0, c: Math.cos(p.ry), s: Math.sin(p.ry), r: p.shape === 'box' ? 0 : p.sx / 2 };
      for (const a of mine) if (kit.solidsMeet({ ...a, hx: a.hx + 0.02, hz: a.hz + 0.02 }, q)) return false;
    }
    return true;
  };
  // ...put there if it does (after its draws: what is left out moves nothing else)
  const extra = (b, type, lx, lz, ry = 0, o = {}) => {
    const sd = rng.int(0, 99);
    if (PROPS[type] && (PROPS[type].boxes || PROPS[type].cyls) && !fits(b, type, lx, lz, ry, o.ly ?? 0)) return false;
    if (PROPS[type] && o.ly === undefined && b.open(b.wx(lx, lz), b.wz(lx, lz))) {
      // (out on the ground: not across a bank or a ditch - it would hang in the air at one end)
      const r = Math.hypot(PROPS[type].size[0], PROPS[type].size[2]) / 2;
      const [x, z] = [b.wx(lx, lz), b.wz(lx, lz)];
      const h0 = heightAt(x, z);
      if (Math.abs(h0 - b.y0) > 0.07) return false; // (nor where the ground has left the place's own level)
      if (r > 0.6 && [[r, 0], [-r, 0], [0, r], [0, -r]].some(([dx, dz]) => Math.abs(heightAt(x + dx, z + dz) - h0) > (r > 2 ? 0.3 : 0.14))) return false;
    }
    b.prop(type, lx, lz, ry, { seed: sd, ...o, nocollide: !(PROPS[type]?.boxes || PROPS[type]?.cyls) });
    return true;
  };

  // soot up a wall from the windows a fire came out of, and what has grown up it since (ivy needs a wall 5 m high)
  const ivyOn = (b, cx, cz, w, d, y0, h) => {
    const here = rng.chance(0.45);
    const face = rng.int(0, 2); // (never the front: the door is in it)
    const at = rng.range(-0.3, 0.3);
    const sd = rng.int(0, 2);
    if (!here || y0 + h < 5) return;
    if (face === 0) b.prop('ivy', cx + at * (w - 4), cz + d / 2 + 0.04, PI, { nocollide: true, seed: sd, ly: PAVE });
    else b.prop('ivy', cx + (face === 1 ? 1 : -1) * (w / 2 + 0.04), cz + at * (d - 4), face === 1 ? -PI / 2 : PI / 2, { nocollide: true, seed: sd, ly: PAVE });
  };
  // what fell out of a wall, at its foot: lumps and slabs on the pavement (nothing solid: it is walked over)
  const skirt = (b, x, z, ly = PAVE) => {
    b.prop('debris', x, z, rng.range(0, 6), { nocollide: true, ly, seed: rng.int(0, 2) });
    // (pieces of the paving broken up, lying on the ground beside it - flat and half sunk, no plate tipped in the air)
    for (let k = rng.int(1, 2); k > 0; k--) {
      const [sx, sy, sz] = [x + rng.range(-1.6, 1.6), ly + rng.range(0, 0.25), z + rng.range(-1, 1)];
      const [w, d, ry, rz, rx] = [rng.range(1.1, 2.4), rng.range(0.9, 1.7), rng.range(0, 3), rng.range(-0.55, 0.55) * 0.45, rng.range(-0.2, 0.2) * 0.5];
      b.box(sx, ly - 0.07 + (sy - ly) * 0.05, sz, w * 0.45, 0.12, d * 0.45, 'concrete', { ry, rz: rz * 0.25, rx: rx * 0.25, collide: false });
    }
  };
  // the stairs up, in a corner of a ground floor: gone under what fell down them
  const stairBlock = (b, x, z) => {
    b.box(x, FLOOR_Y, z, 2.2, 1.5, 1.4, 'concrete');
    b.box(x + 0.2, FLOOR_Y + 1.3, z - 0.1, 2.4, 0.25, 1.6, 'concrete', { rz: 0.3, collide: false });
    b.box(x - 0.5, FLOOR_Y + 1.5, z + 0.2, 0.12, 1.4, 0.12, 'rust', { rz: -0.3, collide: false });
    b.prop('debris', x, z - 1.5, rng.range(0, 6), { nocollide: true, ly: FLOOR_Y });
  };
  // what came down off a lot into the street in front of it: a heap at the kerb (not where the tower's top lies:
  // that stretch has rubble of its own)
  let fallenAt = null; // [x, z] of the middle of the stretch of street the tower fell across
  const streetPile = (b, L, lx) => {
    const [x, z] = [b.wx(lx, -L.d / 2 - 1.3), b.wz(lx, -L.d / 2 - 1.3)];
    const [rx, h] = [rng.range(1.6, 2.4), rng.range(0.8, 1.3)];
    if (fallenAt && Math.abs(x - fallenAt[0]) < 26 && Math.abs(z - fallenAt[1]) < 26) return;
    heap(b, lx, -L.d / 2 - 1.3, rx, 1.2, h, { across: true, brick: 0.5 });
  };
  // what lies along the front of a lot, on the pavement: rubbish, what fell off the building, weeds at the wall's foot
  const frontage = (b, L, F, shop = false) => {
    const z = -L.d / 2 + 0.55;
    for (let k = rng.int(2, 4); k > 0; k--) {
      const r = rng();
      const x = rng.range(-L.w / 2 + 2, L.w / 2 - 2);
      b.prop(r < 0.4 ? 'litter' : r < 0.6 ? 'debris' : r < 0.72 ? 'suitcases' : r < 0.82 ? 'glass_shards' : r < 0.9 ? 'paper_scatter' : 'shopping_cart', x, z + rng.range(-0.2, 0.5), rng.range(0, 6), { nocollide: true, ly: PAVE, seed: (r * 97) | 0 });
    }
    for (let k = rng.int(2, 5); k > 0; k--) weed(b, rng.range(-L.w / 2 + 0.6, L.w / 2 - 0.6), z + rng.range(-0.3, 0.4), rng.range(0.5, 0.9));
    const sign = rng.chance(0.3);
    const sx = rng.range(-3, 3);
    if (shop && sign) b.prop('fallen_sign', sx, z + 0.1, rng.range(-0.3, 0.3), { nocollide: true, ly: PAVE });
    if (shop && F) {
      // (a window boarded up, as often as not)
      const board = rng.chance(0.5);
      const side = rng.chance(0.5) ? 0.3 : -0.3;
      for (let k = 0; k < 4; k++) {
        const tilt = rng.range(-0.12, 0.12);
        if (board) b.box(F.w * side, 0.9 + k * 0.5, F.front - 0.17, Math.min(3.4, F.w * 0.24), 0.2, 0.04, 'planks', { rz: tilt, collide: false });
      }
    }
    if (shop && F && rng.chance(0.6)) b.prop('awning', F.w * (rng.chance(0.5) ? 0.2 : -0.2), F.front - 0.14, 0, { nocollide: true, ly: 2.75, seed: rng.int(0, 1) });
    if (F && rng.chance(0.3)) b.prop('skeleton', rng.range(-L.w / 2 + 2, L.w / 2 - 2), F.front - 0.75, PI, { nocollide: true, ly: PAVE, seed: 1 }); // (sat down against the wall, and stayed)
  };

  // what is behind a building: bins, a pallet, rubbish, and what has come up through the paving
  const yard = (b, F, L) => {
    if (rng.chance(0.6)) b.cont(CONT.DUMPSTER, F.L + 2.2, F.back + 1.6, { prop: 'dumpster', ry: PI, ly: PAVE });
    if (rng.chance(0.5)) b.prop('pallet', F.L + 5.2, F.back + 1.4, rng.range(0, 3), { ly: PAVE });
    const deep = L.d / 2 - F.back;
    if (deep > 4.5 && rng.chance(0.75)) b.tree(rng.range(-L.w / 2 + 2.5, L.w / 2 - 2.5), L.d / 2 - 2.2, [3, 4, 5, 5][rng.int(0, 3)], rng.range(0.6, 1.15));
    if (rng.chance(0.3)) b.prop(rng.chance(0.5) ? 'corpse' : 'skeleton', rng.range(-3, 3), F.back + 3.2, rng.range(0, 6), { nocollide: true, ly: PAVE, seed: rng.int(0, 2) });
    for (let k = rng.int(2, 3); k > 0; k--) b.prop(['litter', 'debris', 'glass_shards', 'bicycle', 'paper_scatter'][rng.int(0, 4)], rng.range(-L.w / 2 + 2, L.w / 2 - 2), F.back + rng.range(1.5, Math.max(1.6, deep - 1.5)), rng.range(0, 6), { nocollide: true, ly: PAVE, seed: rng.int(0, 2) });
    extra(b, 'trash_bin', F.R - 1.2, F.back + 1.1, 0, { ly: PAVE });
    for (let k = rng.int(4, 8); k > 0; k--) weed(b, rng.range(-L.w / 2 + 0.5, L.w / 2 - 0.5), rng.range(F.back + 0.6, L.d / 2 - 0.4), rng.range(0.6, 1.3));
    for (const sx of [-1, 1]) for (let k = 0; k < 2; k++) weed(b, sx * (L.w / 2 - 0.5), rng.range(F.front, F.back), rng.range(0.6, 1.1)); // (down the alleys)
    frontage(b, L, F, true);
  };
  // The mess a room was left in: rubbish, luggage, chairs kicked over, bones, what came down through the ceiling,
  // blood. None of it solid (it is walked over, and it blocks no door: kinds with no collider); none of it standing
  // in furniture. h: the room's ceiling (lamps hang from it).
  const MESS = ['litter', 'debris', 'paper_scatter', 'suitcases', 'ceiling_debris', 'stock_spill', 'bones', 'litter', 'body_bag', 'blood_pool', 'glass_shards', 'corpse', 'office_chair', 'skeleton', 'rug', 'paper_scatter'];
  // R: the room, if it has partitions (nothing lies through one, no lamp hangs in one)
  const mess = (b, F, n, h = 0, R = null) => {
    for (let k = 0; k < n; k++) {
      const type = MESS[rng.int(0, MESS.length - 1)];
      const x = rng.range(F.L + 1, F.R - 1);
      const z = rng.range(F.front + 1, F.back - 1);
      const ry = rng.range(0, 6);
      const sd = rng.int(0, 3);
      if (propBlocked('table', b.wx(x, z), b.wz(x, z), b.ry + ry) || atPartition(R, x, z, 1.5)) continue;
      b.prop(type, x, z, ry, { nocollide: true, ly: FLOOR_Y, seed: sd });
    }
    for (let k = Math.max(1, Math.round(n / 4)); k > 0; k--) {
      const x = rng.range(F.L + 1.6, F.R - 1.6);
      const z = rng.range(F.front + 1.6, F.back - 1.6);
      const [sx, sz, ry, rz] = [rng.range(1.2, 2.4), rng.range(0.9, 1.6), rng.range(0, 3), rng.range(-0.16, 0.16)];
      const [cx, cz, ch, crz, crx] = [x + rng.range(-1, 1), z + rng.range(-1, 1), rng.range(1.2, 2.2), rng.range(-0.5, 0.5), rng.range(-0.3, 0.3)];
      if (atPartition(R, x, z, 1.5)) continue;
      b.box(x, FLOOR_Y + 0.04, z, sx, 0.12, sz, 'concrete', { ry, rz, collide: false });
      if (!atPartition(R, cx, cz, 0.7)) b.box(cx, FLOOR_Y + 1.2, cz, 0.08, ch, 0.08, 'rust', { rz: crz, rx: crx, collide: false }); // (a conduit hanging out of the ceiling)
    }
    if (h) for (let x = F.L + 3; x < F.R - 2; x += 5.5) for (const z of F.d > 10 ? [F.cz - F.d * 0.22, F.cz + F.d * 0.22] : [F.cz]) {
      const [ry, sd] = [rng.chance(0.5) ? 0 : PI / 2, rng.int(0, 2)];
      if (!atPartition(R, x, z, 0.9)) b.prop('ceiling_lamp', x, z, ry, { nocollide: true, ly: h, seed: sd });
    }
  };
  // ...the same in one room of a partitioned floor, x0..x1 by z0..z1: a few things, clear of its walls
  const HOME_MESS = ['litter', 'paper_scatter', 'suitcases', 'litter', 'glass_shards', 'bones', 'ceiling_debris', 'paper_scatter', 'blood_pool', 'debris'];
  const messIn = (b, x0, z0, x1, z1, n, lampAt = 0) => {
    const [xa, xb, za, zb] = [Math.min(x0, x1) + 0.9, Math.max(x0, x1) - 0.9, Math.min(z0, z1) + 0.9, Math.max(z0, z1) - 0.9];
    for (let k = 0; k < n; k++) {
      const type = HOME_MESS[rng.int(0, HOME_MESS.length - 1)];
      const [x, z, ry, sd] = [rng.range(xa, Math.max(xa, xb)), rng.range(za, Math.max(za, zb)), rng.range(0, 6), rng.int(0, 3)];
      if (xb - xa < 0.6 || zb - za < 0.6 || type === 'ceiling_debris' && Math.min(xb - xa, zb - za) < 1.4) continue;
      b.prop(type, x, z, ry, { nocollide: true, ly: FLOOR_Y, seed: sd });
    }
    if (lampAt) b.prop('ceiling_lamp', (x0 + x1) / 2, (z0 + z1) / 2, Math.abs(x1 - x0) > Math.abs(z1 - z0) ? 0 : PI / 2, { nocollide: true, ly: lampAt, seed: rng.int(0, 2) });
  };
  // ---- A flat. The ground floor of a block of flats is homes: off the common hall, between its wall (x = xh) and
  // the wall the flat shares with next door or with the street's side (x = xo), two rows of rooms, front to back -
  // by the far wall a living room on the street, the kitchen behind it and a bedroom at the back; by the hall a
  // small room on the street, the flat's own passage, which every door of it opens off, and the bathroom. Each is
  // painted its own way and has what was in it. o.stairs: the small front room is the block's stair well, open to
  // the hall, under what came down it. o.keep: what is searched in it ('fridge', 'cabinet', 'locker', 'duffel').
  const FLAT_CEIL = 2.7; // a home's ceiling (the slab is over it)
  const flatUnit = (b, R, F, xh, xo, o = {}) => {
    const sg = xo > xh ? 1 : -1;
    const W = Math.abs(xo - xh);
    const X = (u) => xh + sg * u;
    const Z = (v) => F.front + v;
    const C = 3.5; // (the wall between the two rows)
    const H = R.h;
    const rO = sg > 0 ? PI / 2 : -PI / 2; // (turned to stand against a wall on the far side of it, facing the room; rH: on the hall's)
    const rH = -rO;
    // its walls
    if (o.stairs) {
      partition(b, R, X(0), Z(3.5), X(0), F.back, H, 'concrete', [door(3.7, 1.3)]);
      partition(b, R, X(0), Z(3.5), X(C), Z(3.5), H, 'concrete');
      stairBlock(b, X(1.95), Z(2.6));
    } else {
      partition(b, R, X(0), F.front, X(0), F.back, H, 'concrete', [door(7.2, 1.3)]);
      partition(b, R, X(0), Z(3.5), X(C), Z(3.5), H, 'concrete', [door(1.75, 1.2)]);
    }
    partition(b, R, X(C), F.front, X(C), F.back, H, 'concrete', [door(4.35, 1.2), door(7.2, 1.2), door(10.05, 1.2)]);
    partition(b, R, X(C), Z(5.2), xo, Z(5.2), H, 'concrete');
    partition(b, R, X(C), Z(9.2), xo, Z(9.2), H, 'concrete');
    partition(b, R, X(0), Z(10.9), X(C), Z(10.9), H, 'concrete', [door(1.75, 1.2)]);
    // its rooms: each its own paint; tile in the kitchen and the bathroom
    const paint = () => rng.int(0, 5);
    if (!o.stairs) zone(R, X(0), Z(0), X(C), Z(3.5), paint());
    zone(R, X(0), Z(3.5), X(C), Z(10.9), paint());
    zone(R, X(0), Z(10.9), X(C), Z(14), paint());
    zone(R, X(C), Z(0), xo, Z(5.2), paint());
    zone(R, X(C), Z(5.2), xo, Z(9.2), paint());
    zone(R, X(C), Z(9.2), xo, Z(14), paint());
    lino(R, X(C), Z(5.2), xo, Z(9.2), rng.int(0, 5));
    lino(R, X(0), Z(10.9), X(C), Z(14), rng.int(0, 5));
    const keep = o.keep || '';
    // the living room: a sofa and the set it faced, an armchair, shelves
    b.prop('sofa', X(5.75), Z(4.5), 0, { ly: FLOOR_Y, seed: rng.int(0, 2) });
    extra(b, 'tv_set', X(5.9), Z(0.46), PI, inside);
    extra(b, 'armchair', X(W - 0.72), Z(2.3), rO, inside);
    extra(b, 'bookshelf', X(C + 0.62), Z(1.3), rH, inside);
    b.prop('rug', X(5.8), Z(2.5), rng.range(-0.2, 0.2), { nocollide: true, ly: FLOOR_Y, seed: rng.int(0, 2) });
    // the kitchen: units and the stove along the far wall, the table they ate at, the fridge
    extra(b, 'kitchen_counter', X(W - 0.52), Z(6.6), rO, inside);
    extra(b, 'stove', X(W - 0.54), Z(8.2), rO, inside);
    b.prop('kitchen_table', X(5.4), Z(7.3), rng.range(-0.15, 0.15), inside);
    b.loot(X(5.4), Z(7.3), FLOOR_Y + 0.87);
    for (const [du, dv, r] of [[0, -0.75, 0], [0.1, 0.8, PI]]) b.prop('chair', X(5.4 + du), Z(7.3 + dv), r + rng.range(-0.5, 0.5), { nocollide: true, ly: FLOOR_Y, seed: rng.int(0, 2) });
    if (keep.includes('fridge')) cont(b, CONT.FRIDGE, 'fridge', X(4.3), Z(8.68), 0);
    // the bedroom: a bed made up for two, a wardrobe, a chest of drawers
    b.prop('double_bed', X(W - 1.25), Z(12.78), 0, inside);
    extra(b, 'wardrobe', X(5.9), Z(9.68), PI, inside);
    extra(b, 'dresser', X(C + 0.62), Z(12.6), rH, inside);
    if (keep.includes('cabinet')) cont(b, CONT.CABINET, 'cabinet', X(5.0), Z(13.52), 0);
    b.prop('rug', X(5.2), Z(11.4), PI / 2 + rng.range(-0.2, 0.2), { nocollide: true, ly: FLOOR_Y, seed: rng.int(0, 2) });
    // the small room on the street: somebody's - a bed, a table under the window
    if (!o.stairs) {
      b.prop('bed', X(0.68), Z(1.42), 0, { ly: FLOOR_Y, seed: rng.int(0, 1) });
      extra(b, 'table', X(C - 0.62), Z(1.25), rO, inside);
      b.prop('chair', X(2.0), Z(1.3), rO + rng.range(-0.4, 0.4), { nocollide: true, ly: FLOOR_Y });
      b.loot(X(1.75), Z(2.55), FLOOR_Y + 0.02);
    } else b.loot(X(W - 2.9), Z(11.2), FLOOR_Y + 0.02);
    // the passage: a chest against the hall's wall, what was dropped on the way out
    extra(b, 'dresser', X(0.62), Z(5.3), rH, inside);
    if (keep.includes('locker')) cont(b, CONT.LOCKER, 'locker', X(0.42), Z(9.3), rH);
    if (keep.includes('duffel')) b.cont(CONT.DUFFEL, X(2.3), Z(8.9), { prop: 'duffel_bag', ry: 0.8, nocollide: true, ly: FLOOR_Y });
    b.prop('rug', X(1.75), Z(7.2), PI / 2, { nocollide: true, ly: FLOOR_Y, seed: rng.int(0, 2) });
    // the bathroom
    extra(b, 'bathtub', X(0.58), Z(12.95), 0, inside);
    extra(b, 'toilet', X(2.6), Z(13.45), 0, inside);
    // what the years left on its floors; a lamp over each of the rooms that were lived in
    messIn(b, X(C), Z(0), xo, Z(5.2), 2, FLAT_CEIL);
    messIn(b, X(C), Z(5.2), xo, Z(9.2), 1, FLAT_CEIL);
    messIn(b, X(C), Z(9.2), xo, Z(14), 2, FLAT_CEIL);
    messIn(b, X(0), Z(3.5), X(C), Z(10.9), 2);
  };
  // rows of shelving down the middle of a shop's floor, what they held swept off them, clear of its counter and doors
  const aisles = (b, F) => {
    for (const dx of [4.2, 7.4, 10.6, 13.6]) {
      if (F.L + dx > F.R - 4.4) continue;
      extra(b, 'shop_gondola', F.L + dx, F.cz + 1.2, PI / 2, inside);
      extra(b, 'shop_gondola', F.L + dx, F.cz - 2.2, PI / 2, { ly: FLOOR_Y, seed: 1 });
      b.prop('stock_spill', F.L + dx + rng.range(-0.3, 1.4), F.cz + rng.range(-1.6, 2.2), rng.range(0, 6), { nocollide: true, ly: FLOOR_Y, seed: rng.int(0, 2) });
    }
  };
  // a shop's counter: the till on it, what is searched for on its top
  const counter = (b, x, z, ry = 0) => {
    b.prop('checkout_counter', x, z, ry, inside);
    b.loot(x, z, FLOOR_Y + 0.98);
  };
  // what is in a shop, by what it sold. Each fills a room of any width from 12 m up, clear of its two doors.
  const FILL = {
    grocery(b, F) {
      counter(b, F.L + 3, F.front + 3.2);
      for (const dx of [1.6, 3.9, 6.2]) cont(b, CONT.SHELF, 'shelf', F.L + dx, backZ(F, 0.5), 0);
      cont(b, CONT.SHELF, 'shelf', F.R - 4.6, F.cz + 0.4, PI / 2);
      cont(b, CONT.FRIDGE, 'fridge', rightX(F, 0.72), F.cz - 0.2, PI / 2);
      b.loot(F.R - 3, F.cz - 2.4, FLOOR_Y + 0.02);
      aisles(b, F);
      extra(b, 'display_fridge', rightX(F, 0.75), F.cz + 2.2, PI / 2, inside);
      extra(b, 'display_fridge', rightX(F, 0.75), F.cz - 2.4, PI / 2, { ly: FLOOR_Y, seed: 1 });
      extra(b, 'vending_machine', leftX(F, 0.86), F.cz - 0.4, -PI / 2, inside);
      b.prop('shopping_cart', F.R - 2.6, F.front + 2, 0.7, { nocollide: true, ly: FLOOR_Y });
    },
    pharmacy(b, F) {
      counter(b, F.L + 4.2, F.cz + 0.4);
      for (const dx of [1.2, 2.3]) cont(b, CONT.MEDICINE, 'medicine_cabinet', F.L + dx, backZ(F, 0.45), 0);
      cont(b, CONT.CABINET, 'cabinet', F.L + 4.2, backZ(F, 0.55), 0);
      cont(b, CONT.SHELF, 'shelf', rightX(F, 0.5), F.cz - 1.4, PI / 2);
      b.prop('wheelchair', F.L + 1.6, F.front + 2.2, 0.6, { nocollide: true, ly: FLOOR_Y });
      b.loot(F.R - 2.4, F.cz + 1.6, FLOOR_Y + 0.02);
      extra(b, 'shop_gondola', F.R - 5.4, F.cz - 2.4, 0, inside);
      extra(b, 'waiting_chairs', F.R - 2.2, F.front + WALL + 0.4, PI, inside);
      b.prop('stock_spill', F.R - 4.4, F.cz - 0.6, rng.range(0, 6), { nocollide: true, ly: FLOOR_Y, seed: rng.int(0, 2) });
    },
    hardware(b, F) {
      counter(b, F.L + 3, F.front + 3.4);
      b.cont(CONT.TOOLBOX, F.L + 3.6, F.front + 3.4, { prop: 'toolbox', ry: 0.3, nocollide: true, ly: FLOOR_Y + 0.96 });
      for (const dx of [1.6, 3.9]) cont(b, CONT.SHELF, 'shelf', F.L + dx, backZ(F, 0.5), 0);
      cont(b, CONT.CRATE, 'crate', F.L + 6.6, backZ(F, 1), 0.1);
      cont(b, CONT.SHELF, 'shelf', F.R - 4.6, F.cz, PI / 2);
      b.prop('tire_pile', rightX(F, 1.4), F.cz - 2.6, 0, inside);
      aisles(b, F);
      b.loot(F.R - 3, F.cz + 2, FLOOR_Y + 0.02);
      b.loot(F.L + 1.4, F.cz - 1, FLOOR_Y + 0.02);
    },
    diner(b, F) {
      const len = F.w - 8;
      b.box(F.L + 1.2 + len / 2, FLOOR_Y, F.cz + 2.2, len, 1.05, 0.7, 'planks'); // the counter
      b.box(F.L + 1.2 + len / 2, FLOOR_Y + 1.05, F.cz + 2.2, len + 0.1, 0.05, 0.86, 'metal', { collide: false });
      b.loot(F.L + 2.4, F.cz + 2.2, FLOOR_Y + 1.12);
      cont(b, CONT.FRIDGE, 'fridge', F.L + 1.1, backZ(F, 0.72), 0);
      cont(b, CONT.CABINET, 'cabinet', F.L + 2.8, backZ(F, 0.55), 0);
      extra(b, 'stove', F.L + 4.4, backZ(F, 0.66), 0, inside);
      extra(b, 'kitchen_counter', F.L + 6.2, backZ(F, 0.63), 0, inside);
      for (const tx of [F.L + 2.2, F.R - 2.2]) {
        b.prop('table', tx, F.front + 2.4, 0.05, inside);
        b.prop('chair', tx - 1.2, F.front + 2.5, PI / 2, inside);
        b.prop('chair', tx + 1.2, F.front + 2.3, -PI / 2, inside);
      }
      b.loot(F.R - 2.2, F.front + 2.4, FLOOR_Y + 0.82);
      // (more tables down the front, where there is the width for them)
      for (const tx of F.w > 16 ? [-3.6, 3.6] : []) {
        b.prop('table', tx, F.front + 2.4, 0.05, inside);
        b.prop('chair', tx, F.front + 3.5, 0.3, { nocollide: true, ly: FLOOR_Y });
      }
      extra(b, 'vending_machine', rightX(F, 0.86), F.cz + 1.2, PI / 2, inside);
    },
    // Calder Aero Supply: where the plane's magneto is
    aero(b, F) {
      FILL.hardware(b, F);
      part(b, 1, F.R - 1.4, F.cz - 0.6, FLOOR_Y + 0.02);
    },
  };
  // the shops of a street: [what it sells (a FILL), its wall, the board over its door]
  const SHOP = {
    grocery: ['grocery', 'brick', 'shop_grocery'],
    pharmacy: ['pharmacy', 'plaster', 'shop_pharmacy'],
    hardware: ['hardware', 'brick', 'shop_hardware'],
    diner: ['diner', 'plaster', 'shop_diner'],
    aero: ['aero', 'brick', 'shop_aero'],
    liquor: ['grocery', 'brick', 'shop_liquor'],
    pawn: ['hardware', 'plaster', 'shop_pawn'],
    laundry: ['pharmacy', 'plaster', 'shop_laundry'],
    bakery: ['diner', 'brick', 'shop_bakery'],
    bar: ['diner', 'brick', 'shop_bar'],
    books: ['hardware', 'plaster', 'shop_books'],
  };
  const TERRACE = ['grocery', 'liquor', 'laundry', 'bakery', 'bar', 'books', 'pawn', 'diner', 'hardware'];
  // A shop's room: a glass front with the door in the middle of it, a yard door at the back's right-hand end. x0:
  // where its middle is along the lot (a terrace has three). Returns its builder, its frame and what was said of it.
  const shopRoom = (b, L, w, d, kind, x0 = 0, alone = true) => {
    const [, mat, sign] = SHOP[kind];
    const s = b.sub(x0, 0);
    const F = frame(L, w, d);
    const ww = Math.min(3, w * 0.22);
    // (a shop on a lot of its own may have had a wall blown in: one more way through it)
    const breach = alone && rng.chance(0.4);
    const R = groundRoom(s, 0, F.cz, w, d, 3.8, mat === 'plaster' ? 'concrete' : mat, { n: [door(w / 2, 1.6), cw(w * 0.2, ww, 0.8, 2.8), cw(w * 0.8, ww, 0.8, 2.8)], s: [door(2.4, 1.1)], w: breach ? [gap(d * 0.72, 2.6, 2.9)] : [] }, { roof: 'flat', roofMat: 'concrete', floorMat: 'concrete', lino: true, sign });
    // (the stock room behind: a door into it, and the wall down at its other end - the way to the yard door)
    partition(s, R, F.L, F.cz + 4.2, F.R, F.cz + 4.2, 3.8, 'concrete', [door(w * 0.3, 1.3), gap(w - 2.6, 2.2, 2.7)]);
    // (...and between the two, behind a door off the stock room: the office of a shop on a lot of its own, a
    // closet where three share a roof)
    const [ox0, ox1] = [F.L + 7.7, F.R - 3.9];
    partition(s, R, ox0, F.cz + 4.2, ox0, F.back, 3.8, 'concrete', [door(1.27, 1.2)]);
    partition(s, R, ox1, F.cz + 4.2, ox1, F.back, 3.8, 'concrete');
    zone(R, F.L, F.cz + 4.2, ox0, F.back, 5);
    zone(R, ox0, F.cz + 4.2, ox1, F.back, rng.int(0, 4));
    if (alone) {
      extra(s, 'office_desk', (ox0 + ox1) / 2 + 0.6, backZ(F, 0.8), 0, inside);
      s.prop('office_chair', (ox0 + ox1) / 2 + 0.5, F.back - 1.5, rng.range(0, 6), { nocollide: true, ly: FLOOR_Y, seed: rng.int(0, 1) });
      extra(s, 'filing_cabinet', ox1 - 0.09 - 0.06 - 0.3, F.back - WALL - 0.62, 0, inside);
      s.prop('paper_scatter', (ox0 + ox1) / 2, F.cz + 5.4, rng.range(0, 6), { nocollide: true, ly: FLOOR_Y, seed: rng.int(0, 2) });
    } else extra(s, 'toilet', ox1 - 0.09 - 0.06 - 0.26, F.back - WALL - 0.36, 0, inside);
    if (breach) {
      s.prop('debris', F.L + 1.2, F.cz + d * 0.22, rng.range(0, 6), { nocollide: true, ly: FLOOR_Y });
      skirt(s, F.L - 1.2, F.cz + d * 0.22);
    }
    s.prop('glass_shards', -w * 0.3, F.front + 0.9, rng.range(0, 6), { nocollide: true, ly: FLOOR_Y, seed: rng.int(0, 2) });
    s.prop('litter', rng.range(-2, 2), F.cz - 1.5, rng.range(0, 6), { nocollide: true, ly: FLOOR_Y, seed: rng.int(0, 2) });
    // (after what the shop is furnished with: what was left lies round that - and here and there somebody has kept a
    // fire in a drum on the shop floor since)
    s.mess = () => {
      const fire = alone && rng.chance(0.3);
      if (fire && fits(s, 'barrel', F.R - 3.2, F.front + 4.6, 0, FLOOR_Y)) drumFire(s, F.R - 3.2, F.front + 4.6);
      // (more shelving down the side wall - not across a wall that was blown in)
      if (!breach) extra(s, 'shelf', leftX(F, 0.5), F.cz - 3.6, -PI / 2, inside);
      if (!breach) extra(s, 'shelf', leftX(F, 0.5), F.cz + 1.9, -PI / 2, { ly: FLOOR_Y, seed: 1 });
      mess(s, { ...F, back: F.cz + 4.2 }, alone ? 9 : 6, 3.8, R);
    };
    return [s, F, mat];
  };
  // how a building has come through it: [lost, open] for block() - most have lost a storey or two off the top, one
  // in four has an end fallen away
  const ruinOf = (floors) => {
    const r = rng();
    const lost = r < 0.3 ? 0 : rng.int(1, Math.min(3, floors - 1));
    const open = rng.chance(0.24) && floors > 2 ? (rng.chance(0.5) ? 1 : -1) : 0;
    return { lost, open, from: rng.int(0, 1), top: !lost && rng.chance(0.25) ? 'slab' : undefined };
  };
  const BUILD = {
    shop(b, L, kind) {
      const [s, F, mat] = shopRoom(b, L, 18.4, 13.5, kind);
      FILL[SHOP[kind][0]](s, F);
      s.mess();
      const floors = rng.int(1, 4);
      block(b, 0, F.cz, F.w, F.d, 4.1, floors, 3, 'shopflat', mat, { ...ruinOf(floors), blank: rng.chance(0.5) ? 2 : rng.chance(0.5) ? 8 : 0 }); // (flats over the shop: shut, as every upper floor is)
      ivyOn(b, 0, F.cz, F.w, F.d, 0, 4.1 + floors * 3);
      yard(b, F, L);
    },
    // a row of three shops under one roof
    terrace(b, L) {
      const F = frame(L, 41.1, 13.5);
      const U = F.w / 3;
      const k0 = rng.int(0, TERRACE.length - 1);
      const floors = rng.int(1, 3);
      const mat = rng.chance(0.5) ? 'brick' : 'plaster';
      block(b, 0, F.cz, F.w, F.d, 4.1, floors, 3, 'shopflat', mat, ruinOf(floors));
      for (let k = 0; k < 3; k++) {
        const kind = TERRACE[(k0 + k * 2) % TERRACE.length];
        const [s, Fu] = shopRoom(b, L, U, 13.5, kind, (k - 1) * U, false);
        FILL[SHOP[kind][0]](s, Fu);
        s.mess();
      }
      yard(b, F, L);
      b.wreck(rng.chance(0.5) ? 'car_wreck' : 'car_burnt', F.R - 6, F.back + 3.4, PI / 2 + rng.range(-0.2, 0.2), { ly: PAVE, trunk: rng.chance(0.5) });
    },
    // the police station: a front office, the cells, and behind a door the armoury
    police(b, L) {
      const F = frame(L, 18.4, 13.5);
      block(b, 0, F.cz, F.w, F.d, 3.9, rng.int(1, 2), 3, 'walkup', 'brick', { lost: 0, wear: 0.5 });
      const R = groundRoom(b, 0, F.cz, F.w, F.d, 3.6, 'brick', { n: [door(F.w / 2, 1.5), win(F.w * 0.2, 1.6), win(F.w * 0.8, 1.6)], s: [door(2.4, 1.1)], w: [win(F.d * 0.7, 1.2, 1.5, 2.2)] }, { roof: 'flat', roofMat: 'concrete', floorMat: 'concrete', lino: true, sign: 'police', tint: 2 });
      partition(b, R, F.L, F.cz + 1.5, F.R, F.cz + 1.5, 3.6, 'brick', [door(4, 1.2)]);
      // (behind it: the cells' own room, the armoury behind a door of its own, the back office by the yard door)
      partition(b, R, -2.6, F.cz + 1.5, -2.6, F.back, 3.6, 'brick', [door(1.5, 1.2)]);
      partition(b, R, 4, F.cz + 1.5, 4, F.back, 3.6, 'brick', [door(1.5, 1.2)]);
      zone(R, F.L, F.cz + 1.5, -2.6, F.back, 5);
      zone(R, -2.6, F.cz + 1.5, 4, F.back, 0);
      zone(R, 4, F.cz + 1.5, F.R, F.back, 3);
      extra(b, 'locker', 0.3, F.cz + 1.5 + 0.09 + 0.06 + 0.26, PI, inside);
      extra(b, 'locker', 1.4, F.cz + 1.5 + 0.09 + 0.06 + 0.26, PI, { ly: FLOOR_Y, seed: 1 });
      extra(b, 'office_desk', rightX(F, 0.8) - 0.05, F.cz + 3.7, PI / 2, inside);
      b.prop('office_chair', F.R - 1.9, F.cz + 3.6, rng.range(0, 6), { nocollide: true, ly: FLOOR_Y, seed: rng.int(0, 1) });
      b.prop('paper_scatter', 6.4, F.cz + 4.4, rng.range(0, 6), { nocollide: true, ly: FLOOR_Y, seed: rng.int(0, 2) });
      drumFire(b, F.L + 0.9, F.cz - 1.3);
      b.prop('reception_desk', 3.4, F.cz - 1.4, 0, { ly: FLOOR_Y, seed: 1 }); // the front desk
      b.loot(3.4, F.cz - 1.4, FLOOR_Y + 1.14);
      cont(b, CONT.CABINET, 'cabinet', rightX(F, 0.55), F.cz - 3.4, PI / 2);
      for (const dz of [2.25, 3.25]) cont(b, CONT.LOCKER, 'locker', leftX(F, 0.5), F.cz + dz, -PI / 2, { seed: dz | 0 });
      cont(b, CONT.AMMO_BOX, 'military_crate', -1, backZ(F, 0.8), 0);
      cont(b, CONT.AMMO_BOX, 'military_crate', 1.6, backZ(F, 0.8), 0, { seed: 1 });
      b.loot(-4.4, F.cz + 3.2, FLOOR_Y + 0.02);
      b.prop('sandbags', -4.5, F.front - 0.55, 0, { ly: PAVE });
      b.prop('table', -5, F.cz - 3.6, 0.1, inside);
      b.prop('chair', -5, F.cz - 2.6, 3, { nocollide: true, ly: FLOOR_Y });
      // the cell, in the back room's corner: its door standing open, whoever was in it still there
      b.prop('cell_bars', F.L + 0.125 + 1.5, F.cz + 4.2, 0, inside);
      partition(b, R, F.L + 3.2, F.cz + 4.2, F.L + 3.2, F.back, 3.6, 'brick');
      b.prop('cell_bunk', F.L + 0.125 + 0.42, F.back - WALL - 1.0, 0, inside);
      b.prop('skeleton', F.L + 2.3, F.back - 0.9, PI, { nocollide: true, ly: FLOOR_Y, seed: 1 });
      extra(b, 'waiting_chairs', -6.6, F.front + WALL + 0.34, PI, inside);
      extra(b, 'filing_cabinet', F.R - 1.6, F.cz + 1.5 - 0.09 - WALL - 0.6, PI, inside);
      extra(b, 'office_desk', 6.4, F.cz - 3.8, PI, inside);
      mess(b, F, 9, 3.6, R);
      yard(b, F, L);
      signAt(b, F.L + 0.9, 3.0, F.front - 0.5, PI / 2, 1.0, 0.25, 'police', { back: 0.1, two: true });
    },
    // flats over a ground floor that can be walked into: the common hall from the street door to the yard door, the
    // stairs up off it, and a flat either side of it (flatUnit: six rooms each, a home's size and a home's ceiling)
    flats(b, L) {
      const F = frame(L, 18.4, 14);
      const mat = rng.chance(0.55) ? 'brick' : rng.chance(0.5) ? 'concrete' : 'plaster';
      const HW = 1.2; // (half the hall)
      const R = groundRoom(b, 0, F.cz, F.w, F.d, 3.2, mat === 'plaster' ? 'concrete' : mat, { n: [door(F.w / 2, 1.4), cw(2.1, 1.6), cw(6.25, 1.2), cw(12.15, 1.2), cw(16.3, 1.6)], s: [door(F.w / 2, 1.1), cw(2.1, 1.4), cw(16.3, 1.4), hole(6.25, 0.8, 1.5, 2.1), hole(12.15, 0.8, 1.5, 2.1)], e: [cw(7.2, 1.4)], w: [cw(F.d - 7.2, 1.4)] }, { roof: 'flat', roofMat: 'concrete', floorMat: 'planks', boards: true, ceiling: 'plaster', ceil: FLAT_CEIL, homely: true });
      zone(R, -HW, F.front, HW, F.back, 5);
      const duffel = rng.chance(0.4);
      flatUnit(b, R, F, -HW, F.L, { keep: 'fridge' });
      flatUnit(b, R, F, HW, F.R, { stairs: true, keep: duffel ? 'cabinet duffel' : 'cabinet' });
      const floors = rng.int(3, 6);
      block(b, 0, F.cz, F.w, F.d, 3.5, floors, 3, mat === 'concrete' ? 'slab' : mat === 'plaster' ? 'shopflat' : 'walkup', mat, { ...ruinOf(floors), blank: rng.chance(0.4) ? (rng.chance(0.5) ? 2 : 8) : 0 });
      ivyOn(b, 0, F.cz, F.w, F.d, 0, 3.5 + floors * 3);
      // the hall: what was left in it on the way out, the post nobody collected
      for (const [lz, type] of [[2.2, 'paper_scatter'], [6.4, 'litter'], [10.6, 'suitcases']]) b.prop(type, rng.range(-0.4, 0.4), F.front + lz, rng.range(0, 6), { nocollide: true, ly: FLOOR_Y, seed: rng.int(0, 2) });
      yard(b, F, L);
    },
    // a long block of flats: two halls, each with its stairs, and four flats on the ground floor
    block(b, L) {
      const F = frame(L, 41, 14);
      const mat = rng.chance(0.5) ? 'brick' : 'concrete';
      const HW = 1.2;
      const HX = F.w / 4; // (a hall's middle, either side of the block's)
      const at = (x) => x + F.w / 2; // (along the front wall; the back wall runs the other way)
      const back = (x) => F.w / 2 - x;
      const R = groundRoom(b, 0, F.cz, F.w, F.d, 3.2, mat, {
        n: [door(at(-HX), 1.4), door(at(HX), 1.4), ...[-HX - HW - 5.9, -HX + HW + 5.9, HX - HW - 5.9, HX + HW + 5.9].map((x) => cw(at(x), 1.6)), ...[-HX - HW - 1.75, -HX + HW + 1.75, HX - HW - 1.75, HX + HW + 1.75].map((x) => cw(at(x), 1.2))],
        s: [door(back(-HX), 1.1), door(back(HX), 1.1), ...[-HX - HW - 5.9, -HX + HW + 5.9, HX - HW - 5.9, HX + HW + 5.9].map((x) => cw(back(x), 1.4)), ...[-HX - HW - 1.75, -HX + HW + 1.75, HX - HW - 1.75, HX + HW + 1.75].map((x) => hole(back(x), 0.8, 1.5, 2.1))],
        e: [cw(7.2, 1.4)],
        w: [cw(F.d - 7.2, 1.4)],
      }, { roof: 'flat', roofMat: 'concrete', floorMat: 'planks', boards: true, ceiling: 'plaster', ceil: FLAT_CEIL, homely: true });
      partition(b, R, 0, F.front, 0, F.back, 3.2, 'concrete'); // (the wall between the two stairs' flats)
      for (const sx of [-1, 1]) zone(R, sx * HX - HW, F.front, sx * HX + HW, F.back, 5);
      flatUnit(b, R, F, -HX - HW, F.L, { keep: 'cabinet' });
      flatUnit(b, R, F, -HX + HW, 0, { stairs: true, keep: 'fridge' });
      flatUnit(b, R, F, HX - HW, 0, { stairs: true, keep: 'locker' });
      flatUnit(b, R, F, HX + HW, F.R, { keep: 'fridge duffel' });
      const floors = rng.int(3, 6);
      block(b, 0, F.cz, F.w, F.d, 3.5, floors, 3, mat === 'concrete' ? 'slab' : 'walkup', mat, ruinOf(floors));
      ivyOn(b, 0, F.cz, F.w, F.d, 0, 3.5 + floors * 3);
      for (const sx of [-1, 1]) for (const [lz, type] of [[2.4, 'litter'], [9.6, 'paper_scatter']]) b.prop(type, sx * HX + rng.range(-0.4, 0.4), F.front + lz, rng.range(0, 6), { nocollide: true, ly: FLOOR_Y, seed: rng.int(0, 2) });
      yard(b, F, L);
    },
    // an office tower. big: on a lot of its own, the tallest thing for a mile; otherwise a small one on a street lot.
    // fell: its shaft came down across the street (the streets put it there): what stands is its podium, and a stump
    tower(b, L, big) {
      const F = big ? frame(L, 34, 30) : frame(L, 18.4, 15);
      const h = big ? 4.4 : 3.8;
      const fh = big ? 3.3 : 3.2;
      const floors = big ? rng.int(8, 12) : rng.int(5, 7);
      const glassy = rng.chance(big ? 0.5 : 0.35);
      const R = groundRoom(b, 0, F.cz, F.w, F.d, h, 'concrete', { n: [door(F.w / 2, 1.7), win(F.w * 0.22, F.w * 0.17, 0.6, h - 0.8), win(F.w * 0.78, F.w * 0.17, 0.6, h - 0.8)], s: [door(3, 1.2)], e: [win(F.d / 2, F.d * 0.3, 0.6, h - 0.8)], w: [win(F.d / 2, F.d * 0.3, 0.6, h - 0.8)] }, { roof: 'flat', roofMat: 'concrete', floorMat: 'concrete', lino: true, tint: 3 });
      // the core, with the lifts nobody will ride again, and the front desk
      const core = big ? 5 : 3;
      b.box(-F.w / 6, FLOOR_Y, F.cz + F.d / 6, core, h - FLOOR_Y, core, 'concrete');
      // Behind the lobby the floor is offices: a wall across it beside the core, the rooms behind that - the open
      // office with its desks, the one behind it, and at the back of the core the post room - each through a door.
      const [cl, cr, cb] = [-F.w / 6 - core / 2, -F.w / 6 + core / 2, F.cz + F.d / 6 + core / 2]; // (the core's left, right and back)
      if (big) {
        const [wx, wz, wz2] = [1.2, F.cz + 1.2, F.cz + 8.3];
        partition(b, R, wx, wz, F.R, wz, h, 'concrete', [door(3, 1.3), door(12, 1.3)]);
        partition(b, R, wx, wz, wx, F.back, h, 'concrete', [door(9.5, 1.3)]);
        partition(b, R, wx, wz2, F.R, wz2, h, 'concrete', [door(11, 1.3)]);
        partition(b, R, F.L, cb, cl, cb, h, 'concrete', [door(4, 1.3)]);
        partition(b, R, cr, cb, wx, cb, h, 'concrete', [door(2.2, 1.3)]);
        zone(R, wx, wz, F.R, wz2, 2);
        zone(R, wx, wz2, F.R, F.back, 4);
        zone(R, F.L, cb, wx, F.back, 1);
        for (const [dx, dz, r] of [[12.6, 3.4, PI], [12.6, 6.4, 0], [4.2, 3.4, PI], [11.4, 11.2, PI], [13.6, 13.6, 0]]) {
          extra(b, 'office_desk', dx, F.cz + dz, r, inside);
          b.prop('office_chair', dx + rng.range(-0.5, 0.5), F.cz + dz + (r ? -1 : 1) * 1.05, rng.range(0, 6), { nocollide: true, ly: FLOOR_Y, seed: rng.int(0, 1) });
        }
        extra(b, 'filing_cabinet', wx + 0.09 + 0.06 + 0.62, F.cz + 4.4, -PI / 2, inside);
        extra(b, 'filing_cabinet', wx + 0.09 + 0.06 + 0.62, F.cz + 12.6, -PI / 2, { ly: FLOOR_Y, seed: 1 });
        extra(b, 'bookshelf', -9.4, backZ(F, 0.9), 0, inside);
        extra(b, 'office_desk', -5, F.cz + 11.4, 0, inside);
        drumFire(b, 4.4, F.cz - 9.6); // (in the lobby, where somebody waited out a night)
      } else {
        const [wx, wz] = [1.6, F.cz - 0.9];
        partition(b, R, wx, wz, F.R, wz, h, 'concrete', [door(2.5, 1.3)]);
        partition(b, R, wx, wz, wx, F.back, h, 'concrete', [door(6.9, 1.3)]);
        partition(b, R, F.L, cb, cl, cb, h, 'concrete', [door(2.3, 1.3)]);
        partition(b, R, cr, cb, wx, cb, h, 'concrete');
        zone(R, wx, wz, F.R, F.back, 2);
        zone(R, F.L, cb, wx, F.back, 1);
        extra(b, 'filing_cabinet', -0.4, F.back - WALL - 0.62, 0, inside);
      }
      b.prop('reception_desk', F.w / 4, F.cz - F.d / 5, 0, inside);
      b.loot(F.w / 4, F.cz - F.d / 5, FLOOR_Y + 1.14);
      cont(b, CONT.CABINET, 'cabinet', rightX(F, 0.55), F.cz + F.d / 5, PI / 2);
      cont(b, CONT.LOCKER, 'locker', leftX(F, 0.5), F.cz + F.d / 2 - 2.4, -PI / 2);
      b.loot(F.L + 2, F.cz - F.d / 4, FLOOR_Y + 0.02);
      if (big) {
        cont(b, CONT.CABINET, 'cabinet', F.L + 6, backZ(F, 0.55), 0, { seed: 1 });
        b.cont(CONT.DUFFEL, 3, F.cz + 6, { prop: 'duffel_bag', ry: 0.4, nocollide: true, ly: FLOOR_Y });
        b.loot(6, F.cz + 8, FLOOR_Y + 0.02);
      }
      // the lobby: seats along the front, desks behind the lifts, what was in the drawers all over the floor
      extra(b, 'waiting_chairs', F.L + 3.2, F.front + WALL + 0.34, PI, inside);
      extra(b, 'waiting_chairs', F.L + 5.4, F.front + WALL + 0.34, PI, inside);
      extra(b, 'vending_machine', leftX(F, 0.86), F.cz - 1, -PI / 2, inside);
      for (const [dx, dz] of big ? [[6, 6], [9.4, 6], [6, 10], [-10, -4]] : [[4.4, 3.4], [6.4, 0.4]]) {
        extra(b, 'office_desk', dx, F.cz + dz, rng.chance(0.5) ? 0 : PI, inside);
        b.prop('office_chair', dx + rng.range(-0.6, 0.6), F.cz + dz + 1.1, rng.range(0, 6), { nocollide: true, ly: FLOOR_Y, seed: rng.int(0, 1) });
      }
      extra(b, 'filing_cabinet', rightX(F, 0.66), F.cz - F.d / 4, PI / 2, inside);
      extra(b, 'filing_cabinet', rightX(F, 0.66), F.cz - F.d / 4 - 0.7, PI / 2, inside);
      for (let k = big ? 5 : 2; k > 0; k--) b.prop('paper_scatter', rng.range(F.L + 2, F.R - 2), rng.range(F.front + 2, F.back - 2), rng.range(0, 6), { nocollide: true, ly: FLOOR_Y, seed: rng.int(0, 2) });
      mess(b, F, big ? 22 : 9, h, R);
      if (L.fell) {
        // the podium, its top storeys open to the sky; on it the stump of the shaft that went
        const top = block(b, 0, F.cz, F.w, F.d, h + 0.3, 4, fh, glassy ? 'glass' : 'office', 'concrete', { top: 'slab', wear: 0.9 });
        block(b, 0, F.cz, 16, 14, top, 3, fh, glassy ? 'glass' : 'office', 'concrete', { lost: 2, wear: 1 });
        L.shaft = { style: glassy ? 'glass' : 'office', fh };
      } else block(b, 0, F.cz, F.w, F.d, h + 0.3, floors, fh, glassy ? 'glass' : 'office', 'concrete', { lost: rng.int(big ? 1 : 0, 3), open: rng.chance(0.3) ? (rng.chance(0.5) ? 1 : -1) : 0, from: rng.int(2, 4) });
      stairBlock(b, -F.w / 6 + core / 2 + 1.4, F.cz + F.d / 6);
      if (big) landmarks.push({ x: b.wx(0, F.cz), z: b.wz(0, F.cz), name: ['Calder Trust Tower', 'Harbour House', 'Meridian Assurance', 'Dockside Exchange', 'Pacific & Northern', 'Customs House'][towers++ % 6] });
      if (!big) return yard(b, F, L);
      // the plaza behind it: planters gone to dead wood, a shelter, the cars of people who never came down
      for (const tx of [-14, -5, 5, 14]) b.tree(tx, L.d / 2 - 3.4, rng.chance(0.5) ? 3 : 4, rng.range(0.9, 1.2));
      b.prop('bus_shelter', -15.5, F.back + 5, PI / 2, { ly: PAVE });
      b.wreck('car_wreck', 8, F.back + 5.5, PI / 2 + 0.2, { ly: PAVE });
      // (not down the flanks of the one whose shaft fell: it lies there)
      if (!L.fell) b.wreck('car_burnt', F.R + 2.2, F.cz + 3, 0.1, { ly: PAVE, trunk: false });
      if (!L.fell) b.cont(CONT.DUMPSTER, F.L - 1.8, F.cz - 4, { prop: 'dumpster', ry: PI / 2, ly: PAVE });
      b.loot(0, F.back + 4, PAVE + 0.02);
      for (const [bx, bz] of [[-9, F.back + 2.2], [2, F.back + 2.2]]) extra(b, 'street_bench', bx, bz, PI, { ly: PAVE });
      extra(b, 'trash_bin', -4, F.back + 2.0, 0, { ly: PAVE });
      for (let k = 0; k < 9; k++) weed(b, rng.range(-19, 19), rng.range(F.back + 0.5, L.d / 2 - 0.5), rng.range(0.6, 1.3));
      for (let k = 0; k < 4; k++) b.prop(['litter', 'paper_scatter', 'glass_shards', 'debris'][k], rng.range(-16, 16), F.front - rng.range(0.4, 1), rng.range(0, 6), { nocollide: true, ly: PAVE, seed: k });
    },
    // a block that came down: the walls of two sides of it stand, storeys high with the sky in their windows; the
    // rest is heaps, one of them at the kerb
    ruin(b, L) {
      const w = Math.min(L.w - 3, 16);
      const d = 13;
      const cz = -L.d / 2 + SETBACK + d / 2;
      b.prop('debris', -3.5, cz - 1, 2, { nocollide: true, ly: PAVE });
      b.prop('debris', 5, cz + 5.5, 0.5, { nocollide: true, ly: PAVE, seed: 1 });
      b.tree(-4.6, cz + 3.4, 5, rng.range(0.5, 0.8));
      for (let k = 0; k < 9; k++) weed(b, rng.range(-9, 9), rng.range(-8, 9), rng.range(0.7, 1.4));
      frontage(b, L, null);
      // (its shell: the back wall and one side of it stand, storeys high and broken off; stumps of the rest)
      const mat = rng.chance(0.6) ? 'brick' : 'concrete';
      const H = rng.range(7, 13);
      jagged(b, -w / 2, cz - d / 2, -w / 2, cz + d / 2, PAVE, H, mat, true, { inner: 'plaster' });
      jagged(b, -w / 2 + 0.4, cz + d / 2, w / 2, cz + d / 2, PAVE, H, mat, true, { inner: 'plaster' });
      jagged(b, w / 2, cz + d / 2 - 0.4, w / 2, cz + d / 2 - 5.2, PAVE, H * 0.6, mat, true, { inner: 'plaster' });
      jagged(b, w / 2 - 5.2, cz - d / 2, w / 2, cz - d / 2, PAVE, 2.4, mat);
      // (what it came down as: a long heap where its floors landed, smaller ones round it)
      heap(b, 1.8, cz + 1.2, 4.6, 3.6, rng.range(1.7, 2.3), { brick: 0.45, ry: rng.range(-0.3, 0.3) });
      heap(b, -5.0, cz - 3.4, 2.2, 1.9, 1.1, { brick: 0.5 });
      skirt(b, -w / 2 - 1.4, cz + 1);
      skirt(b, 2, cz + d / 2 + 1.5);
      streetPile(b, L, rng.range(-3, 3));
      // (a floor of it still hanging from the back wall, the steel of another across the heap)
      b.box(-2.4, 3.2, cz + d / 2 - 2.3, w * 0.5, 0.26, 4, 'concrete', { rx: -0.34, collide: false });
      b.box(4.4, 1.9, cz + 3.4, 5.4, 0.2, 0.2, 'rust', { rz: -0.34, ry: -0.7, collide: false });
      b.box(-1.4, 2.4, cz + 2.4, 0.2, 0.2, 6.4, 'rust', { rx: 0.3, ry: 0.2, collide: false });
      b.cont(CONT.DUFFEL, -w / 2 + 1.6, cz - d / 2 + 1.6, { prop: 'duffel_bag', ry: 0.5, nocollide: true, ly: PAVE });
      b.loot(w / 2 - 1.2, cz + d / 2 - 1.6, PAVE + 0.02);
      b.prop('skeleton', -w / 2 + 2.6, cz + d / 2 - 1.4, 1.1, { nocollide: true, ly: PAVE, seed: 2 });
      b.tree(L.w / 2 - 2.4, L.d / 2 - 2.4, 4, 1);
    },
    // burnt out: the walls, black, with the sky over them and soot up them from every opening
    burnt(b, L) {
      const F = frame(L, 18, 13);
      if (rng.chance(0.4)) fire(b, 1, 1.2, F.cz);
      else if (rng.chance(0.5)) smoke(b, 0, 3, F.cz);
      b.prop('debris', -3, F.cz - 2, 1, { nocollide: true, ly: FLOOR_Y });
      for (let k = 0; k < 7; k++) weed(b, rng.range(-9, 9), rng.range(F.back + 0.6, L.d / 2 - 0.5), rng.range(0.7, 1.3));
      frontage(b, L, F);
      // (its walls are what they were built of, brick or concrete, under the soot: the kit lays that over every
      // opening the fire came out of, inside and out, and smokes what is left of the plaster)
      const wall = rng.chance(0.65) ? 'brick' : 'concrete';
      groundRoom(b, 0, F.cz, F.w, F.d, 3.4, wall, { n: [gap(F.w / 2, 2.2, 2.6), gap(F.w * 0.2, 2.4, 2.4)], s: [gap(F.w * 0.7, 3, 3)], e: [gap(F.d / 2, 1.6, 2.2)] }, { floorMat: 'ash', burnt: true });
      const up = rng.range(4.5, 9);
      // (each wall is laid so that its outer face looks out of the lot)
      jagged(b, F.L, F.back, F.R, F.back, 3.4, up, wall, false, { soot: true, inner: 'charred' });
      jagged(b, F.L, F.front + 0.4, F.L, F.back - 0.4, 3.4, up, wall, false, { soot: true, inner: 'charred' });
      jagged(b, F.R, F.front, F.L + 0.4, F.front, 3.4, up * 0.6, wall, false, { soot: true, inner: 'charred' });
      jagged(b, F.R, F.back - 0.4, F.R, F.front + 0.4, 3.4, up * 0.4, wall, false, { soot: true, inner: 'charred' });
      skirt(b, F.R + 1.4, F.cz);
      // what the roof and the floors were hung on, down in the room: joists and rafters burnt through, some still
      // leaning where one end held, the rest lying on one another in the ash
      b.box(1, 0.6, F.cz, F.w * 0.7, 0.22, 0.22, 'charred', { rz: 0.22, ry: 0.5, collide: false });
      b.box(-2, 0.3, F.cz + 1.4, F.w * 0.5, 0.2, 0.2, 'charred', { rz: -0.1, ry: -0.8, collide: false });
      b.box(3, 1.5, F.cz - 2, 0.2, 0.2, F.d * 0.8, 'charred', { rx: 0.36, ry: 0.3, collide: false });
      b.box(-5, 1.9, F.cz + 2, 0.18, 0.18, F.d * 0.6, 'charred', { rx: -0.5, ry: -0.2, collide: false });
      for (let k = 0; k < 5; k++) {
        // (a rafter with its head still on the back wall or the left one, its foot in the room)
        const len = rng.range(4.6, 6.4);
        const tip = rng.range(0.48, 0.66);
        const at = rng.range(-0.38, 0.38);
        const onBack = k % 2 === 0;
        const mid = (Math.cos(tip) * len) / 2;
        if (onBack) b.box(at * (F.w - 3), (Math.sin(tip) * len) / 2 + 0.1, F.back - 0.3 - mid, 0.2, 0.2, len, 'charred', { rx: -tip, ry: rng.range(-0.2, 0.2), collide: false });
        else b.box(F.L + 0.3 + mid, (Math.sin(tip) * len) / 2 + 0.1, F.cz + at * (F.d - 3), len, 0.2, 0.2, 'charred', { rz: tip, ry: rng.range(-0.2, 0.2), collide: false });
      }
      for (let k = 0; k < 6; k++) b.box(rng.range(F.L + 2, F.R - 2), 0.22 + rng.range(0, 0.25), rng.range(F.front + 2, F.back - 2), rng.range(2.2, 4.4), 0.16, 0.18, 'charred', { ry: rng.range(0, 3), rz: rng.range(-0.12, 0.12), collide: false });
      heap(b, F.L + 2.6, F.cz + 0.8, 1.5, 1.2, 0.42, { ash: true, ly: FLOOR_Y });
      heap(b, 5.4, F.cz + 3.3, 1.7, 1.3, 0.45, { ash: true, ly: FLOOR_Y });
      cont(b, CONT.CABINET, 'cabinet', F.L + 1.2, backZ(F, 0.55), 0);
      b.prop('bones', F.w / 4, F.cz + 1, 0.4, { nocollide: true, ly: FLOOR_Y });
      b.prop('skeleton', -F.w / 4, F.cz - 2, 2.2, { nocollide: true, ly: FLOOR_Y, seed: 0 });
      b.loot(0, F.cz, FLOOR_Y + 0.02);
      b.wreck('car_burnt', F.R - 2, F.back + 4, 0.2, { ly: PAVE, trunk: false });
    },
    // a lot nobody built on: a bus shelter on the street, dead trees, what was dumped there
    green(b, L) {
      b.prop('bus_shelter', -3, -L.d / 2 + 1.4, 0, { ly: PAVE });
      for (const [tx, tz] of [[-6, 2], [5, -3], [2, 6], [-4, 7]]) b.tree(tx + rng.range(-1, 1), tz + rng.range(-1, 1), rng.chance(0.5) ? 3 : 4, rng.range(0.8, 1.2));
      b.wreck(rng.chance(0.5) ? 'car_burnt' : 'car_wreck', 5.5, 3.5, rng.range(0, 6), { ly: PAVE, trunk: rng.chance(0.5) });
      b.cont(CONT.DUFFEL, -2.4, 3.4, { prop: 'duffel_bag', ry: 0.3, nocollide: true, ly: PAVE });
      b.prop('bones', 0.6, -1.4, 1, { nocollide: true, ly: PAVE });
      b.cont(CONT.CRATE, -6.5, -3.5, { prop: 'crate', ry: 0.3, ly: PAVE });
      b.loot(1.5, 0.5, PAVE + 0.02);
      extra(b, 'street_bench', 4, -L.d / 2 + 1.6, 0, { ly: PAVE });
      extra(b, 'street_bench', -7, 0, PI / 2, { ly: PAVE });
      extra(b, 'trash_bin', 2.2, -L.d / 2 + 1.3, 0, { ly: PAVE });
      b.prop('stroller', -1, 5, rng.range(0, 6), { nocollide: true, ly: PAVE });
      b.prop('bicycle', 7, -5, rng.range(0, 6), { nocollide: true, ly: PAVE, seed: rng.int(0, 1) });
      for (let k = 0; k < 16; k++) weed(b, rng.range(-9, 9), rng.range(-9, 9), rng.range(0.6, 1.4));
      signAt(b, -3, 1.5, -L.d / 2 + 2.06, 0, 0.8, 1.2, 'poster_b', {});
    },
    // a multi-storey car park: two decks on columns over a ground floor of cars, a wall to each deck, the stair tower
    carpark(b, L) {
      const F = frame(L, 38, 15);
      for (const cx of [-18.7, -9.4, 0, 9.4, 18.7]) for (const dz of [-7.2, 0, 7.2]) b.box(cx, PAVE, F.cz + dz, 0.5, CARPARK_DECK * 2 + 0.3, 0.5, 'concrete');
      for (const k of [1, 2]) {
        b.box(0, CARPARK_DECK * k, F.cz, F.w, 0.3, F.d, 'concrete');
        for (const z of [F.front + 0.1, F.back - 0.1]) b.box(0, CARPARK_DECK * k + 0.3, z, F.w, 0.95, 0.2, 'concrete');
        for (const x of [F.L + 0.1, F.R - 0.1]) b.box(x, CARPARK_DECK * k + 0.3, F.cz, 0.2, 0.95, F.d - 0.4, 'concrete');
        // rust down from every joint of it, the level's number on the wall
        for (let x = -15; x <= 15; x += 7.5) signAt(b, x + rng.range(-1, 1), CARPARK_DECK * k + 0.62, F.front - 0.02, 0, 0.7, 1.25, rng.chance(0.5) ? 'rust_a' : 'rust_b', { grime: true });
      }
      b.roofSpan(0, F.cz, F.w / 2, F.d / 2, CARPARK_DECK, 0.3);
      b.box(15.4, 0.2, F.cz - 3.4, 6, 0.3, 3.2, 'concrete', { rz: 0.32, collide: false }); // what is left of the ramp
      // the stair tower at its end, the sign on it
      b.box(F.R + 1.7, PAVE, F.cz + 4, 3, CARPARK_DECK * 2 + 3.2, 4.4, 'concrete');
      signAt(b, F.R + 1.7, CARPARK_DECK * 2 + 2.1, F.cz + 1.76, 0, 2.8, 0.7, 'parking', { far: true });
      for (let k = 0; k < 6; k++) {
        if (!rng.chance(0.55)) continue;
        const t = rng();
        b.wreck(t < 0.4 ? 'car_wreck' : t < 0.65 ? 'car_burnt' : t < 0.85 ? 'car_open' : 'pickup_truck', -16.2 + k * 4.7, F.cz + (k % 2 ? 3.6 : -3.6), rng.range(-0.12, 0.12), { ly: PAVE, trunk: rng.chance(0.5) });
      }
      // (...and those left on the decks: nobody is getting up to them)
      for (const k of [1, 2]) {
        for (let n = 0; n < 6; n++) {
          const t = rng();
          const here = rng.chance(0.5);
          const ry = rng.range(-0.1, 0.1) + (n % 2 ? PI : 0);
          if (here) b.prop(t < 0.5 ? 'car_wreck' : t < 0.8 ? 'car_burnt' : 'van_wreck', -15 + n * 5.8, F.cz + (n % 2 ? 3.4 : -3.4), ry, { ly: CARPARK_DECK * k + 0.3 });
        }
      }
      b.cont(CONT.DUFFEL, -4.7, F.cz, { prop: 'duffel_bag', ry: 0.9, nocollide: true, ly: PAVE });
      b.loot(4.7, F.cz, PAVE + 0.02);
      b.loot(-14, F.cz, PAVE + 0.02);
      yard(b, F, L);
    },
    // a whole block down: its floors lie one on another where it stood, a corner of it still stands seven floors
    // high and open on every room, over a field of rubble
    collapse(b, L) {
      const floors = rng.int(5, 8);
      block(b, -13, -12, 13, 12, PAVE, floors, 3, 'slab', 'concrete', { lost: rng.int(2, 3), open: 1, from: 1, wear: 1 });
      // its floors, pancaked: slabs one on another where the rest of it stood (solid: a heap to be climbed)
      for (let k = 0; k < 4; k++) solid(b, 6 + k * 0.5, PAVE + k * 0.42, -10 + k * 0.4, 18 - k * 2.2, 0.4, 12 - k * 1.6, 'concrete', { ry: 0.04 * (k - 1.5) });
      pancakes.push({ x: b.wx(6, -10), y: b.y0 + PAVE, z: b.wz(6, -10), ry: b.ry, w: 18, d: 12, n: 4, seed: rng.int(1, 99999) });
      heap(b, 7, 1.5, 4.4, 3.4, 2.0, { ry: rng.range(-0.4, 0.4) });
      heap(b, -13, 10.5, 3.8, 3.2, 1.8);
      heap(b, -3, 7, 3.0, 2.6, 1.4);
      heap(b, 14.5, 9.5, 3.2, 3.6, 1.5);
      // (what is left of its walls: lengths of the back and one side, storeys high and broken off)
      jagged(b, -20.4, 20.4, -6, 20.4, PAVE, 11, 'concrete', true, { inner: 'plaster' });
      jagged(b, 11, 20.4, 20, 20.4, PAVE, 8, 'concrete', true, { inner: 'plaster' });
      jagged(b, 20.4, 20.4, 20.4, 5.5, PAVE, 12, 'concrete', true, { inner: 'plaster' });
      jagged(b, -20.4, 0.5, -20.4, 6, PAVE, 6, 'concrete');
      // (floors of it lying where they came down, tipped every way)
      for (let k = 0; k < 7; k++) b.box(rng.range(-16, 16), PAVE + rng.range(0.3, 1.2), rng.range(0, 17), rng.range(4, 7), 0.32, rng.range(3, 6), 'concrete', { rz: rng.range(-0.34, 0.34), rx: rng.range(-0.22, 0.22), ry: rng.range(0, 3), collide: false });
      for (let k = 0; k < 7; k++) skirt(b, rng.range(-18, 18), rng.range(-3, 18));
      for (const [px, pz] of [[12, 0], [-14, 4], [4, 12], [17, -4], [-4, -3]]) b.prop('debris', px, pz, rng.range(0, 6), { nocollide: true, ly: PAVE, seed: px & 3 });
      smoke(b, 4, 3, -8);
      for (let k = 0; k < 14; k++) weed(b, rng.range(-19, 19), rng.range(-4, 19), rng.range(0.7, 1.4));
      for (const [tx, tz] of [[10.5, 15], [-8, 15.5]]) b.tree(tx, tz, 5, rng.range(0.5, 0.8));
      streetPile(b, L, rng.range(-6, 6));
      b.cont(CONT.DUFFEL, 16.4, 3, { prop: 'duffel_bag', ry: 0.5, nocollide: true, ly: PAVE });
      b.cont(CONT.CRATE, 6, 16.6, { prop: 'crate', ry: 0.2, ly: PAVE });
      b.cont(CONT.AMMO_BOX, -17, 2, { prop: 'military_crate', ry: 0.4, ly: PAVE });
      b.prop('corpse', 3, -2.2, 2, { nocollide: true, ly: PAVE });
      b.prop('skeleton', -8, 3, 0.4, { nocollide: true, ly: PAVE });
      b.loot(12.5, 5.5, PAVE + 0.02);
      b.loot(-17.5, 6, PAVE + 0.02);
      for (const [tx, tz] of [[17, -17], [-17, 17]]) b.tree(tx, tz, 4, rng.range(0.9, 1.2));
    },
    // the bus depot: a roof on posts over the buses that never went out, and the dispatcher's office
    depot(b, L) {
      b.shelter(-4, -4, 30, 16, 5.4, 'tin', 'metal');
      for (const px of [-9.5, -2, 6]) for (const pz of [-11.8, 3.8]) b.cyl(px, PAVE, pz, 0.14, 5.4 - PAVE, 'metal', { sides: 6 });
      // (the roof's edge beam, the board on it)
      b.box(-4, 4.9, -12.1, 30.4, 0.6, 0.2, 'rust', { collide: false });
      signAt(b, -4, 5.2, -12.24, 0, 7.2, 1.8, 'depot', { far: true });
      b.wreck('city_bus', -13, -4, 0.04, { ly: PAVE, trunk: false });
      b.wreck('city_bus', -8.6, -4.4, PI - 0.03, { ly: PAVE, trunk: false, seed: 1 });
      b.wreck('school_bus', -3.4, -4.6, 0.1, { ly: PAVE, trunk: false });
      b.wreck('ambulance', 3.4, -3, 0.1, { ly: PAVE, trunk: false });
      const R = groundRoom(b, 14, 12, 10, 8, 3.2, 'brick', { n: [door(5, 1.3), win(2, 1.4), win(8, 1.4)], w: [win(4, 1.4)] }, { roof: 'flat', roofMat: 'concrete', floorMat: 'concrete', lino: true });
      void R;
      b.cont(CONT.LOCKER, 18.56, 13, { prop: 'locker', ry: -PI / 2, ly: FLOOR_Y });
      b.cont(CONT.CABINET, 11, 15.5, { prop: 'cabinet', ry: PI, ly: FLOOR_Y });
      b.cont(CONT.TOOLBOX, 15.5, 14.6, { prop: 'toolbox', ry: 0.6, nocollide: true, ly: FLOOR_Y });
      extra(b, 'office_desk', 14, 10.4, PI, inside);
      b.loot(14, 9.2, FLOOR_Y + 0.02);
      b.prop('office_chair', 14.4, 11.6, 1, { nocollide: true, ly: FLOOR_Y });
      b.prop('paper_scatter', 12.6, 12.6, 2, { nocollide: true, ly: FLOOR_Y });
      b.prop('gas_pump', 9, -15, 0, { ly: PAVE });
      b.prop('tire_pile', -17, 12, 0, { ly: PAVE });
      b.cont(CONT.DUMPSTER, -10, 16, { prop: 'dumpster', ry: PI, ly: PAVE });
      b.cont(CONT.CRATE, 2, 12, { prop: 'crate', ry: 0.2, ly: PAVE });
      b.prop('corpse', 6, 6, 1.2, { nocollide: true, ly: PAVE });
      b.loot(-2, 10, PAVE + 0.02);
      b.loot(10, -8, PAVE + 0.02);
      extra(b, 'street_bench', -16, 16.5, PI, { ly: PAVE });
      for (let k = 0; k < 5; k++) b.prop(['litter', 'suitcases', 'paper_scatter', 'glass_shards', 'traffic_cones'][k], rng.range(-18, 18), rng.range(6, 18), rng.range(0, 6), { nocollide: true, ly: PAVE, seed: k });
      for (let k = 0; k < 12; k++) weed(b, rng.range(-20, 20), rng.range(5, 20), rng.range(0.6, 1.3));
    },
    // CALDER GENERAL: at the back of its block, four floors over an emergency room that can be walked into - the
    // wards behind it, the pharmacy between them. Out front: the canopy with its sign, the ambulances that came in
    // last, and the tents the wards overflowed into, cots and the dead in rows between them.
    hospital(b, L) {
      const F = { w: 34, d: 14, cz: 12, front: 5, back: 19, L: -17, R: 17 };
      const R = groundRoom(b, 0, F.cz, F.w, F.d, 4, 'concrete', { n: [gap(17, 4, 3), cw(5, 3, 0.8, 3), cw(29, 3, 0.8, 3), cw(10.5, 2.2, 0.8, 3), cw(23.5, 2.2, 0.8, 3)], s: [door(4, 1.2), door(30, 1.2)], e: [cw(4, 1.6)], w: [door(12.4, 1.3)] }, { roof: 'flat', roofMat: 'concrete', floorMat: 'concrete', lino: true, tint: 2 });
      partition(b, R, F.L, 13.5, F.R, 13.5, 4, 'concrete', [door(5, 1.3), door(17, 1.6), door(29, 1.3)]);
      for (const wx of [-6, 6]) partition(b, R, wx, 13.5, wx, F.back, 4, 'concrete');
      // (the hall is three rooms: triage on the left of the way in, where the beds were wheeled, the waiting room
      // on its right - each behind a wall that stops short of the corridor along the wards' doors - and between
      // them the desk)
      for (const wx of [-7.6, 10.6]) partition(b, R, wx, F.front, wx, 11.3, 4, 'concrete');
      zone(R, F.L, F.front, -7.6, 13.5, 4);
      zone(R, 10.6, F.front, F.R, 13.5, 1);
      zone(R, F.L, 13.5, -6, F.back, 0);
      zone(R, -6, 13.5, 6, F.back, 5);
      zone(R, 6, 13.5, F.R, F.back, 0);
      // the hall: the desk, the rows of seats, beds wheeled in wherever there was floor
      b.prop('reception_desk', 6.6, 9.4, 0, inside);
      b.loot(6.6, 9.4, FLOOR_Y + 1.14);
      for (const sx of [-13.6, -11.6, 12.6]) extra(b, 'waiting_chairs', sx, F.front + WALL + 0.34, PI, inside);
      extra(b, 'waiting_chairs', 10.6 + 0.09 + 0.06 + 0.32, 8.4, -PI / 2, inside);
      extra(b, 'waiting_chairs', rightX(F, 0.6), 10.6, PI / 2, { ly: FLOOR_Y, seed: 1 });
      drumFire(b, 3.2, 6.4); // (the one light in the place: a drum somebody kept burning by the way in)
      b.prop('hospital_bed', -14.6, 9.2, PI / 2, { ly: FLOOR_Y, seed: 1 });
      b.prop('hospital_bed', -14.6, 11.8, PI / 2, { ly: FLOOR_Y, seed: 2 });
      extra(b, 'hospital_bed', -9.6, 11.4, PI / 2 + 0.3, { ly: FLOOR_Y, seed: 0 });
      b.prop('privacy_curtain', -13.6, 10.5, 0, { nocollide: true, ly: FLOOR_Y });
      extra(b, 'gurney', -3.4, 8.2, 0.5, inside);
      extra(b, 'gurney', 2.6, 11.4, -1.2, { ly: FLOOR_Y, seed: 1 });
      extra(b, 'medical_cart', -11.2, 7.2, 0.4, inside);
      b.prop('iv_stand', -12.6, 11.9, 0, { nocollide: true, ly: FLOOR_Y });
      b.prop('iv_stand', -1.4, 9.6, 1, { nocollide: true, ly: FLOOR_Y, seed: 1 });
      b.prop('wheelchair', -6, 7, 0.8, { nocollide: true, ly: FLOOR_Y });
      b.prop('wheelchair', 12.6, 11.6, 2.6, { nocollide: true, ly: FLOOR_Y });
      b.prop('barricade', 6.2, 12.6, 0.05, inside); // (between the doors of the wards and the pharmacy)
      b.prop('blood_pool', -2, 7.4, 1, { nocollide: true, ly: FLOOR_Y, seed: 1 });
      b.prop('blood_pool', 9, 11.4, 2, { nocollide: true, ly: FLOOR_Y, seed: 2 });
      stairBlock(b, F.R - 1.5, F.front + 1.1);
      // the wards: beds along the back wall, screens between them
      for (const sx of [-1, 1]) {
        b.prop('hospital_bed', sx * 15, F.back - WALL - 1.1, 0, { ly: FLOOR_Y, seed: 2 });
        b.prop('hospital_bed', sx * 11.4, F.back - WALL - 1.1, 0, { ly: FLOOR_Y, seed: sx > 0 ? 1 : 0 });
        extra(b, 'hospital_bed', sx * 7.8, F.back - WALL - 1.1, 0, { ly: FLOOR_Y, seed: 0 });
        b.prop('privacy_curtain', sx * 13.2, F.back - 1.6, PI / 2, { nocollide: true, ly: FLOOR_Y, seed: sx > 0 ? 1 : 0 });
        b.prop('body_bag', sx * 9.6, 14.6, PI / 2, { nocollide: true, ly: FLOOR_Y });
        b.prop('iv_stand', sx * 16.2, 16, 0, { nocollide: true, ly: FLOOR_Y, seed: 1 });
        b.loot(sx * 7, 15.2, FLOOR_Y + 0.02);
      }
      cont(b, CONT.MEDICINE, 'medicine_cabinet', leftX(F, 0.45), 15.4, -PI / 2);
      cont(b, CONT.LOCKER, 'locker', rightX(F, 0.5), 15.4, PI / 2);
      // the pharmacy
      for (const dx of [-4.2, -3.0]) cont(b, CONT.MEDICINE, 'medicine_cabinet', dx, backZ(F, 0.45), 0, { seed: dx | 0 });
      cont(b, CONT.DRUG_LOCKER, 'drug_locker', 4, backZ(F, 0.6), 0);
      cont(b, CONT.CABINET, 'cabinet', 0.6, backZ(F, 0.55), 0);
      b.prop('stock_spill', 1.6, 15.8, 1, { nocollide: true, ly: FLOOR_Y, seed: 1 });
      b.loot(-1.4, 15.4, FLOOR_Y + 0.02);
      mess(b, F, 20, 4, R);
      const floors = 4;
      block(b, 0, F.cz, F.w, F.d, 4.3, floors, 3.2, 'office', 'concrete', { lost: rng.int(0, 1), open: rng.chance(0.5) ? 1 : 0, from: 2, wear: 0.7 });
      // its name across the front, over the ground floor; a cross at either end of it
      signAt(b, 0, 5.3, F.front - 0.36, 0, 14.4, 1.8, 'hospital', { far: true, back: 0.1 });
      for (const sx of [-10, 10]) signAt(b, sx, 5.3, F.front - 0.34, 0, 1.7, 1.7, 'redcross', { far: true });
      // the canopy over the door: a slab on four posts out over the drive, EMERGENCY on its edge
      for (const px of [-4.6, 4.6]) for (const pz of [-1.6, 2.4]) b.cyl(px, PAVE, pz, 0.18, 3.5, 'metal', { sides: 8 });
      b.box(0, 3.6, 1.4, 10.4, 0.34, 7.2, 'concrete', { collide: false });
      b.box(0, 3.4, -2.2, 10.4, 1.3, 0.3, 'metal', { collide: false });
      b.roofSpan(0, 1.4, 5.2, 3.6, 3.6, 0.34);
      signAt(b, 0, 4.05, -2.37, 0, 5.2, 1.3, 'emergency', { far: true });
      b.wreck('ambulance', -7.6, 1.2, 0.12, { ly: PAVE, trunk: false });
      b.wreck('ambulance', 7.8, -0.4, PI + 0.3, { ly: PAVE, trunk: false, seed: 1 });
      b.prop('gurney', 3.2, 0.6, 0.3, { ly: PAVE, seed: 1 });
      // the forecourt: tents either side of the way in, the dead laid out by the kerb, the army's lamp over it all
      for (const [tx, sd] of [[-15.4, 0], [-9.4, 1], [10, 0], [15.6, 1]]) {
        b.prop('triage_tent', tx, -11.4, 0, { ly: PAVE, seed: sd });
        b.prop('field_cot', tx - 1.2, -12.6, 0, { ly: PAVE, seed: (tx & 1) + 1 });
        b.prop('field_cot', tx + 1.2, -10, PI, { ly: PAVE, seed: sd });
        b.prop('iv_stand', tx + 0.3, -12.4, 0, { nocollide: true, ly: PAVE, seed: sd });
      }
      for (let i = 0; i < 7; i++) b.prop('body_bag', -5.4 + i * 1.3, -18.6, PI / 2 + 0.1 * Math.sin(i * 2.1), { nocollide: true, ly: PAVE, seed: i });
      for (let i = 0; i < 4; i++) b.prop('body_bag', -3.8 + i * 1.3, -16.4, PI / 2 - 0.06 * i, { nocollide: true, ly: PAVE, seed: i + 2 });
      b.prop('floodlight_tower', 19, -18.6, 0.6, { ly: PAVE });
      b.prop('checkpoint_sign', 3.4, -19.6, 0, { ly: PAVE });
      b.prop('sandbags', -4.4, -4.6, 0, { ly: PAVE });
      b.prop('sandbags', 4.6, -4.8, 0.1, { ly: PAVE, seed: 1 });
      b.prop('suitcases', 2.4, -7, 0.4, { nocollide: true, ly: PAVE });
      b.prop('wheelchair', -2.4, -6.2, 2, { nocollide: true, ly: PAVE });
      b.prop('stroller', 5.4, -14.4, 1, { nocollide: true, ly: PAVE });
      for (let k = 0; k < 6; k++) b.prop(['litter', 'paper_scatter', 'blood_pool', 'skeleton', 'litter', 'glass_shards'][k], rng.range(-18, 18), rng.range(-19, -4), rng.range(0, 6), { nocollide: true, ly: PAVE, seed: k });
      // down its sides: the generator, what was thrown out
      b.prop('generator', 19.3, 10, PI / 2, { ly: PAVE });
      b.cont(CONT.DUMPSTER, -19.5, 14, { prop: 'dumpster', ry: PI / 2, ly: PAVE });
      b.cont(CONT.DUFFEL, -12.4, -8.4, { prop: 'duffel_bag', ry: 0.4, nocollide: true, ly: PAVE });
      b.cont(CONT.CRATE, 13.6, -5.4, { prop: 'crate', ry: 0.3, ly: PAVE });
      b.prop('barrel', -18.6, -4, 0, { ly: PAVE });
      b.light(-18.6, PAVE + 1.0, -4, 'embers');
      for (const [tx, tz] of [[-19.4, 3], [19.6, 2]]) b.tree(tx, tz, 3, rng.range(0.7, 1.1));
      for (let k = 0; k < 14; k++) weed(b, rng.range(-20, 20), rng.range(-20, 4), rng.range(0.6, 1.3));
      b.loot(8, -6, PAVE + 0.02);
      landmarks.push({ x: b.wx(0, F.cz), z: b.wz(0, F.cz), name: 'Calder General' });
    },
    // ST. BRENDAN'S: a stone church on a corner lot - a nave under a steep roof, a tower at its door with a spire,
    // coloured glass in what is left of its windows, its yard gone to weed
    // Port Calder's town hall on the square: two storeys of stone over its hall, which is walked into from the
    // square up its steps; a clock tower over the door
    // (b's base is HALL_UP over the square: the hall stands on a plinth of its own, its portico up steps)
    hall(b, L) {
      const F = frame(L, 30, 16);
      // the plinth it stands on, a course of dressed stone round its foot, and out in front of it the portico's floor
      const foot = PAVE - HALL_UP;
      b.box(0, foot, F.cz, F.w + 1.0, -foot, F.d + 1.0, 'stone');
      b.box(0, foot, F.front - 1.9, 17.2, -foot, 3.8, 'stone');
      // the steps up to it, the whole width of the portico (each lower one runs further out: under a step's height)
      // (each down into the paving, so that none is a thin slab over the ground: server/nav.js takes those for decks)
      for (let i = 1; i <= 2; i++) b.box(0, foot - 0.3, F.front - 3.8 - (3 - i) * 0.25 + 0.15, 17.2 + (2 - i) * 0.6, i * (-foot / 3) + 0.3, (3 - i) * 0.5 + 0.3, 'stone');
      // ...and at the back door, a flight of its own
      for (let i = 1; i <= 2; i++) b.box(0, foot - 0.3, F.back + 0.5 + (3 - i) * 0.25 - 0.15, 3.4, i * (-foot / 3) + 0.3, (3 - i) * 0.5 + 0.3, 'stone');
      const R = groundRoom(b, 0, F.cz, F.w, F.d, 4.4, 'stone', { n: [door(F.w / 2, 2.2), win(F.w * 0.18, 1.6, 1.3, 2.4), win(F.w * 0.36, 1.6, 1.3, 2.4), win(F.w * 0.64, 1.6, 1.3, 2.4), win(F.w * 0.82, 1.6, 1.3, 2.4)], s: [door(F.w / 2, 1.2)] }, { roof: 'flat', roofMat: 'concrete', floorMat: 'concrete', lino: true, tint: 3 });
      block(b, 0, F.cz, F.w, F.d, 4.7, 2, 3.6, 'stone', 'stone', { lost: 0, wear: 0.4 });
      // A civic face: the portico - six columns the height of both storeys on their bases with their capitals, the
      // entablature over them and a pediment - quoins up the corners, a string course over the hall, a deep cornice
      const top = 4.7 + 2 * 3.6;
      const pz = F.front - 3.2; // (the columns' line, at the front of the portico's floor)
      for (const px of [-8, -5, -2, 2, 5, 8]) { // (wide apart at the door: the way in between them)
        b.box(px, 0, pz, 1.1, 0.45, 1.1, 'stone');
        b.cyl(px, 0.45, pz, 0.42, top - 1.35, 'stone', { sides: 12 });
        b.box(px, top - 0.9, pz, 1.15, 0.5, 1.15, 'stone', { collide: false });
      }
      b.box(0, top - 0.4, (pz + F.front) / 2, 17.4, 1.1, F.front - pz + 1.4, 'stone', { collide: false });
      b.box(0, top + 0.7, (pz + F.front) / 2 - 0.1, 18.0, 0.3, F.front - pz + 1.8, 'stone', { collide: false });
      b.prism(0, top + 1.0, (pz + F.front) / 2, 17.6, 2.7, F.front - pz + 1.4, 'stone');
      b.box(0, top + 1.0, pz - 0.75, 18.2, 0.22, 0.4, 'stone', { collide: false }); // (the pediment's raking foot)
      b.box(0, top - 0.25, F.front - 0.25, F.w + 1.2, 0.75, 0.9, 'stone', { collide: false }); // the cornice
      b.box(0, 4.55, F.front - 0.12, F.w + 0.5, 0.3, 0.5, 'stone', { collide: false }); // the string course
      for (const sx of [-1, 1]) for (let q = 0; q < 9; q++) b.box(sx * (F.w / 2 - 0.25 + (q % 2) * 0.12), 0.2 + q * 1.3, F.front - 0.08, 0.9 + (q % 2) * 0.35, 0.95, 0.4, 'stone', { collide: false });
      // the clock tower over the door: its shaft, a cornice, the clock's four faces, the belfry with its arches, a dome
      const tz = F.front + 3.2;
      b.box(0, top, tz, 5, 7, 5, 'stone', { collide: false });
      b.box(0, top + 7, tz, 5.8, 0.45, 5.8, 'stone', { collide: false });
      for (const [fx, fz, fry] of [[0, -2.53, 0], [0, 2.53, PI], [-2.53, 0, PI / 2], [2.53, 0, -PI / 2]]) {
        // (a disc's axis turned to the face: about X for the front and back, about Z for the sides)
        const turn = fx ? { rz: PI / 2 } : { rx: PI / 2 };
        b.cyl(fx, top + 4.55, tz + fz, 1.5, 0.12, 'trim', { ...turn, sides: 20 });
        b.cyl(fx * 1.02, top + 4.55, tz + fz * 1.02, 1.3, 0.12, 'roadpaint', { ...turn, sides: 20 });
        // the hands, stopped at twenty past nine: each from the middle out (a hand at angle a from twelve, in the face)
        const [ox, oz] = [fx * 1.045, fz * 1.045];
        for (const [a, len, w] of [[-1.25, 0.95, 0.1], [2.1, 0.7, 0.13]]) {
          const [dx, dz, dy] = [-Math.sin(a) * Math.cos(fry) * (len / 2), Math.sin(a) * Math.sin(fry) * (len / 2), Math.cos(a) * (len / 2)];
          b.box(ox + dx, top + 4.61 + dy - len / 2, tz + oz + dz, w, len, 0.04, 'dark', { ry: fry, rz: a, collide: false });
        }
      }
      b.box(0, top + 7.45, tz, 3.6, 3.4, 3.6, 'stone', { collide: false });
      for (const [fx, fz, w, d] of [[0, -1.82, 1.5, 0.06], [0, 1.82, 1.5, 0.06], [-1.82, 0, 0.06, 1.5], [1.82, 0, 0.06, 1.5]]) b.box(fx, top + 8.0, tz + fz, w, 2.3, d, 'dark', { collide: false });
      b.box(0, top + 10.85, tz, 4.2, 0.35, 4.2, 'stone', { collide: false });
      b.cone(0, top + 11.2, tz, 2.3, 3.2, 'tin_rust', 8, { ry: PI / 8 });
      b.box(0, top + 14.4, tz, 0.1, 1.4, 0.1, 'rust', { collide: false });
      // inside: the counter, the records, the benches of the hall, what was left
      b.prop('reception_desk', 0, F.cz - 2.2, 0, inside);
      b.loot(0, F.cz - 2.2, FLOOR_Y + 1.14);
      cont(b, CONT.CABINET, 'cabinet', rightX(F, 0.55), F.cz, PI / 2);
      cont(b, CONT.CABINET, 'cabinet', leftX(F, 0.55), F.cz + 2, -PI / 2, { seed: 1 });
      for (const dx of [-8, -4, 4, 8]) b.prop('waiting_chairs', dx, F.cz + 3.4, 0, inside);
      b.prop('skeleton', 3, F.cz + 1, 1.2, { nocollide: true, ly: FLOOR_Y, seed: 1 });
      b.loot(-9, F.cz - 3.4, FLOOR_Y + 0.02);
      mess(b, F, 10, 4.4, R);
      landmarks.push({ x: b.wx(0, F.cz), z: b.wz(0, F.cz), name: 'Port Calder Town Hall' });
    },
    church(b, L, name = "St. Brendan's") {
      const F = frame(L, 9.6, 14);
      const R = groundRoom(b, 0, F.cz, F.w, F.d, 5.4, 'stone', { n: [door(4.8, 1.6)], s: [door(7.6, 1.1)] }, { roof: 'gable', roofH: 3.9, roofMat: 'shingles', floorMat: 'planks', tint: 3 });
      R.ceiling = 'plaster'; // (a plastered ceiling over the nave: the roof's own inside is nothing to look up into)
      // the tower: over the door, a belfry with its louvres, a spire, a cross
      b.box(0, 5.4, F.front + 1.5, 3.3, 6.6, 3.3, 'stone', { collide: false });
      b.box(0, 12, F.front + 1.5, 3.7, 0.3, 3.7, 'stone', { collide: false });
      for (const [dx, dz, w, d] of [[0, -1.66, 1.2, 0.04], [0, 1.66, 1.2, 0.04], [-1.66, 0, 0.04, 1.2], [1.66, 0, 0.04, 1.2]]) b.box(dx, 9.4, F.front + 1.5 + dz, w, 1.9, d, 'dark', { collide: false });
      b.cone(0, 12.3, F.front + 1.5, 2.45, 7.2, 'shingles', 4);
      b.box(0, 19.4, F.front + 1.5, 0.12, 1.6, 0.12, 'trim', { collide: false });
      b.box(0, 20.3, F.front + 1.5, 0.84, 0.12, 0.12, 'trim', { collide: false });
      // buttresses down both sides, and between them the windows: lead and coloured glass, panes of it gone
      for (const sx of [-1, 1]) {
        for (const dz of [-6.6, -2.2, 2.2, 6.6]) b.box(sx * (F.w / 2 + 0.3), 0, F.cz + dz, 0.6, 3.6, 0.7, 'stone');
        for (const [dz, c] of [[-4.4, 'stained_a'], [0, 'stained_b'], [4.4, 'stained_a']]) {
          signAt(b, sx * (F.w / 2 + 0.14), 2.9, F.cz + dz, sx > 0 ? -PI / 2 : PI / 2, 1.25, 2.5, c, { far: true });
          signAt(b, sx * (F.w / 2 - 0.14), 2.9, F.cz + dz, sx > 0 ? PI / 2 : -PI / 2, 1.25, 2.5, c, {});
          b.box(sx * (F.w / 2 + 0.16), 1.5, F.cz + dz, 0.12, 0.14, 1.6, 'stone', { collide: false });
        }
      }
      signAt(b, 0, 8.0, F.front - 0.17, 0, 1.3, 2.6, 'stained_b', { far: true });
      for (let r = 0; r < 3; r++) {
        b.prop('pew', -2.3, F.cz - 3.2 + r * 2.2, r === 1 ? 0.2 : 0, inside);
        b.prop('pew', 2.3, F.cz - 3.2 + r * 2.2, 0, inside);
      }
      b.prop('altar', -0.4, F.back - 1.6, 0, inside);
      b.loot(-0.4, F.back - 1.6, FLOOR_Y + 1.02);
      cont(b, CONT.CABINET, 'cabinet', F.L + 4.2, backZ(F, 0.55), 0); // (clear of the vestry door)
      b.cont(CONT.DUFFEL, 3.4, F.cz - 5, { prop: 'duffel_bag', ry: 1.1, nocollide: true, ly: FLOOR_Y });
      // those who came here at the end: in the pews, on the floor before the altar
      b.prop('skeleton', -2.3, F.cz - 3.0, PI, { nocollide: true, ly: FLOOR_Y + 0.42, seed: 1 });
      b.prop('skeleton', 2.6, F.cz + 1.3, PI, { nocollide: true, ly: FLOOR_Y + 0.42, seed: 1 });
      b.prop('skeleton', 0.6, F.back - 3.4, 0.5, { nocollide: true, ly: FLOOR_Y, seed: 2 });
      b.prop('blood_pool', 0, F.cz - 1, 1, { nocollide: true, ly: FLOOR_Y });
      b.prop('ceiling_debris', 1.5, F.cz + 3.6, 2, { nocollide: true, ly: FLOOR_Y, seed: 1 });
      for (const [gx, gz, sd] of [[7.4, -5, 0], [8.6, -1.6, 1], [7.2, 2, 2], [-7.6, -3, 1], [-8.4, 1.4, 0], [7.8, 5.4, 1], [-7.4, 5, 2]]) b.prop('grave_cross', gx, gz, rng.range(-0.3, 0.3), { ly: PAVE, seed: sd });
      b.tree(-7.4, 7.6, 3, 1.1);
      b.tree(7.8, 8.2, 4, 0.9);
      b.prop('ivy', F.R + 0.04, F.cz + 2.2, -PI / 2, { nocollide: true, ly: PAVE });
      for (let k = 0; k < 14; k++) weed(b, rng.range(-9, 9) < 0 ? rng.range(-9.2, -5.8) : rng.range(5.8, 9.2), rng.range(-8, 9), rng.range(0.7, 1.3));
      frontage(b, L, F);
      // its board by the gate
      b.cyl(-7, PAVE, -L.d / 2 + 1.2, 0.07, 1.9, 'rust', { sides: 6 });
      signAt(b, -6.2, 1.5, -L.d / 2 + 1.14, 0, 1.9, 0.48, 'church', { back: 0.05 });
      landmarks.push({ x: b.wx(0, F.cz), z: b.wz(0, F.cz), name });
    },
    // a filling station: pumps under a canopy on the street with the name on its edge, the kiosk behind them, the
    // board of prices on its pole at the corner
    gas(b, L) {
      const R = groundRoom(b, 0, 5.5, 10, 6, 3.2, 'brick', { n: [door(5, 1.4), cw(2, 2.4, 0.9, 2.4), cw(8, 2.4, 0.9, 2.4)], e: [door(3, 1.1)] }, { roof: 'flat', roofMat: 'concrete', floorMat: 'concrete', lino: true });
      void R;
      b.prop('checkout_counter', -2.6, 4.6, 0, inside);
      b.loot(-2.6, 4.6, FLOOR_Y + 0.98);
      b.cont(CONT.SHELF, -2.8, 8.065, { prop: 'shelf', ry: PI, ly: FLOOR_Y });
      b.cont(CONT.SHELF, 0.2, 8.065, { prop: 'shelf', ry: PI, ly: FLOOR_Y, seed: 1 });
      b.cont(CONT.FRIDGE, 3, 7.955, { prop: 'fridge', ry: PI, ly: FLOOR_Y });
      b.prop('stock_spill', 1.4, 5.4, 1, { nocollide: true, ly: FLOOR_Y });
      b.prop('ceiling_lamp', 0, 5.5, 0, { nocollide: true, ly: 3.2, seed: 1 });
      for (const px of [-4.2, 4.2]) for (const pz of [-2.4, -6.6]) b.cyl(px, PAVE, pz, 0.18, 4.3, 'metal', { sides: 8 });
      b.box(0, 4.3, -4.5, 10.8, 0.95, 6.8, 'metal', { collide: false });
      b.roofSpan(0, -4.5, 5.4, 3.4, 4.3, 0.95);
      signAt(b, 0, 4.78, -7.92, 0, 3.6, 0.9, 'gas', { far: true });
      signAt(b, -5.42, 4.78, -4.5, PI / 2, 3.6, 0.9, 'gas', { far: true });
      signAt(b, 5.42, 4.78, -4.5, -PI / 2, 3.6, 0.9, 'gas', { far: true });
      b.box(0, PAVE, -4.5, 5.2, 0.16, 1.3, 'concrete'); // the island the pumps stand on
      b.prop('gas_pump', -1.7, -4.5, 0, { ly: PAVE + 0.16 });
      b.prop('gas_pump', 1.7, -4.5, 0, { ly: PAVE + 0.16, seed: 1 });
      b.wreck('car_burnt', 7.2, -4.2, 0.1, { ly: PAVE, trunk: false });
      b.wreck('car_open', -7.4, -3.6, PI - 0.15, { ly: PAVE });
      b.cont(CONT.DUMPSTER, -7.4, 6.6, { prop: 'dumpster', ry: PI / 2, ly: PAVE });
      b.prop('tire_pile', 8, 5, 0, { ly: PAVE });
      b.prop('litter', 0, -1, 1, { nocollide: true, ly: PAVE });
      b.prop('traffic_cones', 3.6, -7.2, 1, { nocollide: true, ly: PAVE });
      // the prices, on a pole
      b.cyl(-8.6, PAVE, -8.6, 0.13, 3.4, 'rust', { sides: 6 });
      signAt(b, -8.6, 4.8, -8.72, 0.25, 1.4, 2.8, 'gasprice', { far: true, back: 0.2, two: true });
      for (let k = 0; k < 8; k++) weed(b, rng.range(-9, 9), rng.range(8.9, 9.4), rng.range(0.7, 1.2));
      frontage(b, L, null, true);
    },
    // THE RIALTO: a picture house - the lobby on the street under its marquee, the hall behind it, the screen still up
    cinema(b, L) {
      const F = frame(L, 30, 15);
      const R = groundRoom(b, 0, F.cz, F.w, F.d, 7, 'brick', { n: [gap(15, 5, 3)], s: [door(3, 1.2), door(27, 1.2)], w: [door(11, 1.2)] }, { roof: 'flat', roofMat: 'concrete', floorMat: 'planks', tint: 4 });
      partition(b, R, F.L, F.front + 4.6, F.R, F.front + 4.6, 7, 'brick', [door(8, 1.6), door(22, 1.6)]);
      R.ceiling = 'plaster';
      // its front: piers the height of it, a stepped head over the middle, a course under the parapet
      for (const px of [-14.6, -9.4, -4.2, 4.2, 9.4, 14.6]) b.box(px, PAVE, F.front - 0.2, 0.7, 7.5, 0.3, 'brick', { collide: false });
      b.box(0, 7.3, F.front + 0.1, 11, 1.5, 0.5, 'brick', { collide: false });
      b.box(0, 8.8, F.front + 0.1, 5.4, 0.9, 0.5, 'brick', { collide: false });
      b.box(0, 6.7, F.front - 0.24, 30.4, 0.3, 0.3, 'concrete', { collide: false });
      // the marquee: a box out over the pavement, the letters that are left on it; the name down a blade above it
      b.box(0, 3.3, F.front - 1.45, 6.6, 1.7, 2.6, 'metal', { collide: false });
      signAt(b, 0, 4.15, F.front - 2.77, 0, 6.2, 1.55, 'marquee', { far: true });
      signAt(b, -3.32, 4.15, F.front - 1.45, PI / 2, 2.4, 0.6, 'marquee', {});
      signAt(b, 3.32, 4.15, F.front - 1.45, -PI / 2, 2.4, 0.6, 'marquee', {});
      signAt(b, 0, 7.6, F.front - 0.9, PI / 2, 1.25, 5.0, 'rialto', { far: true, back: 0.3, two: true });
      // what was showing, in its cases either side of the doors
      for (const [px, c] of [[-6.8, 'poster_a'], [-5.2, 'poster_c'], [5.2, 'poster_b'], [6.8, 'poster_d']]) signAt(b, px, 1.75, F.front - 0.14, 0, 1.0, 1.5, c, {});
      b.prop('checkout_counter', -9, F.front + 2.6, 0, inside); // the box office
      b.loot(-9, F.front + 2.6, FLOOR_Y + 0.98);
      cont(b, CONT.FRIDGE, 'fridge', rightX(F, 0.72), F.front + 2.2, PI / 2);
      cont(b, CONT.CABINET, 'cabinet', leftX(F, 0.55), F.front + 2, -PI / 2);
      extra(b, 'vending_machine', 9.4, F.front + 4.6 - 0.09 - WALL - 0.4, 0, inside);
      extra(b, 'vending_machine', 10.6, F.front + 4.6 - 0.09 - WALL - 0.4, 0, { ly: FLOOR_Y, seed: 1 });
      b.prop('litter', 3, F.front + 2.4, 1, { nocollide: true, ly: FLOOR_Y });
      b.prop('stock_spill', -5, F.front + 2.2, 2, { nocollide: true, ly: FLOOR_Y });
      // the hall: rows of seats facing the screen
      for (let r = 0; r < 3; r++) for (const px of [-11, -8.6, -6.2, -3.8, 3.8, 6.2, 8.6, 11]) if ((r * 7 + ((px * 10) | 0)) % 5) b.prop('cinema_seats', px, F.front + 6.9 + r * 2.1, PI + rng.range(-0.03, 0.03), { ly: FLOOR_Y, seed: r });
      b.box(-2, 1.6, F.back - 0.5, 16, 4.6, 0.12, 'clapboard', { collide: false }); // the screen, a corner of it torn down
      b.box(7.4, 2.2, F.back - 0.6, 3.4, 3.4, 0.1, 'clapboard', { rz: -0.5, collide: false });
      b.cont(CONT.DUFFEL, 0, F.front + 8.2, { prop: 'duffel_bag', ry: 0.6, nocollide: true, ly: FLOOR_Y });
      b.cont(CONT.DUFFEL, -12.6, F.back - 1.6, { prop: 'duffel_bag', ry: 2, nocollide: true, ly: FLOOR_Y, seed: 1 });
      b.prop('corpse', 0.4, F.front + 11.4, 1, { nocollide: true, ly: FLOOR_Y });
      b.prop('skeleton', -8.6, F.front + 8.9, 0, { nocollide: true, ly: FLOOR_Y + 0.4, seed: 1 });
      b.loot(12.6, F.back - 1.6, FLOOR_Y + 0.02);
      b.loot(0, F.back - 2, FLOOR_Y + 0.02);
      mess(b, F, 14);
      b.prop('fallen_sign', 4, F.front - 0.9, 0.2, { nocollide: true, ly: PAVE });
      b.wreck('car_wreck', 18.4, F.cz + 1, 0.05, { ly: PAVE });
      b.cont(CONT.DUMPSTER, -18.2, F.cz + 3, { prop: 'dumpster', ry: PI / 2, ly: PAVE });
      yard(b, F, L);
      landmarks.push({ x: b.wx(0, F.cz), z: b.wz(0, F.cz), name: landmarks.some((m) => m.name === 'The Rialto') ? 'The Orpheum' : 'The Rialto' });
    },
    // HARBOUR STREET STATION: the way down to the trains, shut and fallen in, on a square of its own
    subway(b, L) {
      b.prop('subway_entrance', 0, -3, 0, { ly: PAVE });
      b.prop('bus_shelter', -6.2, -L.d / 2 + 1.4, 0, { ly: PAVE });
      // the station's name over the head of the stairs, on two posts
      for (const px of [-1.9, 1.9]) b.cyl(px, PAVE, -6.6, 0.07, 3.1, 'rust', { sides: 6 });
      signAt(b, 0, 2.95, -6.66, 0, 3.6, 0.9, 'subway', { far: true, back: 0.08, two: true });
      const R = groundRoom(b, 5.8, 5.4, 5, 4, 2.8, 'tin', { w: [door(2, 1.1)], n: [cw(2.5, 2, 1, 2)] }, { roof: 'flat', roofMat: 'tin', plain: true });
      void R;
      b.cont(CONT.CABINET, 7.4, 6.4, { prop: 'cabinet', ry: -PI / 2, ly: FLOOR_Y });
      b.loot(5.4, 4.6, FLOOR_Y + 0.02);
      extra(b, 'turnstiles', -5.6, 1.6, PI / 2, { ly: PAVE });
      extra(b, 'street_bench', -6.6, 6.4, PI / 2, { ly: PAVE });
      extra(b, 'street_bench', 0.4, 8.2, PI, { ly: PAVE, seed: 1 });
      extra(b, 'trash_bin', 2.6, 8.1, 0, { ly: PAVE });
      extra(b, 'newspaper_box', 7.6, -7.6, 0, { ly: PAVE });
      extra(b, 'phone_booth', -8.2, -3.4, PI / 2, { ly: PAVE });
      for (const [tx, tz] of [[-7.4, 8.6], [-3.4, 3.8], [7.6, -4.6]]) b.tree(tx, tz, rng.chance(0.5) ? 3 : 5, rng.range(0.7, 1.1));
      b.prop('suitcases', 3.4, -6.4, 0.8, { nocollide: true, ly: PAVE });
      b.prop('litter', -3, -6.5, 2, { nocollide: true, ly: PAVE });
      b.prop('litter', 2, 2, 0.3, { nocollide: true, ly: PAVE, seed: 1 });
      b.prop('paper_scatter', -1, 4.4, 1, { nocollide: true, ly: PAVE });
      b.prop('stroller', 4.6, 2.4, 2.2, { nocollide: true, ly: PAVE });
      b.cont(CONT.DUFFEL, -3.2, 0.6, { prop: 'duffel_bag', ry: 0.3, nocollide: true, ly: PAVE });
      b.prop('streetlight', 8.6, -8.6, PI, { ly: PAVE });
      b.prop('corpse', 4.4, 0, 2, { nocollide: true, ly: PAVE });
      b.prop('skeleton', -2.4, -8.4, 1, { nocollide: true, ly: PAVE, seed: 2 });
      for (let k = 0; k < 10; k++) weed(b, rng.range(-9, 9), rng.range(-9, 9), rng.range(0.6, 1.2));
      landmarks.push({ x: b.wx(0, -3), z: b.wz(0, -3), name: 'Harbour Street Station' });
    },
    // a car park nobody drove out of
    parking(b, L) {
      const rows = Math.max(1, Math.floor((L.d - 6) / 7));
      const cols = Math.max(2, Math.floor((L.w - 3) / 3.4));
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (!rng.chance(0.5)) continue;
          const t = rng();
          const type = t < 0.4 ? 'car_wreck' : t < 0.62 ? 'car_burnt' : t < 0.8 ? 'car_open' : t < 0.9 ? 'van_wreck' : 'pickup_truck';
          const [px, pz, pr] = [-L.w / 2 + 2.6 + c * 3.4 + rng.range(-0.2, 0.2), -L.d / 2 + 5 + r * 7, (rng.chance(0.5) ? 0 : PI) + rng.range(-0.1, 0.1)];
          const trunk = t < 0.4 && rng.chance(0.45);
          if (fits(b, type, px, pz, pr, PAVE)) b.wreck(type, px, pz, pr, { trunk, ly: PAVE }); // (a pickup is longer than its bay)
        }
      }
      b.prop('streetlight', L.w / 2 - 1, L.d / 2 - 1, PI, { ly: PAVE });
      b.loot(0, L.d / 2 - 2, PAVE + 0.02);
      for (let k = 0; k < 12; k++) weed(b, rng.range(-L.w / 2 + 1, L.w / 2 - 1), (k % 2 ? 1 : -1) * (L.d / 2 - 0.6), rng.range(0.6, 1.2));
      for (let k = 0; k < 5; k++) b.prop(['litter', 'shopping_cart', 'glass_shards', 'suitcases', 'skeleton'][k], rng.range(-L.w / 2 + 2, L.w / 2 - 2), 1.5 + rng.range(-0.4, 0.4), rng.range(0, 6), { nocollide: true, ly: PAVE, seed: k });
      // the board at its way in
      b.cyl(-L.w / 2 + 1, PAVE, -L.d / 2 + 0.8, 0.07, 2.7, 'rust', { sides: 6 });
      signAt(b, -L.w / 2 + 2.1, 2.5, -L.d / 2 + 0.74, 0, 2.2, 0.55, 'parking', { back: 0.05 });
    },
    // a warehouse: one tall hall behind two loading doors, a loft of windows over it, the office in its corner
    warehouse(b, L) {
      const F = frame(L, 38, 15);
      const hi = (at) => ({ at, w: 2.6, y0: 3.3, y1: 5.3, glass: rng.chance(0.4) });
      const R = groundRoom(b, 0, F.cz, F.w, F.d, 6.2, 'brick', { n: [gap(8, 4.2, 4.4), door(19, 1.4), gap(30, 4.2, 4.4), hi(14), hi(24)], s: [door(3, 1.2), hi(12), hi(19), hi(26)], e: [hi(7.5)], w: [hi(7.5)] }, { roof: 'flat', roofMat: 'concrete', floorMat: 'concrete', plain: true });
      partition(b, R, F.R - 7, F.back - 5.4, F.R, F.back - 5.4, 3, 'concrete', [door(2, 1.2)]);
      partition(b, R, F.R - 7, F.back - 5.4, F.R - 7, F.back, 3, 'concrete');
      block(b, 0, F.cz, F.w, F.d, 6.5, 1, 3.6, 'warehouse', 'brick', { top: rng.chance(0.4) ? 'slab' : undefined, wear: 0.9 });
      // the doors, run up and stuck there
      for (const dx of [-11, 11]) b.box(dx, 3.7, F.front - 0.05, 4.2, 0.9, 0.1, 'tin_rust', { collide: false });
      // the hall: racks down one side, what was on them, a container nobody came back for
      for (const dx of [2.2, 4.6, 7.0]) cont(b, CONT.SHELF, 'shelf', F.L + dx, backZ(F, 0.5), 0, { seed: dx | 0 });
      cont(b, CONT.CRATE, 'crate', F.L + 2, F.cz - 2, 0.3);
      b.cont(CONT.FREIGHT, 4, F.cz + 3.4, { prop: 'crate', ry: 0.5, ly: FLOOR_Y, seed: 1 });
      b.prop('shipping_container', -3, F.cz + 2.4, PI / 2 + 0.06, { ly: FLOOR_Y, seed: rng.int(0, 2) });
      for (const [px, pz] of [[-13, F.cz - 3], [-12.4, F.cz + 0.6], [8, F.cz - 3.4], [10.4, F.cz + 3.8]]) b.prop('pallet', px, pz, rng.range(0, 3), inside);
      b.prop('pallet', -13, F.cz - 3, 0.3, { ly: FLOOR_Y + 0.15 });
      b.prop('barrel', 12.4, F.cz - 4.6, 0, inside);
      b.prop('barrel', 13.4, F.cz - 4.4, 0, { ly: FLOOR_Y, seed: 1 });
      b.prop('tire_pile', 6.4, backZ(F, 1.5), 0, inside);
      b.loot(-8, F.cz - 3, FLOOR_Y + 0.02);
      b.loot(2, F.cz - 4, FLOOR_Y + 0.02);
      // the office
      cont(b, CONT.LOCKER, 'locker', rightX(F, 0.5), F.back - 3, PI / 2);
      extra(b, 'office_desk', F.R - 3.6, F.back - 1.2, PI, inside);
      extra(b, 'filing_cabinet', F.R - 6.2, F.back - WALL - 0.6, 0, inside);
      b.prop('office_chair', F.R - 3.4, F.back - 2.4, 2, { nocollide: true, ly: FLOOR_Y });
      b.loot(F.R - 2, F.back - 4, FLOOR_Y + 0.02);
      mess(b, F, 12);
      // out front: a truck that was backing in
      yard(b, F, L);
      signAt(b, 0, 5.4, F.front - 0.14, 0, 9, 6.5, 'ghost', { far: true });
    },
    // What the tower's shaft fell on: the buildings that stood here are under it (the streets lay the shaft's
    // lengths, and their rubble; inFall: where). What it missed of them: stumps of walls, heaps, what burnt after.
    crushed(b, L, inFall) {
      const pts = [];
      for (let k = 0; k < 26; k++) pts.push([rng.range(-L.w / 2 + 2.6, L.w / 2 - 2.6), rng.range(-L.d / 2 + 2.6, L.d / 2 - 2.6), rng(), rng()]);
      const clear = (lx, lz, r) => !inFall(b.wx(lx, lz), b.wz(lx, lz), r);
      // walls along the lot's edges where the shaft did not land
      for (const [x0, z0, x1, z1] of [[-L.w / 2 + 1.2, L.d / 2 - 1.2, L.w / 2 - 1.2, L.d / 2 - 1.2], [-L.w / 2 + 1.2, -L.d / 2 + 1.2, -L.w / 2 + 1.2, L.d / 2 - 1.6], [L.w / 2 - 1.2, -L.d / 2 + 1.2, L.w / 2 - 1.2, L.d / 2 - 1.6], [-L.w / 2 + 1.6, -L.d / 2 + 1.2, L.w / 2 - 1.6, -L.d / 2 + 1.2]]) {
        const n = Math.max(1, Math.round(Math.hypot(x1 - x0, z1 - z0) / 7));
        for (let k = 0; k < n; k++) {
          const [a0, a1] = [k / n, (k + 0.86) / n];
          const p = [x0 + (x1 - x0) * a0, z0 + (z1 - z0) * a0, x0 + (x1 - x0) * a1, z0 + (z1 - z0) * a1];
          const H = rng.range(2.5, 8);
          const keep = rng.chance(0.75);
          if (!keep || !clear((p[0] + p[2]) / 2, (p[1] + p[3]) / 2, 4.5)) continue;
          jagged(b, ...p, PAVE, H, 'brick', true, { inner: 'plaster', soot: rng.chance(0.4) });
        }
      }
      let n = 0;
      for (const [lx, lz, r1, r2] of pts) {
        if (!clear(lx, lz, 3.4)) continue;
        if (n < 3 && heaps.every((h) => Math.hypot(h.x - b.wx(lx, lz), h.z - b.wz(lx, lz)) > 7)) {
          heap(b, lx, lz, 2 + r1 * 1.6, 1.8 + r2 * 1.4, 0.9 + r1 * 0.9, { brick: 0.6, ry: r2 * 3 });
          n++;
        } else b.prop(['debris', 'litter', 'glass_shards', 'skeleton', 'debris', 'bones'][(r1 * 6) | 0], lx, lz, r2 * 6, { nocollide: true, ly: PAVE, seed: (r2 * 3) | 0 });
        weed(b, lx + 1, lz - 1, 0.7 + r1 * 0.6);
      }
      // (a bag somebody left, in whichever corner of it nothing came down on)
      const corner = [[1, 1], [-1, 1], [1, -1], [-1, -1]].find(([sx, sz]) => clear(sx * (L.w / 2 - 2.6), sz * (L.d / 2 - 2.6), 1.5) && heaps.every((h) => Math.hypot(h.x - b.wx(sx * (L.w / 2 - 2.6), sz * (L.d / 2 - 2.6)), h.z - b.wz(sx * (L.w / 2 - 2.6), sz * (L.d / 2 - 2.6))) > Math.max(h.rx, h.rz) + 1.6));
      if (corner) {
        b.cont(CONT.DUFFEL, corner[0] * (L.w / 2 - 2.6), corner[1] * (L.d / 2 - 2.6), { prop: 'duffel_bag', ry: 0.5, nocollide: true, ly: PAVE });
        b.loot(corner[0] * (L.w / 2 - 3.4), corner[1] * (L.d / 2 - 2.6), PAVE + 0.02);
      }
      smoke(b, 0, 2, 0);
    },
  };
  // the set places first, on lots drawn at random, then whatever the seed deals for the rest
  let fall = null; // the tower that fell: { dir, xs, zc, lot, inFall(x, z, pad) }
  {
    const order = lots.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = rng.int(0, i);
      [order[i], order[j]] = [order[j], order[i]];
    }
    const plan = new Map();
    // (the tower whose shaft came down: the first big lot. It fell across the street beside its block - east, or
    // west from the city's last column - onto what stood on the far side: those lots are under it.)
    const fi = order.find((i) => lots[i].w > 40 && lots[i].d > 40 && ((L) => { const nb = L.bi < GRID - 1 ? L.bi + 1 : L.bi - 1; return !onSquare(nb, L.bj) && !trimBlock(nb, L.bj); })(lots[i]));
    if (fi !== undefined) {
      const T = lots[fi];
      const dir = T.bi < GRID - 1 ? 1 : -1;
      const xs = city.x - G2 + (T.bi + (dir > 0 ? 1 : 0)) * PITCH;
      if (Math.abs(Math.sin(T.ry)) > 0.5) T.ry = 0; // (it faces north or south: the shaft fell along its flank, clear of its doors)
      // (the shaft stood in the middle of the tower: SETBACK and the tower's depth put that 4.8 m toward the lot's front)
      const zc = T.z + Math.cos(T.ry) * -4.8;
      T.fell = true;
      plan.set(fi, 'tower');
      fall = { dir, xs, zc, lot: T, bi: T.bi + (dir > 0 ? 1 : 0), bj: T.bj, inFall: (x, z, pad = 0) => (x - xs) * dir > 5 - pad && (x - xs) * dir < 28.5 + pad && Math.abs(z - zc) < 10.5 + pad };
      fallenAt = [xs, city.z - G2 + (T.bj + 0.5) * PITCH];
      lots.forEach((L, i) => {
        if (L.bi !== T.bi + dir || L.bj !== T.bj) return;
        // (does the lot reach into where the shaft lies?)
        const [hx, hz] = Math.abs(Math.sin(L.ry)) > 0.5 ? [L.d / 2, L.w / 2] : [L.w / 2, L.d / 2];
        const near = dir > 0 ? L.x - hx : L.x + hx;
        if ((near - xs) * dir < 27 && L.z - hz < zc + 10.5 && L.z + hz > zc - 10.5) plan.set(i, 'crushed');
      });
    }
    const left = order.filter((i) => !plan.has(i));
    const big = left.filter((i) => lots[i].w > 40 && lots[i].d > 40);
    const long = left.filter((i) => lots[i].w > 40 && lots[i].d < 40);
    // (the places the run needs only on lots inside the city's circle - its zone: a lot by the ring stands out past
    // it, where a part would be said to lie in the woods)
    const small = left.filter((i) => lots[i].w < 40 && Math.hypot(lots[i].x - city.x, lots[i].z - city.z) < CITY_R - 14);
    const deal = (from, list) => list.forEach((what) => from.length && plan.set(from.shift(), what));
    // (two of each: the towers, and the parts shops the plane's magneto may be in)
    deal(big, ['hospital', 'collapse', 'depot', 'tower', 'tower']);
    deal(small, ['aero', 'aero', 'office', 'office', 'office', 'police', 'pharmacy', 'hardware', 'church', 'gas', 'subway']);
    deal(long, ['carpark', 'cinema', 'terrace', 'block', 'warehouse', 'terrace', 'block']);
    const pick = (W) => {
      let r = rng() * W.reduce((s, e) => s + e[1], 0);
      for (const [t, wt] of W) if ((r -= wt) <= 0) return t;
      return W[0][0];
    };
    lots.forEach((L, i) => {
      const b = new Builder(L.x, L.z, L.ry, cityH);
      b.zone = ZONE.CITY;
      const what = plan.get(i) || (L.w < 40 ? pick(SMALL_LOTS) : L.d < 40 ? pick(LONG_LOTS) : pick(BIG_LOTS));
      L.what = what;
      if (what === 'aero') landmarks.push({ x: L.x, z: L.z, name: 'Calder Aero Supply' });
      if (what === 'police') landmarks.push({ x: L.x, z: L.z, name: 'Port Calder Police' });
      if (SHOP[what]) BUILD.shop(b, L, what);
      else if (what === 'office') BUILD.tower(b, L, false);
      else if (what === 'tower') BUILD.tower(b, L, true);
      else if (what === 'crushed') BUILD.crushed(b, L, fall.inFall);
      else BUILD[what](b, L);
    });
  }
  // THE SQUARE: the paving between the four streets round it (Main Street through its middle), the town hall on its
  // north side facing it, and on its south side the memorial, benches and lamps round it, a tree or two left
  {
    const b = new Builder(city.x, city.z, 0, cityH);
    b.zone = ZONE.CITY;
    const E = PITCH - 3.7; // (from the middle to the kerb of the streets round it)
    for (const sz of [-1, 1]) b.box(0, 0, (sz * (E + 3.7)) / 2, E * 2, PAVE, E - 3.7, 'concrete');
    b.clear(0, 0, PITCH * 1.3);
    // (set back from Main Street far enough for its portico and the steps up to it, and a strip of paving before them)
    const L = { x: city.x, z: city.z - 33, w: 42, d: 42, ry: Math.atan2(0, -1), bi: SQ0, bj: SQ0, what: 'hall' };
    lots.push(L);
    BUILD.hall(new Builder(L.x, L.z, L.ry, cityH + HALL_UP), L);
    // the fountain in the middle of the south half: its basin of stone, the water standing dark in it, the column in
    // the middle; a ring of trees round it in their kerbed beds, benches between them facing it, lamps on the ring
    const FZ = 32;
    b.cyl(0, PAVE, FZ, 5, 0.7, 'stone', { sides: 20 });
    b.cyl(0, PAVE + 0.7, FZ, 4.5, 0.02, 'charred', { sides: 20, collide: false }); // (the water, black and still)
    b.cyl(0, PAVE, FZ, 0.7, 2.6, 'stone', { sides: 10 });
    b.cyl(0, PAVE + 2.6, FZ, 1.4, 0.3, 'stone', { sides: 12, collide: false });
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * PI * 2 + PI / 8;
      const [tx, tz] = [Math.sin(a) * 11, FZ + Math.cos(a) * 11];
      if (Math.cos(a) < -0.7) continue; // (open toward the hall)
      b.box(tx, PAVE, tz, 2.4, 0.3, 2.4, 'concrete');
      b.tree(tx, tz, k % 3 === 0 ? 5 : 1, 0.75 + (k % 3) * 0.1);
      const ba = a + PI / 8;
      const [bx2, bz2] = [Math.sin(ba) * 8.2, FZ + Math.cos(ba) * 8.2];
      if (fits(b, 'street_bench', bx2, bz2, ba + PI, PAVE)) b.prop('street_bench', bx2, bz2, ba + PI, { ly: PAVE });
      if (k % 2 === 0 && fits(b, 'streetlight', Math.sin(ba) * 12.5, FZ + Math.cos(ba) * 12.5, 0, PAVE)) b.prop('streetlight', Math.sin(ba) * 12.5, FZ + Math.cos(ba) * 12.5, ba, { ly: PAVE });
    }
    for (const [lx, lz] of [[-E + 2, 6], [E - 2, 6], [-E + 2, E - 2], [E - 2, E - 2], [-E + 2, -6], [E - 2, -6]]) if (fits(b, 'streetlight', lx, lz, 0, PAVE)) b.prop('streetlight', lx, lz, lx < 0 ? -PI / 2 : PI / 2, { ly: PAVE });
    // rows of trees down the square's sides, between the paving and the parked cars
    for (const sx of [-1, 1]) for (let lz = 10; lz <= 48; lz += 9.5) { b.box(sx * 42, PAVE, lz, 2.2, 0.3, 2.2, 'concrete'); b.tree(sx * 42, lz, 1, 0.8); }
    for (let n = 0; n < 14; n++) b.prop(['litter', 'paper_scatter', 'debris', 'glass_shards'][n & 3], rng.range(-40, 40), rng.range(10, 48), rng.range(0, 6), { nocollide: true, ly: PAVE, seed: n & 1 });
    // the market that was set up on it the last week: stalls in two rows either side of the memorial, their awnings,
    // counters and what was left on them
    const put = (type, lx, lz, ry, o = {}) => fits(b, type, lx, lz, ry, PAVE) && b.prop(type, lx, lz, ry, { ly: PAVE, ...o });
    const stall = (lx, lz, k) => {
      for (const [px, pz] of [[-1.5, -1], [1.5, -1], [-1.5, 1], [1.5, 1]]) b.cyl(lx + px, PAVE, lz + pz, 0.06, 2.5, 'rust', { sides: 6 });
      b.box(lx, PAVE, lz - 0.6, 3, 0.95, 0.9, 'planks');
      b.box(lx, PAVE + 2.45, lz, 3.4, 0.08, 2.6, k % 2 ? 'tin' : 'tin_rust', { rx: 0.16, collide: false });
      put('crate_small', lx - 0.8, lz + 0.5, 0.3, { seed: k & 1 });
      if (k % 3 === 0) put('crate', lx + 0.9, lz + 0.6, -0.2, { seed: 1 });
    };
    let k = 0;
    for (const lx of [-31, -22, -13, 13, 22, 31]) stall(lx, 47, k++); // (along the south edge, facing the fountain)
    for (const lx of [-31, -22, 22, 31]) stall(lx, 17, k++);
    for (const [lx, lz] of [[-24, 32], [24, 32]]) put('picnic_table', lx, lz, 0.2);
    // the evacuation point the army set up by the town hall: its tents, the triage tent, sandbags, barriers on Main
    // Street's kerb, the board
    put('military_tent', -38, -30, PI / 2);
    put('military_tent', 38, -32, -PI / 2, { seed: 1 });
    put('triage_tent', 38, -16, -PI / 2);
    for (const [lx, lz, ry] of [[-30, -18, 0], [-27, -18, 0], [-24, -18, 0.1], [29, -44, 0], [32, -44, 0]]) put('sandbags', lx, lz, ry);
    for (const lx of [-46, -40, 40, 46]) put('jersey_barrier', lx, -6.2, 0);
    put('checkpoint_sign', -34, -6.5, 0);
    // the street furniture along Main Street's kerbs, and the cars left parked down the square's sides
    put('bus_shelter', -46, 6.4, PI);
    put('phone_booth', 44, 6.2, PI);
    put('newspaper_box', 36, 5.6, PI);
    put('vending_machine', -30, 5.8, PI);
    for (let lz = 12; lz < 50; lz += 6.5) {
      if (rng.chance(0.75)) put(rng.chance(0.6) ? 'car_wreck' : 'car_burnt', -48.5, lz, PI / 2 + rng.range(-0.05, 0.05), { seed: rng.int(0, 2) });
      if (rng.chance(0.75)) put(rng.chance(0.6) ? 'car_wreck' : 'car_open', 48.5, lz, -PI / 2 + rng.range(-0.05, 0.05), { seed: rng.int(0, 2) });
    }
    for (let n = 0; n < 10; n++) b.prop(['suitcases', 'stroller', 'shopping_cart', 'bicycle', 'skeleton'][n % 5], rng.range(-44, 44), rng.range(8, 50), rng.range(0, 6), { nocollide: true, ly: PAVE, seed: n & 1 });
    // The square up close, where it is walked into off Main Street (what follows is dealt from dice of its own: the
    // rest of the city is as it was). Its paving is no one slab: bands of dressed stone every 6.5 m across both halves,
    // a slab of it gone here and there to the earth under with weeds in it; a promenade of brick from Main Street to
    // the fountain between two stone kerbs; raised beds of stone either side of it, each with its tree; benches along
    // it, the market's nearer stalls, bins; and what people dropped on their way to the evacuation point.
    {
      const dk = mulberry32((seed ^ 0x5a1e) >>> 0);
      const dr = (a, c) => a + dk() * (c - a);
      const band = (lx, lz, w, d, mat = 'stone_rough', h = 0.045) => b.box(lx, PAVE - 0.03, lz, w, h, d, mat, { collide: false });
      for (const sz of [-1, 1]) {
        for (let k = 0; k <= 16; k++) band(-E + 0.3 + k * 6.5, (sz * (E + 3.7)) / 2, 0.3, E - 3.7);
        for (let k = 0; k <= 7; k++) band(0, sz * (3.85 + k * 6.5), E * 2, 0.3);
      }
      // the promenade, and its kerbs
      band(0, 12.4, 5.4, 17, 'brick', 0.06);
      for (const sx of [-1, 1]) band(sx * 2.85, 12.4, 0.3, 17, 'stone', 0.1);
      // slabs gone: the earth under them, weeds come up through it (not where anything stands, nor on the promenade)
      for (let n = 0; n < 14; n++) {
        const ci = Math.floor(dr(-8, 8));
        const cj = Math.floor(dr(0, 7.5));
        const sz = dk() < 0.5 ? -1 : 1;
        const [lx, lz] = [-E + 0.3 + (ci + 8.5) * 6.5, sz * (3.85 + (cj + 0.5) * 6.5)];
        if (Math.abs(lx) < 6 || (sz < 0 && Math.abs(lx) < 21 && lz < -6) || propBlocked('crate', b.wx(lx, lz), b.wz(lx, lz), 0) || Math.hypot(lx, lz - FZ) < 13) continue;
        const [w, d] = [dr(1.6, 4.2), dr(1.4, 3.6)];
        b.box(lx + dr(-1, 1), PAVE - 0.05, lz + dr(-1, 1), w, 0.065, d, 'earth', { collide: false });
        for (let q = Math.floor(dr(1, 4)); q > 0; q--) weed(b, lx + dr(-w, w) * 0.4, lz + dr(-d, d) * 0.4, dr(0.5, 1.0));
      }
      // the raised beds: a kerb of stone a step high, earth in it, a tree and what has seeded round it
      const bed = (lx, lz, w, d, v) => {
        b.box(lx, PAVE, lz, w, 0.48, d, 'stone');
        b.box(lx, PAVE + 0.48, lz, w - 0.5, 0.03, d - 0.5, 'earth', { collide: false });
        b.tree(lx + dr(-0.6, 0.6), lz, v, dr(0.7, 0.9));
        for (let q = 0; q < 4; q++) weed(b, lx + dr(-w / 2 + 0.6, w / 2 - 0.6), lz + dr(-d / 2 + 0.5, d / 2 - 0.5), dr(0.5, 0.9), PAVE + 0.5);
      };
      for (const sx of [-1, 1]) {
        bed(sx * 12, 10.5, 7.5, 4, sx < 0 ? 1 : 5);
        bed(sx * 27, 10, 6, 3.6, 1);
      }
      const put2 = (type, lx, lz, ry, o = {}) => fits(b, type, lx, lz, ry, PAVE) && b.prop(type, lx, lz, ry, { ly: PAVE, seed: Math.floor(dk() * 3), ...o });
      for (const sx of [-1, 1]) {
        for (const lz of [8.5, 15.5]) put2('street_bench', sx * 4.4, lz, sx < 0 ? -PI / 2 : PI / 2);
        put2('trash_bin', sx * 4.3, 12, 0);
      }
      for (const sx of [-1, 1]) stall(sx * 13.5, 17.5, k++);
      // what was dropped on the way across: bags, a pram, papers, a bicycle down, a body under a sheet
      for (const [type, lx, lz] of [['suitcases', 2.2, 7.2], ['paper_scatter', -1.4, 11], ['stroller', -6.4, 6.4], ['litter', 6.5, 13.5], ['glass_shards', -7.5, 14], ['duffel_bag', 7.8, 6.8], ['bicycle', -9.5, 18.8], ['paper_scatter', 9, 5.4], ['body_bag', 8.5, 19.6], ['litter', -3.2, 19]]) {
        b.prop(type, lx, lz, dr(0, 6), { nocollide: true, ly: PAVE, seed: Math.floor(dk() * 2) });
      }
      // the evacuation point, nearer the street: a floodlight on its mast and the generator for it, a wall of
      // sandbags along the kerb, pallets of the army's crates, cots by the triage tent, a truck backed up to them
      put2('floodlight_tower', -20, -8.2, PI * 0.15);
      put2('generator', -22.6, -10.8, 0.3);
      for (const lx of [18.5, 21.5, 24.5]) put2('sandbags', lx, -6.6, 0);
      put2('pallet', -26.5, -12, 0.1);
      put2('military_crate', -28.9, -10.2, -0.4);
      put2('military_crate', -24.4, -14.2, 0.2);
      for (const lz of [-11, -13.4]) put2('field_cot', 30.5, lz, PI / 2);
      put2('army_truck', 22, -20.5, PI / 2 + 0.08);
      put2('traffic_cones', 16.5, -6.4, 0);
      put2('traffic_cones', -16.8, -6.6, 0.5);
    }
    landmarks.push({ x: city.x, z: city.z + 30, name: 'Town Square' });
  }
  // The streets. Every few metres of them: the traffic that stopped for good - wrecks nose to tail, doors standing
  // open, burnt-out shells, one run up onto the pavement or into a shop front - lamps, hydrants, meters, bins,
  // benches, letter boxes and booths along the kerbs, rubbish, paper and broken glass, what people carried and
  // dropped, the dead where they fell, slabs of the roadway heaved up, weeds along every kerb and saplings in the
  // cracks. A few stretches are worse: a roadblock the army held to the last (wire, sandbags, a knocked-out
  // carrier, its dead), a jam that never moved, a hole the street fell into, and the shaft of a tower lying across
  // the road and the block beyond - climbed through where it broke, or gone round. Whatever would stand in
  // something already there is left out, after its draws.
  {
    const b = new Builder(city.x, city.z, 0, cityH);
    b.zone = ZONE.CITY;
    b.ground = true; // (the roadway lies a little under the city's level: what is on it stands on the ground)
    const free = (type, lx, lz, ry) => !propBlocked(type, b.wx(lx, lz), b.wz(lx, lz), ry);
    // which stretch is which: i, the street; k, the block along it; ns, which way it runs
    const key = (i, k, ns) => `${i}:${k}:${ns ? 1 : 0}`;
    // (the streets' wrecks clear of each other as their colliders are, by a hand's width: a plan is a shade short of
    // some of them - the pickup's - and nose to tail in a jam that was 20 cm into the next)
    const street0 = props.length;
    const boxesOf = (type, x, z, ry, sd, m) => {
      const c = Math.cos(ry), s2 = Math.sin(ry);
      return (collidersOf(type, sd)?.boxes || []).map(([lx, , lz, sx, , sz]) => ({ x: x + c * lx + s2 * lz, z: z - s2 * lx + c * lz, hx: sx / 2 + m, hz: sz / 2 + m, c, s: s2, r: 0 }));
    };
    const carsClear = (type, x, z, ry) => {
      const mine = [0, 1, 2].flatMap((sd) => boxesOf(type, x, z, ry, sd, 0.05));
      for (let k = street0; k < props.length; k++) {
        const p = props[k];
        if (Math.abs(p.x - x) > 10 || Math.abs(p.z - z) > 10 || !LONGISH.has(p.type)) continue;
        for (const o of boxesOf(p.type, p.x, p.z, p.ry, p.seed, 0)) for (const a of mine) if (kit.solidsMeet(a, o)) return false;
      }
      return true;
    };
    const kinds = new Map();
    // (a stretch the ring's curve took - an edge street's round a corner, an inner street's last before the ring - is
    // no street now: nothing is set along it)
    const gone = (i, k, ns) => {
      const o = -G2 + i * PITCH;
      const [a, b2] = [-G2 + k * PITCH, -G2 + (k + 1) * PITCH];
      return ns ? !inRing(o, a, -0.5) || !inRing(o, b2, -0.5) : !inRing(a, o, -0.5) || !inRing(b2, o, -0.5);
    };
    // (where a hole would be dug in a stretch: nothing that came down off a lot lies on its lip)
    const holeAt = (i, k, ns) => (ns ? [city.x - G2 + i * PITCH, city.z - G2 + (k + 0.5) * PITCH + 6] : [city.x - G2 + (k + 0.5) * PITCH + 6, city.z - G2 + i * PITCH]);
    const heaped = (i, k, ns) => heaps.some((q) => Math.hypot(q.x - holeAt(i, k, ns)[0], q.z - holeAt(i, k, ns)[1]) < 14);
    const mark = (kind, n) => {
      for (let tries = 0; n > 0 && tries < 80; tries++) {
        const ns = rng.chance(0.5);
        const i = rng.int(0, GRID);
        const k = rng.int(0, GRID - 1);
        if (kinds.has(key(i, k, ns)) || gone(i, k, ns) || (kind === 'hole' && ((!ns && i === GRID / 2) || heaped(i, k, ns)))) continue; // (no hole in Main Street: Route 9 is the way through)
        kinds.set(key(i, k, ns), kind);
        n--;
      }
    };
    if (fall) kinds.set(key(fall.bi, fall.bj, true), 'fallen');
    for (let k = SQ0; k <= SQ1; k++) kinds.set(key(GRID / 2, k, true), 'square'); // (the cross street is the square there)
    mark('block', ROADBLOCKS);
    mark('jam', JAMS);
    mark('hole', SINKHOLES);
    // the holes are dug first: what is put down after stands in them
    for (const [id, kind] of kinds) {
      if (kind !== 'hole') continue;
      const [i, k, ns] = id.split(':').map(Number);
      const o = -G2 + i * PITCH;
      const m = -G2 + (k + 0.5) * PITCH + 6;
      const [hx, hz] = ns ? [city.x + o, city.z + m] : [city.x + m, city.z + o];
      for (let j = Math.floor((hz - 7 + HALF) / GRID_STEP); j <= Math.ceil((hz + 7 + HALF) / GRID_STEP); j++) {
        for (let ii = Math.floor((hx - 7 + HALF) / GRID_STEP); ii <= Math.ceil((hx + 7 + HALF) / GRID_STEP); ii++) {
          const d = Math.hypot(-HALF + ii * GRID_STEP - hx, -HALF + j * GRID_STEP - hz);
          heights[j * N + ii] -= 1.7 * (1 - smoothstep(1.5, 5.6, d));
        }
      }
    }
    const pickW = (W) => {
      let r = rng() * W.reduce((s, e) => s + e[1], 0);
      for (const [t, wt] of W) if ((r -= wt) <= 0) return t;
      return W[0][0];
    };
    // (what stands by a kerb: on the paving, unless the block there is the ring's, which has none. lx, lz: in the
    // city's frame; o: what onPave says for an ordinary block. Returns the prop's options)
    const paveAt = (lx, lz, o) => {
      const bi = Math.floor((lx + G2) / PITCH), bj = Math.floor((lz + G2) / PITCH);
      return bi >= 0 && bj >= 0 && bi < GRID && bj < GRID && goneBlock(bi, bj) ? {} : o;
    };
    const TRAFFIC = [['car_wreck', 3], ['car_burnt', 2.4], ['car_open', 2.8], ['pickup_truck', 1.1], ['van_wreck', 1.1], ['ambulance', 0.3], ['box_truck', 0.45]];
    const LITTER = ['litter', 'litter', 'paper_scatter', 'paper_scatter', 'glass_shards', 'glass_shards', 'debris', 'suitcases', 'bicycle', 'stroller', 'skeleton', 'corpse', 'bones', 'traffic_cones', 'shopping_cart', 'blood_pool', 'litter', 'debris'];
    const hasTrunk = (type) => type === 'car_wreck' || type === 'car_open';
    for (let i = 0; i <= GRID; i++) {
      for (let k = 0; k < GRID; k++) {
        for (const ns of [true, false]) {
          // (the stretch of street i between crossings k and k + 1, north-south or east-west)
          const o = -G2 + i * PITCH;
          const m = -G2 + (k + 0.5) * PITCH;
          const at = (along, across) => (ns ? [o + across, m + along] : [m + along, o + across]);
          const yaw = ns ? 0 : PI / 2;
          // which way a thing is turned for its front (-Z) to look down the street (sign of along), or across it
          // toward its middle (from the side `sgn` of it)
          const faceAlong = (sign) => (ns ? (sign > 0 ? PI : 0) : sign > 0 ? -PI / 2 : PI / 2);
          const faceIn = (sgn) => (ns ? (sgn * PI) / 2 : sgn > 0 ? 0 : PI);
          const kind = kinds.get(key(i, k, ns));
          if (kind === 'square' || gone(i, k, ns)) continue;
          // (the paving of a block stands PAVE over the city's level from 3.7 m off a street's middle - where there is
          // a block: the outer side of an edge street is a verge. What is put on it stands on it.)
          const onPave = (across) => (Math.abs(across) > 3.75 && (across > 0 ? i < GRID : i > 0) ? { ly: PAVE } : {});
          // (where a block has paving at that spot: paveAt - the blocks the ring took have none)
          const paveOf = (along, across) => paveAt(...at(along, across), onPave(across));
          const litter = (type, along, across, o2 = {}) => b.prop(type, ...at(along, across), rng.range(0, 6), { nocollide: true, seed: rng.int(0, 2), ...(paveOf(along, across) || {}), ...o2 });
          const put = (type, along, across, ry, o2 = {}) => {
            const pv = paveOf(along, across);
            if (pv) extra(b, type, ...at(along, across), ry, { ...pv, ...o2 });
          };
          const car = (type, along, across, ry, trunk = false) => {
            const [x, z] = at(along, across);
            const pv = paveOf(along, across);
            if (!pv || !PROPS[type] || !fits(b, type, x, z, ry, pv.ly ?? 0) || !carsClear(type, b.wx(x, z), b.wz(x, z), b.ry + ry)) return false;
            b.wreck(type, x, z, ry, { trunk: trunk && hasTrunk(type), zone: ZONE.ROADSIDE, ...pv });
            return true;
          };
          // weeds along both kerbs and up the middle of the road, whatever else is here
          for (let n = rng.int(7, 11); n > 0; n--) weed(b, ...at(rng.range(-21, 21), (rng.chance(0.5) ? 1 : -1) * rng.range(3.5, 3.95)), rng.range(0.5, 1.1));
          for (let n = rng.int(2, 4); n > 0; n--) weed(b, ...at(rng.range(-21, 21), rng.range(-0.5, 0.5)), rng.range(0.25, 0.45));
          if (kind === 'fallen') continue; // (laid after the rest: below)
          // the kerbs: a lamp at either end, meters down one side, and what a city sets along its pavements
          {
            const [lx, lz] = at(-20, 4.5);
            const pl = paveAt(lx, lz, onPave(4.5));
            if (pl && free('streetlight', lx, lz, 0)) b.prop('streetlight', lx, lz, ns ? PI / 2 : 0, pl); // (its arm out over the roadway)
            const [rx, rz] = at(14, -4.5);
            const there = rng.chance(0.7);
            const pr = paveAt(rx, rz, onPave(-4.5));
            if (there && pr && free('streetlight', rx, rz, 0)) b.prop('streetlight', rx, rz, ns ? -PI / 2 : PI, pr);
            const side = rng.chance(0.5) ? 1 : -1;
            for (let a = -15; a <= 15; a += 6) {
              const here = rng.chance(0.6);
              if (here) put('parking_meter', a + rng.range(-0.4, 0.4), side * 4.15, faceIn(side) + rng.range(-0.2, 0.2));
            }
            for (const sgn of [-1, 1]) {
              const row = [['fire_hydrant', 0.55], ['trash_bin', 0.8], ['street_bench', 0.5], ['mail_dropbox', 0.35], ['newspaper_box', 0.45], ['trash_bin', 0.35], ['phone_booth', 0.22], ['pole_leaning', 0.14]];
              for (const [type, p] of row) {
                const here = rng.chance(p);
                const along = rng.range(-18, 18);
                const across = sgn * (type === 'street_bench' || type === 'phone_booth' ? 5.2 : rng.range(4.3, 4.7));
                const turn = rng.range(-0.15, 0.15);
                if (here) put(type, along, across, (type === 'phone_booth' ? faceIn(-sgn) : faceIn(sgn)) + turn);
              }
            }
          }
          if (kind === 'block') {
            // A roadblock, and the last stand made at it. d: which way it faced (what came, came from -d).
            const s0 = rng.range(-5, 5);
            const d = rng.chance(0.5) ? 1 : -1;
            for (const across of [-2.1, 1.5]) put('jersey_barrier', s0, across, yaw);
            for (const across of [-5.3, 5.3]) put('tank_trap', s0 - d * 0.4, across, rng.range(0, 3));
            put('concertina', s0 - d * 3.4, 0.2, yaw + rng.range(-0.06, 0.06));
            put('concertina', s0 - d * 6.6, -0.6, yaw + rng.range(-0.2, 0.2));
            put('sandbag_nest', s0 + d * 3.3, -1.5, faceAlong(-d));
            b.prop('mg_tripod', ...at(s0 + d * 3.6, -1.5), faceAlong(-d), { nocollide: true });
            put('sandbags', s0 + d * 2.4, 2.4, yaw);
            const carrier = rng.chance(0.6);
            if (carrier) put('apc_wreck', s0 + d * 9.4, 0.3, yaw + PI / 2 + rng.range(-0.35, 0.35));
            else put('army_truck', s0 + d * 10, -1.8, faceAlong(-d) + rng.range(-0.2, 0.2));
            const second = rng.chance(0.6);
            if (second) put('army_truck', s0 + d * 17, 1.8, faceAlong(d) + rng.range(-0.15, 0.15), { seed: 1 });
            put('floodlight_tower', s0 + d * 5.4, -5.0, faceAlong(-d));
            put('checkpoint_sign', s0 - d * 9, 2.2, faceAlong(-d) + rng.range(-0.2, 0.2));
            // the order on its posts, facing what came
            {
              const [qx, qz] = at(s0 - d * 1.2, 5.6);
              const posts = [-0.8, 0.8].map((dq) => (ns ? [qx + dq, qz] : [qx, qz + dq]));
              if (posts.every(([px, pz]) => fits(b, 'parking_meter', px, pz, 0, PAVE))) {
                for (const [px, pz] of posts) b.cyl(px, onPave(5.6).ly ?? 0, pz, 0.06, 2.9, 'rust', { sides: 6 });
                signAt(b, qx, 2.3 + (onPave(5.6).ly ?? 0), qz, faceAlong(-d), 2.0, 1.0, 'quarantine', { far: true, back: 0.05 });
              }
            }
            // (its crate is the city's: a container's zone is the place a schematic in it is rumoured to be in)
            const [cx, cz] = at(s0 + d * 4.6, 3.6);
            if (fits(b, 'military_crate', cx, cz, yaw)) b.cont(CONT.AMMO_BOX, cx, cz, { prop: 'military_crate', ry: yaw });
            put('field_cot', s0 + d * 7, 5.4, yaw + PI / 2);
            put('barrel', s0 + d * 6.2, -3.2, 0);
            // those who held it, and those who came at it
            for (let n = 0; n < 9; n++) {
              const behind = n < 4;
              litter(['corpse', 'skeleton', 'body_bag', 'skeleton', 'corpse', 'bones'][rng.int(0, 5)], s0 + d * (behind ? rng.range(1, 8) : -rng.range(1, 14)), rng.range(-6, 6));
            }
            for (let n = 0; n < 4; n++) litter('blood_pool', s0 + rng.range(-9, 9), rng.range(-5, 5));
            for (let n = 0; n < 3; n++) litter(['glass_shards', 'litter', 'suitcases'][n], s0 - d * rng.range(6, 16), rng.range(-5, 5));
            // the last cars that tried it
            for (const [dd, across, turn] of [[11, -1.8, 0.2], [13.4, 1.9, -0.5], [18, -1.6, 0.1]]) {
              const type = pickW(TRAFFIC.slice(0, 4));
              const ry = faceAlong(d) + turn * rng.range(0.4, 1.4);
              car(type, s0 - d * dd, across, ry, rng.chance(0.5));
            }
            continue;
          }
          if (kind === 'jam') {
            // bumper to bumper, both lanes, doors open where their people got out and ran: the last traffic the
            // street ever had. A bus in the middle of it.
            const busAt = rng.int(1, 4);
            const busLane = rng.chance(0.5) ? 1 : -1;
            for (let n = 0; n < 7; n++) {
              for (const sgn of [-1, 1]) {
                const type = pickW(TRAFFIC);
                const ry = yaw + (sgn > 0 ? PI : 0) + rng.range(-0.12, 0.12);
                const gone = rng.chance(0.1);
                const along = -19.5 + n * 6.2 + rng.range(-0.4, 0.4);
                const across = sgn * rng.range(1.75, 2.05);
                const trunk = rng.chance(0.5);
                if (sgn === busLane && n === busAt) car('city_bus', along + 3, sgn * 1.95, yaw + (sgn > 0 ? PI : 0) + rng.range(-0.04, 0.04));
                else if (!gone) car(type, along, across, ry, trunk);
              }
            }
            for (let n = rng.int(10, 14); n > 0; n--) litter(['suitcases', 'litter', 'suitcases', 'paper_scatter', 'corpse', 'skeleton', 'stroller', 'glass_shards', 'bicycle'][rng.int(0, 8)], rng.range(-20, 20), rng.range(-6.4, 6.4));
            continue;
          }
          const hole = kind === 'hole';
          // the roadway: what was driving down it
          const nv = hole ? 2 : rng.int(3, 6);
          for (let n = 0; n < nv; n++) {
            const sgn = n % 2 ? 1 : -1;
            const along = hole ? rng.range(-20, -7) : -19 + (n + rng.range(0.15, 0.85)) * (38 / nv); // (a hole is at +6: clear of it)
            const type = pickW(TRAFFIC);
            const crash = rng.chance(0.2);
            const ry = yaw + (sgn > 0 ? PI : 0) + (crash ? rng.range(-0.9, 0.9) : rng.range(-0.22, 0.22));
            const across = sgn * rng.range(1.5, 2.3);
            const trunk = rng.chance(0.4);
            const here = rng.chance(0.9);
            if (here) car(type, along, across, ry, trunk);
          }
          // (...one more that ran up onto the pavement, or into the front of a shop: its glass all round it)
          {
            const up = rng.chance(0.6);
            const sgn = rng.chance(0.5) ? 1 : -1;
            const into = rng.chance(0.45);
            const along = hole ? rng.range(-20, -7) : rng.range(-17, 17);
            const type = pickW(TRAFFIC.slice(0, 5));
            const ry = into ? faceIn(-sgn) + rng.range(-0.45, 0.45) : yaw + rng.range(-0.5, 0.5);
            const ok = up && car(type, along, sgn * (into ? 5.5 : rng.range(4.75, 4.95)), ry);
            if (ok && into) {
              litter('glass_shards', along + rng.range(-1, 1), sgn * 6.6);
              litter('debris', along + rng.range(-1.5, 1.5), sgn * 6.4);
            }
          }
          // what came down off the buildings either side: slabs and lumps along the kerbs
          for (let n = rng.int(2, 5); n > 0; n--) {
            const across = (rng.chance(0.5) ? 1 : -1) * rng.range(4.2, 6.2);
            const [x, z] = at(rng.range(-20, 20), across);
            skirt(b, x, z, onPave(across).ly ?? 0.02);
          }
          // what lies about: every few metres of it
          for (let n = rng.int(11, 16); n > 0; n--) litter(LITTER[rng.int(0, LITTER.length - 1)], rng.range(-21, 21), rng.range(-6.6, 6.6));
          {
            const r = rng();
            const pa = rng.range(-18, 18);
            const rim = hole && Math.abs(pa - 6) < 9; // (nothing solid on the lip of a hole)
            const across = (rng.chance(0.5) ? 1 : -1) * rng.range(4.6, 5.2);
            const pr = rng.range(0, 6);
            const [px, pz] = at(pa, across);
            if (r < 0.3) litter('pole_down', rng.range(-8, 8), rng.range(-1, 1), { ry: undefined });
            else if (r < 0.5 && !rim && paveAt(px, pz, onPave(across))?.ly && fits(b, 'dumpster_tipped', px, pz, pr, PAVE)) b.cont(CONT.DUMPSTER, px, pz, { prop: 'dumpster_tipped', ry: pr, ...onPave(across) });
            else if (r < 0.62 && !rim) put('barricade', pa, across, yaw + PI / 2);
          }
          // the roadway, heaved: slabs of it tipped up out of the street (round a hole, all of its rim)
          for (let n = hole ? 7 : rng.int(1, 3); n > 0; n--) {
            const [hx, hz] = hole ? at(6 + Math.sin(n * 0.9) * rng.range(4.4, 6.2), Math.cos(n * 0.9) * rng.range(3.6, 5.2)) : at(rng.range(-20, 20), rng.range(-3.4, 3.4));
            // (the low edge well down in the street, the high one a hand or two up out of it: heaved, not lifted off)
            const [sw, sd, sry, srz, srx] = [rng.range(1.4, 2.6), rng.range(1.2, 2.2), rng.range(0, 3), rng.range(-0.34, 0.34), rng.range(-0.2, 0.2)];
            b.box(hx, -0.16, hz, sw, 0.2, sd, 'concrete', { ry: sry, rz: srz * 0.45, rx: srx * 0.45, collide: false });
          }
          for (let n = rng.int(0, 2); n > 0; n--) b.tree(...at(rng.range(-20, 20), (rng.chance(0.5) ? 1 : -1) * rng.range(4.9, 5.6)), 5, rng.range(0.45, 0.75)); // (a birch, out of a crack)
        }
      }
    }
    // The shaft of the tower that fell, where it lies: three lengths of it end to end from the foot of what still
    // stands - the first against the podium, the second across the far pavement and into the block beyond, the
    // third on what it crushed there - broken apart over the roadway, where the rubble between them is the way
    // through. (across: they are the one thing built in a road.)
    if (fall) {
      const { dir, xs, zc, lot } = fall;
      const lx = xs - city.x;
      const lz = zc - city.z;
      const st = lot.shaft || { style: 'office', fh: 3.3 };
      // (each a little askew of the last, and none of them level: tilt - its far end up)
      const length = (x0, x1, w, h, tilt, skew) => {
        const cx = lx + (dir * (x0 + x1)) / 2;
        solid(b, cx, 0.02, lz, Math.abs(x1 - x0), h, w, 'concrete', { ry: skew }).across = true;
        fallenBits.push({ x: b.wx(cx, lz), y: b.y0 + 0.02, z: b.wz(cx, lz), ry: (dir > 0 ? 0 : PI) + skew, len: Math.abs(x1 - x0), w, h, fh: st.fh, style: st.style, mat: 'concrete', seed: rng.int(1, 99999), tilt });
      };
      length((lot.x + dir * 17 - xs) * dir + 0.5, -1.9, 15, 7.6, -0.14, 0.02); // (from the podium's flank, its end there up on what it broke off: it is 34 m across)
      length(1.9, 12.4, 15, 6.4, 0.05, -0.05);
      length(14.4, 22.6, 14, 4.6, -0.08, 0.07);
      // the break over the roadway: rubble to the height of a man, and at either mouth of it
      heap(b, lx, lz, 1.7, 6.6, 1.6, { across: true, ly: 0.02 });
      for (const sz of [-1, 1]) heap(b, lx + rng.range(-0.6, 0.6), lz + sz * 9.6, 3.2, 2.6, 1.3, { across: true, ly: 0.02, ry: rng.range(-0.3, 0.3) });
      // (...between the second length and the third, and the last of it beyond)
      heap(b, lx + dir * 13.4, lz + rng.range(-3, 3), 1.2, 4.6, 2.2, { ly: PAVE });
      heap(b, lx + dir * 25.4, lz + rng.range(-2, 2), 2.6, 5.0, 2.2, { ly: PAVE });
      for (const [dx, dz] of [[7, -9.6], [8, 9.8], [18.6, -9.2], [19.4, 9.4], [11.6, -9.9], [12.4, 10], [22.6, 9.8], [23, -9.7]]) heap(b, lx + dir * dx, lz + dz, rng.range(2.2, 3), rng.range(1.7, 2.3), rng.range(0.9, 1.5), { ly: PAVE, ry: rng.range(-0.4, 0.4) });
      // (slabs of its skin against it, where they slid off)
      for (let n = 0; n < 10; n++) {
        const sd = n % 2 ? 1 : -1;
        b.box(lx + dir * rng.range(2, 22), PAVE + rng.range(0.5, 1.6), lz + sd * rng.range(7.9, 8.6), rng.range(2.4, 4.4), 0.28, rng.range(2, 3.4), 'concrete', { rx: sd * rng.range(0.7, 1.15), ry: rng.range(-0.3, 0.3), collide: false });
      }
      for (const [dx, dz] of [[-5, -9.4], [-5.4, 9.6], [-1, -13], [2, 13.4], [10, -12.4], [11, 12.6]]) skirt(b, lx + dir * dx, lz + dz, Math.abs(dx) < 3.7 ? 0.02 : PAVE);
      // what it landed on, under its second length
      b.prop('car_burnt', lx + dir * 4.6, lz + 10.6, 0.1, { nocollide: true, seed: 1 });
      b.prop('pole_down', lx - dir * 3, lz - 11.6, 1.2, { nocollide: true });
      for (let n = 0; n < 8; n++) b.prop(['debris', 'glass_shards', 'paper_scatter', 'litter'][n & 3], lx + rng.range(-6, 6), lz + (n % 2 ? 1 : -1) * rng.range(8.6, 16), rng.range(0, 6), { nocollide: true, seed: n & 1 });
      smoke(b, lx + dir * 7, 5, lz);
      if (!fires) fire(b, lx + dir * 9, 0.8, lz + 2.5); // (and if nothing in the city burns yet, the wreck of it does)
    }
    // the crossings: lights dead over them (one in three down), here and there the two that met in the middle
    for (let i = 1; i < GRID; i++) {
      for (let j = 1; j < GRID; j++) {
        const x = -G2 + i * PITCH;
        const z = -G2 + j * PITCH;
        const main = j === GRID / 2;
        const r = rng();
        const crash = rng.chance(0.3);
        const [t1, t2] = [rng.range(0, 6), rng.range(0, 6)];
        if (main || r < 0.5) {
          if ((i + j) % 3 === 1) b.prop('pole_down', x + 4.4, z - 4.6, 0.7, { nocollide: true, seed: 1 });
          else if (paveAt(x + 5.2, z - 5.2, { ly: PAVE })?.ly && fits(b, 'traffic_light', x + 5.2, z - 5.2, PI, PAVE)) b.prop('traffic_light', x + 5.2, z - 5.2, PI, { ly: PAVE }); // (their arms out over the cross street)
          if (paveAt(x - 5.2, z + 5.2, { ly: PAVE })?.ly && fits(b, 'traffic_light', x - 5.2, z + 5.2, 0, PAVE)) b.prop('traffic_light', x - 5.2, z + 5.2, 0, { ly: PAVE });
        }
        if (crash && !(fall && Math.hypot(x - (fall.xs - city.x), z - (fall.zc - city.z)) < 34)) {
          const a = pickW(TRAFFIC.slice(0, 5));
          const c2 = pickW(TRAFFIC.slice(0, 5));
          const put1 = fits(b, a, x - 1.4, z + 0.6, t1);
          if (put1) b.wreck(a, x - 1.4, z + 0.6, t1, { trunk: false, zone: ZONE.ROADSIDE });
          // (the second clear of the first by more than their plans say: a plan is a shade short of some of them - the
          // pickup's - and the two are turned every way)
          const clear = !put1 || !kit.solidsOf(a, b.wx(x - 1.4, z + 0.6), b.wz(x - 1.4, z + 0.6), b.ry + t1).some((p) => kit.solidsOf(c2, b.wx(x + 2.4, z - 1.6), b.wz(x + 2.4, z - 1.6), b.ry + t2).some((q) => kit.solidsMeet({ ...p, hx: p.hx + 0.15, hz: p.hz + 0.3 }, q)));
          if (clear && fits(b, c2, x + 2.4, z - 1.6, t2)) b.wreck(c2, x + 2.4, z - 1.6, t2, { trunk: false, zone: ZONE.ROADSIDE });
          b.prop('glass_shards', x + 0.4, z - 0.4, t1, { nocollide: true });
        }
        for (let n = rng.int(2, 4); n > 0; n--) b.prop(LITTER[rng.int(0, LITTER.length - 1)], x + rng.range(-5, 5), z + rng.range(-5, 5), rng.range(0, 6), { nocollide: true, seed: rng.int(0, 2) });
      }
    }
    // a bus slewed across one of the crossings, an articulated truck jack-knifed across another
    const jx = -G2 + rng.int(1, GRID - 1) * PITCH;
    const jz = -G2 + [1, 2, 4, 5][rng.int(0, 3)] * PITCH;
    if (fits(b, 'city_bus', jx + 1, jz - 0.5, 0.9)) b.wreck('city_bus', jx + 1, jz - 0.5, 0.9, { trunk: false });
    const tx = -G2 + rng.int(1, GRID - 1) * PITCH;
    const tz = -G2 + [1, 2, 4, 5][rng.int(0, 3)] * PITCH;
    if (fits(b, 'semi_truck', tx - 1, tz + 0.5, 2.2)) b.wreck('semi_truck', tx - 1, tz + 0.5, 2.2, { trunk: false, seed: 1 });
  }

  // THE HARBOUR STREETS: the two blocks between the ring's south-west curve and the docks, on the town's pitch, paved,
  // a lamp at each corner, and on each a building to each street: warehouses to the docks' road, terraces or a block
  // of flats to the town (dealt from dice of their own: what the town deals stays put)
  {
    const qd = (n) => hash2(n, 37, (seed ^ 0x0d0c5) | 0);
    for (const bj of [GRID - 2, GRID - 1]) {
      const bx = city.x - G2 - PITCH / 2;
      const bz = city.z - G2 + (bj + 0.5) * PITCH;
      const b = new Builder(bx, bz, 0, cityH);
      b.zone = ZONE.ROADSIDE; // (between two places, in neither: nothing in it is said to be in one)
      b.clear(0, 0, PITCH * 0.72);
      b.box(0, 0, 0, PAVED, PAVE, PAVED, 'concrete');
      for (const sz of [-1, 1]) {
        const n = bj * 2 + (sz > 0 ? 1 : 0);
        const L = { x: bx, z: bz + sz * 11.25, w: 42, d: 19.5, ry: Math.atan2(0, -sz), bi: -1, bj, what: '' };
        L.what = (bj === GRID - 1 && sz > 0) || qd(n) < 0.3 ? 'warehouse' : qd(n + 9) < 0.6 ? 'terrace' : 'block';
        const lb = new Builder(L.x, L.z, L.ry, cityH);
        lb.zone = ZONE.ROADSIDE;
        BUILD[L.what](lb, L);
      }
      const E = PAVED / 2 - 0.9;
      for (const [lx, lz] of [[-E, -E], [E, -E], [-E, E], [E, E]]) if (fits(b, 'streetlight', lx, lz, 0, PAVE)) b.prop('streetlight', lx, lz, lx < 0 ? -PI / 2 : PI / 2, { ly: PAVE });
    }
  }

  // THE BRIDGES: wherever a road crosses the river. A concrete deck on piers a little over the water, rusted
  // girders down its sides, what is left of its railings. (A deck is thin: the dead walk over it - server/nav.js.)
  const bridges = [];
  {
    const b = new Builder(0, 0, 0, 0);
    b.zone = ZONE.FOREST;
    for (const road of roads) {
      for (const [i0, i1] of road.spans) {
        const p = road.pts;
        const [a, e] = [Math.max(0, i0 - 3), Math.min(p.length / 2 - 1, i1 + 3)];
        // (only where it is over the water in fact: a footpath that keeps to the bank has none)
        let over = false;
        for (let i = i0; i <= i1; i++) over ||= heightAt(p[i * 2], p[i * 2 + 1]) < WATER_LEVEL - 0.95;
        if (!over) continue;
        const w = Math.max(5, road.width * 2 + 1.4);
        for (let i = a; i < e; i++) {
          const [x0, z0, x1, z1] = [p[i * 2], p[i * 2 + 1], p[i * 2 + 2], p[i * 2 + 3]];
          const len = Math.hypot(x1 - x0, z1 - z0);
          const ry = Math.atan2(-(z1 - z0), x1 - x0);
          const top = road.hs[i] + 0.02;
          const [cx, cz] = [(x0 + x1) / 2, (z0 + z1) / 2];
          b.box(cx, top - 0.4, cz, len + 0.3, 0.4, w, 'concrete', { ry });
          const [nx, nz] = [-(z1 - z0) / len, (x1 - x0) / len];
          for (const sd of [-1, 1]) {
            // the girder, and the railing over it: posts and a rail, lengths of it gone
            b.box(cx + nx * sd * (w / 2 - 0.15), top - 1.0, cz + nz * sd * (w / 2 - 0.15), len + 0.3, 1.25, 0.3, 'rust', { ry, collide: false });
            const gone = rng.chance(0.22);
            if (gone) continue;
            b.box(cx + nx * sd * (w / 2 - 0.15), top + 0.25, cz + nz * sd * (w / 2 - 0.15), 0.09, 0.9, 0.09, 'rust', { ry, collide: false });
            b.box(cx + nx * sd * (w / 2 - 0.15), top + 1.08, cz + nz * sd * (w / 2 - 0.15), len + 0.3, 0.08, 0.08, 'rust', { ry, rz: rng.range(-0.05, 0.05), collide: false });
            b.box(cx + nx * sd * (w / 2 - 0.15), top + 0.66, cz + nz * sd * (w / 2 - 0.15), len + 0.3, 0.05, 0.05, 'rust', { ry, collide: false });
          }
          // a pier under every fourth length of it that stands in the water
          const bed = heightAt(cx, cz);
          // (not solid: it stands in the water under the deck, and a solid there is a wall across the deck to the dead)
          if ((i - a) % 4 === 2 && bed < WATER_LEVEL - 0.3) b.box(cx, bed - 0.3, cz, 0.9, top - 0.4 - bed + 0.3, w - 1.2, 'concrete', { ry, collide: false });
        }
        const m = (i0 + i1) >> 1;
        const [dx, dz] = [p[e * 2] - p[a * 2], p[e * 2 + 1] - p[a * 2 + 1]];
        bridges.push({ x: p[m * 2], y: road.hs[m], z: p[m * 2 + 1], ry: Math.atan2(-dz, dx), len: Math.hypot(dx, dz), w });
        clears.push([p[m * 2], p[m * 2 + 1], Math.hypot(dx, dz) / 2 + 3]);
      }
    }
  }

  // INDUSTRIAL DOCKS -----------------------------------------------------------------------------------------------
  // The ironworks' yard behind the quays (its casting shed is the factory the picture marks), warehouses along the
  // waterfront, container stacks and cranes on the quay, and the piers out into the sea.
  place(ZONE.INDUSTRIAL, (q) => {
    const b = q.sub(14, -12, 0); // (the ironworks, east of the warehouses)
    const FX = 44;
    const FZ = 40;
    for (let x = -FX + 1.5; x < FX; x += 3) {
      if (Math.abs(x) > 5) b.prop('fence_chain', x, -FZ, 0);
      b.prop('fence_chain', x, FZ, 0);
    }
    for (let z = -FZ + 1.5; z < FZ; z += 3) {
      if (Math.abs(z) > 5) b.prop('fence_chain', -FX, z, PI / 2);
      b.prop('fence_chain', FX, z, PI / 2);
    }
    b.prop('boom_gate', -0.4, -FZ, 0);
    // the casting shed: one long hall, open at both ends
    b.room(-18, 6, 22, 38, 8, 'tin_rust', { n: [gap(11, 7, 5.5)], s: [gap(11, 7, 5.5)], e: [door(12, 1.4), door(28, 1.4)] }, { roof: 'gable', roofH: 3.4, roofMat: 'tin', floorMat: 'concrete' });
    for (const lz of [-6, 6, 18]) b.box(-24.5, 0.12, lz, 5, 2.6, 5, 'rust'); // furnaces along the west wall
    b.box(-13, 0.12, 0, 3.4, 1.1, 8, 'metal'); // the casting bed
    b.cont(CONT.TOOLBOX, -11, 8, { prop: 'toolbox', ry: 0.4, nocollide: true, ly: 0.12 });
    b.cont(CONT.CRATE, -11.5, 14, { prop: 'crate', ry: 0.2, ly: 0.12 });
    b.cont(CONT.LOCKER, -8, 23.2, { prop: 'locker', ry: PI, ly: 0.12 });
    b.loot(-14, -8, 0.14);
    b.loot(-18, 20, 0.14);
    b.loot(-22.5, 22, 0.14);
    // the machine shop
    b.room(20, -18, 20, 14, 4.6, 'brick', { w: [door(7, 1.4)], n: [gap(10, 4.6, 3.6), win(16.5, 1.6)], e: [win(7, 1.6)] }, { roof: 'flat', roofMat: 'concrete', floorMat: 'concrete' });
    b.box(22, 0.12, -13.2, 9, 0.95, 1.1, 'planks'); // the benches
    b.box(27.6, 0.12, -19, 1.1, 0.95, 6, 'planks');
    b.loot(22, -13.2, 1.09);
    b.cont(CONT.SHELF, 13.6, -12.4, { prop: 'shelf', ry: PI, ly: 0.12 });
    b.cont(CONT.TOOLBOX, 26, -22.5, { prop: 'toolbox', ry: 1.1, nocollide: true, ly: 0.12 });
    b.cont(CONT.LOCKER, 29.3, -23.6, { prop: 'locker', ry: -PI / 2, ly: 0.12 });
    // the yard: stacks of billets, a gantry over them, what the last shift left standing
    for (const [sx, sz, h] of [[14, 10, 1.6], [14, 16, 2.4], [22, 10, 0.8], [22, 16, 1.6], [30, 13, 2.4]]) b.box(sx, 0, sz, 6, h, 2.2, 'rust');
    for (const gx of [9, 35]) for (const gz of [6, 20]) b.box(gx, 0, gz, 0.5, 8, 0.5, 'rust');
    for (const gz of [6, 20]) b.box(22, 8, gz, 26.5, 0.6, 0.6, 'rust', { collide: false });
    b.box(22, 7.2, 13, 1.6, 1.2, 14.6, 'metal', { collide: false });
    b.wreck('dump_truck', 6, -26, 1.2, { trunk: false });
    b.wreck('pickup_truck', -4, -30, 0.3);
    b.prop('fuel_tank', 36, 30, 0);
    b.prop('generator', 8, 30, 0.3);
    b.cont(CONT.DUMPSTER, 30, -30, { prop: 'dumpster', ry: PI });
    b.cont(CONT.CRATE, 2, 26, { prop: 'crate', ry: 0.4 });
    b.prop('barrel', 3.6, 28, 0);
    b.light(3.6, 1.0, 28, 'embers');
    b.prop('streetlight', -6, -36, PI);
    b.prop('corpse', 2, -12, 0.7, { nocollide: true });
    b.loot(10, -30);
    b.loot(30, 26);
    // the stack, cold; containers of what was to be shipped; what the years added
    b.cyl(-36, 0, -22, 1.6, 24, 'brick', { sides: 12 });
    b.cyl(-36, 24, -22, 1.75, 0.6, 'charred', { sides: 12, collide: false });
    b.prop('shipping_container', -36, 6, 0.04, { seed: 1 });
    b.prop('shipping_container', -36, 13, -0.03, { seed: 2 });
    b.prop('shipping_container', -36, 13, 0.02, { seed: 0, ly: 2.6 });
    b.cont(CONT.FREIGHT, -32.6, 20, { prop: 'crate', ry: 0.3 });
    b.prop('ivy', -6.96, 12, -PI / 2, { nocollide: true });
    b.prop('ivy', 9.96, -18, PI / 2, { nocollide: true, seed: 1 });
    b.prop('debris', 0, 0, 1, { nocollide: true });
    b.prop('litter', 12, -32, 2, { nocollide: true });
    smoke(b, -18, 9, 6);
    // the warehouses on the waterfront, their doors to the quay (west)
    for (const [lz, k] of [[-62, 0], [24, 1]]) {
      const s = q.sub(-58, lz, PI / 2);
      s.room(0, 0, 34, 16, 7, k === 1 ? 'tin_rust' : 'tin', { n: [gap(17, 8, 5.5)], s: [door(8, 1.4), door(26, 1.4)], e: [win(8, 2)], w: [win(8, 2)] }, { roof: 'gable', roofH: 3, roofMat: 'tin', floorMat: 'concrete' });
      for (const [px, pz, r] of [[-11, 3, 0.1], [-6, -2, 0.4], [9, 4, 1.3], [12, -3, 0.2]]) s.prop('pallet', px, pz, r, { ly: FLOOR_Y, seed: (px + k) & 1 });
      s.cont(CONT.FREIGHT, -13, 5.6, { prop: 'crate', ry: 0.2, ly: FLOOR_Y, seed: k });
      s.cont(CONT.CRATE, 6, 5.4, { prop: 'crate', ry: -0.3, ly: FLOOR_Y, seed: k + 1 });
      s.cont(CONT.SHELF, 15.8, 0, { prop: 'shelf', ry: -PI / 2, ly: FLOOR_Y, seed: k });
      s.prop('shipping_container', -3, 2.4, PI / 2 + 0.05, { ly: FLOOR_Y, seed: k });
      s.loot(2, -4, FLOOR_Y + 0.02);
      s.loot(-9, 1, FLOOR_Y + 0.02);
      if (k === 2) s.prop('pallet', 4, -5, 0.6, { ly: FLOOR_Y, seed: 1 });
    }
    // containers stacked on the quay between them, two high in places
    for (const [lx, lz, r, two] of [[-62, -24, 0.02, true], [-62, -16, -0.03, false], [-62, 58, 0.01, true], [-30, 60, PI / 2, false], [-30, 70, PI / 2 + 0.04, true]]) {
      if (!fits(q, 'shipping_container', lx, lz, r)) continue;
      q.prop('shipping_container', lx, lz, r, { seed: (lz & 3) });
      if (two) q.prop('shipping_container', lx, lz, r + 0.02, { seed: (lz + 1) & 3, ly: 2.6 });
    }
    q.cont(CONT.FREIGHT, -58, -4, { prop: 'crate', ry: 0.3 });
    // THE WATERFRONT. The quay: its wall down into the dredged water along the whole front, a kerb of stone on it,
    // bollards every few metres (not at a pier's root)
    const QX = QUAY_LX;
    const QH = zoneById[ZONE.INDUSTRIAL].h - WATER_LEVEL + 7.5; // (the wall's face, from its foot on the bed to the top)
    const QZ0 = -QUAY_HZ + 2, QZ1 = QUAY_HZ - 2;
    for (let lz = QZ0; lz <= QZ1; lz += 24) q.clear(QX + 40, lz, 42); // (the apron: nothing grows on it)
    for (let z0 = QZ0; z0 < QZ1; z0 += 32) {
      const len = Math.min(32, QZ1 - z0);
      q.box(QX + 0.6, -QH, z0 + len / 2, 1.2, QH + 0.18, len, 'concrete');
    }
    // the piers, as the picture draws them: a long pier out west from the quay at its north end and one at its south
    // end, each with two fingers off it to the south; decks of planks on piles, a T across the end of each
    const PIERS = [
      { z: P([0, 0.503])[1] - q.oz + 3, len: 80, fingers: [[QX - 34, 58], [QX - 68, 64]] },
      { z: P([0, 0.587])[1] - q.oz, len: 62, fingers: [[QX - 28, 66], [QX - 54, 60]] },
    ];
    const plank = (x0, z0, x1, z1, w) => {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const n = Math.max(1, Math.round(len / 6));
      const ry = Math.atan2(-(z1 - z0), x1 - x0);
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        const [lx, lz] = [x0 + (x1 - x0) * t, z0 + (z1 - z0) * t];
        q.box(lx, -0.24, lz, len / n + 0.05, 0.24, w, 'dockwood', { ry });
        for (const sd of [-1, 1]) q.cyl(lx - Math.sin(ry) * sd * (w / 2 - 0.3), -QH, lz - Math.cos(ry) * sd * (w / 2 - 0.3), 0.2, QH - 0.24, 'dockwood', { collide: false });
      }
    };
    for (const pr of PIERS) {
      plank(QX, pr.z, QX - pr.len, pr.z, 7);
      plank(QX - pr.len - 3.5, pr.z - 8, QX - pr.len - 3.5, pr.z + 8, 7); // the T
      for (const [fx, flen] of pr.fingers) plank(fx, pr.z + 3.5, fx, pr.z + 3.5 + flen, 4.5);
      for (let d = 10; d < pr.len; d += 14) for (const sd of [-1, 1]) q.prop('dock_post', QX - d, pr.z + sd * 3.2, 0, { ly: 0 });
      // a boat tied up at its end, another at a finger
      afloat(q.prop('boat', QX - pr.len + 6, pr.z - 6.5, PI / 2 + 0.1, { y: WATER_LEVEL - 0.15, nocollide: true, seed: (pr.len & 1) }));
      afloat(q.prop('boat', pr.fingers[0][0] - 4.6, pr.z + 30, 0.05, { y: WATER_LEVEL - 0.15, nocollide: true, seed: 2 }));
    }
    for (let lz = QZ0 + 6; lz < QZ1; lz += 13) if (PIERS.every((pr) => Math.abs(lz - pr.z) > 7) && [-98, -40, 22, 84].every((c) => Math.abs(lz - c) > 10)) q.prop('dock_post', QX + 1.6, lz, 0); // (not under a crane's legs)
    // the quay's face: rubber fenders hung down it every 8 m (where no pier comes off it), a line painted along its
    // edge, an iron bollard between each two posts
    for (let lz = QZ0 + 3; lz < QZ1; lz += 8) {
      if (PIERS.some((pr) => Math.abs(lz - pr.z) < 6)) continue;
      q.box(QX - 0.2, -2.6, lz, 0.5, 2.7, 1.1, 'tire', { collide: false });
      q.cyl(QX - 0.25, -0.35, lz, 0.32, 0.4, 'tire', { rx: PI / 2, sides: 10 });
    }
    q.box(QX + 1.75, 0.004, 0, 0.18, 0.02, QZ1 - QZ0, 'roadpaint', { collide: false });
    for (let lz = QZ0 + 12.5; lz < QZ1; lz += 13) {
      if (PIERS.some((pr) => Math.abs(lz - pr.z) < 7) || [-98, -40, 22, 84].some((c) => Math.abs(lz - c) < 10)) continue;
      q.cyl(QX + 1.2, 0, lz, 0.22, 0.55, 'iron', { sides: 10 });
      q.cyl(QX + 1.2, 0.55, lz, 0.32, 0.12, 'iron', { sides: 10, collide: false });
    }
    // A 40 ft box: two of the kit's 20 ft containers end to end along z (12.1 m), one colour (a stack of them, n high)
    const box40 = (b, lx, lz, ly, seed, ry = 0) => {
      const [dx, dz] = [Math.sin(ry) * 3.04, Math.cos(ry) * 3.04];
      for (const sd of [-1, 1]) b.prop('shipping_container', lx + dx * sd, lz + dz * sd, ry, { ly, seed: seed & 3 });
    };
    // THE SHIP-TO-SHORE CRANES on their rails along the quay's edge: four legs 30 m high astride the rails, the portal
    // ties, the boom - 45 m out over the water and 18 m back over the apron - its trolley and the cab under it, the
    // spreader hanging on its cables, the machinery house over the legs, the apex and its stays
    const RAIL = [QX + 2.4, QX + 18.4];
    for (const rx of RAIL) q.box(rx, 0, 0, 0.18, 0.16, QZ1 - QZ0, 'metal', { collide: false });
    const CRANES = [-98, -40, 22, 84];
    // a member of a frame from one point to another of q's frame, w thick (drawn: what a body reaches is boxed apart)
    const strut = (x0, y0, z0, x1, y1, z1, w = 0.45) => {
      const [dx, dy, dz] = [x1 - x0, y1 - y0, z1 - z0];
      const L = Math.hypot(dx, dy, dz);
      q.box((x0 + x1) / 2, (y0 + y1) / 2 - w / 2, (z0 + z1) / 2, L, w, w, 'rust', { ry: Math.atan2(-dz, dx), rz: Math.asin(dy / L), collide: false });
    };
    for (const lz of CRANES) {
      const [x0, x1] = RAIL;
      for (const lx of [x0, x1]) for (const sz of [-1, 1]) q.box(lx, 0, lz + sz * 7.5, 1.3, 30, 1.3, 'rust');
      for (const lx of [x0, x1]) q.box(lx, 0, lz, 1.6, 1.4, 16.4, 'rust'); // (the sill beams, the wheels' bogies on the rails)
      for (const sz of [-1, 1]) for (const y of [12, 29]) q.box((x0 + x1) / 2, y, lz + sz * 7.5, x1 - x0, 1, 1, 'rust', { collide: false });
      // the legs braced: crosses in each frame over head height, a diagonal in each portal
      for (const lx of [x0, x1]) for (const [ya, yb] of [[7, 18], [18, 29]]) {
        strut(lx, ya, lz - 7.2, lx, yb, lz + 7.2, 0.5);
        strut(lx, ya, lz + 7.2, lx, yb, lz - 7.2, 0.5);
      }
      for (const sz of [-1, 1]) strut(x0 + 0.6, 12.5, lz + sz * 7.5, x1 - 0.6, 29, lz + sz * 7.5, 0.5);
      // the boom: two trusses - a top chord and a bottom one, the web between them zigzag every 3.5 m - and its walkway
      const [bx0, bx1] = [QX - 45, QX + 18];
      for (const sz of [-1, 1]) {
        const bz = lz + sz * 1.9;
        q.box((bx0 + bx1) / 2, 32.6, bz, bx1 - bx0, 0.55, 0.7, 'rust', { collide: false });
        q.box((bx0 + bx1) / 2, 31.0, bz, bx1 - bx0, 0.55, 0.7, 'rust', { collide: false });
        for (let x = bx0, k = 0; x < bx1 - 0.5; x += 3.5, k++) {
          strut(x, k % 2 ? 31.3 : 32.9, bz, Math.min(bx1, x + 3.5), k % 2 ? 32.9 : 31.3, bz, 0.3);
          q.box(x, 31.3, bz, 0.3, 1.6, 0.3, 'rust', { collide: false });
        }
      }
      for (const d of [0, 1]) q.box(QX - 13.5, 33.2 + d * 0.1, lz, 63, 0.3, 4.6, 'rust', { collide: false }); // (its walkway)
      // the apex: an A-frame over the landside legs, its stays out to the boom's tip and back to its tail
      for (const sz of [-1, 1]) {
        strut(x0 + 3, 33.4, lz + sz * 1.9, x0 + 8, 42.5, lz + sz * 0.5, 0.7);
        strut(x0 + 13, 33.4, lz + sz * 1.9, x0 + 8, 42.5, lz + sz * 0.5, 0.7);
        strut(x0 + 8, 42.3, lz + sz * 0.5, bx0 + 1, 33.4, lz + sz * 1.9, 0.14);
        strut(x0 + 8, 42.3, lz + sz * 0.5, bx1 - 1, 33.4, lz + sz * 1.9, 0.14);
      }
      // the machinery house on the boom's tail: clad in ribbed sheet, a roof that overhangs, louvres down its sides, a
      // door and its landing, the hoist drums' housing on its roof
      {
        const mx = x1 + 6;
        q.box(mx, 31, lz, 9, 4.6, 8.4, 'tin_rust', { collide: false });
        q.box(mx, 35.6, lz, 9.6, 0.3, 9.0, 'rust', { collide: false });
        for (const sz of [-1, 1]) for (let k = 0; k < 4; k++) q.box(mx - 3 + k * 2, 33.6, lz + sz * 4.22, 1.2, 0.8, 0.06, 'dark', { collide: false });
        for (let k = 0; k < 5; k++) q.box(mx - 3.6 + k * 1.8, 31, lz + 4.23, 0.12, 4.6, 0.05, 'rust', { collide: false });
        q.box(mx - 4.52, 31, lz + 2, 0.05, 2.1, 0.9, 'dark', { collide: false });
        q.box(mx - 5.2, 30.9, lz + 2, 1.4, 0.1, 1.6, 'metal', { collide: false });
        q.box(mx + 0.6, 35.9, lz, 4.2, 1.6, 3.4, 'rust', { collide: false });
      }
      // the trolley where it stopped over the ship's hold: its frame on four wheels on the boom's rails, the sheaves
      // over it, and the operator's cab hung under it, glazed round and under
      const tx = QX - 14;
      q.box(tx, 30.0, lz, 4.2, 0.8, 4.6, 'rust', { collide: false });
      for (const sx of [-1.6, 1.6]) for (const sz of [-1.9, 1.9]) q.cyl(tx + sx, 30.55, lz + sz, 0.38, 0.3, 'dark', { rx: PI / 2, sides: 10 });
      for (const sx of [-0.9, 0.9]) q.cyl(tx + sx, 30.9, lz, 0.6, 1.2, 'metal', { rx: PI / 2, sides: 12 });
      q.box(tx + 1, 26.8, lz + 2.4, 3.0, 2.8, 3.0, 'tin', { collide: false }); // the cab
      q.box(tx + 1, 27.6, lz + 0.88, 2.9, 1.2, 0.05, 'dark', { collide: false });
      q.box(tx - 0.52, 27.6, lz + 2.4, 0.05, 1.2, 2.8, 'dark', { collide: false });
      q.box(tx + 1, 26.75, lz + 2.4, 2.6, 0.05, 2.6, 'dark', { collide: false });
      q.box(tx + 1, 29.6, lz + 2.4, 0.4, 0.5, 0.4, 'rust', { collide: false });
      for (const sz of [-1, 1]) q.box(tx, 16, lz + sz * 1.6, 0.08, 14, 0.08, 'metal');
      q.box(tx, 15.4, lz, 2.6, 0.7, 12.2, 'rust'); // the spreader
    }
    // THE FREIGHTER, moored tight against the quay under the cranes: a hull 120 m long whose side stands over the quay,
    // its holds stacked with containers in bays, the house and the bridge at the stern, the funnel, a mast forward,
    // lines to the bollards
    {
      const SW = 20, SL = 120, SX = QX - SW / 2 - 0.9, SZ = -26; // (its stern clear of the south pier)
      const deckY = WATER_LEVEL + 7.4 - zoneById[ZONE.INDUSTRIAL].h; // (its main deck, in the quay's frame)
      // (what is solid of it is these boxes, hidden: what is seen is the ship's own model over them - world.ships,
      // client/render/ships.js - its hull lofted, the bow raked, the house with its windows)
      q.box(SX, deckY - 12, SZ, SW, 12, SL, 'rust'); // the hull
      hide();
      q.box(SX, deckY - 12, SZ, SW + 0.2, 2.4, SL + 0.2, 'dark'); // (the boot-topping at the waterline)
      hide();
      // (the bow: the boxes under the forecastle, below - turned boxes stood out past the drawn stem)
      q.box(SX, deckY, SZ, SW - 0.6, 0.15, SL - 0.6, 'dark', { collide: false });
      for (const sd of [-1, 1]) {
        q.box(SX + sd * (SW / 2 - 0.15), deckY, SZ, 0.3, 1.2, SL, 'rust'); // (the bulwarks)
        hide();
      }
      // (the house, a tall narrow block at the stern; the bridge on it; the forecastle raised over the bow; the mast on it)
      q.box(SX, deckY, SZ + 50.5, 14, 14, 11, 'tin', { collide: true });
      hide();
      q.box(SX, deckY + 14, SZ + 48.25, 12, 3, 6.5, 'tin_rust'); // the bridge
      hide();
      q.box(SX, deckY, SZ - 55, 17, 3, 18, 'rust'); // the forecastle
      hide();
      for (const [bz, bw, bd] of [[-66, 12, 4], [-70, 7, 4], [-73, 3.6, 3]]) {
        q.box(SX, deckY - 9, SZ + bz, bw, 12, bd, 'rust'); // (its bow, narrowing to the stem)
        hide();
      }
      q.box(SX, deckY + 3, SZ - 52, 0.5, 12, 0.5, 'rust'); // the mast
      hide();
      ships.push({ type: 'freighter_hull', x: q.wx(SX, SZ), y: q.y0 + deckY - 12, z: q.wz(SX, SZ), ry: q.ry });
      // the holds' bays between the forecastle and the house: each a hatch coaming standing over the deck, the boxes
      // stacked on its covers
      for (let bay = 0; bay < 6; bay++) {
        const bz = SZ - SL / 2 + 22 + bay * 13.2;
        q.box(SX, deckY, bz, 18.6, 1.35, 12.6, 'rust');
        for (const cx of [-7.5, -5, -2.5, 0, 2.5, 5, 7.5]) {
          const n = 1 + ((bay * 5 + Math.round(cx) * 3 + 7) % 3);
          for (let h = 0; h < n; h++) box40(q, SX + cx, bz, deckY + 1.35 + h * 2.6, bay + h + Math.round(cx));
        }
      }
      for (const lz of [SZ - SL / 2 + 8, SZ + SL / 2 - 8]) q.box(QX - 0.4, 0.4, lz, 1.4, 0.05, 0.05, 'metal', { collide: false }); // (its lines)
    }
    // the harbour master's office at the root of the north pier
    {
      const o = q.sub(QX + 16, PIERS[0].z + 12, 0);
      o.room(0, 0, 8, 6, 3.2, 'brick', { s: [door(4, 1.2)], e: [hole(3, 1.4)], w: [hole(3, 1.4)] }, { roof: 'flat', roofMat: 'concrete', floorMat: 'concrete' }); // (its windows long since broken out)
      o.cont(CONT.CABINET, 2.6, -1.8, { prop: 'cabinet', ry: 0, ly: FLOOR_Y });
      o.loot(-2, 0, FLOOR_Y + 0.02);
    }
    // THE CONTAINER YARD on the apron behind the cranes: blocks of 40 ft boxes, rows of them three wide, stacked two to
    // five high, aisles between the blocks for the straddle carriers and a lane through to the ship
    for (const bx of [QX + 30, QX + 46, QX + 62]) {
      for (let lz = -116; lz <= 112; lz += 13.2) {
        if (lz > -34 && lz < -8) continue; // (the lane through to the ship)
        for (let r = 0; r < 3; r++) {
          const lx = bx + r * 2.6;
          if (!fits(q, 'shipping_container', lx, lz - 3.04, 0) || !fits(q, 'shipping_container', lx, lz + 3.04, 0)) continue;
          const n = 2 + ((Math.round(lz) * 7 + r * 5 + Math.round(bx)) % 4);
          for (let h = 0; h < n; h++) box40(q, lx, lz, h * 2.6, Math.round(lz) + r + h);
        }
      }
    }
    // the warehouses along the back of the apron (two more, the length of the quay), their doors on it
    for (const [lz, k] of [[82, 3]]) {
      const w = q.sub(-58, lz, PI / 2);
      w.room(0, 0, 34, 16, 7, k === 2 ? 'tin' : 'tin_rust', { n: [gap(17, 8, 5.5)], s: [door(8, 1.4), door(26, 1.4)] }, { roof: 'gable', roofH: 3, roofMat: 'tin', floorMat: 'concrete' }); // (no glass: a shed's)
      w.cont(CONT.FREIGHT, -12, 5, { prop: 'crate', ry: 0.2, ly: FLOOR_Y, seed: k });
      w.loot(4, -3, FLOOR_Y + 0.02);
    }
    // what was left on it: pallets and their loads, drums, tyres, the trucks that stopped where they were, a burnt-out
    // one, the light masts
    const clutter = (type, lx, lz, ry, o = {}) => fits(q, type, lx, lz, ry) && q.prop(type, lx, lz, ry, { seed: 0, ...o });
    // (from dice of their own, not the world's stream: what the docks leave lying about deals nothing else anew)
    const dd = (n, k) => hash2(n, k, (seed ^ 0x2d0c5) | 0);
    for (let n = 0; n < 26; n++) {
      const lx = QX + 22 + dd(n, 1) * 48, lz = -120 + dd(n, 2) * 240; // (short of the rail spur)
      const t = dd(n, 3);
      if (t < 0.35) { if (clutter('pallet', lx, lz, dd(n, 4) * PI, { seed: n & 1 }) && dd(n, 5) < 0.6) q.prop('crate', lx, lz, dd(n, 6) * PI, { ly: 0.12, seed: n & 1 }); }
      else if (t < 0.6) for (let d = 0; d < 4; d++) clutter('barrel', lx + (d % 2) * 0.8, lz + (d >> 1) * 0.8, dd(n, 7 + d) * 6, { seed: d & 1 });
      else if (t < 0.75) clutter('tire_pile', lx, lz, dd(n, 4) * PI, { seed: 0 });
      else clutter('crate_small', lx, lz, dd(n, 4) * PI, { seed: 0 });
    }
    for (const [type, lx, lz, ry] of [['box_truck', QX + 52, -24, PI + 0.1], ['dump_truck', QX + 52, 66, 1.4]]) if (fits(q, type, lx, lz, ry)) q.wreck(type, lx, lz, ry, { trunk: false, seed: 1 });
    for (const lz of [-120, -60, 0, 60, 120]) q.box(QX + 24, 0, lz + 6, 0.5, 16, 0.5, 'rust'), q.box(QX + 24, 16, lz + 6, 1.6, 0.8, 3.2, 'metal', { collide: false }); // (the light masts)
    // the rail spur at the back of the yard: its rails and the flat wagons on it, loaded
    for (const rx of [QX + 76.6, QX + 78.0]) q.box(rx, 0, 0, 0.12, 0.14, 220, 'metal', { collide: false });
    for (const wz of [-60, -44, -28, 40, 56]) {
      q.box(QX + 77.3, 0.2, wz, 2.8, 1.0, 13.4, 'rust');
      if (wz % 3 !== 0) box40(q, QX + 77.3, wz, 1.2, wz);
    }
  });

  Object.assign(K, { block, groundRoom, partition, signAt, heap, extra, jagged, weed, fits, roadDistAt, heightAt, solid }); // (what the third pass's places are built with)

  // THE SUBURBS, THE STREETS ROUND TOWN CENTER AND NORTH COAST VILLAGE: houses along the lanes of the picture's areas
  // of houses (and the roads through them), each turned to the lane it stands on - a quarter turn at a time, so its
  // walls lie along the nav grid - every few metres down both sides where there is room for its yard. The ground under
  // each is levelled first.
  const homes = []; // { x, z, ry, h, zone }
  {
    const clearOf = (x, z) => homes.every((o) => Math.hypot(o.x - x, o.z - z) > 15.5);
    const AREA_ZONE = { suburbsNE: ZONE.SUBURB, suburbsNW: ZONE.SUBURB, suburbsE: ZONE.WESTGATE, townSouth: ZONE.CITY, village: ZONE.NORTH_COAST };
    for (const [name, area] of Object.entries(AREAS)) {
      const [x0, z0] = W([area[0], area[1]]);
      const [x1, z1] = W([area[2], area[3]]);
      const zone = AREA_ZONE[name];
      for (const road of roads) {
        if (road.kind !== ROAD.ASPHALT || road.width > 3.7) continue;
        const p = road.pts;
        let acc = rng.range(4, 14);
        for (let i = 1; i < p.length / 2 - 1; i++) {
          acc += Math.hypot(p[i * 2] - p[i * 2 - 2], p[i * 2 + 1] - p[i * 2 - 1]);
          if (acc < 21) continue;
          const x = p[i * 2];
          const z = p[i * 2 + 1];
          if (x < x0 || x > x1 || z < z0 || z > z1) continue;
          const tx = p[i * 2 + 2] - p[i * 2 - 2];
          const tz = p[i * 2 + 3] - p[i * 2 - 1];
          const tl = Math.hypot(tx, tz) || 1;
          for (const sd of [-1, 1]) {
            const off = road.width + 9;
            const hx = x - (tz / tl) * sd * off;
            const hz = z + (tx / tl) * sd * off;
            const ry = Math.round(Math.atan2(hx - x, hz - z) / (PI / 2)) * (PI / 2); // (its front, -Z, to the lane)
            const c = Math.cos(ry);
            const s = Math.sin(ry);
            const corner = (lx, lz) => [hx + c * lx + s * lz, hz - s * lx + c * lz];
            const free = [[-6, -5], [6, -5], [6, 5], [-6, 5], [0, -5], [0, 5], [-6, 0], [6, 0], [0, 0]].every(([lx, lz]) => {
              const [cx, cz] = corner(lx, lz);
              return roadDistAt(cx, cz) > 4.6 && !inCity(cx, cz, 16) && !inWater(cx, cz) && cliffAt(cx, cz) < -6 && riverAt(cx, cz) > RIVER_HW + 16 && lakeAt(cx, cz) < -4 && !onField(cx, cz, 6);
            });
            const placeNear = nearZone(hx, hz, 6);
            if (!free || !clearOf(hx, hz) || (placeNear && ![ZONE.SUBURB, ZONE.WESTGATE, ZONE.NORTH_COAST, ZONE.CITY].includes(placeNear.id))) continue;
            let lo = Infinity;
            let hi = -Infinity;
            for (const [lx, lz] of [[-6, -5], [6, -5], [6, 5], [-6, 5]]) {
              const hh = heightAt(...corner(lx, lz));
              lo = Math.min(lo, hh);
              hi = Math.max(hi, hh);
            }
            if (hi - lo > 3.5) continue;
            // (its plot is levelled out to 15 m: a neighbour that near is on ground of much the same height, or one would
            // be cut into the other's)
            if (homes.some((o) => Math.hypot(o.x - hx, o.z - hz) < 30 && Math.abs(o.h - (lo + hi) / 2) > 0.35)) continue;
            homes.push({ x: hx, z: hz, ry, h: (lo + hi) / 2, zone });
            acc = rng.range(-4, 2); // (and on to the other side of the lane: as the picture draws them, a house each side)
          }
        }
      }
    }
    // the ground under each, level (not the lanes beside it)
    for (const o of homes) {
      const R = 11;
      for (let j = Math.max(0, Math.floor((o.z - R + HALF) / GRID_STEP)); j <= Math.min(N - 1, Math.ceil((o.z + R + HALF) / GRID_STEP)); j++) {
        for (let i = Math.max(0, Math.floor((o.x - R + HALF) / GRID_STEP)); i <= Math.min(N - 1, Math.ceil((o.x + R + HALF) / GRID_STEP)); i++) {
          const k = j * N + i;
          if (roadDist[k] < 3) continue;
          const lx = -HALF + i * GRID_STEP - o.x;
          const lz = -HALF + j * GRID_STEP - o.z;
          const c = Math.cos(o.ry);
          const s = Math.sin(o.ry);
          const hz = s * lx + c * lz; // (the yard: out to the car at its front and the bins at its side)
          const d = Math.hypot(Math.max(0, Math.abs(c * lx - s * lz) - 9), Math.max(0, hz < -2 ? -hz - 10.5 : hz - 6.5));
          heights[k] = lerp(heights[k], o.h, 1 - smoothstep(0, 4, d));
        }
      }
    }
    homes.forEach((o, k) => {
      const b = new Builder(o.x, o.z, o.ry, o.h);
      b.zone = o.zone;
      b.yard = { x: o.x, z: o.z, flat: 5.5 }; // (what stands out past the house - its car, its bins - stands on the ground)
      // (its car at its front - house(): (7.6, -7.5) - only where the ground under it is level: at the lane it can stand
      // half on the road, which is not always at the yard's height)
      // (its dumpster at its side only where no neighbour's house stands near it: one built after it is not seen by fits)
      const bins = homes.every((q) => q === o || Math.hypot(q.x - b.wx(-7.2, 2), q.z - b.wz(-7.2, 2)) > 8);
      house(b, 0, 0, 0, k, K, levelUnder('car_wreck', b.wx(7.6, -7.5), b.wz(7.6, -7.5), b.ry + 0.1), bins);
      b.clear(0, 0, 9);
      if (k % 5 === 2) b.prop('mailbox', 2.6, -6.6, 0);
      // ITS PLOT, kept once: the drive to its car and the path to its door, a hedge down its sides and along its front
      // either side of them (bushes: walked through, nothing to stand on), a shed out the back, a table in its garden
      // or a vegetable bed gone to weed, a second car on the drive. (Dice of its own - hash2 - so nothing else moves;
      // nothing laid where the lane runs, nothing solid where it does not fit.)
      const hd = (n) => hash2(k, n, (seed ^ 0x40b5) | 0);
      const offLane = (lx, lz, keep = 3.6) => roadDistAt(b.wx(lx, lz), b.wz(lx, lz)) > keep;
      const slab = (lx, lz, w, d, mat) => {
        if ([[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].some(([dx, dz]) => !offLane(lx + dx, lz + dz, 2.6) || Math.abs(heightAt(b.wx(lx + dx, lz + dz), b.wz(lx + dx, lz + dz)) - b.y0) > 0.12)) return;
        b.box(lx, -0.04, lz, w, 0.075, d, mat, { collide: false });
      };
      slab(7.6, -8.2, 3.2, 7.6, hd(1) < 0.55 ? 'concrete' : 'gravel'); // the drive
      slab(0, -6.9, 1.3, 5.6, 'concrete'); // the path
      for (const sx of [-1, 1]) {
        if (hd(2 + sx) < 0.3) continue; // (no hedge down this side)
        for (let lz = -9; lz <= 6; lz += 1.0) if (offLane(sx * 9.2, lz)) weed(b, sx * 9.2 + (hd(10 + lz) - 0.5) * 0.25, lz, 1.25 + hd(20 + lz) * 0.4, null, 0);
      }
      if (hd(4) < 0.7) for (let lx = -8.6; lx <= 8.6; lx += 1.0) if ((lx < -1.3 || lx > 1.3) && (lx < 5.4 || lx > 9.8) && offLane(lx, -10.2)) weed(b, lx, -10.2 + (hd(30 + lx) - 0.5) * 0.25, 1.15 + hd(40 + lx) * 0.35, null, 0);
      // (what stands out in its garden: clear of a neighbour's house too, which may be built after it)
      const out = (type, lx, lz, ry, oo = {}) => fits(b, type, lx, lz, ry) && levelUnder(type, b.wx(lx, lz), b.wz(lx, lz), b.ry + ry) && homes.every((q) => q === o || Math.hypot(q.x - b.wx(lx, lz), q.z - b.wz(lx, lz)) > 8.5) && b.prop(type, lx, lz, ry, { seed: Math.floor(hd(50) * 3), ...oo });
      if (hd(5) < 0.5) {
        // the shed: planked, a lean-to roof of tin, its door to the garden
        const [sx, sz] = [6.6, 6.4];
        if ([[sx - 1.6, sz - 1.4], [sx + 1.6, sz + 1.4], [sx + 1.6, sz - 1.4], [sx - 1.6, sz + 1.4]].every(([x, z]) => offLane(x, z) && Math.abs(heightAt(b.wx(x, z), b.wz(x, z)) - b.y0) < 0.25) && !propBlocked('crate', b.wx(sx, sz), b.wz(sx, sz), 0) && homes.every((q) => q === o || Math.hypot(q.x - b.wx(sx, sz), q.z - b.wz(sx, sz)) > 10) && !props.some((q) => Math.abs(q.x - b.wx(sx, sz)) < 3.6 && Math.abs(q.z - b.wz(sx, sz)) < 3.6 && PROPS[q.type]?.boxes)) {
          // (...and clear of a neighbour's house and the doors in its sides - one built after it was boxed in by it - and
          // of what stands in a neighbour's garden behind it)
          b.box(sx, -0.1, sz, 2.8, 2.3, 2.2, 'planks');
          b.box(sx, 2.2, sz, 3.2, 0.12, 2.6, 'tin_rust', { rx: 0.12, collide: false });
          b.box(sx - 0.5, 0, sz - 1.13, 0.9, 1.9, 0.05, 'door', { collide: false });
        }
      }
      if (hd(6) < 0.18) out('picnic_table', -4.2, 7.6, 0.15 + hd(7) * 0.3);
      else if (hd(6) < 0.7) {
        // a vegetable bed, gone to weed
        slab(-5.2, 7.2, 3.6, 2.2, 'earth');
        for (let q = 0; q < 4; q++) weed(b, -6.6 + q * 0.95, 7.2 + (hd(60 + q) - 0.5) * 0.8, 0.6 + hd(70 + q) * 0.3);
      }
      // (a bicycle one plot in ten - and no second car on the drives: each is a model of thousands of vertices in the
      // static world, the GPU's memory; a house's own car is house()'s)
      if (hd(11) < 0.1) out('bicycle', -2.6, -5.2, 1.3 + hd(12), { nocollide: true });
    });
  }

  // NORTH COAST VILLAGE: its church above the harbour, a pier out into the bay with a boat at it, the houses (above)
  {
    const at = P([0.183, 0.128]);
    const zn = zoneById[ZONE.NORTH_COAST];
    const b = new Builder(at[0], at[1], facing(at, P([0.215, 0.150])), Math.max(zn.h, heightAt(at[0], at[1])));
    b.zone = ZONE.NORTH_COAST;
    const L = { x: at[0], z: at[1], w: 19.5, d: 19.5, ry: b.ry, what: 'church' };
    b.box(0, 0, 0, 22, PAVE, 22, 'concrete');
    BUILD.church(b, L, 'Church of the Sea');
    for (let j = Math.max(0, Math.floor((at[1] - 16 + HALF) / GRID_STEP)); j <= Math.min(N - 1, Math.ceil((at[1] + 16 + HALF) / GRID_STEP)); j++) {
      for (let i = Math.max(0, Math.floor((at[0] - 16 + HALF) / GRID_STEP)); i <= Math.min(N - 1, Math.ceil((at[0] + 16 + HALF) / GRID_STEP)); i++) {
        const d = Math.hypot(-HALF + i * GRID_STEP - at[0], -HALF + j * GRID_STEP - at[1]);
        if (roadDist[j * N + i] > 3) heights[j * N + i] = lerp(heights[j * N + i], b.y0, 1 - smoothstep(12, 16, d));
      }
    }
    const v = new Builder(zn.x, zn.z, 0, zn.h);
    v.zone = ZONE.NORTH_COAST;
    const pier = (a, c, w) => {
      const [ax, az] = P(a);
      const [cx, cz] = P(c);
      const len = Math.hypot(cx - ax, cz - az);
      const n = Math.max(1, Math.round(len / 5));
      const ry = Math.atan2(-(cz - az), cx - ax);
      const y = WATER_LEVEL + 1.3 - v.y0;
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        v.box(ax + (cx - ax) * t - v.ox, y - 0.22, az + (cz - az) * t - v.oz, len / n + 0.05, 0.22, w, 'dockwood', { ry, collide: true });
      }
      return y;
    };
    const y = pier([0.160, 0.166], [0.124, 0.166], 3.4);
    pier([0.152, 0.168], [0.152, 0.198], 2.6);
    const [bx, bz] = P([0.146, 0.19]);
    afloat(v.prop('boat', bx - v.ox, bz - v.oz, 0.1, { y: WATER_LEVEL - 0.15, nocollide: true }));
    const [cx2, cz2] = P([0.13, 0.166]);
    v.cont(CONT.CRATE, cx2 - v.ox, cz2 - v.oz, { prop: 'crate', ly: y, ry: 0.3 });
    v.loot(cx2 - v.ox + 2, cz2 - v.oz, y + 0.02);
    // THE HARBOUR at work when it stopped: boats tied up along the pier and its finger, on the planks the fish boxes,
    // pots, drums and pallets, nets hung to dry on their poles, and at the root of the pier on the shore the fish shed
    // with its slipway. (Dice of their own: nothing after them moves.)
    {
      const hd = (n) => hash2(n, 31, (seed ^ 0x4a7b) | 0);
      const at = (fx, fz) => { const [x, z] = P([fx, fz]); return [x - v.ox, z - v.oz]; };
      const boats = [[0.1555, 0.176, PI / 2], [0.1485, 0.184, -PI / 2 + 0.1], [0.1555, 0.194, PI / 2 + 0.06], [0.142, 0.1695, 0.04], [0.133, 0.1625, PI - 0.05], [0.128, 0.1695, 0.08]];
      boats.forEach(([fx, fz, ry], k) => {
        const [x, z] = at(fx, fz);
        if (!inWater(x + v.ox, z + v.oz)) return;
        afloat(v.prop('boat', x, z, ry + (hd(k) - 0.5) * 0.2, { y: WATER_LEVEL - 0.15, nocollide: true, seed: k % 2 }));
      });
      const laid = [];
      const deck = (fx, fz, type, ry, seedv = 0) => {
        const [x, z] = at(fx, fz);
        if (laid.some(([a, c]) => Math.hypot(a - x, c - z) < 2.2)) return; // (clear of what is already on the planks)
        laid.push([x, z]);
        v.prop(type, x, z, ry, { ly: y, nocollide: type === 'pallet', seed: seedv }); // (solid as they are anywhere: no hole on the planks)
      };
      for (let k = 0; k < 9; k++) {
        const fx = 0.126 + hd(10 + k) * 0.032;
        const side = hd(20 + k) < 0.5 ? -1 : 1;
        deck(fx, 0.166 + side * 0.0006, ['crate_small', 'barrel', 'crate_small', 'pallet', 'tire_pile'][k % 5], hd(30 + k) * 6, k & 1);
      }
      for (let k = 0; k < 4; k++) deck(0.152 + (hd(40 + k) - 0.5) * 0.0008, 0.172 + k * 0.006, k % 2 ? 'crate_small' : 'barrel', hd(50 + k) * 6, k & 1);
      // nets on their poles, over the planks by the pier's root
      {
        const [nx, nz] = at(0.1575, 0.1652);
        for (const dx of [-3, 0, 3]) v.cyl(nx + dx, y, nz, 0.06, 2.4, 'trim', { sides: 6, collide: false });
        v.box(nx, y + 2.3, nz, 6.2, 0.04, 0.04, 'rope', { collide: false });
        for (const dx of [-1.5, 1.5]) v.box(nx + dx, y + 1.25, nz, 2.9, 2.1, 0.03, 'canvas', { rz: (hd(60) - 0.5) * 0.1, collide: false });
      }
      // the fish shed on the shore where the pier starts, its door to it
      const [sx, sz] = P([0.1635, 0.1655]);
      const sh = heightAt(sx, sz);
      if (sh > WATER_LEVEL + 0.6 && roadDistAt(sx, sz) > 6 && !staticGrid.query(sx, sz, 6, []).some((c) => !(c.flags & COL.TREE)) && [[-4, -3], [4, -3], [4, 3], [-4, 3]].every(([dx, dz]) => Math.abs(heightAt(sx + dx, sz + dz) - sh) < 0.8)) {
        const fs = new Builder(sx, sz, PI / 2, sh);
        fs.zone = ZONE.NORTH_COAST;
        fs.box(0, -0.6, 0, 8.4, 0.6, 6.4, 'concrete');
        fs.room(0, 0, 8, 6, 3, 'planks', { n: [door(4, 1.6)], s: [win(2), win(6)] }, { roof: 'gable', roofH: 1.8, roofMat: 'tin_rust', floorMat: 'concrete' });
        fs.cont(CONT.CRATE, -2.6, 1.6, { prop: 'crate', ry: 0.2, seed: 1 });
        fs.prop('barrel', 3.2, 2, 0, { seed: 2 });
        fs.loot(1, 1);
      }
    }
  }

  // NORTH RIDGE OUTPOST: the army's post on the far side of North Pass. Its radio tower, a water tower, the domes of
  // its radars, the huts and the comms room the flight radio is in, all behind wire.
  place(ZONE.OUTPOST, (b) => {
    const HX = 46;
    const HZ = 36;
    for (let x = -HX + 1.5; x < HX; x += 3) {
      if (Math.abs(x) > 6) b.prop('fence_chain', x, HZ, 0);
      if (rng.chance(0.88)) b.prop('fence_chain', x, -HZ, 0);
    }
    for (let z = -HZ + 1.5; z < HZ; z += 3) {
      if (rng.chance(0.9)) b.prop('fence_chain', -HX, z, PI / 2);
      if (Math.abs(z) > 6) b.prop('fence_chain', HX, z, PI / 2);
    }
    b.prop('boom_gate', -0.4, HZ, PI);
    for (const sx of [-1, 1]) b.prop('sandbags', sx * 7.6, HZ - 2.4, 0, { seed: sx + 1 });
    extra(b, 'watchtower', -HX + 4, HZ - 4, PI);
    extra(b, 'watchtower', HX - 4, -HZ + 4, 0, { seed: 1 });
    // the radio tower: a lattice of four legs drawn in to its head, 44 m up, red and white by turns
    {
      const T = 44;
      for (let k = 0; k < 11; k++) {
        const y0 = (k * T) / 11;
        const y1 = ((k + 1) * T) / 11;
        const w0 = lerp(7, 1.6, y0 / T);
        const w1 = lerp(7, 1.6, y1 / T);
        const mat = k % 2 ? 'metal' : 'rust';
        for (const sx of [-1, 1]) {
          for (const sz of [-1, 1]) {
            b.box(-6 + sx * (w0 + w1) / 4, y0, -18 + sz * (w0 + w1) / 4, 0.3, y1 - y0 + 0.05, 0.3, mat, { collide: k === 0 });
          }
          b.box(-6 + (sx * w1) / 2, y1 - 0.1, -18, 0.12, 0.12, w1, mat, { collide: false });
          b.box(-6, y1 - 0.1, -18 + (sx * w1) / 2, w1, 0.12, 0.12, mat, { collide: false });
        }
      }
      b.box(-6, T, -18, 0.2, 7, 0.2, 'metal', { collide: false });
      b.box(-6, T + 2, -18, 3.6, 0.2, 0.2, 'metal', { collide: false });
    }
    extra(b, 'water_tower', 12, -22, 0.3);
    // the radar domes
    for (const [dx, dz, r] of [[-30, -10, 4.2], [30, -14, 3.4]]) {
      b.cyl(dx, 0, dz, r, 3.2, 'concrete', { sides: 16 });
      b.cone(dx, 3.2, dz, r + 0.1, r * 0.9, 'metal', 16, { ry: 0 });
    }
    // the comms room: the radio desk, the sets, the flight radio somewhere in it; a hut either side
    b.room(14, 6, 14, 9, 3.2, 'concrete', { n: [door(4, 1.3), win(10, 1.6)], e: [win(4.5)], w: [win(4.5)] }, { roof: 'flat', roofMat: 'concrete', floorMat: 'concrete' });
    extra(b, 'office_desk', 14, 9.6, PI, { ly: 0.12 });
    b.prop('radio_set', 11.6, 9.9, PI, { ly: 0.12 });
    b.cont(CONT.LOCKER, 20.5, 8, { prop: 'locker', ry: -PI / 2, ly: 0.12 });
    b.cont(CONT.CABINET, 8.6, 9.8, { prop: 'cabinet', ry: PI, ly: 0.12 });
    part(b, 3, 16.6, 9.4, 0.14 + 0.76);
    part(b, 3, 8.4, 3.2, 0.14);
    b.prop('satellite_dish', 22.6, 0.6, 2.2);
    b.room(-14, 8, 12, 7, 3, 'olive', { n: [door(6, 1.2)], s: [win(6, 1.4)] }, { roof: 'flat', roofMat: 'tin', floorMat: 'planks' });
    b.prop('field_cot', -17, 9.6, PI / 2, { ly: 0.12 });
    b.prop('field_cot', -11, 9.6, PI / 2, { ly: 0.12 });
    b.cont(CONT.AMMO_BOX, -14, 10.4, { prop: 'military_crate', ry: 0, ly: 0.12 });
    part(b, 3, -18.6, 6.2, 0.14);
    b.room(-14, 22, 12, 7, 3, 'olive', { n: [door(6, 1.2)] }, { roof: 'flat', roofMat: 'tin', floorMat: 'planks' });
    b.cont(CONT.SHELF, -9.8, 24.6, { prop: 'shelf', ry: PI, ly: 0.12 });
    b.loot(-15, 21, 0.14);
    for (const [tx, tz, k] of [[24, 24, 0], [34, 24, 1]]) b.prop('military_tent', tx, tz, 0, { seed: k });
    b.wreck('army_truck', 34, 6, 0.4, { trunk: false });
    b.wreck('army_truck', -34, 18, PI - 0.2, { trunk: false, seed: 1 });
    b.cont(CONT.AMMO_BOX, 30, 12, { prop: 'military_crate', ry: 0.4 });
    b.prop('generator', 20, -4, 0.2);
    b.prop('fuel_tank', 30, -26, PI / 2);
    for (const [lx, lz] of [[0, 18], [-6, 26], [8, 30], [-24, 2]]) b.prop(['corpse', 'skeleton', 'body_bag', 'blood_pool'][(lx + 24) & 3], lx, lz, lx, { nocollide: true });
    b.loot(2, 10);
    b.loot(26, 18);
    b.loot(-26, -22);
    // the compound as the army kept it, read from the road: a concrete apron from the gate to the huts and the comms
    // room, a lamp over each door still lit off the generator, floodlights at the corners of the wire, the gate's
    // sandbagged post and barriers on the road in, its sign, wire along the inside of the front fence, a flagpole, the
    // stacks of crates on pallets (dice of their own: what else the seed deals stays put)
    {
      const od = (n) => hash2(n, 77, (seed ^ 0x0b57) | 0);
      for (const [px, pz, w, d] of [[0, 20, 8, 32], [6, 6, 34, 10], [-14, 15, 14, 22]]) b.box(px, -0.02, pz, w, 0.08, d, 'concrete', { collide: false });
      for (const [lx, lz] of [[18, 1.2], [-14, 4.2], [-14, 18.2]]) b.light(lx, 2.6, lz, 'lamp');
      for (const [lx, lz, ry] of [[-HX + 3, HZ - 3, PI * 0.75], [HX - 3, HZ - 3, -PI * 0.75], [-HX + 3, -HZ + 3, PI * 0.25], [HX - 3, -HZ + 3, -PI * 0.25]]) extra(b, 'floodlight_tower', lx, lz, ry);
      extra(b, 'sandbag_nest', 9, HZ - 4, 0);
      extra(b, 'checkpoint_sign', -8.5, HZ + 2.5, PI);
      for (const lx of [-5, 5]) extra(b, 'jersey_barrier', lx, HZ + 9, 0.3 * Math.sign(lx));
      for (let lx = -HX + 8; lx <= HX - 8; lx += 7) if (Math.abs(lx) > 9) extra(b, 'concertina', lx, HZ - 2.2, 0);
      b.cyl(4, 0, 12, 0.08, 9, 'metal', { sides: 6 });
      b.box(4.75, 7.2, 12, 1.4, 0.9, 0.02, 'canvas_mil', { collide: false });
      for (let k = 0; k < 4; k++) {
        const [lx, lz] = [26 + (k % 2) * 3.2, -6 - (k >> 1) * 3.4];
        if (extra(b, 'pallet', lx, lz, od(k) * 0.3)) extra(b, 'military_crate', lx, lz, od(k + 9) * 0.4, { ly: 0.15 });
      }
    }
    // (cleared inside the wire, and a few metres out from it: the woods stand round it)
    for (let lx = -HX + 6; lx <= HX - 6; lx += 12) for (let lz = -HZ + 6; lz <= HZ - 6; lz += 12) b.clear(lx, lz, 10);
    for (let lx = -HX; lx <= HX; lx += 8) for (const lz of [-HZ, HZ]) b.clear(lx, lz, 5);
    for (let lz = -HZ; lz <= HZ; lz += 8) for (const lx of [-HX, HX]) b.clear(lx, lz, 5);
    b.clear(0, HZ + 10, 9);
  });

  // THE LIGHTHOUSE, on its islet off the south-west coast: the tower, the lamp room's glass on top, a keeper's store
  place(ZONE.LIGHTHOUSE, (yard) => {
    // (on its islet's own ground, whatever is levelled round it: the tower's foot at the lowest of the ground it covers,
    // what stands by it on the ground)
    let foot = Infinity;
    for (let a = 0; a < 8; a++) foot = Math.min(foot, heightAt(yard.ox + Math.sin(a) * 2.8, yard.oz + Math.cos(a) * 2.8));
    const b = new Builder(yard.ox, yard.oz, yard.ry, foot);
    b.zone = ZONE.LIGHTHOUSE;
    b.ground = true;
    b.cyl(0, 0, 0, 2.8, 15, 'plaster', { sides: 16 });
    b.cyl(0, 15, 0, 3.4, 0.4, 'rust', { sides: 16, collide: false });
    b.cyl(0, 15.4, 0, 2.1, 2.6, 'glass', { sides: 12, collide: false });
    b.cone(0, 18, 0, 2.5, 2.2, 'rust', 12, { ry: 0 });
    b.light(0, 16.6, 0, 'embers');
    b.cont(CONT.CRATE, -1.2, -4.4, { prop: 'crate', ry: 0.2 });
    b.loot(1.6, -4.2);
    b.prop('barrel', -3.6, 1.8, 0);
  });

  // SOUTH FOREST: three camps under the trees, each a tent or two round a fire, what their people left
  const camp = (b, k) => {
    b.prop('tent', 0, 2.2, rng.range(-0.3, 0.3), { seed: k });
    if (k !== 1) b.prop('tent', -4.2, 0.6, 0.9 + rng.range(-0.2, 0.2), { seed: k + 1 });
    b.prop('campfire', 0.5, -2.2, 0, { nocollide: true, seed: 1 });
    b.prop('log_bench', 3, -2.4, PI / 2 + 0.2);
    b.prop('log_bench', 0.4, -5.2, 0.1);
    if (k === 0) b.wreck('camper', 7.6, 3, 1.4, { zone: ZONE.SOUTH_FOREST });
    b.cont(CONT.DUFFEL, -2.4, -1.4, { prop: 'duffel_bag', ry: rng.range(0, 6), nocollide: true });
    b.cont(CONT.CRATE, 2.6, 3.8, { prop: 'crate_small', ry: 0.4, h: 0.62 });
    b.prop('picnic_table', -5.4, -4.6, 0.3);
    b.prop(k ? 'skeleton' : 'corpse', 1.8, -0.6, rng.range(0, 6), { nocollide: true });
    b.loot(1.6, -4.4);
    b.loot(-3, 3.6);
    b.light(0.5, 0.3, -2.2, 'embers');
    b.clear(0, 0, 8);
  };
  place(ZONE.SOUTH_FOREST, (b) => camp(b, 0));
  // ...and its other two, where the picture marks them (on the ground as it is: they are a clearing each, no more)
  camps.forEach(([x0, z0], k) => {
    // (beside the track that leads to it, not on it)
    let [x, z] = [x0, z0];
    for (let a = 0, best = roadDistAt(x0, z0); a < 8 && best < 9; a++) {
      const tx = x0 + Math.sin((a * PI) / 4) * 11;
      const tz = z0 + Math.cos((a * PI) / 4) * 11;
      if (roadDistAt(tx, tz) > best && cliffAt(tx, tz) < -10) [x, z, best] = [tx, tz, roadDistAt(tx, tz)];
    }
    const b = new Builder(x, z, rng.range(0, PI * 2), heightAt(x, z));
    b.zone = ZONE.SOUTH_FOREST;
    b.ground = true;
    camp(b, k + 1);
  });

  // (is a road other than a tunnel's own within r of (x, z)? A road through a tunnel has points in its gallery)
  const tunnelRoads = new Set(roads.filter((rd) => tunnels.some((t) => { for (let i = 0; i < rd.pts.length; i += 2) if (tunnelOf(rd.pts[i], rd.pts[i + 1], 0)) return true; return false; })));
  const roadsNear = (x, z, r) => roads.some((rd) => { if (tunnelRoads.has(rd)) return false; for (let i = 0; i + 3 < rd.pts.length; i += 2) { const [ax, az, bx, bz] = [rd.pts[i], rd.pts[i + 1], rd.pts[i + 2], rd.pts[i + 3]]; const L2 = (bx - ax) ** 2 + (bz - az) ** 2 || 1; const t = clamp(((x - ax) * (bx - ax) + (z - az) * (bz - az)) / L2, 0, 1); if (Math.hypot(x - ax - (bx - ax) * t, z - az - (bz - az) * t) < r + rd.width) return true; } return false; });
  // THE ROAD TUNNELS: a concrete gallery through the mountain from mouth to mouth - walls, a roof, a face over either
  // mouth with its name - and the cuttings in front of them (their walls are the mountain's: below)
  for (const t of tunnels) {
    // (where the gallery is: worked out with its cap, above)
    if (t.s0 === undefined) continue;
    const { s0, s1 } = t;
    const ry = Math.atan2(t.dx, t.dz); // (a Builder turned by this has the road along its +Z)
    const levelAt = (s) => lerp(t.y0, t.y1, clamp((s + CUT_LEN) / (t.len + CUT_LEN * 2), 0, 1));
    const b = new Builder(t.a[0], t.a[1], ry, 0);
    b.zone = ZONE.FOREST;
    const SEG = 6;
    for (let s = s0; s < s1; s += SEG) {
      const e = Math.min(s1, s + SEG);
      const y = levelAt((s + e) / 2) - 0.1;
      for (const sd of [-1, 1]) b.box(sd * (TUNNEL_HW + 0.35), y, (s + e) / 2, 0.7, TUNNEL_H + 0.2, e - s + 0.05, 'concrete_pale');
      b.box(0, y + TUNNEL_H, (s + e) / 2, TUNNEL_HW * 2 + 1.4, 0.9, e - s + 0.05, 'concrete_pale');
      // the lamps down its roof, every other length of it still lit (world.lights 'lamp': the generator in the
      // service room kept them on - their fittings shine, so the gallery reads lit from the road), the cable tray
      const lit = Math.round((s - s0) / SEG) % 2 === 0;
      b.box(0, y + TUNNEL_H - 0.12, (s + e) / 2, 0.5, 0.12, 0.9, lit ? 'lampglow' : 'metal', { collide: false });
      if (lit) b.light(0, y + TUNNEL_H - 0.5, (s + e) / 2, 'lamp');
      b.box(-TUNNEL_HW + 0.12, y + TUNNEL_H - 1.2, (s + e) / 2, 0.24, 0.16, e - s + 0.05, 'metal', { collide: false });
    }
    // the faces over its mouths: a portal of dressed stone set into the rock - its piers, the head over the road with
    // the opening arched in it (a segment: springing 4 m up, the crown at the roof), the voussoirs round the arch and
    // its keystone, a cornice, the plaque with the name - and its wing walls running out along the cutting
    for (const [s, sd] of [[s0, -1], [s1, 1]]) {
      const y = levelAt(s) - 0.1;
      const zf = s + sd * 0.6; // (the face's middle, its thickness standing out of the mountain)
      for (const lat of [-1, 1]) b.box(lat * (TUNNEL_HW + 1.9), y, zf, 3.4, TUNNEL_H + 8.5, 2.2, 'concrete_pale');
      b.box(0, y + TUNNEL_H, zf, TUNNEL_HW * 2 + 0.8, 8.5, 2.2, 'concrete_pale');
      // the arch: the corners of the opening filled up to its curve, a strip at a time
      const RISE = 2.6, R = (TUNNEL_HW ** 2 + RISE ** 2) / (2 * RISE), CY = TUNNEL_H - R;
      for (let x = -TUNNEL_HW + 0.4; x < TUNNEL_HW; x += 0.8) {
        const ya = CY + Math.sqrt(Math.max(0, R * R - x * x));
        if (TUNNEL_H - ya > 0.05) b.box(x, y + ya, zf, 0.82, TUNNEL_H - ya, 2.2, 'concrete_pale');
      }
      // the voussoirs: a band round the arch, standing proud of the face
      for (let k = 0; k <= 10; k++) {
        const a = -Math.asin(TUNNEL_HW / R) + (k / 10) * 2 * Math.asin(TUNNEL_HW / R);
        const vx = Math.sin(a) * (R + 0.5), vy = CY + Math.cos(a) * (R + 0.5);
        b.box(vx, y + vy - 0.55, zf + sd * 1.25, 1.05, k === 5 ? 1.5 : 1.1, 0.4, k === 5 ? 'concrete' : 'stone', { rz: -a, collide: false });
      }
      b.box(0, y + TUNNEL_H + 7.6, zf + sd * 0.2, TUNNEL_HW * 2 + 8.4, 0.5, 2.8, 'concrete_pale'); // (the cornice)
      b.box(0, y + TUNNEL_H + 3.6, zf + sd * 1.15, 6.4, 1.2, 0.12, 'metal', { collide: false }); // (the plaque)
      // the wing walls: along the cutting either side, splaying a little, stepping down as they go
      for (const lat of [-1, 1]) {
        // (inside the cutting: a road that meets this one at its mouth - the airport's perimeter at East Pass - and a
        // fence along it keep their room)
        for (let k = 0; k < 2; k++) {
          const along = 3.2 + k * 4.4;
          const wx = lat * (TUNNEL_HW + 1.7), wz = zf + sd * (1.3 + along);
          const [ww, wv] = [b.wx(wx, wz), b.wz(wx, wz)];
          const [fx, fz] = al(ww, wv);
          const nearFence = Math.min(Math.abs(fx - FENCE.x0), Math.abs(fx - FENCE.x1), Math.abs(fz - FENCE.z0), Math.abs(fz - FENCE.z1)) < 12 && fx > FENCE.x0 - 12 && fx < FENCE.x1 + 12 && fz > FENCE.z0 - 12 && fz < FENCE.z1 + 12;
          if (nearFence || roadsNear(ww, wv, 6)) continue; // (the airport's fence runs past East Pass's mouth)
          b.box(wx, y, wz, 1.2, TUNNEL_H + 3 - k * 2.4, 4.2, 'stone');
        }
      }
      // a lamp over the mouth, lit
      b.light(0, y + TUNNEL_H + 1.2, zf + sd * 1.6, 'lamp');
      // (and one just inside, so the arch reads lit from the road even in the cutting's shade)
      b.light(0, y + TUNNEL_H - 0.6, s - sd * 3, 'lamp');
    }
    if (t.name) landmarks.push({ x: t.a[0] + t.dx * ((s0 + s1) / 2), z: t.a[1] + t.dz * ((s0 + s1) / 2), name: t.name, pass: true });
  }

  // what the field map names that is no place: the range, the lake
  landmarks.push({ x: FX(0.668), z: FX(0.395), name: 'The Ridge', big: true }, { x: lake.x, z: lake.z + 30, name: 'Pine Lake', big: true });

  // THE MOUNTAINS' WALLS: along the foot of every cliff a wall nobody sees, WALL_T thick on the mountain's side of the
  // line, from under the ground to well over the cliff's lip. Nothing walks, drives, climbs or is shot through it, and
  // the dead's nav grid takes it for the wall it is. (A tunnel's corridor is out of the mountain: its cuttings are
  // walled the same way, and the gallery has walls of its own.)
  const walls = maskEdges(wallMask, N, GRID_STEP, HALF, 0.5);
  for (const line of walls) {
    for (let k = 0; k + 1 < line.length; k++) {
      const [ax, az] = line[k];
      const [bx, bz] = line[k + 1];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.05) continue;
      const ux = (bx - ax) / len;
      const uz = (bz - az) / len;
      // (the mountain is on the right of the line: (-uz, ux))
      const cx = (ax + bx) / 2 - uz * (WALL_T / 2 - 0.25);
      const cz = (az + bz) / 2 + ux * (WALL_T / 2 - 0.25);
      const foot = Math.min(heightAt(ax, az), heightAt(bx, bz), heightAt(cx, cz)) - 3;
      // (as high as a cliff, and at the least as high as the ground just in from its line stands: the cuttings in front
      // of a tunnel's mouths rise from the road to the whole mountain within a few metres)
      let rise = 0;
      for (const k of [1, 2.5, 4]) for (const t of [0, 0.5, 1]) rise = Math.max(rise, heightAt(ax + (bx - ax) * t - uz * k, az + (bz - az) * t + ux * k));
      const col = makeBox(cx, cz, foot, Math.max(foot + CLIFF * 1.25 + 14, rise + 6), len + WALL_T * 0.6, WALL_T, Math.atan2(-uz, ux), COL.STATIC);
      col.tag = 'cliff'; // (a bullet strikes stone: shared/surfaces.js)
      staticGrid.add(col);
    }
  }

  // East Pass's road ran on over the river to the Ridge: the bridge is gone, its first span ends over the water
  {
    const r = roads.find((rd) => rd.name === 'north road');
    if (r) {
      const p = r.pts;
      const n = p.length / 2;
      const [ex, ez] = [p[n * 2 - 2], p[n * 2 - 1]];
      const dx = ex - p[n * 2 - 6];
      const dz = ez - p[n * 2 - 5];
      const dl = Math.hypot(dx, dz) || 1;
      const b = new Builder(ex, ez, Math.atan2(-dx / dl, -dz / dl), r.hs[n - 1]);
      b.zone = ZONE.FOREST;
      for (let k = 0; k < 3; k++) b.box(0, -0.45, -3 - k * 4, 8.4 - k * 0.4, 0.45, 4.05, 'concrete', { rz: k === 2 ? 0.08 : 0 });
      for (const sd of [-1, 1]) b.box(sd * 4, 0, -7, 0.25, 1.0, 10, 'rust', { collide: false, rz: sd * 0.05 });
      b.prop('jersey_barrier', 0, -1, PI / 2, { seed: 2 });
      b.prop('road_sign', 3.6, 1.6, 0, { seed: 1 });
    }
  }

  // ...and the lesser places of the picture (mainland-places.js): the marina, the logging camp, the firehouse, the quarry's yard
  for (const zn of zones) if (OUTLYING[zn.id] && zn.id !== ZONE.WESTGATE) place(zn.id, (b) => OUTLYING[zn.id].build(b, K, zn));

  // MILE 9 TRUCK STOP: a canopy over the pumps, a diner, rigs that never left.
  place(ZONE.TRUCKSTOP, (b) => {
    b.box(0, -0.05, -4, 36, 0.1, 24, 'concrete', { collide: true });
    b.room(-4, 12, 14, 9, 3.6, 'brick', { n: [door(7, 1.6), win(2.6, 3, 0.9, 2.5), win(11.4, 3, 0.9, 2.5)], e: [win(4.5)], s: [door(2.4, 1.1)] }, { roof: 'flat', roofMat: 'concrete', floorMat: 'concrete' });
    b.box(-6, 0.12, 10, 5, 1.0, 0.7, 'planks');
    b.loot(-6, 10, 1.14);
    b.cont(CONT.FRIDGE, 2.2, 15.5, { prop: 'fridge', ry: PI, ly: 0.12 });
    b.cont(CONT.SHELF, -8, 15.5, { prop: 'shelf', ry: PI, ly: 0.12 });
    b.cont(CONT.SHELF, -4, 15.5, { prop: 'shelf', ry: PI, ly: 0.12 });
    b.prop('table', 0.5, 10.5, 0, { ly: 0.12 });
    for (const [px, pz] of [[-6, -2], [6, -2], [-6, -10], [6, -10]]) b.cyl(px, 0, pz, 0.2, 5, 'metal');
    b.box(0, 5, -6, 15, 0.55, 11, 'metal', { collide: false });
    b.roofSpan(0, -6, 7.5, 5.5, 5, 0.55);
    b.prop('gas_pump', -2, -6, 0);
    b.prop('gas_pump', 2, -6, 0);
    b.wreck('semi_truck', 22, 9, 0.05, { trunk: false });
    b.prop('litter', 4, 0, 1, { nocollide: true });
    b.prop('suitcases', -9, 2, 0.3, { nocollide: true });
    b.wreck('pickup_truck', -14, -8, 1.3);
    b.wreck('car_wreck', 12, -12, 2.4);
    b.cont(CONT.DUMPSTER, -14, 14, { prop: 'dumpster', ry: PI / 2 });
    b.prop('motel_sign', -17, -20, 0.2);
    b.prop('streetlight', 14, -19, PI);
    b.prop('barrel', 9, 4, 0);
    b.prop('corpse', 3, -2, 0.9, { nocollide: true });
    b.loot(-12, 4);
    b.loot(10, 2);
  });

  // CALDER FIELD ----------------------------------------------------------------------------------------------
  // (everything here is in the runway's frame: aw() turns it to the world, a Builder turned by AIR.ry builds in it)
  const apron = { x: aw(APRON.lx, APRON.lz)[0], z: aw(APRON.lx, APRON.lz)[1], hx: APRON.hx, hz: APRON.hz };
  // the apron: a rectangle of concrete between the runway and the hangars
  {
    const b = new Builder(apron.x, apron.z, AIR.ry, fieldH);
    b.zone = ZONE.HANGARS;
    b.box(0, -0.05, 0, apron.hx * 2, 0.1, apron.hz * 2, 'concrete', { collide: true });
    b.clear(0, -40, 44);
    b.clear(0, 40, 44);
  }
  // the plane, at the south end of the runway, its nose to the north; the fuel truck beside it on the apron's edge
  const planeY = fieldH;
  const car = { x: plane[0], y: planeY, z: plane[1], ry: AIR.ry, plane: true };
  props.push({ type: 'plane_wreck', x: car.x, y: car.y, z: car.z, ry: car.ry, seed: 7, live: true }); // (live: as the car at the bridgehead - the take-off swaps it for the one that flies)
  addPropColliders('plane_wreck', car.x, car.y, car.z, car.ry);
  const truck = { x: aw(17, RUNWAY_LEN / 2 - 32)[0], y: fieldH, z: aw(17, RUNWAY_LEN / 2 - 32)[1], ry: AIR.ry - 0.35 };
  props.push({ type: 'fuel_truck', x: truck.x, y: truck.y, z: truck.z, ry: truck.ry, seed: 3 });
  addPropColliders('fuel_truck', truck.x, truck.y, truck.z, truck.ry, props[props.length - 1]);
  clears.push([car.x, car.z, 12], [truck.x, truck.z, 7]);
  const runway = { x: field.x, z: field.z, ry: AIR.ry, z0: -RUNWAY_LEN / 2, z1: RUNWAY_LEN / 2, half: RUNWAY_HALF, y: fieldH, truck };
  void runwayRoad;
  {
    // what is on the runway: wrecks the plane will have to clear on its run (well off its line), a light plane that
    // did not make it, the cones somebody set out
    const b = new Builder(field.x, field.z, AIR.ry, fieldH);
    b.zone = ZONE.HANGARS;
    b.wreck('pickup_truck', RUNWAY_HALF - 1.4, -40, 0.12, { trunk: false });
    b.wreck('car_wreck', -RUNWAY_HALF + 1.4, -110, 0.2);
    b.prop('jersey_barrier', RUNWAY_HALF - 1.5, 60, PI / 2, { seed: 1 });
    b.prop('jersey_barrier', -RUNWAY_HALF + 1.5, 20, PI / 2, { seed: 2 });
    b.prop('corpse', 3, 90, 0.4, { nocollide: true });
    // light aircraft that never got off: one ran off the side, one stands on the grass by the apron
    b.prop('light_plane', RUNWAY_HALF + 15, -70, 0.8, { ground: true, seed: 0 });
    b.prop('light_plane', -RUNWAY_HALF - 11, -20, -2.2, { ground: true, seed: 1 });
    b.clear(RUNWAY_HALF + 15, -70, 8);
    b.clear(-RUNWAY_HALF - 11, -20, 8);
    // The runway's paint, white once (roadpaint: faded, worn through to the asphalt): the bars of both thresholds,
    // each end's number beyond them - 36 for whoever lands heading north, as the plane will leave, 18 from the other
    // end - the dashed centre line between the two, the aiming marks, the edge lines.
    const paint = (lx, lz, sx, sz) => b.box(lx, -0.045, lz, sx, 0.03, sz, 'roadpaint', { collide: false });
    for (let z = -RUNWAY_LEN / 2 + 62; z < RUNWAY_LEN / 2 - 56; z += 24) if (rng.chance(0.8)) paint(0, z, 0.6, 11);
    for (const end of [-1, 1]) for (let k = -4; k <= 4; k++) if (k) paint(k * 2.3 + (k > 0 ? 0.5 : -0.5), end * (RUNWAY_LEN / 2 - 12), 1.3, 14);
    {
      // the numbers, in strokes: [x, z, across, along] of a digit 3 m wide and 7 m tall, its foot towards the
      // threshold (z = 0) and its head 7 m up the runway
      const T = 0.75;
      const NUMBERS = 37; // (from the runway's end to the foot of its number: past the nose of the plane that stands on the south one)
      const SEG = { a: [0, 7 - T / 2, 3, T], g: [0, 3.5, 3, T], d: [0, T / 2, 3, T], f: [-1.5 + T / 2, 5.25, T, 3.5], b: [1.5 - T / 2, 5.25, T, 3.5], e: [-1.5 + T / 2, 1.75, T, 3.5], c: [1.5 - T / 2, 1.75, T, 3.5] };
      const DIGIT = { 1: 'bc', 3: 'abgcd', 6: 'afgedc', 8: 'abcdefg' };
      for (const [end, digits] of [[1, [3, 6]], [-1, [1, 8]]]) {
        // (read from the approach: heading north at the south end, left is west; the other way at the north end)
        digits.forEach((n, i) => {
          const cx = (i ? 1 : -1) * 2.4 * end;
          for (const s of DIGIT[n]) {
            const [x, z, sx, sz] = SEG[s];
            paint(cx + x * end, end * (RUNWAY_LEN / 2 - NUMBERS - z), sx, sz);
          }
        });
      }
    }
    // ...its edge lights, most of them dark for good, and a windsock at either end
    for (let z = -RUNWAY_LEN / 2 + 6; z <= RUNWAY_LEN / 2 - 6; z += 28) for (const sx of [-1, 1]) b.prop('runway_light', sx * (RUNWAY_HALF + 0.9), z, 0, { nocollide: true, ground: true, seed: (z + sx) & 1 });
    for (const sx of [-1, 1]) for (let z = -RUNWAY_LEN / 2 + 4; z < RUNWAY_LEN / 2 - 20; z += 22) if (rng.chance(0.82)) paint(sx * (RUNWAY_HALF - 0.9), z + 10, 0.4, rng.range(14, 21));
    for (const end of [-1, 1]) for (const dz of [56, 74, 92]) for (const sx of [-1, 1]) if (rng.chance(0.8)) paint(sx * 4.6, end * (RUNWAY_LEN / 2 - dz), 2.2, 9);
    // (...and beyond either end, what brought them in at night: bars of lamps on the grass)
    for (const end of [-1, 1]) for (const dz of [10, 24, 38]) for (let k = -2; k <= 2; k++) b.prop('runway_light', k * 2.4, end * (RUNWAY_LEN / 2 + dz), 0, { nocollide: true, ground: true, seed: (k + dz) & 1 });
    b.prop('windsock', RUNWAY_HALF + 9, RUNWAY_LEN / 2 - 40, 0.4, { ground: true });
    b.prop('windsock', -RUNWAY_HALF - 8, -RUNWAY_LEN / 2 + 30, 2, { ground: true });
  }
  {
    // the apron: what was parked on it the day the flights stopped (turned half round: the apron is east of the runway,
    // its far side the hangars)
    const b = new Builder(apron.x, apron.z, AIR.ry + PI, fieldH);
    b.zone = ZONE.HANGARS;
    const on = { ly: 0.05 };
    b.prop('light_plane', -12, -22, 1.2, { ...on, seed: 1 });
    b.prop('light_plane', 9, 6, -0.6, { ...on, seed: 0 });
    b.prop('light_plane', -13, 44, 2.8, { ...on, seed: 1 });
    b.wreck('fire_truck', -19, -60, 0.2, { ...on, trunk: false });
    for (const [cx, cz, r] of [[-5, -42, 0.3], [-5.4, -38.6, 0.34], [14, 30, 1.9], [-2, 58, 0.1]]) b.prop('baggage_cart', cx, cz, r, on);
    b.prop('shipping_container', -24, 64, 0.02, { ...on, seed: 1 });
    b.prop('shipping_container', -24, 71, -0.04, { ...on, seed: 2 });
    b.cont(CONT.FREIGHT, -20.4, 67.4, { prop: 'crate', ry: 0.2, ly: 0.05 });
    b.cont(CONT.DUFFEL, 4, -30, { prop: 'duffel_bag', ry: 1, nocollide: true, ly: 0.05 });
    for (const [lx, lz] of [[2, -36], [12, 22], [-8, 50], [20, -8]]) b.prop('suitcases', lx, lz, lx, { nocollide: true, ly: 0.05, seed: lz & 1 });
    b.prop('litter', 0, 0, 1, { nocollide: true, ly: 0.05 });
    b.prop('corpse', 6, -18, 2, { nocollide: true, ly: 0.05 });
    // (where the last flights were loaded: the army's trucks, tents for those who waited, the lamps over them)
    b.prop('army_truck', 16, -34, 0.3, { ...on, seed: 0 });
    b.prop('army_truck', 19.6, -46, -0.15, { ...on, seed: 1 });
    b.prop('triage_tent', -18, 22, 0.05, { ...on, seed: 0 });
    b.prop('triage_tent', -11.6, 23, -0.04, { ...on, seed: 1 });
    for (const [cx, cz, r] of [[-19, 20, 0], [-16.8, 24, PI], [-12.6, 21, 0], [-10.4, 25, PI]]) extra(b, 'field_cot', cx, cz, r, { ...on, seed: (cx * 2) & 3 });
    for (const [fx, fz, r] of [[22, 40, 2.4], [-24, -34, 0.6], [22, -64, 3.6]]) extra(b, 'floodlight_tower', fx, fz, r, on);
    for (let i = 0; i < 6; i++) b.prop('body_bag', -6 + i * 1.3, 32.5, PI / 2 + 0.07 * i, { nocollide: true, ly: 0.05, seed: i });
    for (const [lx, lz] of [[-4, 12], [6, -6], [12, 44], [-16, -8], [18, 14], [0, 60], [-10, -52], [8, -62]]) b.prop(['suitcases', 'paper_scatter', 'skeleton', 'litter', 'suitcases', 'traffic_cones', 'stroller', 'glass_shards'][(lx + 16) & 7], lx, lz, lx, { nocollide: true, ly: 0.05, seed: lz & 1 });
    b.loot(-16, 10, 0.07);
    b.loot(16, -50, 0.07);
  }
  {
    // the perimeter: chain link down the airfield's landward side, down in places, and the gate the road from East
    // Pass comes in by (this frame's z 22: the gate)
    const g0 = GATE_AT.lz - 22;
    const b = new Builder(aw(FENCE.x0, g0)[0], aw(FENCE.x0, g0)[1], AIR.ry, fieldH);
    b.zone = ZONE.TERMINAL;
    b.ground = true;
    for (let z = FENCE.z0 - g0; z <= FENCE.z1 - g0; z += 3) {
      const down = rng.chance(0.14);
      if (down || Math.abs(z - 22) < 6.5 || propBlocked('fence_chain', b.wx(0, z), b.wz(0, z), PI / 2) || roadDistAt(b.wx(0, z), b.wz(0, z)) < 3.4 || riverAt(b.wx(0, z), b.wz(0, z)) < RIVER_HW + 8) continue;
      b.prop('fence_chain', 0, z, PI / 2, { seed: z & 1 });
    }
    // (the boom stands on the road it is across, not on the verges either side of it)
    b.prop('boom_gate', 0.4, 16.5, PI / 2, { ground: false, ly: heightAt(b.wx(0.4, 16.5), b.wz(0.4, 16.5)) - fieldH });
    b.prop('jersey_barrier', -3.4, 26, PI / 2, { seed: 1 });
    b.prop('razor_wire', -3.6, 31, PI / 2);
    b.prop('road_sign', -4.4, 12, PI / 2, { seed: 2 });
    // (...and held it: a nest either side of the road, a carrier knocked out in front of it, their order on its posts)
    extra(b, 'sandbag_nest', -5.4, 12.4, PI / 2);
    extra(b, 'sandbag_nest', -5.4, 33, PI / 2, { seed: 1 });
    extra(b, 'apc_wreck', -15, 26.4, 0.5);
    extra(b, 'concertina', -9.4, 16.4, PI / 2 + 0.1);
    extra(b, 'tank_trap', -9, 30, 0.4);
    extra(b, 'tank_trap', -11.4, 11, 1.2);
    extra(b, 'floodlight_tower', 4.6, 30.4, 1.2);
    for (const [lx, lz] of [[-12, 20], [-18, 24], [-8, 23.6], [-21, 18], [-6.6, 27], [3, 24]]) b.prop(['corpse', 'skeleton', 'blood_pool', 'skeleton', 'body_bag', 'suitcases'][(lz * 2) % 6 | 0], lx, lz, lx, { nocollide: true, seed: lz & 1 });
  }
  place(ZONE.HANGARS, (b) => {
    // three hangars in a row, their doors (local -Z: east) open on the apron
    const hangar = (lx, k) => {
      const s = b.sub(lx, 6, 0);
      s.room(0, 0, 24, 24, 8, 'tin', { n: [gap(12, 16, 6.4)], s: [door(20, 1.3)], e: [win(12, 2)], w: [win(12, 2)] }, { roof: 'gableZ', roofH: 3.6, roofMat: 'tin', floorMat: 'concrete' });
      s.cont(CONT.SHELF, -4.6, 11.3, { prop: 'shelf', ry: PI, ly: FLOOR_Y, seed: k }); // (clear of the back door at x -8)
      s.cont(CONT.TOOLBOX, -2.4, 9.4, { prop: 'toolbox', ry: 0.5, nocollide: true, ly: FLOOR_Y, seed: k });
      s.cont(CONT.LOCKER, 11.56, 4, { prop: 'locker', ry: -PI / 2, ly: FLOOR_Y, seed: k });
      s.cont(CONT.CRATE, 8.6, 10.4, { prop: 'crate', ry: 0.2, ly: FLOOR_Y, seed: k });
      s.prop('barrel', -10.9, 3, 0, { ly: FLOOR_Y, seed: k });
      s.loot(0, 8, FLOOR_Y + 0.02);
      s.loot(-8, -4, FLOOR_Y + 0.02);
      // its doors, run half shut on their rails, rusted where they stand
      s.box(-5.7, 0, -12.32, 4.6, 6.3, 0.14, 'tin_rust');
      s.box(6.5, 0, -12.32, 3, 6.3, 0.14, 'tin_rust');
      s.prop('ivy', 12.16, 3, -PI / 2, { nocollide: true, seed: k });
      s.prop('litter', 2, -6, k, { nocollide: true, ly: FLOOR_Y, seed: k });
      part(s, 0, -10.6, 9.6, FLOOR_Y + 0.02); // the propeller, off the rack on the back wall
      if (k) part(s, 4, 10, -6, FLOOR_Y + 0.02);
      return s;
    };
    // (each: the frame showing down its flanks, rust run down its front from the door's rail, an engine hoist)
    for (const lx of [-30, 0, 30]) {
      for (const dz of [-6, 0, 6, 12, 18]) for (const sx of [-1, 1]) b.box(lx + sx * 12.24, 0, dz, 0.2, 8, 0.3, 'rust', { collide: false });
      b.box(lx, 6.5, -6.4, 24.4, 0.3, 0.3, 'rust', { collide: false });
      for (const dx of [-9, -3, 4, 9.5]) signAt(b, lx + dx, 6.4 - 1.4, -6.16, 0, 0.9, 2.8, dx > 0 ? 'rust_a' : 'rust_b', { grime: true, far: true });
      signAt(b, lx + 8.6, 2.2, -6.16, 0, 1.4, 1.4, lx ? 'xcode_a' : 'xcode_b', {});
    }
    hangar(-30, 0).prop('light_plane', 1.5, 0, 0.35, { ly: FLOOR_Y, seed: 1 });
    hangar(0, 1).wreck('pickup_truck', -4, 2, 0.3, { ly: FLOOR_Y, trunk: false });
    const h3 = hangar(30, 2);
    h3.prop('pallet', 3, 2, 0.3, { ly: FLOOR_Y });
    h3.cont(CONT.AMMO_BOX, -6, 4, { prop: 'military_crate', ry: 0.4, ly: FLOOR_Y });
    b.prop('generator', 0, 20.5, 0.2);
    b.cont(CONT.DUMPSTER, 45, 2, { prop: 'dumpster', ry: PI / 2 });
    for (const [lx, lz, r] of [[-44, -8, 0.3], [44, -10, 2.2]]) extra(b, 'floodlight_tower', lx, lz, r);
    extra(b, 'box_truck', -47, -14, 0.2);
    extra(b, 'van_wreck', 46, 14, 2.9);
    for (const [lx, lz] of [[-14, -9], [16, -11], [34, -9.4], [-36, -10]]) b.prop(['barrel', 'tire_pile', 'pallet', 'barrel'][(lx + 36) & 3], lx, lz, lx, { seed: lz & 1 });
    for (const [lx, lz] of [[-6, -10], [22, -12], [-24, -11.4], [8, -13], [38, -13]]) b.prop(['litter', 'paper_scatter', 'skeleton', 'suitcases', 'debris'][(lx + 24) % 5 | 0], lx, lz, lx, { nocollide: true, seed: lz & 1 });
    b.wreck('car_wreck', -46.5, 10, 0.4);
    b.prop('streetlight', 15, -9, 0);
    b.prop('streetlight', -15, -9, 0);
    b.prop('corpse', 3, -12, 2, { nocollide: true });
    b.loot(-15, -11);
  });
  place(ZONE.TERMINAL, (b) => {
    // The terminal: a hall with its desk and its rows of seats, a back office, a lounge of glass over half of it,
    // a canopy the length of its front, CALDER FIELD on its roof - and the tower at its north end, the cab on top.
    const R = groundRoom(b, 0, 2, 26, 14, 4.4, 'concrete', { n: [door(13, 1.8), win(5, 5, 0.7, 3.4), win(21, 5, 0.7, 3.4)], s: [door(20, 1.3), win(8, 4, 0.9, 3)], w: [win(7, 3, 0.9, 3)] }, { roof: 'flat', roofMat: 'concrete', floorMat: 'concrete', lino: true, tint: 2 });
    partition(b, R, 6, -5, 6, 9, 4.4, 'concrete', [door(9, 1.3)]);
    // (the back of it is two rooms: the office, and through a door of that the radio room; and the hall has a wall
    // between check-in and the baggage belt, open at its end)
    partition(b, R, 6, 2, 13, 2, 4.4, 'concrete', [door(1.6, 1.2)]);
    partition(b, R, -13, -1.7, -5, -1.7, 4.4, 'concrete');
    zone(R, 6, 2, 13, 9, 4);
    zone(R, 6, -5, 13, 2, 0);
    zone(R, -13, -5, -5, -1.7, 5);
    drumFire(b, 2.6, 0.9);
    b.prop('reception_desk', -4, 0, 0, { ly: 0.12 }); // the check-in desk
    b.loot(-4, 0, 1.26);
    for (const lx of [-9.6, -7.4, -3.6, -1.4]) b.prop('waiting_chairs', lx, 5.6, 0, { ly: 0.12, seed: lx & 1 });
    b.cont(CONT.LOCKER, 12.1, 6, { prop: 'locker', ry: -PI / 2, ly: 0.12 });
    b.cont(CONT.CABINET, 9.6, 8.2, { prop: 'cabinet', ry: PI, ly: 0.12 });
    b.cont(CONT.FRIDGE, -12.1, 6.4, { prop: 'fridge', ry: PI / 2, ly: 0.12 });
    b.prop('table', 9.4, 0, 0, { ly: 0.12 });
    b.loot(9.4, 0, 0.94);
    b.loot(11.4, -3.6, 0.14); // (the radio room's set is dead: the flight radio is at North Ridge Outpost)
    extra(b, 'office_desk', 10.6, 4.2, -PI / 2, { ly: 0.12 });
    extra(b, 'filing_cabinet', 7.2, 8.2, PI, { ly: 0.12 });
    extra(b, 'vending_machine', -12.2, 1.6, PI / 2, { ly: 0.12 });
    extra(b, 'vending_machine', -12.2, 0.4, PI / 2, { ly: 0.12, seed: 1 });
    for (const [lx, lz] of [[-6, 3], [2, -2], [-10, -3], [3, 6.5]]) b.prop(['paper_scatter', 'ceiling_debris', 'blood_pool', 'office_chair'][(lx + 10) & 3], lx, lz, lx, { nocollide: true, ly: 0.12, seed: lz & 1 });
    for (const lx of [-8, 0]) b.prop('ceiling_lamp', lx, 2, 0, { nocollide: true, ly: 4.4, seed: lx & 1 });
    // the baggage hall: the belt, what never got claimed
    b.box(-8, 0.12, -3.2, 8, 0.6, 1.2, 'rust');
    for (const [lx, lz, r] of [[-9.4, -0.4, 0.3], [-4, -4.6, 1.2], [1.6, 3, 2], [-11, -4.2, 2.6], [3.6, -3.4, 0.7]]) b.prop('suitcases', lx, lz, r, { nocollide: true, ly: 0.12, seed: lz & 1 });
    b.prop('litter', 0, -2, 1, { nocollide: true, ly: 0.12 });
    b.prop('barricade', 2.6, -2.9, PI / 2, { ly: 0.12 });
    b.loot(-11, 5.2, 0.14);
    // the lounge over the hall, its glass mostly gone; the name on the roof's edge
    block(b, -5, 3, 14, 9, 4.7, 1, 3.4, 'glass', 'concrete', { wear: 0.95 });
    for (const px of [-5.4, 0, 5.4]) b.box(px, 4.7, -5.1, 0.14, 1.9, 0.14, 'rust', { collide: false });
    signAt(b, 0, 5.75, -5.28, 0, 12.4, 1.55, 'terminal', { far: true, back: 0.1 });
    // the canopy over the kerb, on its posts
    for (const px of [-10, -3.4, 3.4, 10]) b.cyl(px, 0, -8.6, 0.13, 3.3, 'metal', { sides: 8 });
    b.box(0, 3.3, -7.1, 23, 0.26, 4.2, 'concrete', { collide: false });
    b.roofSpan(0, -7.1, 11.5, 2.1, 3.3, 0.26);
    // the tower: a shaft of four floors over the hall's north end, a walkway round its head, the cab on that - its
    // glass leaning out, half its panes gone - and on the cab's roof the aerials and the beacon
    const top = block(b, 9.5, 5.5, 5, 5, 4.7, 3, 3.1, 'office', 'concrete', { wear: 0.6 });
    b.box(9.5, top, 5.5, 7.4, 0.3, 7.4, 'concrete', { collide: false });
    for (const [dx, dz, w, d] of [[0, -3.6, 7.3, 0.06], [0, 3.6, 7.3, 0.06], [-3.6, 0, 0.06, 7.3], [3.6, 0, 0.06, 7.3]]) {
      b.box(9.5 + dx, top + 1.25, 5.5 + dz, w, 0.06, d, 'rust', { collide: false });
      b.box(9.5 + dx, top + 0.8, 5.5 + dz, w, 0.04, d, 'rust', { collide: false });
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(9.5 + sx * 3.6, top + 0.3, 5.5 + sz * 3.6, 0.07, 1.0, 0.07, 'rust', { collide: false });
    b.box(9.5, top + 0.3, 5.5, 4.6, 0.9, 4.6, 'metal', { collide: false });
    for (const [nx, nz] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      for (let k = -1; k <= 1; k++) {
        const here = rng.chance(0.62);
        const [px, pz] = [9.5 + nx * 2.45 + (nz ? k * 1.55 : 0), 5.5 + nz * 2.45 + (nx ? k * 1.55 : 0)];
        if (here) b.box(px, top + 1.2, pz, 1.45, 1.9, 0.04, 'glass', { collide: false, ry: nx ? PI / 2 : 0 });
        b.box(9.5 + nx * 2.5 + (nz ? (k + 0.5) * 1.55 : 0), top + 1.2, 5.5 + nz * 2.5 + (nx ? (k + 0.5) * 1.55 : 0), 0.08, 1.95, 0.08, 'metal', { collide: false });
      }
    }
    b.box(9.5, top + 1.2, 5.5, 2.6, 1.0, 2.6, 'dark', { collide: false }); // (the desks, in the dark of it)
    b.box(9.5, top + 3.1, 5.5, 6.6, 0.3, 6.6, 'concrete', { collide: false });
    b.box(9.5, top + 3.4, 5.5, 0.12, 4.4, 0.12, 'metal', { collide: false });
    b.box(8, top + 3.4, 4.4, 0.06, 2.6, 0.06, 'rust', { collide: false, rz: 0.12 });
    b.box(11, top + 3.4, 6.8, 0.06, 1.8, 0.06, 'rust', { collide: false });
    b.box(10.6, top + 3.7, 4.2, 1.5, 0.5, 0.2, 'metal', { collide: false, ry: 0.6 }); // (the radar's bar, where it stopped)
    b.cyl(10.6, top + 3.4, 4.2, 0.1, 0.3, 'rust', { sides: 6, collide: false });
    b.prop('baggage_cart', -18, 2, 0.1);
    b.prop('ivy', -13.16, 4, PI / 2, { nocollide: true });
    // out front: the forecourt, what the last flight out left behind, and the army's last order on its posts
    b.box(0, -0.05, -13, 30, 0.1, 14, 'concrete', { collide: true });
    b.wreck('ambulance', -8, -13.6, 1.4, { ly: 0.05, trunk: false });
    b.wreck('car_open', 6, -15, 0.2, { ly: 0.05, seed: 1 });
    b.wreck('school_bus', 15, 22, 1.5, { trunk: false });
    b.cont(CONT.DUFFEL, -2, -8, { prop: 'duffel_bag', ry: 0.6, nocollide: true, ly: 0.05 });
    b.cont(CONT.DUFFEL, 3.4, -10.5, { prop: 'duffel_bag', ry: 2.1, nocollide: true, ly: 0.05, seed: 1 });
    b.prop('streetlight', -13, -19, PI);
    b.prop('streetlight', 13, -19, PI);
    b.prop('corpse', 0, -16, 0.4, { nocollide: true, ly: 0.05 });
    b.loot(-10, -9, 0.07);
    for (const [lx, lz] of [[-12, -9.6], [-4, -11], [9, -9.2], [12.6, -12], [1, -18], [-9, -18.4]]) b.prop(['suitcases', 'suitcases', 'paper_scatter', 'skeleton', 'stroller', 'litter'][(lx + 12) % 6 | 0], lx, lz, lx * 0.7, { nocollide: true, ly: 0.05, seed: (lz * 3) & 1 });
    extra(b, 'street_bench', -6, -9.1, PI, { ly: 0.05 });
    extra(b, 'street_bench', 6, -9.1, PI, { ly: 0.05, seed: 1 });
    extra(b, 'trash_bin', 11.2, -9.2, 0, { ly: 0.05 });
    extra(b, 'checkpoint_sign', 2.4, -19, 0, { ly: 0.05 });
    extra(b, 'floodlight_tower', -13.4, -14.6, 0.4, { ly: 0.05 });
    for (const dq of [-1.1, 1.1]) b.cyl(12.6 + dq, 0, -19.6, 0.06, 3.2, 'rust', { sides: 6 });
    signAt(b, 12.6, 2.5, -19.68, 0, 2.6, 1.3, 'evac', { far: true, back: 0.05 });
  });
  place(ZONE.FUEL_DEPOT, (b) => {
    const FX = 22;
    const FZ = 20;
    for (let x = -FX + 1.5; x < FX; x += 3) {
      if (Math.abs(x) > 4) b.prop('fence_chain', x, -FZ, 0);
      b.prop('fence_chain', x, FZ, 0);
    }
    for (let z = -FZ + 1.5; z < FZ; z += 3) {
      b.prop('fence_chain', -FX, z, PI / 2);
      b.prop('fence_chain', FX, z, PI / 2);
    }
    // the tank farm: three tanks in a bund
    for (const lx of [-12, 0, 12]) {
      b.cyl(lx, 0, 9, 4.4, 7.5, 'tin_rust', { sides: 16 });
      b.cone(lx, 7.5, 9, 4.5, 1, 'tin', 16, { ry: 0 });
    }
    b.box(0, 0, 2.6, 36, 0.7, 0.4, 'concrete');
    for (const lx of [-12, 0, 12]) {
      for (const dx of [-0.25, 0.25]) b.box(lx + dx, 0, 4.5, 0.05, 8.2, 0.05, 'rust', { collide: false });
      for (let y = 0.5; y < 8; y += 0.5) b.box(lx, y, 4.5, 0.5, 0.04, 0.04, 'rust', { collide: false });
      b.box(lx, 7.6, 9, 9.2, 0.08, 0.08, 'rust', { collide: false }); // (the rail round its roof, seen as a line)
      b.cyl(lx + 2.2, 0, 3.6, 0.14, 0.9, 'rust', { sides: 6, collide: false });
    }
    b.box(0, 0.35, 1.4, 30, 0.22, 0.22, 'rust', { collide: false }); // the main, along the bund
    b.box(-12, 0.35, -3, 0.22, 0.22, 9, 'rust', { collide: false });
    // the pump house
    b.room(-12, -10, 8, 6, 3, 'concrete', { e: [door(3, 1.2)], n: [win(4, 1.4)] }, { roof: 'flat', roofMat: 'concrete', floorMat: 'concrete' });
    b.cont(CONT.LOCKER, -15.3, -9, { prop: 'locker', ry: PI / 2, ly: 0.12 });
    b.cont(CONT.TOOLBOX, -11, -8, { prop: 'toolbox', ry: 0.2, nocollide: true, ly: 0.12 });
    part(b, 4, -14, -11.6, 0.14);
    // the drum store, under a roof on posts
    b.shelter(10, -10, 10, 7, 3.2, 'tin', 'metal');
    for (const [dx, dz] of [[7, -11.4], [8, -11.4], [7.5, -10.5], [12.5, -8.4]]) b.prop('barrel', dx, dz, 0);
    part(b, 4, 10, -11.6);
    part(b, 4, 12.6, -10.4);
    part(b, 4, 9.4, -8.4);
    b.prop('fuel_tank', 14, -15.6, PI / 2);
    b.cont(CONT.CRATE, 4, -15, { prop: 'crate', ry: 0.3 });
    b.wreck('pickup_truck', -2, -14.6, 1.5);
    b.prop('streetlight', -5.5, -18.6, PI);
    b.prop('corpse', 2, -6, 2.4, { nocollide: true });
    b.loot(0, -4);
    b.loot(16, -4);
  });

  // ---------------------------------------------------------------- the land a body walks to
  // Every 4 m cell of dry ground outside the mountains that can be walked to from the bridgehead, the tunnels open (the
  // workings under the river are not on it: the far side is reached through North Pass). What is scattered goes only
  // there: nothing on an island of the sea or the lake, nothing in a pocket the cliffs close off.
  const RC4 = 4;
  const RN = Math.ceil(SIZE / RC4);
  const landReach = new Uint8Array(RN * RN);
  {
    const ok = (i, j) => {
      const x = -HALF + (i + 0.5) * RC4;
      const z = -HALF + (j + 0.5) * RC4;
      return heightAt(x, z) > WATER_LEVEL + 0.2 && cliffAt(x, z) < -0.5;
    };
    const q = new Int32Array(RN * RN);
    let tail = 0;
    const i0 = Math.floor((head.x + HALF) / RC4);
    const j0 = Math.floor((head.z + HALF) / RC4);
    landReach[j0 * RN + i0] = 1;
    q[tail++] = j0 * RN + i0;
    for (let h = 0; h < tail; h++) {
      const k = q[h];
      const i = k % RN;
      const j = (k - i) / RN;
      for (let m = 0; m < 4; m++) {
        const ni = i + (m === 0 ? 1 : m === 1 ? -1 : 0);
        const nj = j + (m === 2 ? 1 : m === 3 ? -1 : 0);
        if (ni < 0 || nj < 0 || ni >= RN || nj >= RN || landReach[nj * RN + ni] || !ok(ni, nj)) continue;
        landReach[nj * RN + ni] = 1;
        q[tail++] = nj * RN + ni;
      }
    }
  }
  const reachAt = (x, z) => landReach[clamp(Math.floor((z + HALF) / RC4), 0, RN - 1) * RN + clamp(Math.floor((x + HALF) / RC4), 0, RN - 1)] === 1;

  // ---------------------------------------------------------------- roadside & countryside sites
  // What stands along the roads and out on the plain between the places, as on the island: a wreck, a camp, a
  // stash, a shed.
  const sites = [];
  // (not in a place, the city, the airfield, the water or a mountain, and well clear of the river and the map's edge)
  const adits = [passageW, passageE, P(PLACES.mineA), [zoneById[ZONE.PASSAGE].x + 6, zoneById[ZONE.PASSAGE].z - 22]]; // (the portals, and the sealed adits' mounds)
  const _sq = [];
  const builtNear = (x, z, r) => staticGrid.query(x, z, r, _sq).some((c) => !(c.flags & COL.TREE));
  const siteOk = (x, z) => reachAt(x, z) && Math.hypot(x - PIT.x, z - PIT.z) > PIT.r + 12 && adits.every(([ax, az]) => Math.hypot(x - ax, z - az) > 38) && !builtNear(x, z, 10) && !onField(x, z, 14) && lakeAt(x, z) < -16 && riverAt(x, z) > RIVER_HW + 14 && seaAt(x, z) < -12 && cliffAt(x, z) < -10 && !tunnelOf(x, z, 10) && !inCity(x, z, 26) && Math.abs(x) < HALF - 60 && Math.abs(z) < HALF - 60 && !inWater(x, z) && !nearZone(x, z, 26) && homes.every((o) => Math.hypot(o.x - x, o.z - z) > 18);
  // is a road other than `road` within d of (x, z)? (At a junction the ground is two roads': nothing is seated there.)
  // (the roads' points by 16 m cells: which roads have a point in each)
  const roadCells = new Map();
  roads.forEach((r, ri) => {
    for (let k = 0; k < r.pts.length; k += 2) {
      const key = Math.floor(r.pts[k] / 16) * 4096 + Math.floor(r.pts[k + 1] / 16);
      let set = roadCells.get(key);
      if (!set) roadCells.set(key, (set = []));
      if (set[set.length - 1] !== ri) set.push(ri);
    }
  });
  const otherRoad = (road, x, z, d) => {
    for (let i = Math.floor((x - d) / 16); i <= Math.floor((x + d) / 16); i++) {
      for (let j = Math.floor((z - d) / 16); j <= Math.floor((z + d) / 16); j++) {
        for (const ri of roadCells.get(i * 4096 + j) || []) {
          const r = roads[ri];
          if (r === road) continue;
          const p = r.pts;
          for (let k = 0; k < p.length; k += 2) if (Math.abs(p[k] - x) < d && Math.abs(p[k + 1] - z) < d) return true;
        }
      }
    }
    return false;
  };
  // (the boots of a pile-up: a wreck's colliders kept a stride from every boot there, and a boot only where a stride
  // behind it is clear of every wreck's)
  const STRIDE = 0.9;
  let jamProps = 0, jamConts = 0; // (where this pile-up's props and containers begin: only its own can box a boot in)
  const bootsClear = (type, x, z, ry) => {
    const mine = [0, 1, 2].flatMap((sd) => (collidersOf(type, sd)?.boxes || []).map(([lx, , lz, sx, , sz]) => ({ x: x + Math.cos(ry) * lx + Math.sin(ry) * lz, z: z - Math.sin(ry) * lx + Math.cos(ry) * lz, hx: sx / 2, hz: sz / 2, c: Math.cos(ry), s: Math.sin(ry), r: 0 })));
    for (let k = jamConts; k < containers.length; k++) {
      const o = containers[k];
      if (o.ctype !== CONT.TRUNK || Math.abs(o.x - x) > 8 || Math.abs(o.z - z) > 8) continue;
      const q = { x: o.x, z: o.z, hx: 0, hz: 0, c: 1, s: 0, r: STRIDE };
      if (mine.some((a) => kit.solidsMeet(a, q))) return false;
    }
    return true;
  };
  const bootRoom = (x, z) => {
    const q = { x, z, hx: 0, hz: 0, c: 1, s: 0, r: STRIDE };
    for (let k = jamProps; k < props.length; k++) {
      const p = props[k];
      if (Math.abs(p.x - x) > 8 || Math.abs(p.z - z) > 8 || p.nocollide) continue;
      for (const [lx, , lz, sx, , sz] of collidersOf(p.type, p.seed)?.boxes || []) {
        const c = Math.cos(p.ry), s2 = Math.sin(p.ry);
        if (kit.solidsMeet({ x: p.x + c * lx + s2 * lz, z: p.z - s2 * lx + c * lz, hx: sx / 2, hz: sz / 2, c, s: s2, r: 0 }, q)) return false;
      }
    }
    return true;
  };
  const siteFree = (x, z, gapTo) => sites.every((s) => Math.hypot(s.x - x, s.z - z) >= (s.type === 'jam' ? Math.max(gapTo, 48) : gapTo)); // (a jam is 60 m of road)
  // (a wreck of a pile-up is put down only clear of the colliders of every wreck already there, as they are, by a
  // hand's width: on a bend the cars of one lane come round into each other)
  const wreckClear = (type, x, z, ry) => {
    const box = (t, px, pz, pry, seed) => {
      const def = collidersOf(t, seed);
      const c = Math.cos(pry);
      const s2 = Math.sin(pry);
      const out = [];
      for (const [lx, , lz, sx, , sz] of def?.boxes || []) out.push({ x: px + c * lx + s2 * lz, z: pz - s2 * lx + c * lz, hx: sx / 2 + 0.1, hz: sz / 2 + 0.1, c, s: s2, r: 0 });
      for (const [lx, lz, r] of def?.cyls || []) out.push({ x: px + c * lx + s2 * lz, z: pz - s2 * lx + c * lz, hx: 0, hz: 0, c: 1, s: 0, r: r + 0.1 });
      return out;
    };
    const mine = [0, 1, 2].flatMap((seed) => box(type, x, z, ry, seed));
    for (const p of props) {
      if (Math.abs(p.x - x) > 14 || Math.abs(p.z - z) > 14) continue;
      for (const o of box(p.type, p.x, p.z, p.ry, p.seed)) for (const a of mine) if (kit.solidsMeet(a, o)) return false;
    }
    return true;
  };
  // The main roads first: every so often the traffic out of the city stopped for good - a dozen wrecks across both
  // lanes, a truck jack-knifed among them, what their people dropped as they ran
  for (const main of roads.filter((r) => r.kind === ROAD.ASPHALT && r.width === 3.6)) {
    const p = main.pts;
    let acc = JAM_EVERY; // (the first where there is first room for one)
    for (let i = 6; i < p.length / 2 - 6; i++) {
      acc += Math.hypot(p[i * 2] - p[i * 2 - 2], p[i * 2 + 1] - p[i * 2 - 1]);
      const x = p[i * 2];
      const z = p[i * 2 + 1];
      if (acc < JAM_EVERY || nearZone(x, z, 46) || inCity(x, z, 30) || onField(x, z, 30) || tunnelOf(x, z, 24) || riverAt(x, z) < RIVER_HW + 20 || homes.some((o) => Math.hypot(o.x - x, o.z - z) < 30)) continue;
      acc = rng.range(-30, 30);
      const tx = p[i * 2 + 4] - p[i * 2 - 4];
      const tz = p[i * 2 + 5] - p[i * 2 - 3];
      const b = new Builder(x, z, Math.atan2(-tx, -tz), heightAt(x, z));
      b.zone = ZONE.FOREST;
      b.ground = true;
      sites.push({ x, z, ry: b.ry, type: 'jam', road: ROAD.ASPHALT });
      [jamProps, jamConts] = [props.length, containers.length];
      const truck = rng.chance(0.5);
      const tx0 = rng.range(-0.6, 0.6);
      const tr = rng.chance(0.5) ? 0.5 : PI - 0.4;
      const ts = rng.int(0, 1);
      if (truck && !propBlocked('semi_truck', b.wx(tx0, 0), b.wz(tx0, 0), b.ry + tr) && longClear('semi_truck', b.wx(tx0, 0), b.wz(tx0, 0)) && !otherRoad(main, x, z, 18)) b.wreck('semi_truck', tx0, 0, tr, { trunk: false, seed: ts, zone: ZONE.ROADSIDE });
      // (both lanes, nose to tail: n lengths of it, a gap here and there where one got out)
      for (let n = rng.int(6, 9) * 2, k = 0; k < n; k++) {
        const along = ((k >> 1) - n / 4) * 6.3 + rng.range(-0.7, 0.7);
        const lane = (k % 2 ? 1 : -1) * rng.range(1.7, 2.3) + (rng.chance(0.14) ? (k % 2 ? 3 : -3) : 0); // (a few took to the verge)
        const t = rng();
        const ry = (k % 2 ? PI : 0) + rng.range(-0.35, 0.35);
        const trunk = rng.chance(0.5);
        const type = t < 0.4 ? 'car_wreck' : t < 0.68 ? 'car_burnt' : t < 0.86 ? 'pickup_truck' : t < 0.95 ? 'ambulance' : 'school_bus';
        if (!levelUnder(type, b.wx(lane, along), b.wz(lane, along), b.ry + ry) || propBlocked(type, b.wx(lane, along), b.wz(lane, along), b.ry + ry) || !wreckClear(type, b.wx(lane, along), b.wz(lane, along), b.ry + ry) || !longClear(type, b.wx(lane, along), b.wz(lane, along)) || otherRoad(main, b.wx(lane, along), b.wz(lane, along), 13)) continue;
        // (a boot is opened from behind: no wreck pulled up within a stride of one, nor one opened where a wreck stands
        // that close behind it - boxed in among them it could not be reached)
        const wx = b.wx(lane, along), wz = b.wz(lane, along);
        if (!bootsClear(type, wx, wz, b.ry + ry)) continue;
        const back = type === 'pickup_truck' ? 2.9 : 2.45;
        const boot = trunk && type !== 'car_burnt' && type !== 'ambulance' && type !== 'school_bus' && bootRoom(wx + Math.sin(b.ry + ry) * back, wz + Math.cos(b.ry + ry) * back);
        b.wreck(type, lane, along, ry, { trunk: boot, zone: ZONE.ROADSIDE });
      }
      b.prop('suitcases', rng.range(-5, 5), rng.range(-12, 12), rng.range(0, 6), { nocollide: true });
      b.prop('litter', rng.range(-4, 4), rng.range(-12, 12), rng.range(0, 6), { nocollide: true, seed: 1 });
      b.prop('corpse', rng.range(-6, 6), rng.range(-14, 14), rng.range(0, 6), { nocollide: true });
      b.cont(CONT.DUFFEL, 6.4, rng.range(-8, 8), { prop: 'duffel_bag', ry: rng.range(0, 6), nocollide: true, zone: ZONE.ROADSIDE });
    }
  }
  for (const road of roads) {
    if (road.length < 90 || road.name === 'track from the mines') continue; // (no roadside sites down the mines' track: before any draw, so what else the seed deals stays put)
    const p = road.pts;
    let acc = rng.range(20, 50);
    let sideOf = rng.chance(0.5) ? 1 : -1;
    for (let i = 2; i < p.length / 2 - 2; i++) {
      acc += Math.hypot(p[i * 2] - p[i * 2 - 2], p[i * 2 + 1] - p[i * 2 - 1]);
      if (acc < (road.kind === ROAD.TRAIL ? 60 : 36)) continue;
      const tx = p[i * 2 + 2] - p[i * 2 - 2];
      const tz = p[i * 2 + 3] - p[i * 2 - 1];
      const tl = Math.hypot(tx, tz) || 1;
      const type = ['wreck', 'wreck', 'camp', 'stash', 'shed', 'wreck', 'crash', 'post', 'stop', 'graves'][rng.int(0, 9)];
      const off = road.width + (type === 'wreck' ? rng.range(2.5, 4) : rng.range(7, 10));
      const sx = p[i * 2] + (-tz / tl) * sideOf * off;
      const sz = p[i * 2 + 1] + (tx / tl) * sideOf * off;
      sideOf = -sideOf;
      // (not where a second road comes by: by a junction the ground is the roads', not the site's)
      if (!siteOk(sx, sz) || !siteFree(sx, sz, 30) || roadDistAt(sx, sz) < off - road.width - 1 || (type !== 'wreck' && roadDistAt(sx, sz) < 8.5) || otherRoad(road, sx, sz, 16)) continue;
      // (rh: the road's height by a wreck. It stands on a shoulder of the road, level with it - not on a shelf up the
      // bank of a cutting.)
      sites.push({ x: sx, z: sz, ry: Math.atan2((-tz / tl) * -sideOf, (tx / tl) * -sideOf), type, road: road.kind, rh: type === 'wreck' ? road.hs[i] : undefined });
      acc = rng.range(-10, 10);
    }
  }
  for (let a = 0; a < 6000 && sites.length < 300; a++) {
    const x = rng.range(-HALF + 70, HALF - 70);
    const z = rng.range(-HALF + 70, HALF - 70);
    if (!siteOk(x, z) || roadDistAt(x, z) < 22 || !siteFree(x, z, 38)) continue;
    sites.push({ x, z, ry: rng.range(0, PI * 2), type: ['camp', 'stash', 'shed', 'camp'][rng.int(0, 3)], road: 0 });
  }
  // level the ground under each (not the roads beside them), so a shed's walls and what stands by them sit true
  for (const st of sites) {
    if (st.type === 'jam') continue; // (it stands on the road)
    const h0 = st.rh ?? heightAt(st.x, st.z);
    const R = SITE_FLAT + 5;
    for (let j = Math.max(0, Math.floor((st.z - R + HALF) / GRID_STEP)); j <= Math.min(N - 1, Math.ceil((st.z + R + HALF) / GRID_STEP)); j++) {
      for (let i = Math.max(0, Math.floor((st.x - R + HALF) / GRID_STEP)); i <= Math.min(N - 1, Math.ceil((st.x + R + HALF) / GRID_STEP)); i++) {
        const k = j * N + i;
        if (roadDist[k] < 5 && st.rh === undefined) continue; // (clear of it: what stands on the road was seated on it as it is)
        // (a site by a road is a shoulder of it: by the road it follows the road's own fall, a cell at a time)
        heights[k] = lerp(heights[k], st.rh !== undefined && roadDist[k] < 9.5 ? roadH[k] - 0.05 : h0, 1 - smoothstep(SITE_FLAT, R, Math.hypot(-HALF + i * GRID_STEP - st.x, -HALF + j * GRID_STEP - st.z)));
      }
    }
    st.h = h0;
  }
  // (what a site has more of than it always had is dealt from dice of its own - sd - so nothing after it moves)
  const sd = (st, n) => hash2(Math.round(st.x * 8), Math.round(st.z * 8) + n * 7919, (seed ^ 0x51e5) | 0);
  // (...seated on its lowest corner: not where the ground under its middle stands well above that, on the slope out past
  // the site's levelled ground)
  const seatedTrue = (type, x, z, ry) => heightAt(x, z) - seatY(type, x, z, ry) <= 0.12 + (Math.hypot(PROPS[type].size[0], PROPS[type].size[2]) / 2) * 0.3;
  const put3 = (b, type, lx, lz, ry, seedv = 0) => fits(b, type, lx, lz, ry) && levelUnder(type, b.wx(lx, lz), b.wz(lx, lz), b.ry + ry) && seatedTrue(type, b.wx(lx, lz), b.wz(lx, lz), b.ry + ry) && b.prop(type, lx, lz, ry, { seed: seedv });
  for (const st of sites) {
    if (st.type === 'jam') continue;
    const b = new Builder(st.x, st.z, st.ry, st.h);
    b.zone = ZONE.FOREST;
    b.ground = true;
    if (st.type === 'wreck') {
      const t = rng();
      // (now and then a bus, burnt out where it went off the road)
      const bus = st.road === ROAD.ASPHALT && sd(st, 1) < 0.2;
      const wt = bus ? (sd(st, 2) < 0.5 ? 'school_bus' : 'city_bus') : t < 0.45 ? 'car_wreck' : t < 0.75 ? 'car_burnt' : 'pickup_truck';
      const wry = PI / 2 + rng.range(-0.5, 0.5);
      if (bus) {
        if (levelUnder(wt, st.x, st.z, st.ry + wry) && !propBlocked(wt, st.x, st.z, st.ry + wry) && longClear(wt, st.x, st.z)) b.wreck(wt, 0, 0, wry, { zone: ZONE.ROADSIDE, trunk: false, seed: 1 });
      } else if (levelUnder(wt, st.x, st.z, st.ry + wry)) b.wreck(wt, 0, 0, wry, { zone: ZONE.ROADSIDE, trunk: t < 0.45 || t >= 0.75 });
      if (rng.chance(0.4)) b.prop('corpse', rng.range(-2.5, 2.5), -2.4, rng.range(0, 6), { nocollide: true });
      if (rng.chance(0.3)) b.loot(rng.range(-2, 2), 2.6);
    } else if (st.type === 'camp') {
      b.prop('tent', 0, 1.5, rng.range(-0.3, 0.3));
      b.prop('campfire', 0.3, -2.2, 0, { nocollide: true, seed: 1 });
      b.prop('log_bench', 2.65, -2.2, PI / 2 + 0.2);
      b.cont(CONT.DUFFEL, -1.9, -1.4, { prop: 'duffel_bag', ry: rng.range(0, 6), nocollide: true });
      b.loot(1.2, -3.8);
      b.clear(0, 0, 5);
    } else if (st.type === 'crash') {
      // two that met, off the road: one burnt, their people still by them
      b.wreck(rng.chance(0.5) ? 'car_open' : 'van_wreck', -1.2, 0.4, PI / 2 + rng.range(-0.4, 0.4), { zone: ZONE.ROADSIDE, trunk: false, seed: rng.int(0, 3) });
      extra(b, 'car_burnt', 2.4, -1.6, rng.range(0, 6));
      b.prop('glass_shards', 0.6, -0.6, rng.range(0, 6), { nocollide: true });
      b.prop(rng.chance(0.5) ? 'skeleton' : 'corpse', rng.range(-3, 3), 2.6, rng.range(0, 6), { nocollide: true, seed: rng.int(0, 2) });
      b.prop('suitcases', rng.range(-3, 3), -3.2, rng.range(0, 6), { nocollide: true });
      if (rng.chance(0.5)) b.cont(CONT.DUFFEL, 3.6, 2.4, { prop: 'duffel_bag', ry: rng.range(0, 6), nocollide: true, zone: ZONE.ROADSIDE });
    } else if (st.type === 'post') {
      // a post the army held on the road: a nest, wire, their order on a trestle, what is left of them
      extra(b, 'sandbag_nest', 0, 0.6, PI);
      b.prop('mg_tripod', 0, 0.8, PI, { nocollide: true });
      extra(b, 'concertina', 0.4, -3.6, rng.range(-0.1, 0.1));
      extra(b, 'checkpoint_sign', -3.6, -2, PI + rng.range(-0.3, 0.3));
      b.cont(CONT.AMMO_BOX, 3.4, 1.2, { prop: 'military_crate', ry: 0.3, zone: ZONE.ROADSIDE }); // (no place's: see placeSchematics)
      for (let k = 0; k < 3; k++) b.prop(['skeleton', 'corpse', 'blood_pool'][k], rng.range(-3.6, 3.6), rng.range(-2.6, 3.4), rng.range(0, 6), { nocollide: true, seed: k });
      b.clear(0, 0, 5);
      // (on a made road, the checkpoint it was: barriers angled off the shoulder toward the road, their truck pulled
      // over, a floodlight, tank traps, the tent they slept in)
      if (st.road === ROAD.ASPHALT || sd(st, 3) < 0.5) {
        for (const [jx, jz, jr] of [[-6.5, -4.6, 0.5], [6.4, -4.4, -0.45]]) if (Math.abs(heightAt(b.wx(jx, jz), b.wz(jx, jz)) - st.h) < 0.1) put3(b, 'jersey_barrier', jx, jz, jr);
        // (their truck at one in two, the floodlight at one in three: models heavy for the GPU's memory)
        if (sd(st, 7) < 0.5) put3(b, 'army_truck', 8.5, 3.5, PI / 2 + (sd(st, 4) - 0.5) * 0.4, Math.floor(sd(st, 5) * 2));
        if (sd(st, 8) < 0.34) put3(b, 'floodlight_tower', -6.2, 1.8, 0.4);
        put3(b, 'tank_trap', -9.5, -2.4, sd(st, 6) * 3);
        put3(b, 'military_tent', -8.6, 6.6, 0.2);
        put3(b, 'sandbags', 3.6, -2.6, 0.1, 1);
      }
    } else if (st.type === 'stop') {
      // a bus stop out in the country: its shelter, a bench, what was left waiting
      b.prop('bus_shelter', 0, 0.8, PI);
      extra(b, 'trash_bin', 2.8, 0.4, 0);
      extra(b, 'street_bench', -3.4, 0.6, PI);
      for (let k = 0; k < 3; k++) b.prop(['suitcases', 'litter', 'skeleton'][k], rng.range(-3, 3), -1.6 - k * 0.6, rng.range(0, 6), { nocollide: true, seed: k });
      if (rng.chance(0.4)) b.loot(1.2, -1.4);
    } else if (st.type === 'graves') {
      // somebody buried theirs by the road
      for (let k = 0; k < 4; k++) {
        const gx = -2.7 + k * 1.8;
        b.prop('grave_cross', gx, 1.4 + rng.range(-0.2, 0.2), rng.range(-0.3, 0.3), { seed: k });
        b.box(gx, 0, 0.2, 0.8, 0.06, 1.9, 'earth', { collide: false });
      }
      b.prop('bones', 3.6, -1.2, 0, { nocollide: true });
      if (rng.chance(0.5)) b.cont(CONT.DUFFEL, -3.6, -1, { prop: 'duffel_bag', ry: 1, nocollide: true, zone: ZONE.ROADSIDE });
    } else if (st.type === 'stash') {
      b.cont(CONT.AMMO_BOX, 0, 0, { prop: 'military_crate', ry: 0.2 });
      b.prop('sandbags', 0.2, 1.4, 0.1);
      b.prop('sandbags', -2, 0, PI / 2 - 0.2, { seed: 1 });
      b.prop('barrel', 1.8, -0.4, 0);
      b.clear(0, 0, 4);
    } else {
      b.ground = false;
      b.room(0, 0, 3.6, 3.2, 2.5, rng.chance(0.5) ? 'planks' : 'tin', { n: [door(1.8, 1.2)] }, { roof: 'flat', roofMat: 'tin' });
      b.cont(CONT.TOOLBOX, 0.9, 0.9, { prop: 'toolbox', ry: 0.3, nocollide: true });
      b.cont(CONT.SHELF, -1.15, 0.4, { prop: 'crate', ry: 0, h: 0.6 });
      b.prop('woodpile', 2.8, 0, PI / 2);
    }
  }
  // A FARM on the city side, off a road where the woods leave open ground: the farmhouse, the barn with its doors
  // open, the silo, the round bales, the tractor left in the yard, a paddock's fence, the field in rows with its
  // scarecrow, the well. (The first open spot by a road the dice turn up; its ground levelled.)
  {
    let at = null;
    roads.forEach((road, ri) => {
      if (at || (road.kind !== ROAD.ASPHALT && road.kind !== ROAD.DIRT) || road.length < 300) return;
      const p = road.pts;
      for (let i = 4; i < p.length / 2 - 4 && !at; i += 6) {
        const tx = p[i * 2 + 2] - p[i * 2 - 2];
        const tz = p[i * 2 + 3] - p[i * 2 - 1];
        const tl = Math.hypot(tx, tz) || 1;
        for (const sd of [1, -1]) {
          const off = road.width + 36;
          const x = p[i * 2] + (tz / tl) * sd * off;
          const z = p[i * 2 + 1] - (tx / tl) * sd * off;
          if (!reachAt(x, z) || forestAt(x, z) > 0.5 || builtNear(x, z, 30) || nearZone(x, z, 30) || inCity(x, z, 50) || cliffAt(x, z) > -30 || seaAt(x, z) > -30 || lakeAt(x, z) > -25 || riverAt(x, z) < 45 || onField(x, z, 30) || Math.abs(x) > HALF - 80 || Math.abs(z) > HALF - 80) continue;
          // (its ground is levelled out to 40 m: clear of every site and of what a site puts down round it, a dozen metres)
          if (homes.some((o) => Math.hypot(o.x - x, o.z - z) < 45) || sites.some((st) => Math.hypot(st.x - x, st.z - z) < 54)) continue;
          let lo = Infinity, hi = -Infinity, wet = false;
          for (let dx = -26; dx <= 26; dx += 6.5) for (let dz = -26; dz <= 26; dz += 6.5) {
            const hh = heightAt(x + dx, z + dz);
            lo = Math.min(lo, hh);
            hi = Math.max(hi, hh);
            if (roadDistAt(x + dx, z + dz) < 6 || inWater(x + dx, z + dz)) wet = true;
          }
          if (wet || hi - lo > 4.5) continue;
          at = { x, z, h: (lo + hi) / 2, ry: Math.atan2((-tz / tl) * -sd, (tx / tl) * -sd) };
          break;
        }
      }
    });
    if (at) {
      const R = 32;
      for (let j = Math.max(0, Math.floor((at.z - R - 8 + HALF) / GRID_STEP)); j <= Math.min(N - 1, Math.ceil((at.z + R + 8 + HALF) / GRID_STEP)); j++) {
        for (let i = Math.max(0, Math.floor((at.x - R - 8 + HALF) / GRID_STEP)); i <= Math.min(N - 1, Math.ceil((at.x + R + 8 + HALF) / GRID_STEP)); i++) {
          const k = j * N + i;
          if (roadDist[k] < 5) continue;
          heights[k] = lerp(heights[k], at.h, 1 - smoothstep(R, R + 8, Math.hypot(-HALF + i * GRID_STEP - at.x, -HALF + j * GRID_STEP - at.z)));
        }
      }
      const b = new Builder(at.x, at.z, at.ry, at.h);
      b.zone = ZONE.ROADSIDE;
      b.yard = { x: at.x, z: at.z, flat: R };
      house(b, -12, -2, 0, 7, K, true);
      b.room(11, 2, 12, 16, 5.6, 'barn', { n: [gap(6, 4.2, 4.4)], s: [door(6, 1.3)] }, { roof: 'gable', roofH: 3.6, roofMat: 'tin_rust', floorMat: 'planks' });
      b.cont(CONT.CRATE, 14.5, 6, { prop: 'crate', ry: 0.2, ly: 0.12, seed: 1 });
      b.prop('hay_square', 7.4, 7.5, 0.1, { ly: 0.12, seed: 0 });
      b.loot(9, 4, 0.14);
      b.cyl(21, 0, 9, 2.4, 11, 'tin', { sides: 14 });
      b.cone(21, 11, 9, 2.6, 2.2, 'tin_rust', 14);
      b.clear(0, 0, R - 2);
      const put4 = (type, lx, lz, ry, seedv = 0) => fits(b, type, lx, lz, ry) && levelUnder(type, b.wx(lx, lz), b.wz(lx, lz), b.ry + ry) && b.prop(type, lx, lz, ry, { seed: seedv });
      for (const [lx, lz] of [[2, 12], [5, 13.5], [3.4, 16], [6.6, 16.6]]) put4('hay_round', lx, lz, lx * 0.7, Math.round(lx) & 1);
      put4('tractor', 1.5, 2, 0.9);
      put4('well', -20, 8, 0);
      put4('woodpile', -20, -4, PI / 2, 1);
      // the paddock's fence along the side of the yard, and the field behind it in rows, its scarecrow
      for (let lz = -12; lz <= 12; lz += 3) put4('fence', 27.5, lz, PI / 2, lz & 1);
      for (let r = 0; r < 5; r++) b.box(-6 + r * 0, -0.02, 20.5 + r * 2.2, 34, 0.08, 1.1, 'earth', { collide: false });
      put4('scarecrow', 4, 24.8, 0.4);
      landmarks.push({ x: at.x, z: at.z, name: 'Farm' });
    }
  }
  // ROAD SIGNS down the made and the dirt roads, every quarter of a kilometre or so, on the verge where the traffic
  // on that side reads them (dice of their own: nothing else moves; none where something stands or a road crosses)
  roads.forEach((road, ri) => {
    if ((road.kind !== ROAD.ASPHALT && road.kind !== ROAD.DIRT) || road.length < 200) return;
    const p = road.pts;
    let acc = 60 + hash2(ri, 1, (seed ^ 0x5197) | 0) * 120;
    let side = hash2(ri, 2, (seed ^ 0x5197) | 0) < 0.5 ? 1 : -1;
    for (let i = 1; i < p.length / 2 - 1; i++) {
      acc += Math.hypot(p[i * 2] - p[i * 2 - 2], p[i * 2 + 1] - p[i * 2 - 1]);
      if (acc < 250) continue;
      const tx = p[i * 2 + 2] - p[i * 2 - 2];
      const tz = p[i * 2 + 3] - p[i * 2 - 1];
      const tl = Math.hypot(tx, tz) || 1;
      const off = road.width + 2.2;
      const x = p[i * 2] + (tz / tl) * side * off;
      const z = p[i * 2 + 1] - (tx / tl) * side * off;
      const ry = Math.atan2(tx, tz) + (side > 0 ? PI : 0);
      if (inCity(x, z, 12) || onField(x, z, 4) || cliffAt(x, z) > -8 || inWater(x, z) || roadDistAt(x, z) < road.width + 1.2 || tunnelOf(x, z, 8) || propBlocked('road_sign', x, z, ry) || builtNear(x, z, 0.8) || Math.abs(heightAt(x, z) - heightAt(p[i * 2], p[i * 2 + 1])) > 1.2) continue;
      const y = heightAt(x, z);
      props.push({ type: 'road_sign', x, y, z, ry, seed: Math.floor(hash2(ri, i, (seed ^ 0x51a9) | 0) * 2) });
      addPropColliders('road_sign', x, y, z, ry, props[props.length - 1]);
      acc = hash2(ri, i + 3, (seed ^ 0x5197) | 0) * 60 - 30;
      side = -side;
    }
  });
  // THE SOUTH PASSAGE MINES ---------------------------------------------------------------------------------------
  // The way through the ground: a drift from the portal on the river's west bank (the picture's second mine entrance,
  // where the track from the quarry ends) down under the river to the one on its east bank, with its galleries, cut and
  // dressed as Blackrock Mine is (mine.js, minedress.js). The mine's yard on the far side: its headframe, the hoist
  // house. The old adits by the quarry and in the yard are sealed. The hydraulic pump is down in the workings - the
  // pump that kept the drift under the river dry - so the passage is the one way to it.
  let mine = null;
  {
    // (the drift's junction and its sump: under the middle of the river where the line between the portals crosses it)
    let under = null;
    for (let t = 0; t <= 1; t += 0.01) {
      const x = lerp(passageW[0], passageE[0], t);
      const z = lerp(passageW[1], passageE[1], t);
      if (!under || riverAt(x, z) < riverAt(...under)) under = [x, z];
    }
    mine = planPassage({ seed, a: { x: passageW[0], z: passageW[1], zone: ZONE.PASSAGE }, b: { x: passageE[0], z: passageE[1], zone: ZONE.PASSAGE }, via: [under], heights, heightAt, roadDistAt, half: HALF, n: N, step: GRID_STEP });
  }
  if (mine) {
    // (the ground out in front of a portal is the mine's yard, trodden bare: no tree grows within 40 m of a mouth on its
    // line - in the woods the forest stood up to the timbers, and the mouth was not to be seen from anywhere)
    for (const p of mine.portals) for (let s = 2; s <= 40; s += 5) clears.push([p.x - p.dx * s, p.z - p.dz * s, 6 + s * 0.12]);
    const n0 = partSpots.length;
    dressMine({ mine, seed, Builder, staticGrid, zone: ZONE.PASSAGE });
    // the pump: in the junction, by the sump, or in the deepest room
    const rm = mine.rooms[0];
    const b = new Builder(rm.x, rm.z, 0, rm.y);
    b.zone = ZONE.PASSAGE;
    const k = (rm.r * 0.8 - 0.6) * Math.SQRT1_2;
    b.partSpot(-k + 0.4, k - 0.2);
    b.partSpot(k - 0.3, -k + 0.5);
    for (let i = n0; i < partSpots.length; i++) partSpots[i].supply = 2;
    // The passage was a way through, kept up till the end: its lamps along the drift (a post at the wall, a lamp that
    // still burns - world.lights 'lamp': a glow and no flame), and the tubs on its rails where the last shift left them
    const m = mine.main;
    const inRoom = (x, z, pad) => mine.rooms.some((r) => Math.hypot(x - r.x, z - r.z) < r.r + pad);
    let side = 1;
    for (let i = 8; i < m.n - 6; i += 9) {
      if (inRoom(m.x[i], m.z[i], 2)) continue;
      const c = Math.min(m.n - 1, i + 1);
      const tl = Math.hypot(m.x[c] - m.x[i - 1], m.z[c] - m.z[i - 1]) || 1;
      const [tx, tz] = [(m.x[c] - m.x[i - 1]) / tl, (m.z[c] - m.z[i - 1]) / tl];
      const lx = m.x[i] + tz * side * (MINE_R - 0.32);
      const lz = m.z[i] - tx * side * (MINE_R - 0.32);
      const lb = new Builder(lx, lz, Math.atan2(tx, tz), m.y[i]);
      lb.zone = ZONE.PASSAGE;
      lb.prop('lantern_post', 0, 0, side > 0 ? -PI / 2 : PI / 2, { seed: i });
      lights.push({ x: lx - tz * side * 0.3, y: m.y[i] + 1.75, z: lz + tx * side * 0.3, kind: 'lamp' });
      side = -side;
    }
    // (and in its rooms: either side of the junction, at the far wall of each gallery's end - where it is clear)
    {
      const jt = [m.x[mine.jx + 1] - m.x[mine.jx - 1], m.z[mine.jx + 1] - m.z[mine.jx - 1]];
      const jl = Math.hypot(...jt) || 1;
      for (const [rk, rm] of mine.rooms.entries()) {
        const spots = rm.kind === 'junction' ? [[jt[1] / jl, -jt[0] / jl], [-jt[1] / jl, jt[0] / jl]] : [[rm.dx, rm.dz]];
        for (const [ux, uz] of spots) {
          const [lx, lz] = [rm.x + ux * (rm.r - 0.45), rm.z + uz * (rm.r - 0.45)];
          const ry = Math.atan2(-ux, -uz);
          if (propBlocked('lantern_post', lx, lz, ry)) continue;
          const fy = mine.floorFor(lx, lz, rm.y + 0.3);
          const lb = new Builder(lx, lz, ry, fy === fy ? fy : rm.y);
          lb.zone = ZONE.PASSAGE;
          lb.prop('lantern_post', 0, 0, 0, { seed: 320 + rk });
          lights.push({ x: lx - ux * 0.3, y: lb.y0 + 1.75, z: lz - uz * 0.3, kind: 'lamp' });
        }
      }
    }
    // (and down each of the galleries off it, two: half way along and near its end, so what is down them reads too)
    for (const [gi, g] of mine.galleries.entries()) {
      for (const f of [0.4, 0.82]) {
        const i = Math.max(1, Math.min(g.n - 2, Math.round((g.n - 1) * f)));
        const tl = Math.hypot(g.x[i + 1] - g.x[i - 1], g.z[i + 1] - g.z[i - 1]) || 1;
        const [tx, tz] = [(g.x[i + 1] - g.x[i - 1]) / tl, (g.z[i + 1] - g.z[i - 1]) / tl];
        const sd = (gi + (f > 0.5 ? 1 : 0)) % 2 ? 1 : -1;
        const lx = g.x[i] + tz * sd * (MINE_R - 0.32);
        const lz = g.z[i] - tx * sd * (MINE_R - 0.32);
        const fy = mine.floorFor(lx, lz, g.y[i] + 0.3);
        const lb = new Builder(lx, lz, Math.atan2(tx, tz), fy === fy ? fy : g.y[i]);
        lb.zone = ZONE.PASSAGE;
        lb.prop('lantern_post', 0, 0, sd > 0 ? -PI / 2 : PI / 2, { seed: 300 + gi * 2 + (f > 0.5 ? 1 : 0) });
        lights.push({ x: lx - tz * sd * 0.3, y: lb.y0 + 1.75, z: lz + tx * sd * 0.3, kind: 'lamp' });
      }
    }
    for (const f of [0.22, 0.47, 0.81]) {
      const i = Math.floor(m.n * f);
      if (inRoom(m.x[i], m.z[i], 2)) continue;
      const c = Math.min(m.n - 1, i + 1);
      const tb = new Builder(m.x[i], m.z[i], Math.atan2(m.x[c] - m.x[i], m.z[c] - m.z[i]), m.y[i]);
      tb.zone = ZONE.PASSAGE;
      // a tub: a steel box on its wheels, on the rails (+Z along the drift)
      tb.box(0, 0.32, 0, 1.0, 0.82, 1.6, 'rust');
      tb.box(0, 1.12, 0, 1.06, 0.06, 1.66, 'metal', { collide: false });
      for (const sx of [-0.45, 0.45]) for (const sz of [-0.5, 0.5]) tb.cyl(sx, 0.16, sz, 0.17, 0.08, 'metal', { sides: 10, rz: PI / 2, collide: false });
    }
  }
  // a sealed adit: a stone face in a mound of rock, boards across its mouth (its +Z into the hill)
  const sealed = (x, z, ry, zone) => {
    const dx = Math.sin(ry);
    const dz = Math.cos(ry);
    const y = heightAt(x, z);
    for (let j = Math.max(0, Math.floor((z - 26 + HALF) / GRID_STEP)); j <= Math.min(N - 1, Math.ceil((z + 26 + HALF) / GRID_STEP)); j++) {
      for (let i = Math.max(0, Math.floor((x - 26 + HALF) / GRID_STEP)); i <= Math.min(N - 1, Math.ceil((x + 26 + HALF) / GRID_STEP)); i++) {
        const vx = -HALF + i * GRID_STEP - x;
        const vz = -HALF + j * GRID_STEP - z;
        const s0 = vx * dx + vz * dz;
        const lat = -vx * dz + vz * dx;
        const e = ((s0 - 12) / 11) ** 2 + (lat / 11) ** 2;
        if (s0 >= 2 && e < 1 && roadDist[j * N + i] > 4) heights[j * N + i] = Math.max(heights[j * N + i], y + 6.5 * (1 - e) * (1 - e));
      }
    }
    const b = new Builder(x, z, ry, y);
    b.zone = zone;
    b.box(0, 0, 3.4, 9, 4.4, 5, 'stone');
    b.box(-6.5, 0, 3, 6, 3.4, 4.5, 'stone', { ry: 0.25 });
    b.box(6.5, 0, 3.2, 6, 3.8, 4.5, 'stone', { ry: -0.2 });
    b.box(0.4, 4.2, 4, 6, 1.2, 3.5, 'stone', { ry: 0.1, collide: false });
    b.box(0, 0, 0.8, 2.6, 2.5, 0.25, 'dark', { collide: false });
    b.box(-1.45, 0, 0.6, 0.3, 2.7, 0.3, 'trim');
    b.box(1.45, 0, 0.6, 0.3, 2.7, 0.3, 'trim');
    b.box(0, 2.7, 0.6, 3.4, 0.3, 0.3, 'trim', { collide: false });
    b.box(0, 0.7, 0.5, 3.1, 0.2, 0.06, 'planks', { rz: 0.12 });
    b.box(0, 1.5, 0.5, 3.1, 0.2, 0.06, 'planks', { rz: -0.1 });
    b.loot(1.6, -1.8);
    b.clear(0, 2, 9);
  };
  {
    const a = P(PLACES.mineA);
    sealed(a[0], a[1], facing(a, P([0.66, 0.818])) + PI, ZONE.AGGREGATES);
  }
  // THE QUARRY'S PIT: what was working in it when it stopped - an excavator on the floor at the face it was digging, a
  // dump truck under it, another on a bench, the belt that carried the stone up to the yard, heaps of it on the benches
  {
    const fy = heightAt(PIT.x, PIT.z);
    const yd = zoneById[ZONE.AGGREGATES];
    const toYard = Math.atan2(yd.x - PIT.x, yd.z - PIT.z); // (the belt runs up toward the yard: +Z of this frame)
    const b = new Builder(PIT.x, PIT.z, toYard, fy);
    b.zone = ZONE.AGGREGATES;
    b.ground = true;
    // THE FACES: under every bench its face of rock, near sheer - blasted, so no two metres of it stand in one plane
    // (each length of it set in or out, a little higher or lower, turned a little), from below the ledge under it to
    // over the one it holds up; none where the haul road comes down, nor under the belt
    {
      const fr = mulberry32((seed ^ 0x9175) >>> 0);
      const [c0, s0] = [Math.cos(toYard), Math.sin(toYard)];
      for (let j = 1; j <= PIT.steps; j++) {
        const target = PIT.r - PIT.bw * (j - 0.085) - 0.6; // (in over the riser's foot: the heightfield's riser is two metres wide)
        const n = Math.round((2 * PI * target) / 3.1);
        const y0 = PIT.top - j * PIT.drop - 0.5 - fy;
        const y1 = PIT.top - (j - 1) * PIT.drop + 0.12 - fy;
        for (let q = 0; q < n; q++) {
          const a = ((q + 0.5) / n) * PI * 2;
          const [sa, ca] = [Math.sin(a), Math.cos(a)];
          // (the radius at which this angle's benches put the face: they wander - pitD)
          let rad = target;
          for (let it = 0; it < 3; it++) rad = target - nE((PIT.x + sa * rad) * 0.05, (PIT.z + ca * rad) * 0.05) * 3;
          const [wx, wz] = [PIT.x + sa * rad, PIT.z + ca * rad];
          const ramp = pitRamp(wx, wz, target);
          const r1 = fr();
          const r2 = fr();
          const r3 = fr();
          if ((ramp && ramp[0] > -0.05 && ramp[1] < PIT.hw + 4.5) || (Math.abs(Math.sin(a - toYard) * rad) < 2.2 && Math.cos(a - toYard) > 0)) continue;
          const lx = c0 * (wx - PIT.x) - s0 * (wz - PIT.z);
          const lz = s0 * (wx - PIT.x) + c0 * (wz - PIT.z);
          const len = ((2 * PI * rad) / n) * (1.12 + r1 * 0.2);
          const inset = (r2 - 0.5) * 0.8;
          // (its top knee high over the ledge it holds up as that ledge is here: a lip of rock along the bench's edge, too
          // high for a wheel to ride up onto - along the tops, off the end of one, a vehicle dropped into the face below -
          // and no higher: the benches wander, and where one ran low a face stood up out of it a metre)
          const out = rad + inset + 1; // (its outer side: where the ledge it holds up begins)
          let ledge = -Infinity; // (the ledge's highest along the face's length, just outside it)
          for (const t of [-0.5, 0, 0.5]) for (const o of [out, out + 0.7]) ledge = Math.max(ledge, heightAt(PIT.x + Math.sin(a + (t * len) / rad) * o, PIT.z + Math.cos(a + (t * len) / rad) * o));
          const top = ledge - fy + 0.45;
          // (mined for stone, as a boulder is, and richer: COL.QUARRY)
          b.box(lx * (1 + inset / rad), y0, lz * (1 + inset / rad), len, Math.max(0.5, top - y0), 2.0, 'stone_rough', { ry: a - toYard + (r3 - 0.5) * 0.18, flags: COL.STATIC | COL.ROCK | COL.QUARRY });
        }
      }
    }
    // standing water on the floor, where it is lowest
    {
      const pr = mulberry32((seed ^ 0x2b07) >>> 0);
      for (let q = 0; q < 7; q++) {
        const a = pr() * PI * 2;
        const r = 4 + pr() * (PIT.floor - 9);
        const [lx, lz] = [Math.sin(a) * r, Math.cos(a) * r];
        // (each two or three pools run together: no puddle is a circle)
        for (let m = 0; m < 3; m++) b.cyl(lx + (pr() - 0.5) * 2.6, 0.03 + m * 0.002, lz + (pr() - 0.5) * 2.6, 0.8 + pr() * 1.6, 0.02, 'puddle', { sides: 9, ry: pr() * 3, collide: false });
      }
    }
    // the excavator, a mining shovel the size of a house: its tracks, the house on them with the cab and the engine,
    // the boom and the stick down to a bucket bigger than a car, resting on the floor at the face
    {
      const e = b.sub(-4, -9, 0.5);
      e.ground = true;
      for (const sd of [-1, 1]) e.box(sd * 3.6, 0, 0, 2.2, 2.4, 12, 'charred');
      e.box(0, 2.4, 0, 8, 0.9, 8, 'rust');
      e.box(0, 3.3, 1.2, 7.4, 4.4, 7.6, 'tin_rust'); // the house
      e.box(-2.4, 7.7, -1.8, 2.4, 2.6, 2.6, 'tin', { collide: false }); // the cab
      e.box(1.2, 7.7, 3.4, 3, 1.6, 2.6, 'charred', { collide: false }); // (its engine's hood)
      e.box(1.2, 7.4, -6.2, 1.8, 1.8, 11, 'rust', { rx: -0.62, collide: false }); // the boom
      e.box(1.2, 4.0, -12.6, 1.4, 1.4, 7.4, 'rust', { rx: 0.5, collide: false }); // the stick
      e.box(1.2, 0, -14.6, 4.2, 2.8, 3.4, 'metal'); // the bucket
    }
    // the haul truck that was being loaded: a dump body as long as a bus on six wheels taller than a man
    {
      const t = b.sub(9, -12, 2.4);
      t.ground = true;
      for (const [wx, wz] of [[-3.2, -4], [3.2, -4], [-3.2, 3], [3.2, 3], [-2.1, 3], [2.1, 3]]) t.cyl(wx, 0, wz, 1.6, 1.4, 'charred', { sides: 10 });
      t.box(0, 1.2, -0.4, 6, 1.4, 11, 'rust'); // the chassis
      t.box(0, 2.6, 1.0, 6.4, 3.2, 8.6, 'tin_rust'); // the dump body
      t.box(-1.6, 2.6, -4.6, 2.6, 2.8, 2.4, 'tin', { collide: false }); // the cab
    }
    // the belt: a long trough up out of the pit to its rim, on legs
    const top = PIT.top - fy;
    const run = PIT.r + 6;
    const tilt = Math.atan2(top, run);
    b.box(0, top / 2 + 1.2, run / 2, 1.4, 0.5, Math.hypot(run, top), 'rust', { rx: -tilt, collide: false });
    for (let k = 0; k <= 14; k++) {
      const lz = (run * k) / 14;
      const ly = (top * k) / 14;
      const g = heightAt(b.wx(0, lz), b.wz(0, lz)) - fy;
      if (ly + 1 - g > 0.3) for (const sd of [-0.6, 0.6]) b.box(sd, g, lz, 0.25, ly + 1 - g, 0.25, 'rust');
    }
    // heaps of stone on the floor and the benches
    const bench = (k) => PIT.r - ((k - 0.55) * (PIT.r - PIT.floor)) / PIT.steps; // (the middle of bench k: 1 the top one)
    for (const [k, a, t] of [[0, 0.9, 'gravel_pile'], [0, 5.0, 'rubble_pile'], [1, 1.2, 'gravel_pile'], [2, 4.4, 'gravel_pile'], [3, 0.4, 'rubble_pile'], [4, 5.4, 'gravel_pile'], [2, 2.6, 'rubble_pile']]) {
      if (k) continue; // (the benches' ledges are narrow between their faces: heaps only on the floor)
      const r = 17; // (on the floor: clear of the shovel and the truck)
      const x = b.wx(Math.sin(a) * r, Math.cos(a) * r);
      const z = b.wz(Math.sin(a) * r, Math.cos(a) * r);
      if (propBlocked(t, x, z, a)) continue;
      const py = heightAt(x, z);
      props.push({ type: t, x, y: py, z, ry: a, seed: k });
      addPropColliders(t, x, py, z, a, props[props.length - 1]);
    }
    {
      const r = bench(2);
      const x = b.wx(Math.sin(3.4) * r, Math.cos(3.4) * r);
      const z = b.wz(Math.sin(3.4) * r, Math.cos(3.4) * r);
      const t2 = new Builder(x, z, toYard + 3.4 + PI / 2, heightAt(x, z));
      t2.zone = ZONE.AGGREGATES;
      t2.ground = true;
      if (levelUnder('dump_truck', x, z, t2.ry) && fits(t2, 'dump_truck', 0, 0, 0)) t2.wreck('dump_truck', 0, 0, 0, { trunk: false, seed: 1 });
    }
    b.loot(-2, -12);
    b.clear(0, 0, PIT.r);
  }
  // the yard: the headframe over the old shaft, the hoist house, the adit in the hillside behind them (sealed)
  place(ZONE.PASSAGE, (b) => {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(-8 + sx * 2.4, 0, 4 + sz * 2.4, 0.5, 16, 0.5, 'rust');
    for (const y of [4, 8, 12]) b.box(-8, y, 4, 5.4, 0.3, 5.4, 'rust', { collide: false });
    b.box(-8, 16, 4, 6.4, 0.6, 6.4, 'rust', { collide: false });
    b.cyl(-8, 16.6, 4, 2.2, 0.4, 'metal', { sides: 16, rx: PI / 2, collide: false }); // (the sheave wheel)
    b.box(-8, 0, 4, 3.2, 0.5, 3.2, 'planks'); // (boards over the shaft)
    const R = groundRoom(b, 9, 2, 12, 9, 4, 'brick', { n: [door(6, 1.6), win(2.4, 1.4), win(9.6, 1.4)], w: [win(4.5)] }, { roof: 'flat', roofMat: 'tin', floorMat: 'concrete' });
    void R;
    b.box(10, 0.12, 4.4, 4, 1.6, 2.4, 'metal'); // (the winding engine)
    b.cont(CONT.TOOLBOX, 5.6, 5.4, { prop: 'toolbox', ry: 0.6, nocollide: true, ly: 0.12 });
    b.cont(CONT.LOCKER, 14.5, 5.2, { prop: 'locker', ry: -PI / 2, ly: 0.12 });
    b.loot(7, 0.4, 0.14);
    for (const [lx, lz, r] of [[-16, -6, 0.4], [-2, -10, 1.2]]) b.prop('cart', lx, lz, r);
    for (const rx of [-0.45, 0.45]) b.box(-8 + rx, 0, -6, 0.08, 0.1, 14, 'rust', { collide: false });
    b.prop('gravel_pile', 16, -12, 0.3);
    b.prop('lantern_post', -3, -4, 0);
    b.prop('barrel', 3, -8, 0);
    b.cont(CONT.CRATE, -14, 10, { prop: 'crate', ry: 0.3 });
    b.prop('corpse', 0, -4, 1.2, { nocollide: true });
    b.loot(-12, -8);
  });
  {
    const zn = zoneById[ZONE.PASSAGE];
    sealed(zn.x + 6, zn.z - 22, PI, ZONE.PASSAGE);
  }

  // hoardings along the main roads out of the city, on the side their power line is not: the army's, and what was
  // being sold
  for (const main of roads.filter((r) => r.kind === ROAD.ASPHALT && r.width === 3.6)) {
    const p = main.pts;
    const CELLS = ['evac', 'billboard_a', 'quarantine', 'billboard_b', 'evac'];
    let acc = 60;
    let n = 0;
    for (let i = 12; i < p.length / 2 - 12; i++) {
      acc += Math.hypot(p[i * 2] - p[i * 2 - 2], p[i * 2 + 1] - p[i * 2 - 1]);
      const x = p[i * 2];
      const z = p[i * 2 + 1];
      if (acc < 140 || nearZone(x, z, 16) || inCity(x, z, 30) || onField(x, z, 10) || riverAt(x, z) < 30 || tunnelOf(x, z, 16) || cliffAt(x, z) > -14) continue;
      const tx = p[i * 2 + 2] - p[i * 2 - 2];
      const tz = p[i * 2 + 3] - p[i * 2 - 1];
      const tl = Math.hypot(tx, tz) || 1;
      const px = x - (-tz / tl) * (main.width + 5.4);
      const pz = z - (tx / tl) * (main.width + 5.4);
      const dir = Math.atan2(tx, tz) + 0.25; // (its face to what comes out of the city)
      if (propBlocked('billboard', px, pz, dir) || sites.some((s) => Math.hypot(s.x - px, s.z - pz) < 9) || homes.some((o) => Math.hypot(o.x - px, o.z - pz) < 16)) continue;
      acc = 0;
      const py = seatY('billboard', px, pz, dir);
      if (heightAt(px, pz) - py > 0.5 || py - heightAt(px, pz) > 0.05) continue; // (not on a slope its legs would stand down, nor over a dip)
      props.push({ type: 'billboard', x: px, y: py, z: pz, ry: dir, seed: i });
      addPropColliders('billboard', px, py, pz, dir, props[props.length - 1]);
      const cell = CELLS[n++ % CELLS.length];
      signs.push({ x: px - Math.sin(dir) * 0.3, y: py + 4.9, z: pz - Math.cos(dir) * 0.3, ry: dir, w: 5.4, h: 2.6, cell, far: true });
    }
  }
  // power poles along the main roads, where nothing stands in their way
  for (const main of roads.filter((r) => r.kind === ROAD.ASPHALT && r.width === 3.6)) {
    const p = main.pts;
    for (let i = 12; i < p.length / 2 - 12; i += 18) {
      const x = p[i * 2];
      const z = p[i * 2 + 1];
      if (nearZone(x, z, 10) || onField(x, z, 0) || tunnelOf(x, z, 12) || cliffAt(x, z) > -12) continue;
      const tx = p[i * 2 + 2] - p[i * 2 - 2];
      const tz = p[i * 2 + 3] - p[i * 2 - 1];
      const tl = Math.hypot(tx, tz) || 1;
      const px = x + (-tz / tl) * (main.width + 3);
      const pz = z + (tx / tl) * (main.width + 3);
      const dir = Math.atan2(-tx, -tz);
      if (propBlocked('power_pole', px, pz, dir) || sites.some((s) => Math.hypot(s.x - px, s.z - pz) < 8) || homes.some((o) => Math.hypot(o.x - px, o.z - pz) < 14) || nearZone(px, pz, 22)) continue;
      const py = seatY('power_pole', px, pz, dir);
      if (heightAt(px, pz) - py > 0.4) continue; // (on the slope of a cutting or a rim it stood sunk to its knees)
      props.push({ type: 'power_pole', x: px, y: py, z: pz, ry: dir, seed: i });
      addPropColliders('power_pole', px, py, pz, dir, props[props.length - 1]);
    }
  }

  // ---------------------------------------------------------------- vegetation
  // The forest where the picture has it (forestAt: thick enough to be a wall off the roads where it is dense), thinner
  // up the mountains' flanks and none on their heights; a tree here and there in the open. Nothing grows on the
  // city's paving but what has broken through it (the dead trees the blocks plant with Builder.tree).
  // (what is taken, as a bitmap of 1 m cells: a disc is set into it, and a disc asked about is clear when no cell of it
  // is set - one lookup per cell, where a list of discs was 25 lists searched for every tree tried)
  const OS = SIZE;
  let occ = new Uint8Array(OS * OS);
  const occupied = (x, z, r) => {
    const i0 = Math.max(0, Math.floor(x - r + HALF));
    const i1 = Math.min(OS - 1, Math.floor(x + r + HALF));
    const j0 = Math.max(0, Math.floor(z - r + HALF));
    const j1 = Math.min(OS - 1, Math.floor(z + r + HALF));
    const r2 = (r + 0.71) ** 2;
    for (let j = j0; j <= j1; j++) {
      const dz = j + 0.5 - HALF - z;
      for (let i = i0; i <= i1; i++) {
        const dx = i + 0.5 - HALF - x;
        if (occ[j * OS + i] && dx * dx + dz * dz < r2) return true;
      }
    }
    return false;
  };
  const occupy = (x, z, r) => {
    const i0 = Math.max(0, Math.floor(x - r + HALF));
    const i1 = Math.min(OS - 1, Math.floor(x + r + HALF));
    const j0 = Math.max(0, Math.floor(z - r + HALF));
    const j1 = Math.min(OS - 1, Math.floor(z + r + HALF));
    for (let j = j0; j <= j1; j++) {
      const dz = j + 0.5 - HALF - z;
      for (let i = i0; i <= i1; i++) {
        const dx = i + 0.5 - HALF - x;
        if (dx * dx + dz * dz < r * r) occ[j * OS + i] = 1;
      }
    }
    const ci = Math.floor(x + HALF);
    const cj = Math.floor(z + HALF);
    if (ci >= 0 && cj >= 0 && ci < OS && cj < OS) occ[cj * OS + ci] = 1;
  };
  for (const p of props) occupy(p.x, p.z, Math.max(2.5, Math.hypot(...(PROPS[p.type]?.size || [2, 0, 2]).filter((_, i) => i !== 1)) / 2 + 0.6));
  for (const [x, z, r] of clears) occupy(x, z, Math.min(r, 6));
  // (what is to be kept clear, in 16 m cells: thousands of them, asked of by every tree and rock tried)
  let clearCells = null;
  const clearHit = (x, z, pad) => {
    if (!clearCells) {
      clearCells = new Map();
      for (const c of clears) {
        const e = c[2] + 1; // (pads are up to 1 m)
        for (let i = Math.floor((c[0] - e) / 16); i <= Math.floor((c[0] + e) / 16); i++) {
          for (let j = Math.floor((c[1] - e) / 16); j <= Math.floor((c[1] + e) / 16); j++) {
            const k = i * 65536 + j;
            if (!clearCells.has(k)) clearCells.set(k, []);
            clearCells.get(k).push(c);
          }
        }
      }
    }
    const arr = clearCells.get(Math.floor(x / 16) * 65536 + Math.floor(z / 16));
    return !!arr && arr.some(([cx, cz, r]) => (x - cx) ** 2 + (z - cz) ** 2 < (r + pad) ** 2);
  };
  const zoneClear = (x, z) => zones.some((zn) => (x - zn.x) ** 2 + (z - zn.z) ** 2 < zn.clear * zn.clear) || onField(x, z, 6);
  const onRoad = (x, z, r) => roadDistAt(x, z) < (roadKindAt(x, z) === ROAD.TRAIL ? 2.2 : 5.5) + r;
  // does a trunk or a boulder of radius r at (x, z) stand in an upright piece somebody built (a wall, a post)?
  let partCells = null;
  const partBlocked = (x, z, r) => {
    if (!partCells) {
      partCells = new Map();
      for (const p of parts) {
        if (p.rx || p.rz || p.sy < 1 || (p.shape !== 'box' && p.shape !== 'cyl')) continue;
        const e = Math.hypot(p.sx, p.sz) / 2;
        for (let i = Math.floor((p.x - e) / 8); i <= Math.floor((p.x + e) / 8); i++) {
          for (let j = Math.floor((p.z - e) / 8); j <= Math.floor((p.z + e) / 8); j++) {
            const k = i * 65536 + j;
            if (!partCells.has(k)) partCells.set(k, []);
            partCells.get(k).push(p);
          }
        }
      }
    }
    for (let i = Math.floor((x - r) / 8); i <= Math.floor((x + r) / 8); i++) {
      for (let j = Math.floor((z - r) / 8); j <= Math.floor((z + r) / 8); j++) {
        for (const p of partCells.get(i * 65536 + j) || []) {
          if (p.shape === 'cyl') {
            if (Math.hypot(p.x - x, p.z - z) < r + p.sx / 2) return true;
          } else {
            const c = Math.cos(p.ry);
            const s = Math.sin(p.ry);
            const lx = c * (x - p.x) - s * (z - p.z);
            const lz = s * (x - p.x) + c * (z - p.z);
            if (Math.hypot(Math.max(0, Math.abs(lx) - p.sx / 2), Math.max(0, Math.abs(lz) - p.sz / 2)) < r) return true;
          }
        }
      }
    }
    return false;
  };
  let trees = [];
  // (the woods, the boulders and the bushes are dealt from dice of their own, one set to every cell of the forest's
  // grid and to every boulder or bush tried - a hash of the seed, the cell or the try and the draw - and not from the
  // world's stream: a mountain or a clearing changed in one place changes the trees there and nowhere else, where
  // with the stream every tree dealt after it was dealt anew)
  const VSEED = (seed ^ 0x6a09e6) | 0;
  const die = (i, j, k) => hash2(i, j, (VSEED + Math.imul(k, 0x9e3779b1)) | 0);
  // (solid: in the collider grid, as on the island. A tree up a mountain, past its wall, is out of everybody's reach and
  // is drawn and nothing else: no collider)
  const pushTree = (x, z, v, scale, solid = true) => {
    const y = heightAt(x, z);
    const rot = die(Math.round(x * 16), Math.round(z * 16), 77) * PI * 2;
    occupy(x, z, 1.0 * scale);
    if (!solid) {
      trees.push(x, y, z, scale, rot, v);
      return;
    }
    if (partBlocked(x, z, TREE_R[v] * scale + 0.15)) return; // (left out after its draws, as on the island)
    const c = makeTree(x, z, y - 1, y + 14 * scale, TREE_R[v] * scale, v, trees.length / 6);
    trees.push(x, y, z, scale, rot, v);
    staticGrid.add(c);
  };
  for (const [x, z, v, s] of extraTrees) if (!occupied(x, z, 1.2) && !inWater(x, z)) pushTree(x, z, v, s);
  // THE CRAGS: the cliffs are no smooth bank. Along the foot of every one, every few metres, a rib, a buttress with
  // its lip hanging out over the foot, a spire or a shelf of rock stands up out of the face, with the gully between
  // one and the next; up the faces, ledges and buttresses where the ground is steep; and on the lowest metres of the
  // face, small trees that have taken hold. All of it inside the mountain's wall (each crag set in from the line by
  // its own reach at its foot): drawn, never walked to, no collider - as a tree up a mountain. [x, y, z, scale, ry,
  // variant] as the rocks are; the variants (client/render/models/vegetation.js getCragVariants): 0 rib, 1 buttress,
  // 2 spire, 3 shelf, and how far each reaches out from its middle at its foot (CRAG_R)
  const CRAG_R = [2.3, 3.6, 1.4, 3.0];
  const CRAG_H = [13.5, 9.6, 14.8, 2.7]; // (how high each stands over its foot)
  const CRAG_COL = [[[0, 0, 1.9]], [[-1.7, 0.2, 2.1], [1.7, 0.2, 2.1]], [[0, 0, 1.25]], [[0, 0, 2.3]]]; // ([x, z, r] of its own frame)
  const crags = [];
  {
    const inward = (x, z) => {
      const gx = cliffAt(x + 2, z) - cliffAt(x - 2, z);
      const gz = cliffAt(x, z + 2) - cliffAt(x, z - 2);
      const l = Math.hypot(gx, gz) || 1;
      return [gx / l, gz / l];
    };
    const putCrag = (x, z, v, scale, sink, baseY = heightAt(x, z)) => {
      const [ix, iz] = inward(x, z);
      // (its front, -Z, turned out of the mountain, give or take)
      const ry = Math.atan2(ix, iz) + (die(Math.round(x * 4), Math.round(z * 4), 51) - 0.5) * 0.7;
      crags.push(x, baseY - sink * scale, z, scale, ry, v);
      occupy(x, z, CRAG_R[v] * scale * 0.8);
    };
    let a = 0;
    for (const line of walls) {
      let carry = 0;
      for (let k = 0; k + 1 < line.length; k++) {
        const [ax, az] = line[k];
        const [bx, bz] = line[k + 1];
        const len = Math.hypot(bx - ax, bz - az);
        let t = carry;
        while (t < len) {
          a++;
          const x0 = ax + ((bx - ax) * t) / len;
          const z0 = az + ((bz - az) * t) / len;
          t += 5 + die(a, 7, 41) * 6;
          if (tunnelOf(x0, z0, 14) || die(a, 7, 42) < 0.12) continue; // (a gully: nothing stands out of it)
          const r = die(a, 7, 43);
          const v = r < 0.42 ? 0 : r < 0.68 ? 1 : r < 0.84 ? 2 : 3;
          const scale = 0.75 + die(a, 7, 44) * 0.6;
          const [ix, iz] = inward(x0, z0);
          // (standing out of the foot of the face, its back in the face: what stands out past the mountain's wall is
          // solid - CRAG_COL, cylinders over its footprint, as a boulder's - and none comes near a road or a place)
          const back = 0.2 + die(a, 7, 45) * 1.1;
          const [x, z] = [x0 + ix * back, z0 + iz * back];
          const reach = CRAG_R[v] * scale + 1;
          if (inWater(x, z) || onRoad(x, z, reach + 0.6) || zoneClear(x, z) || clearHit(x, z, reach) || onField(x, z, reach + 4) || partBlocked(x, z, reach)) continue;
          const y0 = heightAt(x0, z0) - (v === 3 ? 0.4 : v === 2 ? 1.0 : 1.2) * scale;
          putCrag(x, z, v, scale, 0, y0);
          {
            const ry = crags[crags.length - 2];
            const [c, sn] = [Math.cos(ry), Math.sin(ry)];
            for (const [lx, lz, r] of CRAG_COL[v]) staticGrid.add(makeCyl(x + (c * lx + sn * lz) * scale, z + (-sn * lx + c * lz) * scale, y0 - 1, y0 + CRAG_H[v] * scale, r * scale, COL.STATIC));
          }
          // (and now and then a small tree on the face beside it, rooted in a crack)
          if (die(a, 7, 47) < 0.3) {
            const tb = 0.6 + die(a, 7, 48) * 2.2;
            const [tx, tz] = [x0 + ix * tb - iz * 2.2, z0 + iz * tb + ix * 2.2];
            if (cliffAt(tx, tz) > 0.4 && !tunnelOf(tx, tz, 10) && !occupied(tx, tz, 0.8)) pushTree(tx, tz, die(a, 7, 49) < 0.6 ? 0 : 5, 0.5 + die(a, 7, 50) * 0.3, false);
          }
        }
        carry = t - len;
      }
    }
    // up the faces: ledges and buttresses where the ground stands steep, to well over the tree line
    for (let j = 0; j < SIZE / 12; j++) {
      for (let i = 0; i < SIZE / 12; i++) {
        const x = -HALF + (i + die(i, j, 61)) * 12;
        const z = -HALF + (j + die(i, j, 62)) * 12;
        const d = cliffAt(x, z);
        if (d < 9 || d > 170 || die(i, j, 63) > 0.45) continue;
        const y = heightAt(x, z);
        const steep = Math.abs(heightAt(x + 3, z) - heightAt(x - 3, z)) + Math.abs(heightAt(x, z + 3) - heightAt(x, z - 3));
        if (steep < 5 || y > 245 || tunnelOf(x, z, 14)) continue;
        // (from far off a face is read by what is the size of a house and more: the higher, the bigger)
        const r = die(i, j, 64);
        const v = r < 0.4 ? 3 : r < 0.7 ? 1 : r < 0.9 ? 0 : 2;
        putCrag(x, z, v, (0.9 + die(i, j, 65) * 0.9) * (1 + Math.min(1, d / 80)), v === 3 ? 1.0 : v === 1 ? 2.0 : 3.0);
      }
    }
  }
  const LIM = HALF - 4;
  // The forest: one tree at the most to every TREE_CELL square, jittered in it, with the forest's density for its
  // chance: where the picture's woods are dense a tree every 3-4 m, a wall off the roads. Up a mountain the woods thin
  // with the height and stop at the tree line; on a face too steep for them, none.
  // CLEARINGS in the woods: in about two 96 m squares of five a round opening 9-18 m across where no tree stands - grass,
  // a deadfall, a rock or two (below) - so the woods are no even wall (dice of their own, by the square)
  const CLR = 96;
  const clearingAt = (x, z) => {
    const ci = Math.floor((x + HALF) / CLR), cj = Math.floor((z + HALF) / CLR);
    for (let i = ci - 1; i <= ci + 1; i++) for (let j = cj - 1; j <= cj + 1; j++) {
      if (die(i, j, 101) > 0.42) continue;
      const cx = -HALF + (i + 0.2 + die(i, j, 102) * 0.6) * CLR, cz = -HALF + (j + 0.2 + die(i, j, 103) * 0.6) * CLR;
      const r = 9 + die(i, j, 104) * 9;
      if ((x - cx) ** 2 + (z - cz) ** 2 < r * r) return [cx, cz, r, i, j];
    }
    return null;
  };
  const TREE_CELL = 3.2;
  const TREE_LINE = 150;
  const MOUNTAIN_VERGE = 10;
  const TREES_N = Math.floor((LIM * 2) / TREE_CELL);
  for (let tj = 0; tj < TREES_N; tj++) {
    for (let ti = 0; ti < TREES_N; ti++) {
      const x = -LIM + (ti + die(ti, tj, 1)) * TREE_CELL;
      const z = -LIM + (tj + die(ti, tj, 2)) * TREE_CELL;
      const r0 = die(ti, tj, 3);
      const f = forestAt(x, z);
      const up = cliffAt(x, z);
      const dens = up > 0 ? Math.max(f, 0.4) * 0.7 * (1 - smoothstep(8, 70, up)) : Math.max(0.02, f ** 1.15 * 0.8);
      if (r0 > dens) continue;
      const scale = 0.75 + die(ti, tj, 4) * 0.55;
      const r = die(ti, tj, 5);
      // (and none on the verge along a mountain's foot, MOUNTAIN_VERGE m of scree out from its wall: in the thick woods
      // a strip a vehicle's width wide was left between the trees and the wall, a trap a car drove into and could not
      // turn in - west of North Pass it wedged the car on two rolls of the woods in five)
      if (seaAt(x, z) > -4 || inWater(x, z) || (up > -MOUNTAIN_VERGE && up < CLIFF_IN + 1)) continue;
      if (up > 0) {
        const y = heightAt(x, z);
        if (y > TREE_LINE + (r0 - 0.5) * 30 || Math.abs(heightAt(x + 2, z) - heightAt(x - 2, z)) + Math.abs(heightAt(x, z + 2) - heightAt(x, z - 2)) > 7 || tunnelOf(x, z, 6) || occupied(x, z, 0.9 * scale)) continue;
        pushTree(x, z, r < 0.34 ? 0 : r < 0.62 ? 1 : r < 0.8 ? 2 : r < 0.9 ? 5 : 6, scale, false);
        continue;
      }
      if (zoneClear(x, z) || onRoad(x, z, 0.6) || clearHit(x, z, 0.8) || tunnelOf(x, z, 4) || occupied(x, z, 1.1 * scale)) continue;
      if (f > 0.35 && clearingAt(x, z)) continue;
      pushTree(x, z, r < 0.28 ? 0 : r < 0.5 ? 1 : r < 0.66 ? 2 : r < 0.84 ? 5 : r < 0.9 ? 6 : r < 0.96 ? 3 : 4, scale);
    }
  }
  let rocks = [];
  for (let a = 0; a < 5200 && rocks.length < 1300 * 6; a++) {
    const x = -LIM + die(a, 0, 11) * LIM * 2;
    const z = -LIM + die(a, 0, 12) * LIM * 2;
    const up = cliffAt(x, z);
    // (most at the feet of the cliffs, where they came down)
    if (up < -30 && die(a, 0, 13) < 0.7) continue;
    if (zoneClear(x, z) || onRoad(x, z, 1.2) || inWater(x, z) || clearHit(x, z, 1) || tunnelOf(x, z, 4) || (up > -2 && up < CLIFF_IN + 1)) continue;
    if (Math.hypot(x - head.x, z - head.z) < 110) continue; // (the bridgehead's fields, where the car is first driven off, are clear of them)
    const v = Math.min(ROCK_R.length - 1, Math.floor(die(a, 0, 14) * ROCK_R.length));
    const scale = 0.6 + die(a, 0, 15) * 1.2;
    const r = ROCK_R[v] * scale;
    if (occupied(x, z, r + 0.5) || partBlocked(x, z, r + 0.3)) continue;
    const y = heightAt(x, z) - 0.25 * scale;
    occupy(x, z, r);
    rocks.push(x, y, z, scale, die(a, 0, 16) * PI * 2, v);
    staticGrid.add(makeCyl(x, z, y - 1, y + r * 0.9, r * 0.85, COL.STATIC | COL.ROCK));
  }
  // the boulders that came down off the faces: a field of them along every mountain's foot, on its verge of scree
  for (let a = 0, n = 0; a < 14000 && n < 2200; a++) {
    const x = -LIM + die(a, 2, 31) * LIM * 2;
    const z = -LIM + die(a, 2, 32) * LIM * 2;
    const up = cliffAt(x, z);
    if (up < -MOUNTAIN_VERGE + 1 || up > -2) continue;
    if (zoneClear(x, z) || onRoad(x, z, 2) || inWater(x, z) || clearHit(x, z, 1) || tunnelOf(x, z, 6)) continue;
    const v = Math.min(ROCK_R.length - 1, Math.floor(die(a, 2, 33) * ROCK_R.length));
    const scale = 1.1 + die(a, 2, 34) * 1.9;
    const r = ROCK_R[v] * scale;
    if (occupied(x, z, r + 0.4) || partBlocked(x, z, r + 0.3)) continue;
    const y = heightAt(x, z) - 0.3 * scale;
    occupy(x, z, r);
    rocks.push(x, y, z, scale, die(a, 2, 35) * PI * 2, v);
    staticGrid.add(makeCyl(x, z, y - 1, y + r * 0.9, r * 0.85, COL.STATIC | COL.ROCK));
    n++;
  }
  // WHAT LIES IN THE WOODS: outcrops of rock, a few boulders shouldered together; deadfall - a trunk come down in
  // lengths - in the clearings and among the trees (solid, as boulders and logs are: their colliders)
  {
    const solidOK = (x, z, r) => !(zoneClear(x, z) || onRoad(x, z, r + 1) || inWater(x, z) || clearHit(x, z, r) || tunnelOf(x, z, 6) || cliffAt(x, z) > -12 || occupied(x, z, r) || partBlocked(x, z, r) || Math.hypot(x - head.x, z - head.z) < 110 || !reachAt(x, z));
    for (let a = 0, n = 0; a < 9000 && n < 420; a++) {
      const x = -LIM + die(a, 5, 111) * LIM * 2;
      const z = -LIM + die(a, 5, 112) * LIM * 2;
      if (forestAt(x, z) < 0.35 || !solidOK(x, z, 3.5)) continue;
      const k = 2 + Math.floor(die(a, 5, 113) * 3);
      for (let q = 0; q < k; q++) {
        const ang = die(a, q, 114) * PI * 2, dd = q ? 1.4 + die(a, q, 115) * 1.6 : 0;
        const rx = x + Math.cos(ang) * dd, rz = z + Math.sin(ang) * dd;
        const v = Math.min(ROCK_R.length - 1, Math.floor(die(a, q, 116) * ROCK_R.length));
        const scale = (q ? 0.9 : 1.6) + die(a, q, 117) * 0.9;
        const rr = ROCK_R[v] * scale;
        if (q && (occupied(rx, rz, rr * 0.5) || onRoad(rx, rz, rr + 1))) continue;
        const ry0 = heightAt(rx, rz) - 0.3 * scale;
        rocks.push(rx, ry0, rz, scale, die(a, q, 118) * PI * 2, v);
        staticGrid.add(makeCyl(rx, rz, ry0 - 1, ry0 + rr * 0.9, rr * 0.85, COL.STATIC | COL.ROCK));
      }
      occupy(x, z, 3.5);
      n++;
    }
    for (let a = 0, n = 0; a < 12000 && n < 520; a++) {
      const x = -LIM + die(a, 6, 121) * LIM * 2;
      const z = -LIM + die(a, 6, 122) * LIM * 2;
      const inClr = clearingAt(x, z);
      if ((!inClr && (forestAt(x, z) < 0.3 || die(a, 6, 123) < 0.6)) || !solidOK(x, z, 2.8)) continue;
      const ry = die(a, 6, 124) * PI;
      const [ux, uz] = [Math.sin(ry), Math.cos(ry)];
      const lengths = 1 + Math.floor(die(a, 6, 125) * 2);
      let ok = true;
      for (let q = 0; q <= lengths; q++) if (occupied(x + ux * q * 2.1, z + uz * q * 2.1, 0.6) || onRoad(x + ux * q * 2.1, z + uz * q * 2.1, 1.5)) ok = false;
      if (!ok) continue;
      for (let q = 0; q <= lengths; q++) {
        const [lx, lz] = [x + ux * q * 2.15, z + uz * q * 2.15];
        const lry = ry + (die(a, q, 126) - 0.5) * 0.25;
        if (propBlocked('log_bench', lx, lz, lry)) break;
        const hs = [[ux, uz], [-ux, -uz], [uz * 0.3, -ux * 0.3], [-uz * 0.3, ux * 0.3]].map(([dx, dz]) => heightAt(lx + dx * 1.1, lz + dz * 1.1));
        if (Math.max(...hs) - Math.min(...hs) > 0.45) break; // (only where it lies along level ground)
        const y0 = Math.min(...hs);
        props.push({ type: 'log_bench', x: lx, y: y0, z: lz, ry: lry, seed: q });
        addPropColliders('log_bench', lx, y0, lz, lry, props[props.length - 1]);
      }
      occupy(x + ux * lengths, z + uz * lengths, lengths * 1.2 + 1);
      n++;
    }
  }
  let bushes = [];
  for (let a = 0; a < 70000; a++) {
    const x = -LIM + die(a, 1, 21) * LIM * 2;
    const z = -LIM + die(a, 1, 22) * LIM * 2;
    if (roadDistAt(x, z) < 4 || inWater(x, z) || onField(x, z, 0) || cliffAt(x, z) > 40) continue;
    const zn = nearZone(x, z, -8);
    if (zn && die(a, 1, 23) < (zn.id === ZONE.CITY ? 0.93 : 0.85)) continue; // (the city is overgrown, but it is still paving)
    if (clearHit(x, z, 0) || occupied(x, z, 0.4)) continue;
    bushes.push(x, heightAt(x, z), z, 0.7 + die(a, 1, 24) * 0.8, die(a, 1, 25) * PI * 2, Math.min(2, Math.floor(die(a, 1, 26) * 3)));
  }

  // undergrowth: ferns and brush where the dense woods meet the open - along the roads through them and round the
  // clearings' edges, where it is seen (deep in the woods it is hidden by the trunks, and it was what the woods' frame
  // cost more than Cody's had)
  for (let a = 0; a < 26000; a++) {
    const x = -LIM + die(a, 8, 131) * LIM * 2;
    const z = -LIM + die(a, 8, 132) * LIM * 2;
    if (forestAt(x, z) < 0.45 || roadDistAt(x, z) < 5 || inWater(x, z) || cliffAt(x, z) > 2 || nearZone(x, z, -4) || clearHit(x, z, 0) || occupied(x, z, 0.5)) continue;
    if (roadDistAt(x, z) > 11) continue; // (along the roads through them only: deep in, the trunks hide it)
    bushes.push(x, heightAt(x, z), z, 0.6 + die(a, 8, 133) * 0.7, die(a, 8, 134) * PI * 2, die(a, 8, 135) < 0.6 ? 1 : Math.floor(die(a, 8, 136) * 3));
  }
  // what came up through the city's paving, down its kerbs and in its yards
  // (a weed in a raised bed stands on its earth: y)
  for (const [x, z, scale, y, v] of weeds) {
    if (y === null && partBlocked(x, z, 0.3)) continue;
    const ry = rng.range(0, PI * 2);
    const vv = rng.int(0, 2);
    bushes.push(x, y ?? heightAt(x, z), z, scale, ry, v ?? vv); // (a hedge is the leafy shrub: v)
  }

  // ---------------------------------------------------------------- spawns
  // (a spot in the woods is only kept if a body can walk out of it: of eight ways out, at least two run 8 m clear of
  // every trunk, boulder and wall. In the thick woods a ring of trunks can close round a spot)
  const solidNear = (x, z, r) => {
    const y = heightAt(x, z);
    for (const c of staticGrid.cellAt(x, z) || []) {
      if (c.y1 < y + 0.3 || c.y0 > y + 1.8) continue;
      const lx = c.c * (x - c.x) - c.s * (z - c.z);
      const lz = c.s * (x - c.x) + c.c * (z - c.z);
      if (c.type === 0 ? Math.abs(lx) < c.hx + r && Math.abs(lz) < c.hz + r : lx * lx + lz * lz < (c.r + r) ** 2) return true;
    }
    return false;
  };
  const WALK_R = 16;
  const WN = WALK_R * 2 + 1;
  const wseen = new Uint8Array(WN * WN);
  const wq = new Int32Array(WN * WN);
  const walkOut = (x, z) => {
    wseen.fill(0);
    let h = 0, t = 0;
    const c = WALK_R * WN + WALK_R;
    wq[t++] = c;
    wseen[c] = 1;
    while (h < t) {
      const k = wq[h++];
      const i = k % WN, j = (k / WN) | 0;
      if ((i - WALK_R) ** 2 + (j - WALK_R) ** 2 >= (WALK_R - 1) ** 2) return true;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const m = (j + dj) * WN + i + di;
        if (wseen[m]) continue;
        wseen[m] = 1;
        const px = x + i + di - WALK_R, pz = z + j + dj - WALK_R;
        if (solidNear(px, pz, 0.4) || inWater(px, pz) || cliffAt(px, pz) > -1) continue;
        wq[t++] = m;
      }
    }
    return false;
  };
  const resourceSpawns = [];
  for (let a = 0; a < 16000 && resourceSpawns.length < 560; a++) {
    const x = rng.range(-LIM + 20, LIM - 20);
    const z = rng.range(-LIM + 20, LIM - 20);
    if (zoneClear(x, z) || inCity(x, z, 12) || inWater(x, z) || occupied(x, z, 0.8) || cliffAt(x, z) > -14 || !reachAt(x, z) || !walkOut(x, z)) continue; // (not on the scree and foothills at a mountain's foot: too steep a pocket there for the dead's grid)
    resourceSpawns.push({ x, y: heightAt(x, z) + 0.02, z, zone: ZONE.FOREST });
  }
  // fallback horde spawns (the horde normally appears round wherever the survivors are): rings round the city and
  // round the airport, on open ground of each side
  const hordeSpawns = [];
  for (const [cx, cz, r0, r1] of [[city.x, city.z, 240, 420], [field.x, field.z, 200, 330]]) {
    for (let i = 0; i < 64; i++) {
      const a = (i / 64) * PI * 2;
      for (let tries = 0; tries < 10; tries++) {
        const r = rng.range(r0, r1);
        const x = cx + Math.sin(a) * r;
        const z = cz + Math.cos(a) * r;
        if (Math.abs(x) > LIM - 10 || Math.abs(z) > LIM - 10 || inWater(x, z) || cliffAt(x, z) > -4 || riverAt(x, z) < RIVER_HW + 6) continue;
        hordeSpawns.push({ x, z });
        break;
      }
    }
  }

  // ---------------------------------------------------------------- the field map
  // Where the field map writes each place's name (the picture's own spots for them, clear of the roads and of each
  // other: label, the middle of the name), which names are of lesser places (minor: smaller letters), which of what is
  // named inside the city (city: written only when the map is zoomed in), and the picture's marks (marks: the town, the
  // church, the industry, the gas station, the airport, the camps, the tunnels' and the mines' mouths, the quarry, the
  // lighthouse, the radio tower and the water tower: client/ui/mapmainland.js).
  {
    const LABEL = {
      [ZONE.BRIDGEHEAD]: [0.178, 0.418],
      [ZONE.INDUSTRIAL]: [0.232, 0.59],
      [ZONE.SUBURB]: [0.458, 0.336],
      [ZONE.WESTGATE]: [0.487, 0.538],
      [ZONE.NORTH_COAST]: [0.242, 0.15],
      [ZONE.TRUCKSTOP]: [0.568, 0.6],
      [ZONE.OUTPOST]: [0.922, 0.188],
      [ZONE.AGGREGATES]: [0.603, 0.858],
      [ZONE.PASSAGE]: [0.846, 0.754],
      [ZONE.SOUTH_FOREST]: [0.54, 0.752],
      [ZONE.LIGHTHOUSE]: [0.108, 0.702],
      [ZONE.CITY]: [0.346, 0.43],
    };
    const MINOR = [ZONE.BRIDGEHEAD, ZONE.LIGHTHOUSE, ZONE.MARINA, ZONE.LOGGING, ZONE.FIREHOUSE, ZONE.TERMINAL, ZONE.HANGARS, ZONE.FUEL_DEPOT];
    for (const zn of zones) {
      if (LABEL[zn.id]) zn.label = P(LABEL[zn.id]);
      if (MINOR.includes(zn.id)) zn.minor = true;
    }
    // (the airport's three: inside its fence, clear of each other and of the map's edge)
    for (const [id, dx, dz] of [[ZONE.TERMINAL, 0, -16], [ZONE.HANGARS, -30, 26], [ZONE.FUEL_DEPOT, -50, 16]]) {
      const zn = zoneById[id];
      zn.label = [Math.min(zn.x + dx, HALF - 110), zn.z + dz];
    }
    zoneById[ZONE.FIREHOUSE].label = [zoneById[ZONE.FIREHOUSE].x + 34, zoneById[ZONE.FIREHOUSE].z + 18];
    for (const m of landmarks) if (inCity(m.x, m.z, 12)) m.city = true;
    // (what the picture names that is no place: the passes where it writes them, the airport over its field)
    for (const m of landmarks) {
      if (m.name === 'North Pass') m.label = P([0.745, 0.136]);
      if (m.name === 'East Pass') m.label = P([0.808, 0.487]);
    }
    landmarks.push({ x: FX(0.94), z: FX(0.535), name: 'Airport', big: true });
  }
  const marks = [];
  {
    const zp = (id) => zoneById[id];
    // (on Main Street in the middle of the square, just south of the town hall: the badge is wider than the hall, and on
    // it, as the picture has it, it hid the hall's footprint; here the hall's front is its edge and the fountain's ring
    // of trees clear of it)
    marks.push({ kind: 'town', x: city.x, z: city.z + 4 });
    marks.push({ kind: 'church', ...(([x, z]) => ({ x, z }))(P([0.183, 0.128])) });
    marks.push({ kind: 'industrial', x: zp(ZONE.INDUSTRIAL).x + 10, z: zp(ZONE.INDUSTRIAL).z - 6 });
    marks.push({ kind: 'gas', x: zp(ZONE.TRUCKSTOP).x + 26, z: zp(ZONE.TRUCKSTOP).z - 4 });
    marks.push({ kind: 'airport', x: FX(0.94), z: FX(0.505) });
    for (const [x, z] of [[zp(ZONE.SOUTH_FOREST).x, zp(ZONE.SOUTH_FOREST).z], ...camps]) marks.push({ kind: 'tent', x, z });
    for (const t of tunnels) {
      if (t.s0 === undefined) continue;
      for (const s of [t.s0, t.s1]) marks.push({ kind: 'tunnel', x: t.a[0] + t.dx * s, z: t.a[1] + t.dz * s });
    }
    if (mine) for (const p of mine.portals) marks.push({ kind: 'mine', x: p.x, z: p.z });
    for (const [x, z] of [P(PLACES.mineA), [zp(ZONE.PASSAGE).x + 6, zp(ZONE.PASSAGE).z - 22]]) marks.push({ kind: 'mine', x, z });
    marks.push({ kind: 'pit', x: PIT.x, z: PIT.z, r: PIT.r, floor: PIT.floor, steps: PIT.steps });
    marks.push({ kind: 'quarry', x: zp(ZONE.AGGREGATES).x + 30, z: zp(ZONE.AGGREGATES).z + 30 });
    marks.push({ kind: 'lighthouse', x: zp(ZONE.LIGHTHOUSE).x, z: zp(ZONE.LIGHTHOUSE).z });
    marks.push({ kind: 'tower', x: zp(ZONE.OUTPOST).x - 6, z: zp(ZONE.OUTPOST).z - 18 });
    marks.push({ kind: 'watertower', x: zp(ZONE.OUTPOST).x + 12, z: zp(ZONE.OUTPOST).z - 22 });
  }

  // ---------------------------------------------------------------- queries
  // The ground under feet at height y over (x,z): the terrain, or the floor of the drift they are down in (as on the
  // island: world.js). heightAt is the terrain alone.
  const floorAt = (x, z, y) => {
    if (mine) {
      const f = mine.floorFor(x, z, y);
      if (f === f) return f;
    }
    return heightAt(x, z);
  };
  const above = (x, y, z) => {
    if (mine) {
      const f = mine.voidFloor(x, z, y);
      if (f === f) return y - f;
    }
    return y - heightAt(x, z);
  };
  const rayTerrain = (ox, oy, oz, dx, dy, dz, maxT) => {
    const step = 0.75;
    let prevT = 0;
    if (above(ox, oy, oz) < 0) return 0;
    for (let t = step; t <= maxT + step; t += step) {
      const tt = t > maxT ? maxT : t;
      const y = oy + dy * tt;
      if (y > 420 && dy >= 0) return -1;
      if (above(ox + dx * tt, y, oz + dz * tt) < 0) {
        let lo = prevT;
        let hi = tt;
        for (let k = 0; k < 6; k++) {
          const m = (lo + hi) / 2;
          if (above(ox + dx * m, oy + dy * m, oz + dz * m) < 0) hi = m;
          else lo = m;
        }
        return (lo + hi) / 2;
      }
      prevT = tt;
      if (tt >= maxT) break;
    }
    return -1;
  };
  const zoneAt = (x, z) => {
    for (const zn of zones) if (Math.hypot(x - zn.x, z - zn.z) < zn.flat + 8) return zn.id;
    return ZONE.FOREST;
  };
  const openingNear = (x, z, maxD = 1.2) => {
    let best = null;
    let bd = maxD;
    for (const o of openings) {
      const d = Math.hypot(o.x - x, o.z - z);
      if (d < bd) {
        bd = d;
        best = o;
      }
    }
    return best;
  };
  const start = { x: head.x, z: head.z };
  // (what only the building of the world needed goes now: every closure made here keeps all that any of them can see,
  // so a grid left in reach of one would be held as long as the world is)
  seaMask = lakeMask = islets = mtnMask = cut = wallMask = reliefGrid = roadH = occ = roadDir = null;
  const treesOut = new Float32Array(trees);
  const rocksOut = new Float32Array(rocks);
  const bushesOut = new Float32Array(bushes);
  trees = rocks = bushes = null;
  zoneCells.length = flatCells.length = 0;
  peakCells.clear();
  partCells = clearCells = null;

  return {
    seed,
    kind: WORLD.MAINLAND,
    size: SIZE,
    half: HALF,
    gridN: N,
    posScale: POS_SCALE_WIDE,
    heights,
    roadDist,
    roadKind,
    heightAt,
    floorAt,
    mine,
    clinic: null,
    darks: [],
    darkAt: () => 0,
    fair: null,
    rail: null,
    roadDistAt,
    roadKindAt,
    rayTerrain,
    isDeepWater: (x, z) => heightAt(x, z) < WATER_LEVEL - 0.95,
    zoneAt,
    zones,
    zoneById,
    roads,
    highway,
    lake,
    ponds,
    river: { pts: new Float32Array(riverPts), hw: RIVER_HW, bridges, at: riverAt, flow, speed: RIVER_FLOW, depth: RIVER_DEPTH },
    creek: { pts: creekP, hw: CREEK_HW },
    landmarks, // what the field map names inside a place: { x, z, name, label (where the name is written, if not there), city (inside the city: written zoomed in), big }
    marks, // the field map's marks: { kind, x, z } (client/ui/mapmainland.js)
    sea: { x: FX(0.03), south: FX(0.46), at: seaAt }, // the sea runs on past the map's west edge, and past its north and south edges west of x / south (the client lays water there); at: how far out on the water (m)
    lakeAt, // how far out on Pine Lake (m; negative on land)
    reachAt, // can (x, z) be walked to from the bridgehead over the ground (tunnels open, no swimming)? 4 m cells
    cliffAt, // how far inside a mountain (m; negative outside)
    forestAt, // how thick the forest is, 0 .. 1
    walls, // the lines the mountains' walls stand along
    paved: [{ x: docks.x + QUAY_LX + 44, z: docks.z, hx: 44, hz: QUAY_HZ, ry: 0 }], // the docks' apron, from the quay's edge to the warehouses: asphalt (client/render/terrain.js)
    tunnels: tunnels.map((t) => ({ name: t.name, a: t.a, b: t.b, y0: t.y0, y1: t.y1, len: t.len, s0: t.s0, s1: t.s1, cap: t.cap })), // cap: the mountain over the gallery, for the client to draw (s0, step, lat, n, m, h)
    trees: treesOut,
    rocks: rocksOut,
    ships, // the ships moored at the quays, drawn only: { type, x, y, z, ry } (client/render/ships.js)
    crags: new Float32Array(crags), // the cliffs' crags, drawn only: [x, y, z, scale, ry, variant] (client/render/foliage.js)
    bushes: bushesOut,
    parts,
    props,
    lights,
    roofs,
    staticGrid,
    structGrid,
    colliderGrids: [staticGrid, structGrid],
    lootSpawns,
    containers,
    partSpots,
    openings,
    openingNear,
    sites,
    resourceSpawns,
    hordeSpawns,
    spawnPoints,
    start,
    car,
    cemetery: null,
    bridge,
    runway,
    city: { x: city.x, z: city.z, pitch: PITCH, grid: GRID, lots, buildings, rooms, shells, heaps, fallen: fallenBits, pancakes, signs },
    farms: [],
    homes: homes.map((o) => ({ x: o.x, z: o.z, ry: o.ry })),
  };
}
