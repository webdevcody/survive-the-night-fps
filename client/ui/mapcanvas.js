// Bakes the field map of the valley (an old sepia survey map: hill shading, contour lines, forest
// stipple, water, roads, trails and building footprints) from the deterministic world once per world.
// Names and live markers are drawn on top by the map screen / compass, never baked in.
import { MAP_HALF, MAP_SIZE, GRID_STEP, WATER_LEVEL } from '../../shared/constants.js';
import { WHEEL } from '../../shared/fair.js';
import { WORLD } from '../../shared/acts.js';
import { BRIDGE, DAMAGED } from '../../shared/bridge.js';
import { SHORE, geography, islandShore, mainlandShoreGuess, edgeProfile, edgeFromProfile } from '../../shared/coast.js';

// The map is baked at MAP_PPM px per metre, whatever the size of the world: 1280 px for the island, 2560 for the
// mainland (which is twice as far across). mapX / mapY are of the map baked last: the client has one world at a time.
export const MAP_PPM = 2;
const S = MAP_PPM;
let half = MAP_HALF; // of the world the map was last baked for
export let MAP_PX = MAP_SIZE * MAP_PPM; // ...and the size of its canvas

export const mapX = (x) => (x + half) * S;
export const mapY = (z) => (z + half) * S;

export function renderMapCanvas(world) {
  half = world.half;
  MAP_PX = world.size * MAP_PPM;
  const MAP_HALF = half;
  const MAP_SIZE = world.size;
  const cv = document.createElement('canvas');
  cv.width = cv.height = MAP_PX;
  const g = cv.getContext('2d');

  // ---- raster: paper + hillshade + contours + water (1 px per metre, scaled up)
  const R = MAP_SIZE;
  const raster = document.createElement('canvas');
  raster.width = raster.height = R;
  const rg = raster.getContext('2d');
  const img = rg.createImageData(R, R);
  const d = img.data;
  const H = world.heights;
  const N = world.gridN;
  const hAt = (x, z) => {
    let fx = (x + MAP_HALF) / GRID_STEP;
    let fz = (z + MAP_HALF) / GRID_STEP;
    fx = fx < 0 ? 0 : fx > N - 1.001 ? N - 1.001 : fx;
    fz = fz < 0 ? 0 : fz > N - 1.001 ? N - 1.001 : fz;
    const i = fx | 0;
    const j = fz | 0;
    const tx = fx - i;
    const tz = fz - j;
    const k = j * N + i;
    const a = H[k] + (H[k + 1] - H[k]) * tx;
    const b = H[k + N] + (H[k + N + 1] - H[k + N]) * tx;
    return a + (b - a) * tz;
  };
  const hs = new Float32Array(R * R);
  for (let py = 0; py < R; py++) for (let px = 0; px < R; px++) hs[py * R + px] = hAt(px - MAP_HALF + 0.5, py - MAP_HALF + 0.5);
  shadeRaster(hs, R, R, d, noise(1234567));
  rg.putImageData(img, 0, 0);
  g.imageSmoothingEnabled = true;
  g.drawImage(raster, 0, 0, MAP_PX, MAP_PX);

  // ---- forest stipple
  const T = world.trees;
  g.fillStyle = 'rgba(58, 74, 52, 0.42)';
  for (let i = 0; i < T.length; i += 6) {
    const r = 1.1 + T[i + 3] * 1.3;
    g.beginPath();
    g.arc(mapX(T[i]), mapY(T[i + 2]), r, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = 'rgba(40, 52, 36, 0.35)';
  for (let i = 0; i < T.length; i += 12) {
    g.beginPath();
    g.arc(mapX(T[i]) + 0.8, mapY(T[i + 2]) + 0.8, 0.9, 0, Math.PI * 2);
    g.fill();
  }

  // ---- roads
  const path = (road) => {
    const p = road.pts;
    g.beginPath();
    g.moveTo(mapX(p[0]), mapY(p[1]));
    for (let i = 2; i < p.length; i += 2) g.lineTo(mapX(p[i]), mapY(p[i + 1]));
  };
  g.lineCap = 'round';
  g.lineJoin = 'round';
  for (const pass of [0, 1]) {
    for (const road of world.roads) {
      path(road);
      if (road.kind === 3) {
        if (pass) continue;
        g.setLineDash([5, 5]);
        g.strokeStyle = 'rgba(92, 62, 34, 0.8)';
        g.lineWidth = 1.6;
        g.stroke();
        g.setLineDash([]);
      } else if (road.kind === 2) {
        g.strokeStyle = pass ? '#c9a066' : '#2e241c';
        g.lineWidth = pass ? 2.4 : 9;
        g.stroke();
      } else {
        g.strokeStyle = pass ? '#b58a58' : '#4a3422';
        g.lineWidth = pass ? 3.2 : 6.2;
        g.stroke();
      }
    }
  }

  // ---- the railway, as a survey map draws one: a line with sleepers hatched across it, from one tunnel mouth to
  // the other (a bar across each), and the siding at the depot
  if (world.rail) {
    g.strokeStyle = '#2a2019';
    world.rail.tracks.forEach((t, ti) => {
      const from = ti ? t.from : world.rail.portals[0].i;
      const to = ti ? t.to : world.rail.portals[1].i;
      g.lineWidth = 1.7;
      g.beginPath();
      g.moveTo(mapX(t.x[from]), mapY(t.z[from]));
      for (let i = from + 1; i <= to; i++) g.lineTo(mapX(t.x[i]), mapY(t.z[i]));
      g.stroke();
      g.lineWidth = 1.3;
      g.beginPath();
      for (let i = from + 3; i < to; i += 5) {
        const l = Math.hypot(t.x[i + 1] - t.x[i - 1], t.z[i + 1] - t.z[i - 1]) || 1;
        const nx = (-(t.z[i + 1] - t.z[i - 1]) / l) * 2.3;
        const nz = ((t.x[i + 1] - t.x[i - 1]) / l) * 2.3;
        g.moveTo(mapX(t.x[i] - nx), mapY(t.z[i] - nz));
        g.lineTo(mapX(t.x[i] + nx), mapY(t.z[i] + nz));
      }
      g.stroke();
    });
    g.lineWidth = 3.4;
    for (const p of world.rail.portals) {
      g.beginPath();
      g.moveTo(mapX(p.x - p.dz * 5.5), mapY(p.z + p.dx * 5.5));
      g.lineTo(mapX(p.x + p.dz * 5.5), mapY(p.z - p.dx * 5.5));
      g.stroke();
    }
  }

  // ---- the workings of the mine, as the surveyor drew them: the drifts dashed under the ground they run
  // beneath, a tick across each mouth
  if (world.mine) {
    g.strokeStyle = 'rgba(52, 30, 24, 0.7)';
    g.lineWidth = 2.6;
    g.setLineDash([2.5, 4.5]);
    for (const l of [world.mine.main, ...world.mine.galleries]) {
      g.beginPath();
      g.moveTo(mapX(l.x[0]), mapY(l.z[0]));
      for (let i = 1; i < l.n; i++) g.lineTo(mapX(l.x[i]), mapY(l.z[i]));
      g.stroke();
    }
    g.setLineDash([]);
    for (const rm of world.mine.rooms) {
      g.beginPath();
      g.arc(mapX(rm.x), mapY(rm.z), rm.r * S * 0.8, 0, Math.PI * 2);
      g.stroke();
    }
    g.lineWidth = 3;
    for (const p of world.mine.portals) {
      g.beginPath();
      g.moveTo(mapX(p.x - p.dz * 4.5), mapY(p.z + p.dx * 4.5));
      g.lineTo(mapX(p.x + p.dz * 4.5), mapY(p.z - p.dx * 4.5));
      g.stroke();
    }
  }

  // ---- St. Agnes Cemetery: its railings as a broken line, a cross for every grave
  const cem = world.cemetery;
  if (cem) {
    g.strokeStyle = 'rgba(38, 28, 22, 0.7)';
    g.lineWidth = 1.2;
    g.save();
    g.translate(mapX(cem.x), mapY(cem.z));
    g.rotate(-cem.ry);
    g.setLineDash([3, 2]);
    g.strokeRect(-cem.hx * S, -cem.hz * S, cem.hx * 2 * S, cem.hz * 2 * S);
    g.setLineDash([]);
    g.restore();
    g.lineWidth = 0.9;
    g.beginPath();
    for (const gr of cem.graves) {
      const x = mapX(gr.x);
      const y = mapY(gr.z);
      g.moveTo(x - 1.5, y - 0.5);
      g.lineTo(x + 1.5, y - 0.5);
      g.moveTo(x, y - 2);
      g.lineTo(x, y + 2);
    }
    g.stroke();
  }
  // ---- the fair's Ferris wheel, the one landmark that is seen from across the valley: a wheel, as a mark
  if (world.fair) {
    const f = world.fair;
    const x = mapX(f.x + f.c * WHEEL.x + f.s * WHEEL.z);
    const y = mapY(f.z - f.s * WHEEL.x + f.c * WHEEL.z);
    const r = WHEEL.r * S * 0.8;
    g.strokeStyle = 'rgba(52, 30, 24, 0.8)';
    g.lineWidth = 1.6;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI;
      g.moveTo(x - Math.cos(a) * r, y - Math.sin(a) * r);
      g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    }
    g.stroke();
  }

  // ---- buildings (walls + floors + roofs from the static parts)
  g.fillStyle = 'rgba(38, 28, 22, 0.88)';
  for (const p of world.parts) {
    if (p.shape !== 'box' && p.shape !== 'cyl') continue;
    if (p.sy < 0.9 && p.sx * p.sz < 30) continue;
    if (world.mine && p.y + p.sy / 2 < world.heightAt(p.x, p.z)) continue; // (the timbering of the mine: it is under the ground)
    const w = p.sx * S;
    const h = p.sz * S;
    if (w * h < 1.2) continue;
    g.save();
    g.translate(mapX(p.x), mapY(p.z));
    g.rotate(-p.ry);
    if (p.shape === 'cyl') {
      g.beginPath();
      g.arc(0, 0, w / 2, 0, Math.PI * 2);
      g.fill();
    } else if (p.sy < 0.9) {
      g.fillStyle = 'rgba(80, 64, 50, 0.35)';
      g.fillRect(-w / 2, -h / 2, w, h);
      g.fillStyle = 'rgba(38, 28, 22, 0.88)';
    } else g.fillRect(-w / 2, -h / 2, w, h);
    g.restore();
  }
  // big props (vehicles, tents)
  const BIG = { car: 1, car_wreck: 1, pickup_truck: 1, school_bus: 1, camper: 1, dump_truck: 1, tractor: 1, military_tent: 1, tent: 1, heli_wreck: 1, log_pile: 1, fuel_tank: 1, car_burnt: 1, ambulance: 1, semi_truck: 1, fire_truck: 1, shipping_container: 1, airliner_wreck: 1, plane_wreck: 1, light_plane: 1, rubble_slope: 1, rubble_pile: 1, car_open: 1, city_bus: 1, box_truck: 1, van_wreck: 1, apc_wreck: 1, army_truck: 1, triage_tent: 1 };
  g.fillStyle = 'rgba(60, 44, 34, 0.7)';
  for (const pr of world.props) {
    if (!BIG[pr.type]) continue;
    const sz = PROP_SIZE[pr.type] || [2, 4];
    g.save();
    g.translate(mapX(pr.x), mapY(pr.z));
    g.rotate(-pr.ry);
    g.fillRect((-sz[0] / 2) * S, (-sz[1] / 2) * S, sz[0] * S, sz[1] * S);
    g.restore();
  }

  // ---- grid + border (1 square = 80 m)
  g.strokeStyle = 'rgba(70, 48, 30, 0.16)';
  g.lineWidth = 1;
  for (let v = 0; v <= MAP_SIZE; v += 80) {
    g.beginPath();
    g.moveTo(v * S, 0);
    g.lineTo(v * S, MAP_PX);
    g.moveTo(0, v * S);
    g.lineTo(MAP_PX, v * S);
    g.stroke();
  }
  // (no vignette baked in: the sheet goes on past the survey now - the shore, the sea, the bridge, the other map - so
  // the age is the view's, darkening its edges wherever it is: ui2.css .map-view)
  if (world.kind === WORLD.ISLAND) ISLAND_SEEN.set(world.seed, { edge: edgeProfile(world.heightAt), thumb: thumbOf(cv) });
  return cv;
}

// ---------------------------------------------------------------- the paper
// A deterministic speckle, so the same world bakes to the same picture
function noise(seed) {
  return () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
}

// The survey's look, per pixel, from a field of heights (w x h, row-major, a pixel a step): paper tinted by height,
// hill shading lit from the north-west, contours every 2.5 m (an index line every 10), and below the water line the
// water, darker with depth, inked along the shore. A height that is NaN is left alone (transparent): the shore layer
// round a map leaves the map's own square to the map. d: RGBA out. contours: draw them (the widest view does not: at
// its scale they would be a smudge). shadeK: how dark a metre of rise from one pixel to the next shades (0.55 at a
// pixel a metre; a coarser raster's pixels are further apart, so less).
export function shadeRaster(hs, w, h, d, rnd, { contours = true, shadeK = 0.55 } = {}) {
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const k = py * w + px;
      const z = hs[k];
      if (z !== z) continue;
      // (a neighbour that is NaN - none of this layer's - counts as level with this pixel)
      let hl = hs[py * w + Math.max(0, px - 1)];
      let hr = hs[py * w + Math.min(w - 1, px + 1)];
      let hu = hs[Math.max(0, py - 1) * w + px];
      let hd = hs[Math.min(h - 1, py + 1) * w + px];
      if (hl !== hl) hl = z;
      if (hr !== hr) hr = z;
      if (hu !== hu) hu = z;
      if (hd !== hd) hd = z;
      // light from the north-west
      const shade = Math.max(-1, Math.min(1, ((hl - hr) + (hu - hd)) * shadeK));
      let r = 214;
      let gg = 199;
      let b = 164;
      // elevation tint: valleys a touch greener, heights paler
      const e = Math.max(0, Math.min(1, (z + 6) / 36));
      r += (e - 0.4) * 22;
      gg += (e - 0.4) * 16;
      b += (e - 0.4) * 6;
      r += shade * 34;
      gg += shade * 30;
      b += shade * 24;
      // contour lines every 2.5 m (index line every 10 m)
      const c0 = Math.floor(z / 2.5);
      if (contours && (Math.floor(hr / 2.5) !== c0 || Math.floor(hd / 2.5) !== c0)) {
        const idx = Math.floor(Math.max(z, hr, hd) / 2.5) % 4 === 0;
        const a = idx ? 0.34 : 0.18;
        r = r * (1 - a) + 96 * a;
        gg = gg * (1 - a) + 64 * a;
        b = b * (1 - a) + 38 * a;
      }
      if (z < WATER_LEVEL) {
        const depth = Math.min(1, (WATER_LEVEL - z) / 5);
        r = 118 - depth * 34;
        gg = 136 - depth * 30;
        b = 138 - depth * 20;
        // shoreline ink
        if (hr >= WATER_LEVEL || hd >= WATER_LEVEL || hl >= WATER_LEVEL || hu >= WATER_LEVEL) {
          r = 70;
          gg = 78;
          b = 80;
        }
      }
      const n = (rnd() - 0.5) * 10;
      d[k * 4] = r + n;
      d[k * 4 + 1] = gg + n;
      d[k * 4 + 2] = b + n;
      d[k * 4 + 3] = 255;
    }
  }
}

