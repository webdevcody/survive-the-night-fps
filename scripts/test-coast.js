// The island's shore, the bridge on both maps, and where the two maps lie to each other (shared/coast.js, and the field
// map's layers in client/ui/mapcanvas.js). Checks, for a handful of seeds:
//   - the island is an island: on every bearing out of the valley there is a shore, never on the valley's edge, and
//     past it open sea, all inside SHORE.MARGIN
//   - no square on either map: the ground past the edge (world.far) runs on from the heightfield's unbroken, and no
//     ridge runs along the edge (the old rim along the square drew it on the map and on the skyline)
//   - the field map's layer round the island (shoreImage) is water all the way round its rim, land next to the valley,
//     and leaves the valley's own square to the bake; the mainland's has the sea off its west edge
//   - the bridge: geography's plan is the very bridge the mainland is built with (same place, same spans, holes and
//     wrecks), the island's is that one moved into the island's frame, its island end stands on a bluff at the deck's
//     height with the sea under its first span, and the mainland's map has it coming in from the sea to the Bridgehead
//   - what the field map draws of the bridge (bridgeMarks) is the plan: the roadway from end to end, a pier at every
//     joint, the broken span's lost half missing, the last span down on the mainland and standing on the island
//   - the widest view takes in both maps, and the island's frame and the mainland's agree about where the bridge is
// usage: node scripts/test-coast.js
import { createWorld } from '../shared/world.js';
import { createMainland } from '../shared/mainland.js';
import { WORLD, MAINLAND_SIZE } from '../shared/acts.js';
import { MAP_HALF, WATER_LEVEL } from '../shared/constants.js';
import { BRIDGE } from '../shared/bridge.js';
import { SHORE, BRIDGE_DECK, BRIDGE_LEN, MAINLAND_COAST, geography, islandLand } from '../shared/coast.js';
import { shoreTiles, shoreTile, bridgeMarks, SEA } from '../client/ui/mapcanvas.js';
import { farField, mapMargin } from '../shared/coast.js';

// the field map's tiles round a map (shoreTiles), read as one picture: the pixel at (x, z); where no tile is, the open
// sea's own colour (the view's: SEA) outside the map's square, null inside it
function stripsOf(world) {
  const S = shoreTiles(world).map((R) => shoreTile(world, R));
  const sea = new Uint8ClampedArray([...SEA, 255]);
  const H = world.half;
  const at = (x, z) => {
    for (const s of S) {
      const px = Math.floor((x - s.x0) * s.ppm);
      const py = Math.floor((z - s.z0) * s.ppm);
      if (px >= 0 && py >= 0 && px < s.pw && py < s.ph) return s.data.subarray((py * s.pw + px) * 4, (py * s.pw + px) * 4 + 4);
    }
    return Math.abs(x) < H && Math.abs(z) < H ? null : sea;
  };
  const M = mapMargin(world);
  return { S, at, x0: -H - M, w: 2 * (H + M), pixels: S.reduce((a, s) => a + s.pw * s.ph, 0) };
}
const wetPx = (p) => !!p && p[3] === 255 && p[2] > p[0] + 8;
const landPx = (p) => !!p && p[3] === 255 && p[0] > p[2] + 8;

