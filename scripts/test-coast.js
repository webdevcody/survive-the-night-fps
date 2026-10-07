// The island's shore, the bridge on both maps, and where the two maps lie to each other (shared/coast.js, and the field
// map's layers in client/ui/mapcanvas.js). Checks, for a handful of seeds:
//   - the island is an island: on every bearing out of the valley there is a shore, never on the valley's edge, and
//     past it open sea, all inside SHORE.MARGIN; the shore's ground meets the valley's at the edge
//   - the field map's layer round the island (shoreImage) is water all the way round its rim, land next to the valley,
//     and leaves the valley's own square to the bake; the mainland's has the sea off its west edge
//   - the bridge: geography's plan is the very bridge the mainland is built with (same place, same spans, holes and
//     wrecks), the island's is that one moved into the island's frame, its island end stands on a bluff at the deck's
//     height with the sea under its first span, and the mainland's map has it coming in from the sea to the Bridgehead
//   - what the field map draws of the bridge (bridgeMarks) is the plan: the roadway from end to end, a pier at every
//     joint, the broken span's lost half missing, the last span down on the mainland and standing on the island
//   - the widest view takes in both maps, and the island's frame and the mainland's agree about where the bridge is
// Nothing here touches the world: the fingerprints of test-world / test-mainland are what say a map changed.
// usage: node scripts/test-coast.js
import { createWorld } from '../shared/world.js';
import { createMainland } from '../shared/mainland.js';
import { WORLD, MAINLAND_SIZE } from '../shared/acts.js';
import { MAP_HALF, WATER_LEVEL } from '../shared/constants.js';
import { BRIDGE } from '../shared/bridge.js';
import { SHORE, BRIDGE_DECK, BRIDGE_LEN, MAINLAND_COAST, geography, islandShore, edgeProfile, edgeFromProfile } from '../shared/coast.js';
import { shoreImage, bridgeMarks } from '../client/ui/mapcanvas.js';

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

const H = MAP_HALF;
for (const seed of ISLANDS) {
  const w = createWorld(seed);
  const s = islandShore(seed, w.heightAt);
  const geo = geography(seed);
  // ---- an island: a shore on every bearing, off the valley, open sea past it, all inside the margin
  let worst = '';
  let edgeGap = 0;
  for (let i = 0; i < 1440; i++) {
    const a = (i / 1440) * Math.PI * 2;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const out = H / Math.max(Math.abs(ca), Math.abs(sa)); // where the way out leaves the valley
    const r = s.reach(ca * 1000, sa * 1000);
    const at = (d) => s.heightAt(ca * (out + d), sa * (out + d));
    if (r < SHORE.REACH_MIN - 1e-3 || r > SHORE.REACH_MAX + 1e-3) worst ||= `reach ${r.toFixed(1)} at ${a.toFixed(2)}`;
    else if (!(at(r - 2) > WATER_LEVEL)) worst ||= `under water short of the shore at ${a.toFixed(2)}`;
    else if (!(at(r + 2) < WATER_LEVEL)) worst ||= `dry past the shore at ${a.toFixed(2)}`;
    else if (!(at(r + SHORE.SHELF + 1) <= WATER_LEVEL - SHORE.DEPTH + 0.01)) worst ||= `no open sea past the shelf at ${a.toFixed(2)}`;
    else if (Math.max(Math.abs(ca), Math.abs(sa)) * (out + r + SHORE.SHELF) > H + SHORE.MARGIN) worst ||= `past the margin at ${a.toFixed(2)}`;
    // the shore's ground starts where the valley's stops
    edgeGap = Math.max(edgeGap, Math.abs(s.heightAt(ca * out, sa * out) - w.heightAt(ca * out, sa * out)), Math.abs(at(0.05) - w.heightAt(ca * out, sa * out)));
  }
  check(`seed ${seed}: a shore on every bearing, off the valley, open sea past it, inside the margin`, !worst, worst);
  check(`seed ${seed}: the shore's ground meets the valley's at its edge`, edgeGap < 0.15, `worst ${edgeGap.toFixed(3)} m`);
  // (drawn from a kept profile of the edge - the mainland's view of the island - it is the same shore)
  const prof = islandShore(seed, edgeFromProfile(edgeProfile(w.heightAt)));
  let pd = 0;
  for (let i = 0; i < 400; i++) {
    // (outside the valley: inside it the valley's own heights are the ground, not these)
    const k = (H + 2 + (i % 9) * 25) / Math.max(Math.abs(Math.cos(i)), Math.abs(Math.sin(i)));
    pd = Math.max(pd, Math.abs(prof.heightAt(Math.cos(i) * k, Math.sin(i) * k) - s.heightAt(Math.cos(i) * k, Math.sin(i) * k)));
  }
  check(`seed ${seed}: the island drawn from its kept edge profile is the same island`, pd < 0.6, `worst ${pd.toFixed(2)} m`);

  // ---- the field map's layer round the island: water all round its rim, land by the valley, the valley left to the bake
  const img = shoreImage(w);
  const n = img.px;
  const d = img.data;
  let rimDry = 0;
  for (let i = 0; i < n; i++) for (const k of [i, (n - 1) * n + i, i * n, i * n + n - 1]) if (!isWater(d, k)) rimDry++;
  check(`seed ${seed}: the map's shore layer is sea all round its rim`, rimDry === 0, `${rimDry} of ${4 * n} rim pixels not water (${n} px a side)`);
  const px = (x, z) => Math.floor((z - img.z0) * img.ppm) * n + Math.floor((x - img.x0) * img.ppm);
  let open = 0;
  let besideDry = 0;
  for (let i = 0; i < 360; i++) {
    const a = (i / 360) * Math.PI * 2;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const out = H / Math.max(Math.abs(ca), Math.abs(sa));
    // just past the valley's edge it is land (the far side of the hills), and walking on out there is water before the rim
    if (!isLand(d, px(ca * (out + 3), sa * (out + 3)))) besideDry++;
    let wet = false;
    for (let t = out + 3; Math.max(Math.abs(ca * t), Math.abs(sa * t)) < -img.x0 - 1; t += 1) if (isWater(d, px(ca * t, sa * t))) wet = true;
    if (wet) open++;
  }
  check(`seed ${seed}: out of the valley on every bearing the map shows land, then the sea`, open === 360 && besideDry === 0, `${open}/360 reach water, ${besideDry} with no land by the valley`);
  check(`seed ${seed}: the shore layer leaves the valley to the bake`, d[px(0, 0) * 4 + 3] === 0 && d[px(H - 1, H - 1) * 4 + 3] === 0 && d[px(H + 1.5, 0) * 4 + 3] === 255);

  // ---- the bridge's island end: on a bluff at the deck's height, the sea under its first span
  const pi = geo.bridge(true);
  check(`seed ${seed}: the bridge leaves the island's east shore on its middle line`, near(pi.x0, geo.end) && pi.z === 0 && near(pi.x1 - pi.x0, BRIDGE_LEN) && geo.end > H + SHORE.REACH_MIN, `island end at x ${pi.x0.toFixed(1)}`);
  const abut = s.heightAt(pi.x0, 0);
  const under = s.heightAt(pi.x0 + SHORE.LAND + 3, 0);
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
  // the mainland's shore layer: the sea all down its west rim
  const img = shoreImage(m);
  let dry = 0;
  for (let j = 0; j < img.px; j++) if (!isWater(img.data, j * img.px)) dry++;
  check(`seed ${seed}: the mainland's shore layer is sea off its west edge`, dry === 0, `${dry} dry`);

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