// Ground nobody has surveyed (the mainland, seen from the island before anybody has crossed; the mainland past the
// edges of its own survey): bare paper, greyed, hatched across. The same colour as everything else a map leaves blank.
const UNSURVEYED = [196, 188, 170];
const HATCH = [150, 138, 118];
function blankPixel(d, k, px, py, step) {
  const on = (px + py) % step === 0;
  const c = on ? HATCH : UNSURVEYED;
  d[k * 4] = c[0];
  d[k * 4 + 1] = c[1];
  d[k * 4 + 2] = c[2];
  d[k * 4 + 3] = 255;
}

// The grid of the survey (a square every 80 m, on world lines, so it runs on unbroken from a map onto what is round it)
function grid(g, x0, z0, wm, hm, ppm, width) {
  g.strokeStyle = 'rgba(70, 48, 30, 0.16)';
  g.lineWidth = width;
  g.beginPath();
  for (let v = Math.ceil(x0 / 80) * 80; v <= x0 + wm; v += 80) {
    g.moveTo((v - x0) * ppm, 0);
    g.lineTo((v - x0) * ppm, hm * ppm);
  }
  for (let v = Math.ceil(z0 / 80) * 80; v <= z0 + hm; v += 80) {
    g.moveTo(0, (v - z0) * ppm);
    g.lineTo(wm * ppm, (v - z0) * ppm);
  }
  g.stroke();
}