const ISLANDS = [1, 7, 42, 1337];
const MAINLANDS = [1, 1337];
let failed = 0;
function check(name, ok, detail = '') {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`);
}
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;
// a pixel of the survey's water (its blue over its red) or of its paper (red over blue)
const isWater = (d, k) => d[k * 4 + 3] === 255 && d[k * 4 + 2] > d[k * 4] + 8;
const isLand = (d, k) => d[k * 4 + 3] === 255 && d[k * 4] > d[k * 4 + 2] + 8;

// No square, on either map: the ground runs on across the map's edge with nothing that follows it.
//   seamless   world.far, just past the edge, is the heightfield's ground just inside it (in height and in slope),
//              except where a road or the railway was graded into the edge
//   no ridge   the lie of the land near the edge does not run along it: the old rim made the ground climb straight at
//              the edge nearly everywhere (its contours parallel to the edge); now the slope there points every way
// edges: which sides to look along ('N', 'S', 'W', 'E'): the mainland's west edge is in the sea
function edgeChecks(name, w, edges) {
  const half = w.half;
  const N = w.gridN;
  const graded = (x, z) => {
    const i = Math.round((x + half) / 2);
    const j = Math.round((z + half) / 2);
    for (let dj = -6; dj <= 6; dj++) for (let di = -6; di <= 6; di++) {
      const k = Math.min(N - 1, Math.max(0, j + dj)) * N + Math.min(N - 1, Math.max(0, i + di));
      if (w.roadDist[k] < 14 || w.roadKind[k] === 4) return true;
    }
    return false;
  };
  let n = 0;
  let jumps = 0;
  let kinks = 0;
  let along = 0;
  let steep = 0;
  let worstJ = 0;
  for (const e of edges) {
    for (let v = -half + 30; v <= half - 30; v += 2) {
      // (x, z) on the edge, (nx, nz) the way out
      const [x, z, nx, nz] = e === 'N' ? [v, -half, 0, -1] : e === 'S' ? [v, half, 0, 1] : e === 'W' ? [-half, v, -1, 0] : [half, v, 1, 0];
      if (graded(x, z)) continue;
      n++;
      const hin = w.heightAt(x - nx * 2, z - nz * 2);
      const h0 = w.heightAt(x - nx * 0.01, z - nz * 0.01);
      const hout = w.far(x + nx * 2, z + nz * 2);
      const j = Math.abs(w.far(x + nx * 0.01, z + nz * 0.01) - h0);
      worstJ = Math.max(worstJ, j);
      if (j > 0.3) jumps++;
      if (Math.abs((hout - h0) - (h0 - hin)) > 1.2) kinks++;
      // the slope 20 m in: how much of it is straight out across the edge
      const px = x - nx * 20;
      const pz = z - nz * 20;
      const gx = w.heightAt(px + 2, pz) - w.heightAt(px - 2, pz);
      const gz = w.heightAt(px, pz + 2) - w.heightAt(px, pz - 2);
      const g = Math.hypot(gx, gz) / 4;
      if (g > 0.08) {
        steep++;
        if ((gx * nx + gz * nz) / (4 * g) > 0.97) along++; // (within 14 degrees of straight out: a contour along the edge)
      }
    }
  }
  check(`${name}: the ground runs on across the map's edge unbroken`, jumps <= n * 0.01 && kinks <= n * 0.03, `${n} points: ${jumps} steps over 0.3 m (worst ${worstJ.toFixed(2)} m), ${kinks} kinks`);
  check(`${name}: no ridge runs along the map's edge`, steep === 0 || along / steep < 0.45, `${along} of ${steep} slopes 20 m in climb straight at the edge (${((100 * along) / Math.max(1, steep)) | 0}%)`);
}