// ---------------------------------------------------------------- round the map: the shore and the sea
// A layer of the map screen and the minimap, laid under the baked map: { cv, x0, z0, w, h, ppm } (x0 / z0: the world
// point of its top-left corner, w / h: metres across and down, ppm: its pixels a metre). Its middle, the map's own
// square, is left transparent.
//
// shoreImage(world) is its pixels, with no canvas (scripts/test-coast.js reads them): the island's are the shore past
// the valley's edge (shared/coast.js) - the far side of the hills, the cliffs and beaches, the shallows, the sea - in
// the survey's own look at its own resolution (a pixel a metre, as the map's raster), so nothing marks where the
// survey ends. The mainland's are the sea off its west edge and, past the other three, ground it does not cover.
export function shoreImage(world) {
  const island = world.kind === WORLD.ISLAND;
  const H = world.half;
  const ppm = island ? 1 : 0.5;
  const M = island ? SHORE.MARGIN + 8 : 160;
  const x0 = -H - M;
  const z0 = -H - M;
  const wm = world.size + 2 * M;
  const w = Math.round(wm * ppm);
  const shore = island ? islandShore(world.seed, world.heightAt) : null;
  const guess = island ? null : mainlandShoreGuess(world.seed);
  const hs = new Float32Array(w * w);
  const IN = H - 2.5 / ppm; // (inside this the map's own square covers it: a pixel or two of the valley's ground is
  // worked out beyond, so the shading of the first pixels outside is as the map's last ones inside)
  const blank = new Uint8Array(w * w);
  // The island's ground is worked out every GS m and read between those as the valley's heightfield is (bilinearly,
  // from its own 2 m grid): as smooth, at a quarter of the work.
  const GS = 2;
  const gn = island ? Math.ceil(wm / GS) + 2 : 0;
  const gh = new Float32Array(gn * gn);
  for (let j = 0; j < gn; j++) {
    for (let i = 0; i < gn; i++) {
      const x = x0 + i * GS;
      const z = z0 + j * GS;
      gh[j * gn + i] = Math.abs(x) < IN - GS && Math.abs(z) < IN - GS ? NaN : Math.abs(x) <= H && Math.abs(z) <= H ? world.heightAt(x, z) : shore.heightAt(x, z);
    }
  }
  const ground = (x, z) => {
    const fx = (x - x0) / GS;
    const fz = (z - z0) / GS;
    const i = fx | 0;
    const j = fz | 0;
    const tx = fx - i;
    const tz = fz - j;
    const k = j * gn + i;
    const a = gh[k] + (gh[k + 1] - gh[k]) * tx;
    const b = gh[k + gn] + (gh[k + gn + 1] - gh[k + gn]) * tx;
    return a + (b - a) * tz;
  };
  for (let py = 0; py < w; py++) {
    const z = z0 + (py + 0.5) / ppm;
    const gz = guess ? guess(z) : 0; // (the guessed shore of the mainland past its survey, on this row)
    for (let px = 0; px < w; px++) {
      const k = py * w + px;
      const x = x0 + (px + 0.5) / ppm;
      if (Math.abs(x) < IN && Math.abs(z) < IN) {
        hs[k] = NaN;
        continue;
      }
      if (Math.abs(x) <= H && Math.abs(z) <= H) hs[k] = world.heightAt(x, z);
      else if (island) hs[k] = ground(x, z);
      else if (x < -H || x < gz) hs[k] = WATER_LEVEL - SHORE.DEPTH; // (the open sea)
      else {
        hs[k] = NaN;
        blank[k] = 1;
      }
    }
  }
  const d = new Uint8ClampedArray(w * w * 4);
  shadeRaster(hs, w, w, d, noise(7654321), { shadeK: 0.55 * ppm });
  // ...and the valley's own ground worked out beyond its edge is the map's: transparent, as the map covers it
  for (let py = 0; py < w; py++) {
    const z = z0 + (py + 0.5) / ppm;
    for (let px = 0; px < w; px++) {
      const k = py * w + px;
      const x = x0 + (px + 0.5) / ppm;
      if (blank[k]) blankPixel(d, k, px, py, 6);
      else if (Math.abs(x) < H && Math.abs(z) < H) d[k * 4 + 3] = 0;
    }
  }
  return { data: d, x0, z0, w: wm, h: wm, px: w, ppm };
}

export function renderShore(world) {
  const s = shoreImage(world);
  const cv = document.createElement('canvas');
  cv.width = cv.height = s.px;
  const g = cv.getContext('2d');
  const img = g.createImageData(s.px, s.px);
  img.data.set(s.data);
  g.putImageData(img, 0, 0);
  grid(g, s.x0, s.z0, s.w, s.h, s.ppm, 0.5 * s.ppm);
  return { cv, x0: s.x0, z0: s.z0, w: s.w, h: s.h, ppm: s.ppm };
}

// ---------------------------------------------------------------- the bridge
// The bridge to the other map (shared/bridge.js plans it, shared/coast.js says where it is on either map), as a survey
// map draws one: the roadway between two lines (its trusses), flared where it meets the land, a pier under every joint
// between spans, what was left on it, and broken where the bridge is broken. The span that lost a truss has lost the
// half of its roadway that hung from it; the one whose top steel came down has it hatched across that lane; and on
// the mainland the span nearest the shore is gone - it went into the sea behind the car - and is a dashed outline
// in the water. (On the island, before the crossing, it still stands.)
//
// bridgeMarks(plan, fallen) is what is drawn, in world metres (scripts/test-coast.js holds it to the plan):
//   deck: [{ x0, x1, z0, z1 }] the roadway, in strips (a broken span's lost half left out)
//   rails: [{ x0, x1, z }] the trusses' lines; piers: [x]; wings: [{ x, dir }] the ends on land (dir: towards the land)
//   ruin: [{ x0, x1 }] a span that is gone; hatch: [{ x0, x1, z0, z1 }]; breaks: [{ x0, x1, z }] a broken edge
//   wrecks: [{ type, x, z, ry }]
export function bridgeMarks(plan, fallen) {
  const { PANEL, DECK } = BRIDGE;
  const half = DECK / 2;
  const z = plan.z;
  const out = { z, x0: plan.x0, x1: plan.x1, deck: [], rails: [], piers: [], wings: [{ x: plan.x0, dir: -1 }, { x: plan.x1, dir: 1 }], ruin: [], hatch: [], breaks: [], wrecks: [] };
  for (const sp of plan.spans) {
    if (sp.state === 'fallen' && fallen) {
      out.ruin.push({ x0: sp.x0, x1: sp.x1 });
      continue;
    }
    if (sp.state === 'broken') {
      // (its lost side: the middle panels, from two in from either pier)
      const b0 = sp.x0 + 2 * PANEL;
      const b1 = sp.x1 - 2 * PANEL;
      const keep = -sp.lost; // the side still there (+1: +z)
      out.deck.push({ x0: sp.x0, x1: sp.x1, z0: keep > 0 ? z : z - half, z1: keep > 0 ? z + half : z });
      out.deck.push({ x0: sp.x0, x1: b0, z0: keep > 0 ? z - half : z, z1: keep > 0 ? z : z + half }, { x0: b1, x1: sp.x1, z0: keep > 0 ? z - half : z, z1: keep > 0 ? z : z + half });
      out.rails.push({ x0: sp.x0, x1: sp.x1, z: z + keep * half }, { x0: sp.x0, x1: b0, z: z - keep * half }, { x0: b1, x1: sp.x1, z: z - keep * half });
      out.breaks.push({ x0: b0, x1: b1, z });
    } else {
      out.deck.push({ x0: sp.x0, x1: sp.x1, z0: z - half, z1: z + half });
      out.rails.push({ x0: sp.x0, x1: sp.x1, z: z - half }, { x0: sp.x0, x1: sp.x1, z: z + half });
      if (sp.state === 'damaged') {
        const side = sp.lost;
        out.hatch.push({ x0: sp.x0 + DAMAGED[0] * PANEL, x1: sp.x0 + DAMAGED[1] * PANEL, z0: side > 0 ? z : z - half, z1: side > 0 ? z + half : z });
      }
    }
  }
  // a pier at every joint between two spans (the island end and the mainland end stand on their abutments)
  for (const sp of plan.spans) if (sp.x0 > plan.x0 + 1) out.piers.push(sp.x0);
  for (const w of plan.wrecks) {
    const sp = plan.spans.find((s) => w.x >= s.x0 && w.x <= s.x1);
    if (sp && sp.state === 'fallen' && fallen) continue;
    out.wrecks.push({ type: w.type, x: w.x, z: z + w.lz, ry: w.ry });
  }
  return out;
}