const H = MAP_HALF;
for (const seed of ISLANDS) {
  const w = createWorld(seed);
  const s = islandLand(seed);
  const geo = geography(seed);
  // ---- an island: a shore on every bearing, off the valley, open sea past it, all inside the margin
  let worst = '';
  for (let i = 0; i < 1440; i++) {
    const a = (i / 1440) * Math.PI * 2;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const out = H / Math.max(Math.abs(ca), Math.abs(sa)); // where the way out leaves the valley
    const r = s.reach(ca * 1000, sa * 1000);
    const at = (d) => w.far(ca * (out + d), sa * (out + d));
    if (r < SHORE.REACH_MIN - 1e-3 || r > SHORE.REACH_MAX + 1e-3) worst ||= `reach ${r.toFixed(1)} at ${a.toFixed(2)}`;
    else if (!(at(r - 2) > WATER_LEVEL)) worst ||= `under water short of the shore at ${a.toFixed(2)}`;
    else if (!(at(r + 2) < WATER_LEVEL)) worst ||= `dry past the shore at ${a.toFixed(2)}`;
    else if (!(at(r + SHORE.SHELF + 1) <= WATER_LEVEL - SHORE.DEPTH + 0.01)) worst ||= `no open sea past the shelf at ${a.toFixed(2)}`;
    else if (Math.max(Math.abs(ca), Math.abs(sa)) * (out + r + SHORE.SHELF) > H + SHORE.MARGIN) worst ||= `past the margin at ${a.toFixed(2)}`;
  }
  check(`seed ${seed}: a shore on every bearing, off the valley, open sea past it, inside the margin`, !worst, worst);
  edgeChecks(`seed ${seed} (island)`, w, ['N', 'S', 'W', 'E']);

  // ---- the field map's strips round the island: water all round their rim, land by the valley, the valley left to the bake
  const img = stripsOf(w);
  const E = img.x0 + 1; // (just inside their outer rim)
  let rimDry = 0;
  let rimN = 0;
  for (let v = E; v < -E; v += 2) for (const [x, z] of [[v, E], [v, -E], [E, v], [-E, v]]) {
    rimN++;
    if (!wetPx(img.at(x, z))) rimDry++;
  }
  check(`seed ${seed}: the map is sea all round the tiles' rim`, rimDry === 0, `${rimDry} of ${rimN} rim pixels not water`);
  let open = 0;
  let besideDry = 0;
  for (let i = 0; i < 360; i++) {
    const a = (i / 360) * Math.PI * 2;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const out = H / Math.max(Math.abs(ca), Math.abs(sa));
    // just past the valley's edge it is land (the island's hills), and walking on out there is water before the rim
    if (!landPx(img.at(ca * (out + 3), sa * (out + 3)))) besideDry++;
    let wet = false;
    for (let t = out + 3; Math.max(Math.abs(ca * t), Math.abs(sa * t)) < -img.x0 - 1; t += 2) if (wetPx(img.at(ca * t, sa * t))) wet = true;
    if (wet) open++;
  }
  check(`seed ${seed}: out of the valley on every bearing the map shows land, then the sea`, open === 360 && besideDry === 0, `${open}/360 reach water, ${besideDry} with no land by the valley`);
  check(`seed ${seed}: the tiles leave the valley to the bake (but for a sliver under its rim)`, img.at(0, 0) === null && img.at(H - 4, H - 40)?.[3] !== 255 && landPx(img.at(H + 1.5, 0)));
  check(`seed ${seed}: only the tiles with land or shallows in them are made: ${img.S.length}, ${img.pixels} pixels`, img.pixels < 600000 && img.S.length < 150, `${((img.pixels * 4) / 1048576).toFixed(2)} MB`);

  // ---- the bridge's island end: on a bluff at the deck's height, the sea under its first span
  const pi = geo.bridge(true);
  check(`seed ${seed}: the bridge leaves the island's east shore on its middle line`, near(pi.x0, geo.end) && pi.z === 0 && near(pi.x1 - pi.x0, BRIDGE_LEN) && geo.end > H + SHORE.REACH_MIN, `island end at x ${pi.x0.toFixed(1)}`);
  const abut = w.far(pi.x0, 0);
  const under = w.far(pi.x0 + SHORE.LAND + 3, 0);
  check(`seed ${seed}: it stands on a bluff at the deck's height, the sea under its first span`, Math.abs(abut - BRIDGE_DECK) < 0.5 && under < WATER_LEVEL && s.coast(pi.x0 + SHORE.LAND, 0) > -0.5, `abutment ground ${abut.toFixed(2)} m, ${SHORE.LAND + 3} m on ${under.toFixed(2)} m`);
}