// draws the marks onto g, a world point (x, z) being at ((x - x0) * ppm, (z - z0) * ppm). k: the bridge drawn k times as
// wide as it is (the widest view: at its scale the roadway would be a hair), and nothing on it
function drawBridge(g, m, x0, z0, ppm, k = 1) {
  const X = (x) => (x - x0) * ppm;
  const Y = (z) => (m.z + (z - m.z) * k - z0) * ppm; // (across the bridge, widened about its middle)
  const across = (dz) => dz * k * ppm;
  const ink = 'rgba(38, 28, 22, 0.92)';
  const lw = Math.max(1, 0.7 * ppm * k);
  const half = BRIDGE.DECK / 2;
  g.lineCap = 'butt';
  g.lineJoin = 'miter';
  // a span that is gone: where it lies in the water, sunk and askew - a shadow of its roadway, dashed round
  for (const r of m.ruin) {
    g.save();
    g.translate(X(r.x1), Y(m.z));
    g.rotate(0.05);
    g.fillStyle = 'rgba(38, 28, 22, 0.22)';
    g.fillRect(-(r.x1 - r.x0 - 2) * ppm, -across(half * 0.9), (r.x1 - r.x0 - 2) * ppm, across(half * 1.8));
    g.setLineDash([Math.max(2, 2 * ppm), Math.max(2, 1.4 * ppm)]);
    g.strokeStyle = 'rgba(38, 28, 22, 0.85)';
    g.lineWidth = lw;
    g.strokeRect(-(r.x1 - r.x0 - 2) * ppm, -across(half * 0.9), (r.x1 - r.x0 - 2) * ppm, across(half * 1.8));
    g.setLineDash([]);
    g.restore();
  }
  // the roadway: paper, as a road over the water
  g.fillStyle = 'rgba(222, 206, 170, 0.96)';
  for (const r of m.deck) g.fillRect(X(r.x0), Y(r.z0), (r.x1 - r.x0) * ppm, across(r.z1 - r.z0));
  // what is on it
  if (k === 1) {
    g.fillStyle = 'rgba(60, 44, 34, 0.75)';
    for (const w of m.wrecks) {
      const sz = PROP_SIZE[w.type] || [2, 4.5];
      g.save();
      g.translate(X(w.x), Y(w.z));
      g.rotate(-w.ry);
      g.fillRect((-sz[0] / 2) * ppm, (-sz[1] / 2) * ppm, sz[0] * ppm, sz[1] * ppm);
      g.restore();
    }
  }
  // the top steel down across a lane
  g.strokeStyle = 'rgba(38, 28, 22, 0.6)';
  g.lineWidth = Math.max(0.6, 0.3 * ppm);
  for (const r of m.hatch) {
    g.save();
    g.beginPath();
    g.rect(X(r.x0), Y(r.z0), (r.x1 - r.x0) * ppm, across(r.z1 - r.z0));
    g.clip();
    g.beginPath();
    const dz = (r.z1 - r.z0) * k;
    for (let x = r.x0 - 6 * k; x < r.x1 + 6 * k; x += 2.2 * k) {
      g.moveTo(X(x), Y(r.z0));
      g.lineTo(X(x + dz), Y(r.z1));
      g.moveTo(X(x + dz), Y(r.z0));
      g.lineTo(X(x), Y(r.z1));
    }
    g.stroke();
    g.restore();
  }
  // the trusses
  g.strokeStyle = ink;
  g.lineWidth = lw;
  g.beginPath();
  for (const r of m.rails) {
    g.moveTo(X(r.x0), Y(r.z));
    g.lineTo(X(r.x1), Y(r.z));
  }
  // the ends on land: the lines flare out, as a survey map ends a bridge
  for (const w of m.wings) {
    for (const s of [-1, 1]) {
      g.moveTo(X(w.x), Y(m.z + s * half));
      g.lineTo(X(w.x + w.dir * 4 * k), Y(m.z + s * (half + 4)));
    }
  }
  g.stroke();
  // the piers
  g.fillStyle = ink;
  for (const x of m.piers) g.fillRect(X(x) - Math.max(1, BRIDGE.PIER * ppm) / 2, Y(m.z - half - 1.4), Math.max(1, BRIDGE.PIER * ppm), across(BRIDGE.DECK + 2.8));
  // the broken edge of what is left of a span's roadway: a ragged line
  g.lineWidth = Math.max(0.8, 0.4 * ppm);
  g.beginPath();
  for (const b of m.breaks) {
    g.moveTo(X(b.x0), Y(b.z));
    let n = 0;
    for (let x = b.x0 + 1.6 * k; x < b.x1; x += 1.6 * k) g.lineTo(X(x), Y(b.z + (n++ % 2 ? 0.7 : -0.7)));
    g.lineTo(X(b.x1), Y(b.z));
  }
  g.stroke();
}

// The bridge's own layer, laid over the baked map (on the mainland its last span is inside the survey): a few hundred
// metres long and a few wide, at the map's resolution. null on a world without one.
export function renderBridge(world) {
  const geo = geography(world.seed);
  const island = world.kind === WORLD.ISLAND;
  const plan = island ? geo.bridge(true) : world.bridge || geo.bridge(false);
  const m = bridgeMarks(plan, !island);
  const pad = 14;
  const x0 = Math.min(plan.x0, plan.x1) - pad;
  const z0 = plan.z - BRIDGE.DECK / 2 - pad;
  const wm = Math.abs(plan.x1 - plan.x0) + 2 * pad;
  const hm = BRIDGE.DECK + 2 * pad;
  const ppm = MAP_PPM;
  const cv = document.createElement('canvas');
  cv.width = Math.ceil(wm * ppm);
  cv.height = Math.ceil(hm * ppm);
  drawBridge(cv.getContext('2d'), m, x0, z0, ppm);
  return { cv, x0, z0, w: cv.width / ppm, h: cv.height / ppm, ppm, marks: m };
}

// ---------------------------------------------------------------- both maps
// The field map's widest view (MapScreen zoomed out past its own map): the island and the mainland where they lie to
// each other (shared/coast.js geography), the sea between them and the bridge across it, at a fraction of the map's
// resolution. The map in hand is drawn from its bake. The other: on the island, the mainland nobody has been to is
// an outline - its shore as it might be guessed from the sea, unsurveyed paper, no names; on the mainland, the island
// the team came from, from what this page saw of it (ISLAND_SEEN), or its shape alone if it saw nothing (a rejoin).
export const OVERVIEW_PPM = 0.4;
// what was kept of the island when its map was baked, for the mainland's widest view: seed -> { edge, thumb }
const ISLAND_SEEN = new Map();
function thumbOf(cv) {
  const n = Math.round(MAP_SIZE * OVERVIEW_PPM * 1.5);
  const t = document.createElement('canvas');
  t.width = t.height = n;
  const g = t.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(cv, 0, 0, n, n);
  for (const k of [...ISLAND_SEEN.keys()]) ISLAND_SEEN.delete(k); // (one run's island at a time)
  return t;
}