// ---- the mainland: the bridge it is built with is geography's, and its map has it coming in from the sea
for (const seed of MAINLANDS) {
  const m = createMainland(seed);
  const geo = geography(seed);
  const pm = geo.bridge(false);
  const pi = geo.bridge(true);
  const b = m.bridge;
  check(`seed ${seed}: geography's bridge is where the mainland builds it`, near(b.x0, pm.x0) && near(b.x1, pm.x1) && near(b.z, pm.z) && b.deckY === pm.deckY && b.deckY === BRIDGE_DECK && near(b.x1, MAINLAND_COAST + SHORE.LAND), `mainland x ${b.x0}..${b.x1} z ${b.z.toFixed(2)}`);
  const same = JSON.stringify([b.spans.map((sp) => [sp.state, sp.lost, sp.x0]), b.holes, b.wrecks.map((wr) => [wr.type, wr.x, wr.lz])]) === JSON.stringify([pm.spans.map((sp) => [sp.state, sp.lost, sp.x0]), pm.holes, pm.wrecks.map((wr) => [wr.type, wr.x, wr.lz])]);
  check(`seed ${seed}: ...the same spans, holes and wrecks`, same);
  // the island's frame is the mainland's moved: every span of the island's plan lands on the mainland's
  let off = 0;
  pi.spans.forEach((sp, k) => {
    const [x, z] = geo.toMainland(sp.x0, pi.z);
    off = Math.max(off, Math.abs(x - pm.spans[k].x0), Math.abs(z - pm.z));
  });
  pi.wrecks.forEach((wr, k) => (off = Math.max(off, Math.abs(geo.toMainland(wr.x, 0)[0] - pm.wrecks[k].x))));
  check(`seed ${seed}: the island's bridge is the mainland's, moved into the island's frame`, off < 1e-6 && geo.toIsland(...geo.toMainland(3, 4)).every((v, i) => near(v, [3, 4][i])));
  // on the mainland's map: its last span is over the sea inside the survey, and the rest goes off its west edge
  const MH = MAINLAND_SIZE / 2;
  const wet = [];
  for (let x = -MH + 2; x < MAINLAND_COAST - 8; x += 4) wet.push(m.heightAt(x, b.z) < WATER_LEVEL);
  check(`seed ${seed}: on the mainland's map the bridge comes in from the sea to the Bridgehead`, b.x0 < -MH && b.x1 > -MH && b.x1 < -MH + 120 && wet.every(Boolean), `${wet.filter(Boolean).length}/${wet.length} points of its line inside the survey are sea`);
  // the mainland's layer round its map: the sea all down its west rim, the far country round the rest
  const img = stripsOf(m);
  const E = img.x0 + 1;
  let dry = 0;
  let landE = 0;
  let nE = 0;
  for (let v = E; v < -E; v += 2) {
    nE++;
    if (!wetPx(img.at(E, v))) dry++;
    if (Math.abs(v) > m.half || landPx(img.at(m.half + 40, v))) landE++; // (inside its feathered outer rim)
  }
  check(`seed ${seed}: the mainland's map is sea off its west edge and land past its east one`, dry === 0 && landE === nE, `${dry} dry in the west, ${nE - landE} not land in the east`);
  check(`seed ${seed}: the mainland's tiles are few: ${img.S.length}, ${img.pixels} pixels`, img.pixels < 450000 && img.S.length < 140, `${((img.pixels * 4) / 1048576).toFixed(2)} MB`);
  edgeChecks(`seed ${seed} (mainland)`, m, ['N', 'S', 'E']);

  // ---- what the field map draws of the bridge, on either map
  for (const [plan, fallen, where] of [[pi, false, 'island'], [b, true, 'mainland']]) {
    const mk = bridgeMarks(plan, fallen);
    const half = BRIDGE.DECK / 2;
    // the roadway from end to end on the side the broken span keeps; the broken span's lost half missing in its middle
    const bs = plan.spans[plan.broken];
    const keep = -bs.lost;
    const covered = (x, z) => mk.deck.some((r) => x >= r.x0 - 1e-6 && x <= r.x1 + 1e-6 && z >= r.z0 - 1e-6 && z <= r.z1 + 1e-6);
    let gaps = 0;
    for (let x = plan.x0 + 0.5; x < plan.x1; x += 1) {
      const sp = plan.spans.find((q) => x >= q.x0 && x <= q.x1);
      if (sp.state === 'fallen' && fallen) continue;
      if (!covered(x, plan.z + keep * half * 0.5)) gaps++;
    }
    const mid = (bs.x0 + bs.x1) / 2;
    const fallenSpan = plan.spans.find((q) => q.state === 'fallen');
    const ruin = mk.ruin.length === (fallen ? 1 : 0) && (!fallen || (near(mk.ruin[0].x0, fallenSpan.x0) && near(mk.ruin[0].x1, fallenSpan.x1)));
    check(
      `seed ${seed} (${where}): the map's bridge is the plan - roadway end to end, ${BRIDGE.SPANS - 1} piers, the broken half gone, the last span ${fallen ? 'down' : 'standing'}`,
      gaps === 0 && !covered(mid, plan.z + bs.lost * half * 0.5) && covered(mid, plan.z + keep * half * 0.5) && mk.piers.length === BRIDGE.SPANS - 1 && mk.piers.every((x) => plan.spans.some((q) => near(q.x0, x))) && ruin && near(mk.x0, plan.x0) && near(mk.x1, plan.x1) && mk.z === plan.z,
      `${gaps} m of roadway missing, ruin ${mk.ruin.length}, piers ${mk.piers.length}`,
    );
  }

  // ---- the widest view: both maps in it, in either frame the same
  const ei = geo.extent(true);
  const em = geo.extent(false);
  const [mx0, mz0] = geo.toIsland(-MH, -MH);
  const [mx1, mz1] = geo.toIsland(MH, MH);
  check(
    `seed ${seed}: the widest view takes in both maps and their shores, the same in either frame`,
    ei.x0 <= -H - SHORE.MARGIN && ei.z0 <= -H - SHORE.MARGIN && ei.z1 >= H + SHORE.MARGIN && ei.x1 >= mx1 && ei.z0 <= mz0 && ei.z1 >= mz1 && mx0 > H + SHORE.REACH_MIN && near(em.x0 - geo.island.x, ei.x0) && near(em.z1 - geo.island.z, ei.z1),
    `island frame x ${ei.x0.toFixed(0)}..${ei.x1.toFixed(0)}, z ${ei.z0.toFixed(0)}..${ei.z1.toFixed(0)}`,
  );
}
check('the island and the mainland are told apart by kind', WORLD.ISLAND !== WORLD.MAINLAND);

console.log(failed ? `\n${failed} check(s) FAILED` : '\nall coast checks passed');
process.exit(failed ? 1 : 0);