export function renderOverview(world, baked) {
  const island = world.kind === WORLD.ISLAND;
  const geo = geography(world.seed);
  const ext = geo.extent(island);
  const ppm = OVERVIEW_PPM;
  const wm = ext.x1 - ext.x0;
  const hm = ext.z1 - ext.z0;
  const W = Math.round(wm * ppm);
  const Hpx = Math.round(hm * ppm);
  const H = world.half;
  // the other map's middle in this one's frame, and the island's shore (wherever the island is)
  const [ox, oz] = island ? geo.toIsland(0, 0) : [geo.island.x, geo.island.z];
  const seen = island ? null : ISLAND_SEEN.get(world.seed);
  const edgeAt = island ? world.heightAt : seen ? edgeFromProfile(seen.edge) : () => 26;
  const shore = islandShore(world.seed, edgeAt);
  const guess = mainlandShoreGuess(world.seed);
  const IH = MAP_SIZE / 2; // (the island's half)
  const MH = geo.mainland.half;
  const hs = new Float32Array(W * Hpx);
  const blank = new Uint8Array(W * Hpx);
  for (let py = 0; py < Hpx; py++) {
    const z = ext.z0 + (py + 0.5) / ppm;
    const gz = guess(island ? z - oz : z); // (the mainland's guessed shore on this row, in its frame)
    const nearIsland = Math.abs(island ? z : z - oz) < IH + SHORE.MARGIN;
    for (let px = 0; px < W; px++) {
      const x = ext.x0 + (px + 0.5) / ppm;
      const k = py * W + px;
      // where this pixel is on the island (its frame) and on the mainland (its frame)
      const ix = island ? x : x - ox;
      const iz = island ? z : z - oz;
      const mx = island ? x - ox : x;
      const mz = island ? z - oz : z;
      if (island && Math.abs(x) < H && Math.abs(z) < H) hs[k] = NaN; // (the map in hand: its bake goes over it)
      else if (!island && Math.abs(x) < H && Math.abs(z) < H) hs[k] = NaN;
      else if (Math.abs(ix) < IH && Math.abs(iz) < IH) hs[k] = island ? world.heightAt(ix, iz) : seen ? NaN : edgeAt(ix, iz) - 6;
      else if (nearIsland && Math.abs(ix) < IH + SHORE.MARGIN && shore.coast(ix, iz) < SHORE.SHELF + 4) hs[k] = shore.heightAt(ix, iz);
      else if (mx >= gz && (island || Math.abs(mz) > MH || mx > MH)) {
        hs[k] = NaN; // the mainland nobody has surveyed (from the island: all of it; from the mainland: past its edges)
        blank[k] = 1;
      } else hs[k] = WATER_LEVEL - SHORE.DEPTH;
    }
  }
  const d = new Uint8ClampedArray(W * Hpx * 4);
  shadeRaster(hs, W, Hpx, d, noise(24681357), { contours: false, shadeK: 0.55 * ppm });
  for (let k = 0; k < W * Hpx; k++) if (blank[k]) blankPixel(d, k, k % W, (k / W) | 0, 5);
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = Hpx;
  const g = cv.getContext('2d');
  const img = g.createImageData(W, Hpx);
  img.data.set(d);
  g.putImageData(img, 0, 0);
  const X = (x) => (x - ext.x0) * ppm;
  const Y = (z) => (z - ext.z0) * ppm;
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  // the map in hand, from its bake; on the mainland, the island as this page saw it
  if (baked) g.drawImage(baked, X(-H), Y(-H), world.size * ppm, world.size * ppm);
  if (seen) g.drawImage(seen.thumb, X(ox - IH), Y(oz - IH), MAP_SIZE * ppm, MAP_SIZE * ppm);
  grid(g, ext.x0, ext.z0, wm, hm, ppm, 1);
  // the unsurveyed mainland's shore, as a guess: dashed
  g.strokeStyle = 'rgba(70, 52, 36, 0.75)';
  g.lineWidth = 1.2;
  g.setLineDash([4, 3]);
  g.beginPath();
  let first = true;
  for (let mz = ext.z0 - (island ? oz : 0); mz <= ext.z1 - (island ? oz : 0); mz += 6) {
    const x = guess(mz) + (island ? ox : 0);
    const z = mz + (island ? oz : 0);
    if (!island && Math.abs(mz) <= MH) {
      first = true; // (the mainland's own survey draws its shore)
      continue;
    }
    if (first) g.moveTo(X(x), Y(z));
    else g.lineTo(X(x), Y(z));
    first = false;
  }
  g.stroke();
  g.setLineDash([]);
  // ...and the survey's edge round the mainland, once it is the map in hand (on the island: nobody has surveyed it)
  if (!island) {
    g.strokeStyle = 'rgba(70, 52, 36, 0.45)';
    g.strokeRect(X(-MH), Y(-MH), MH * 2 * ppm, MH * 2 * ppm);
  }
  // the bridge between them
  const plan = geo.bridge(island);
  drawBridge(g, bridgeMarks(plan, !island), ext.x0, ext.z0, ppm, 2.6);
  return { cv, x0: ext.x0, z0: ext.z0, w: wm, h: hm, ppm, other: { x: ox, z: oz }, bridge: plan };
}

const PROP_SIZE = {
  car: [1.9, 4.6],
  car_wreck: [1.9, 4.5],
  pickup_truck: [2.1, 5.4],
  school_bus: [2.6, 10.5],
  camper: [2.4, 6.6],
  dump_truck: [2.6, 7.2],
  tractor: [2, 3.8],
  military_tent: [4, 6],
  tent: [2.4, 2.8],
  heli_wreck: [3.2, 13],
  log_pile: [4.2, 2.4],
  fuel_tank: [2.2, 5],
  car_burnt: [1.9, 4.5],
  ambulance: [2.2, 5.6],
  semi_truck: [2.8, 16],
  fire_truck: [2.6, 8],
  shipping_container: [2.5, 6.1],
  airliner_wreck: [5, 28],
  plane_wreck: [3, 12],
  light_plane: [9, 7],
  rubble_slope: [6.4, 6.4],
  rubble_pile: [4.4, 4.4],
  car_open: [1.9, 4.5],
  city_bus: [2.6, 12],
  box_truck: [2.5, 7.5],
  van_wreck: [2, 5],
  apc_wreck: [2.9, 7],
  army_truck: [2.5, 7.5],
  triage_tent: [5, 7],
};
