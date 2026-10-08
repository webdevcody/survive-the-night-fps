// Bakes the field map of the valley (an old sepia survey map: hill shading, contour lines, forest
// stipple, water, roads, trails and building footprints) from the deterministic world once per world.
// Names and live markers are drawn on top by the map screen / compass, never baked in.
import { MAP_HALF, MAP_SIZE, GRID_STEP, WATER_LEVEL } from '../../shared/constants.js';
import { WHEEL } from '../../shared/fair.js';
import { WORLD } from '../../shared/acts.js';
import { BRIDGE, DAMAGED } from '../../shared/bridge.js';
import { SHORE, geography, islandLand, mainlandShoreGuess, farField, farFlora, farTreeDensity, mapMargin } from '../../shared/coast.js';
import { smoothstep } from '../../shared/rng.js';

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
  // (the survey's look, as shadeRaster below draws it, written out here for the speed of the one big raster)
  let seed = 1234567;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let py = 0; py < R; py++) {
    for (let px = 0; px < R; px++) {
      const k = py * R + px;
      const h = hs[k];
      const hl = hs[py * R + Math.max(0, px - 1)];
      const hr = hs[py * R + Math.min(R - 1, px + 1)];
      const hu = hs[Math.max(0, py - 1) * R + px];
      const hd = hs[Math.min(R - 1, py + 1) * R + px];
      // light from the north-west
      const shade = Math.max(-1, Math.min(1, ((hl - hr) + (hu - hd)) * 0.55));
      let r = 214;
      let gg = 199;
      let b = 164;
      // elevation tint: valleys a touch greener, heights paler
      const e = Math.max(0, Math.min(1, (h + 6) / 36));
      r += (e - 0.4) * 22;
      gg += (e - 0.4) * 16;
      b += (e - 0.4) * 6;
      r += shade * 34;
      gg += shade * 30;
      b += shade * 24;
      // contour lines every 2.5 m (index line every 10 m)
      const c0 = Math.floor(h / 2.5);
      if (Math.floor(hr / 2.5) !== c0 || Math.floor(hd / 2.5) !== c0) {
        const idx = Math.floor(Math.max(h, hr, hd) / 2.5) % 4 === 0;
        const a = idx ? 0.34 : 0.18;
        r = r * (1 - a) + 96 * a;
        gg = gg * (1 - a) + 64 * a;
        b = b * (1 - a) + 38 * a;
      }
      let n = (rnd() - 0.5) * 10;
      if (h < WATER_LEVEL) {
        const depth = Math.min(1, (WATER_LEVEL - h) / 5);
        r = 118 - depth * 34;
        gg = 136 - depth * 30;
        b = 138 - depth * 20;
        // shoreline ink
        if (hr >= WATER_LEVEL || hd >= WATER_LEVEL || hl >= WATER_LEVEL || hu >= WATER_LEVEL) {
          r = 70;
          gg = 78;
          b = 80;
        } else if (depth === 1) n = 0; // (deep water: the open sea's flat colour, SEA, which the view lays where no raster is)
      }
      d[k * 4] = r + n;
      d[k * 4 + 1] = gg + n;
      d[k * 4 + 2] = b + n;
      d[k * 4 + 3] = 255;
    }
  }
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
  // (not along the map's own edges: the layer round it draws those, as it draws every line past them)
  for (let v = 80; v < MAP_SIZE; v += 80) {
    g.beginPath();
    g.moveTo(v * S, 0);
    g.lineTo(v * S, MAP_PX);
    g.moveTo(0, v * S);
    g.lineTo(MAP_PX, v * S);
    g.stroke();
  }
  // (no vignette baked in: the sheet goes on past the survey now - the shore, the sea, the bridge, the other map - so
  // the age is the view's, darkening its edges wherever it is: ui2.css .map-view)
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
export function shadeRaster(hs, w, h, d, rnd, { contours = true, shadeK = 0.55, contourK = 1 } = {}) {
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
        const a = (idx ? 0.34 : 0.18) * contourK;
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
      // (no speckle on deep water: it is the open sea's flat colour, which the map screen and the minimap lay
      // where no raster is - SEA)
      const n = r === 84 && gg === 106 && b === 118 ? 0 : (rnd() - 0.5) * 10;
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

// ---------------------------------------------------------------- round the map: the land past its edge
// Layers of the map screen and the minimap, laid under the baked map: tiles of TILE m round its square, at the bake's
// own raster resolution (a pixel a metre), of the ground past the edge of the survey (world.far, sampled by
// shared/coast.js farField) in the survey's own look - on the island its hills running on down to the shore and the
// shallows, on the mainland its far country. Only the tiles with land or shallows in them are made: the open sea is no
// canvas at all, but the view's own colour (SEA, which the deep water of every raster here is drawn in exactly, with
// no speckle) and the grid drawn over it (MapScreen's map-sea). Each tile is { cv, x0, z0, w, h, ppm }; one that runs
// in over the map's square is transparent there, but for SHORE_IN m under the bake's rim (so no hairline shows).
export const SHORE_PPM = 1;
export const TILE = 64;
export const SHORE_FEATHER = 36; // m: the mainland band's outer rim fades out over this, into the widest view under it
const SHORE_IN = 2;
export const SEA = [84, 106, 118]; // (the deep water of shadeRaster)

// the tiles wanted: [{ x0, z0, w, h }]
export function shoreTiles(world) {
  const H = world.half;
  const M = mapMargin(world);
  const F = farField(world);
  const DEEP = WATER_LEVEL - 5 + 0.01; // (as deep as shadeRaster's water gets dark)
  // (tile edges on the map's edge, so none of them is half a hole: bands of up to TILE m out from it, and of TILE m
  // along it; those next to it reach SHORE_IN m in under the bake's rim)
  const nOut = Math.ceil(M / TILE);
  const cuts = [];
  for (let k = 0; k <= nOut; k++) cuts.push(-H - M + (k * M) / nOut);
  for (let v = -H + TILE; v < H; v += TILE) cuts.push(v);
  for (let k = 0; k <= nOut; k++) cuts.push(H + (k * M) / nOut);
  const out = [];
  for (let tj = 0; tj + 1 < cuts.length; tj++) {
    for (let ti = 0; ti + 1 < cuts.length; ti++) {
      let x0 = cuts[ti], x1 = cuts[ti + 1], z0 = cuts[tj], z1 = cuts[tj + 1];
      const outX = x1 <= -H || x0 >= H;
      const outZ = z1 <= -H || z0 >= H;
      if (!outX && !outZ) continue; // (under the bake)
      if (x1 === -H) x1 += SHORE_IN;
      if (x0 === H) x0 -= SHORE_IN;
      if (z1 === -H) z1 += SHORE_IN;
      if (z0 === H) z0 -= SHORE_IN;
      // (each runs a metre on under its east and south neighbours: no hairline between two drawn scaled)
      if (x1 < H + M) x1 += 1;
      if (z1 < H + M) z1 += 1;
      // (open sea through and through, and a sample's width round it: none)
      let wet = true;
      for (let z = z0 - F.step; z <= z1 + F.step && wet; z += F.step / 2) for (let x = x0 - F.step; x <= x1 + F.step && wet; x += F.step / 2) if (F.at(x, z) > DEEP) wet = false;
      if (!wet) out.push({ x0, z0, w: x1 - x0, h: z1 - z0 });
    }
  }
  return out;
}

// A tile's pixels, with no canvas (scripts/test-coast.js reads them)
export function shoreTile(world, R) {
  const H = world.half;
  const F = farField(world);
  const ppm = SHORE_PPM;
  // (a pixel more all round, so the shading at the tile's edge is worked out from its true neighbours)
  const w = Math.round(R.w * ppm);
  const h = Math.round(R.h * ppm);
  const W = w + 2;
  const Hh = h + 2;
  const hs = new Float32Array(W * Hh);
  const IN = H - SHORE_IN - 2;
  for (let py = 0; py < Hh; py++) {
    const z = R.z0 + (py - 0.5) / ppm;
    for (let px = 0; px < W; px++) {
      const x = R.x0 + (px - 0.5) / ppm;
      hs[py * W + px] = Math.abs(x) < IN && Math.abs(z) < IN ? NaN : Math.abs(x) <= H && Math.abs(z) <= H ? world.heightAt(x, z) : F.cubic(x, z);
    }
  }
  const full = new Uint8ClampedArray(W * Hh * 4);
  shadeRaster(hs, W, Hh, full, noise(7654321 + ((R.x0 * 31 + R.z0 * 17) | 0)), { shadeK: 0.55 * ppm, contourK: ppm });
  const data = new Uint8ClampedArray(w * h * 4);
  for (let py = 0; py < h; py++) data.set(full.subarray(((py + 1) * W + 1) * 4, ((py + 1) * W + 1 + w) * 4), py * w * 4);
  // (the band's outer rim fades out into the widest view's coarser picture under it, on a map whose band ends on land:
  // so no line marks where the detail stops - on the island it ends in open sea, the same either side)
  const OUT = H + mapMargin(world);
  const FEATHER = world.kind === WORLD.MAINLAND ? SHORE_FEATHER : 0;
  if (FEATHER) {
    for (let py = 0; py < h; py++) {
      const z = R.z0 + (py + 0.5) / ppm;
      for (let px = 0; px < w; px++) {
        const m = OUT - Math.max(Math.abs(R.x0 + (px + 0.5) / ppm), Math.abs(z));
        if (m < FEATHER) data[(py * w + px) * 4 + 3] = Math.round(255 * Math.max(0, m / FEATHER) ** 1.5);
      }
    }
  }
  // (the map's own square is the bake's: transparent, but for a sliver under its rim)
  const HOLE = H - SHORE_IN + 0.5;
  for (let py = 0; py < h; py++) {
    const z = R.z0 + (py + 0.5) / ppm;
    if (Math.abs(z) >= HOLE) continue;
    for (let px = 0; px < w; px++) if (Math.abs(R.x0 + (px + 0.5) / ppm) < HOLE) data[(py * w + px) * 4 + 3] = 0;
  }
  // (and only as much of the tile as has something in it but the open sea, which the view under it is already: a coast
  // tile is mostly sea, and memory is pixels)
  let cx0 = w, cy0 = h, cx1 = -1, cy1 = -1;
  for (let py = 0; py < h; py++) {
    for (let px = 0, k = py * w * 4; px < w; px++, k += 4) {
      if (data[k + 3] === 0 || (data[k + 3] === 255 && data[k] === SEA[0] && data[k + 1] === SEA[1] && data[k + 2] === SEA[2])) continue;
      if (px < cx0) cx0 = px;
      if (px > cx1) cx1 = px;
      if (py < cy0) cy0 = py;
      if (py > cy1) cy1 = py;
    }
  }
  if (cx1 < 0) cx0 = cx1 = cy0 = cy1 = 0;
  // (a couple of pixels round it, for the woods' dots on the shore)
  cx0 = Math.max(0, cx0 - 2);
  cy0 = Math.max(0, cy0 - 2);
  cx1 = Math.min(w - 1, cx1 + 2);
  cy1 = Math.min(h - 1, cy1 + 2);
  const cw = cx1 - cx0 + 1;
  const ch = cy1 - cy0 + 1;
  if (cw === w && ch === h) return { data, x0: R.x0, z0: R.z0, w: R.w, h: R.h, pw: w, ph: h, ppm };
  const crop = new Uint8ClampedArray(cw * ch * 4);
  for (let py = 0; py < ch; py++) crop.set(data.subarray(((cy0 + py) * w + cx0) * 4, ((cy0 + py) * w + cx0 + cw) * 4), py * cw * 4);
  return { data: crop, x0: R.x0 + cx0 / ppm, z0: R.z0 + cy0 / ppm, w: cw / ppm, h: ch / ppm, pw: cw, ph: ch, ppm };
}

export function renderShoreTile(world, R) {
  const s = shoreTile(world, R);
  const cv = document.createElement('canvas');
  cv.width = s.pw;
  cv.height = s.ph;
  const g = cv.getContext('2d');
  const img = g.createImageData(s.pw, s.ph);
  img.data.set(s.data);
  g.putImageData(img, 0, 0);
  stipple(g, farFlora(world).trees, s.x0, s.z0, s.ppm, s);
  grid(g, s.x0, s.z0, s.w, s.h, s.ppm, 0.5 * s.ppm);
  return { cv, x0: s.x0, z0: s.z0, w: s.w, h: s.h, ppm: s.ppm };
}

// ...and all of them: { strips: tiles, x0, z0, w, h }. baked: the map's own canvas (on the island a small copy of the
// two together is kept, for the mainland's widest view: keepIsland)
export function shoreLayers(world, strips, baked = null) {
  const H = world.half;
  const M = mapMargin(world);
  const L = { strips, x0: -H - M, z0: -H - M, w: 2 * (H + M), h: 2 * (H + M) };
  if (world.kind === WORLD.ISLAND && baked) keepIsland(world, L, baked);
  return L;
}

// the woods as the bake draws them (a dot a tree, and a darker one for every other), on a raster of ppm px a metre; R:
// only those in this rectangle (and a little round it)
function stipple(g, T, x0, z0, ppm, R = null, k = 1) {
  const f = ppm / MAP_PPM; // (the bake's dots are sized in its own pixels, two a metre)
  const inR = (x, z) => !R || (x > R.x0 - 4 && x < R.x0 + R.w + 4 && z > R.z0 - 4 && z < R.z0 + R.h + 4);
  g.fillStyle = 'rgba(58, 74, 52, 0.42)';
  g.beginPath();
  for (let i = 0; i < T.length; i += 6) {
    if (!inR(T[i], T[i + 2])) continue;
    const x = (T[i] - x0) * ppm;
    const y = (T[i + 2] - z0) * ppm;
    const r = Math.max(0.35, (1.1 + T[i + 3] * 1.3) * f * k);
    g.moveTo(x + r, y);
    g.arc(x, y, r, 0, Math.PI * 2);
  }
  g.fill();
  g.fillStyle = 'rgba(40, 52, 36, 0.35)';
  g.beginPath();
  for (let i = 0; i < T.length; i += 12) {
    if (!inR(T[i], T[i + 2])) continue;
    const x = (T[i] - x0) * ppm + 0.8 * f;
    const y = (T[i + 2] - z0) * ppm + 0.8 * f;
    const r = Math.max(0.3, 0.9 * f * k);
    g.moveTo(x + r, y);
    g.arc(x, y, r, 0, Math.PI * 2);
  }
  g.fill();
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
  // (only as far as the map's strips reach: past them the widest view draws it, and the closer views cannot pan there)
  const reach = world.half + mapMargin(world);
  const x0 = Math.max(Math.min(plan.x0, plan.x1) - pad, -reach);
  const z0 = plan.z - BRIDGE.DECK / 2 - pad;
  const wm = Math.min(Math.max(plan.x0, plan.x1) + pad, reach) - x0;
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
// each other (shared/coast.js geography), the sea between them and the bridge across it. The map in hand is its bake
// and its strips, shown small; this is only what lies past them, at overviewPpm: the sea, the bridge, the other map
// (on the island the mainland nobody has been to - its shore as it might be guessed from the sea, unsurveyed paper, no
// names; on the mainland the island the team came from, from what this page saw of it, ISLAND_SEEN, or its shape alone
// if it saw nothing: a rejoin), and on the mainland its far country past the strips.
// (px a metre: on the mainland about as fine as the view shows it, so its far country goes on from the band round the
// map in the same grain; from the island it is the sea and paper nobody has surveyed, and half that does)
export const overviewPpm = (world) => (world.kind === WORLD.MAINLAND ? 0.2 : 0.1);
// what was kept of the island when its map was baked, for the mainland's widest view: seed -> { thumb, x0, w }
const ISLAND_SEEN = new Map();
function keepIsland(world, L, baked) {
  const n = Math.round(L.w * 0.2); // (drawn in the mainland's)
  const t = document.createElement('canvas');
  t.width = t.height = n;
  const g = t.getContext('2d');
  g.imageSmoothingQuality = 'high';
  const k = n / L.w;
  for (const s of L.strips) g.drawImage(s.cv, (s.x0 - L.x0) * k, (s.z0 - L.z0) * k, s.w * k, s.h * k);
  g.drawImage(baked, (-world.half - L.x0) * k, (-world.half - L.z0) * k, world.size * k, world.size * k);
  ISLAND_SEEN.clear(); // (one run's island at a time)
  ISLAND_SEEN.set(world.seed, { thumb: t, x0: L.x0, w: L.w });
}

// The widest view's pixels, with no canvas (scripts/test-coast.js reads them): { d (RGBA), W, Hpx, ext, ppm, ox, oz,
// seen }. all: the map's own square and band too (which the view leaves to them), so a test can hold the two alike.
export function overviewRaster(world, { all = false } = {}) {
  const island = world.kind === WORLD.ISLAND;
  const geo = geography(world.seed);
  const ext = geo.extent(island);
  const ppm = overviewPpm(world);
  const wm = ext.x1 - ext.x0;
  const hm = ext.z1 - ext.z0;
  const W = Math.round(wm * ppm);
  const Hpx = Math.round(hm * ppm);
  // (the map in hand and its strips reach this far: they are drawn over this; on the mainland it runs on in under the
  // band's feathered rim, which fades into it)
  const D = all ? -1 : world.half + mapMargin(world) - (island ? 4 : SHORE_FEATHER + 1 / ppm);
  const [ox, oz] = island ? geo.toIsland(0, 0) : [geo.island.x, geo.island.z];
  const seen = island ? null : ISLAND_SEEN.get(world.seed);
  const isle = island ? null : islandLand(world.seed); // (the island's shape, where this page never saw it)
  const guess = mainlandShoreGuess(world.seed);
  const IH = MAP_SIZE / 2;
  const IM = IH + SHORE.MARGIN;
  // the mainland's far country, from world.far every 32 m (only on the mainland: from the island nobody has seen it)
  const CS = 32;
  const cn = Math.ceil(Math.max(wm, hm) / CS) + 4;
  const coarse = island ? null : new Float32Array(cn * cn).fill(NaN);
  const cr = (p0, p1, p2, p3, t) => {
    const u = 1 - t;
    const t2 = t * t;
    return (p0 * u * u * u + p1 * (3 * t2 * t - 6 * t2 + 4) + p2 * (-3 * t2 * t + 3 * t2 + 3 * t + 1) + p3 * t2 * t) / 6;
  };
  const v = (ii, jj) => {
    const k = (jj + 1) * cn + ii + 1; // (a sample's margin all round)
    if (coarse[k] !== coarse[k]) coarse[k] = world.far(ext.x0 + ii * CS, ext.z0 + jj * CS);
    return coarse[k];
  };
  // (a cubic B-spline through them: smooth enough to shade - its slope and its bend run on across the samples, where
  // straight lines between them would shade in squares, and an interpolating curve in streaks along the rows of them;
  // down each column of samples once a row of pixels, then along the row)
  const col = new Float32Array(cn);
  let colZ = NaN;
  const far = (x, z) => {
    const fz = (z - ext.z0) / CS;
    const j = fz | 0;
    if (z !== colZ) {
      colZ = z;
      col.fill(NaN);
    }
    const fx = (x - ext.x0) / CS;
    const i = fx | 0;
    const tz = fz - j;
    const c = (ii) => {
      if (col[ii + 1] !== col[ii + 1]) col[ii + 1] = cr(v(ii, j - 1), v(ii, j), v(ii, j + 1), v(ii, j + 2), tz);
      return col[ii + 1];
    };
    return cr(c(i - 1), c(i), c(i + 1), c(i + 2), fx - i);
  };
  const DEEP = NaN; // (the open sea: transparent - the view's own colour, SEA, shows through)
  const hs = new Float32Array(W * Hpx);
  // (along the mainland's river where it runs in from past the edge, the ground itself, not the coarse picture: a
  // valley too narrow for it, and the water in it)
  const exact = new Float32Array(W * Hpx).fill(1e9); // (how far from it)
  const RX = 40;
  const up = !island && world.river && world.river.up;
  if (up && up.length >= 2) {
    const P = [...up, world.river.pts[0], world.river.pts[1]];
    const R = RX;
    for (let s = 0; s + 3 < P.length; s += 2) {
      const [ax, az, bx, bz] = [P[s], P[s + 1], P[s + 2], P[s + 3]];
      const l2 = (bx - ax) ** 2 + (bz - az) ** 2 || 1;
      const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - R - ext.x0) * ppm));
      const i1 = Math.min(W - 1, Math.ceil((Math.max(ax, bx) + R - ext.x0) * ppm));
      const j0 = Math.max(0, Math.floor((Math.min(az, bz) - R - ext.z0) * ppm));
      const j1 = Math.min(Hpx - 1, Math.ceil((Math.max(az, bz) + R - ext.z0) * ppm));
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const x = ext.x0 + (i + 0.5) / ppm;
          const z = ext.z0 + (j + 0.5) / ppm;
          const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / l2));
          exact[j * W + i] = Math.min(exact[j * W + i], Math.hypot(x - ax - (bx - ax) * t, z - az - (bz - az) * t));
        }
      }
    }
  }
  const blank = new Uint8Array(W * Hpx);
  for (let py = 0; py < Hpx; py++) {
    const z = ext.z0 + (py + 0.5) / ppm;
    const gz = guess(island ? z - oz : z);
    const iz = island ? z : z - oz;
    for (let px = 0; px < W; px++) {
      const x = ext.x0 + (px + 0.5) / ppm;
      const k = py * W + px;
      const ix = island ? x : x - ox;
      const mx = island ? x - ox : x;
      if (Math.abs(x) < D && Math.abs(z) < D) hs[k] = NaN; // (under the map and its strips)
      else if (!island && Math.abs(ix) < IM && Math.abs(iz) < IM) hs[k] = seen ? DEEP : isle.land(ix, iz, 3);
      else if (island) {
        if (mx >= gz) {
          hs[k] = NaN; // the mainland nobody has surveyed
          blank[k] = 1;
        } else hs[k] = DEEP;
      } else if (mx < gz - 60) hs[k] = DEEP;
      else if (exact[k] < RX) {
        // (and into the coarse picture round it, with no line where the one gives way to the other)
        const e = world.far(x, z);
        hs[k] = e + (far(x, z) - e) * smoothstep(RX * 0.4, RX, exact[k]);
      } else hs[k] = far(x, z);
    }
  }
  const d = new Uint8ClampedArray(W * Hpx * 4);
  shadeRaster(hs, W, Hpx, d, noise(24681357), { shadeK: 0.55 * ppm, contours: false });
  // (contours too fine to draw at this scale, as the tone they give the map in hand when it is drawn this small: the
  // share of its pixels a contour runs through - a line every 2.5 m of rise, across a pixel's rows and its columns -
  // one in four an index line)
  for (let py = 1; py < Hpx - 1; py++) {
    for (let px = 1; px < W - 1; px++) {
      const k = py * W + px;
      const h = hs[k];
      if (h !== h || h < WATER_LEVEL) continue;
      const gx = hs[k + 1] - hs[k - 1];
      const gz = hs[k + W] - hs[k - W];
      if (gx !== gx || gz !== gz) continue;
      const a = Math.min(1, ((Math.abs(gx) + Math.abs(gz)) * ppm) / 2 / 2.5) * CONTOUR_TONE;
      d[k * 4] += (96 - d[k * 4]) * a;
      d[k * 4 + 1] += (64 - d[k * 4 + 1]) * a;
      d[k * 4 + 2] += (38 - d[k * 4 + 2]) * a;
    }
  }
  // (the woods, too small to dot at this scale, as the band's dots look drawn this small - a pixel of it is a point of
  // the band's picture, on a dot or not: on a light one as often as they cover the ground, a tree's each, and on a dark
  // one as often as theirs do, every other tree's)
  const dens = !island && world.flora ? farTreeDensity(world) : null;
  if (dens) {
    // (worked out every DS pixels and taken between: the odds change over a hundred metres, not a pixel)
    const DS = 4;
    const woods = noise(13572468);
    const gw = Math.ceil(W / DS) + 2;
    const gd = new Float32Array(gw * (Math.ceil(Hpx / DS) + 2)).fill(NaN);
    const gv = (i, j) => {
      const q = j * gw + i;
      if (gd[q] !== gd[q]) gd[q] = dens(ext.x0 + (i * DS + 0.5) / ppm, ext.z0 + (j * DS + 0.5) / ppm);
      return gd[q];
    };
    for (let py = 0; py < Hpx; py += 1) {
      const j = (py / DS) | 0;
      const tz = py / DS - j;
      for (let px = 0; px < W; px++) {
        const k = py * W + px;
        if (hs[k] !== hs[k] || hs[k] < WATER_LEVEL + 1.6) continue;
        const i = (px / DS) | 0;
        const tx = px / DS - i;
        const a0 = gv(i, j) + (gv(i + 1, j) - gv(i, j)) * tx;
        const n = a0 + (gv(i, j + 1) + (gv(i + 1, j + 1) - gv(i, j + 1)) * tx - a0) * tz;
        if (n <= 0) continue;
        const t = woods() < 1 - Math.exp(-n * DOT_AREA) ? 0.42 : 0;
        d[k * 4] += (58 - d[k * 4]) * t;
        d[k * 4 + 1] += (74 - d[k * 4 + 1]) * t;
        d[k * 4 + 2] += (52 - d[k * 4 + 2]) * t;
        const t2 = woods() < 1 - Math.exp(-n * 0.5 * DOT2_AREA) ? 0.35 : 0;
        d[k * 4] += (40 - d[k * 4]) * t2;
        d[k * 4 + 1] += (52 - d[k * 4 + 1]) * t2;
        d[k * 4 + 2] += (36 - d[k * 4 + 2]) * t2;
      }
    }
  }
  for (let k = 0; k < W * Hpx; k++) if (blank[k]) blankPixel(d, k, k % W, (k / W) | 0, 3);
  return { d, W, Hpx, ext, ppm, ox, oz, seen, wm, hm };
}
// (the stipple's dots, in square metres: a tree's light dot at its mean size, and the dark one)
const DOT_AREA = Math.PI * ((1.1 + 1.3 * 1.025) / MAP_PPM) ** 2;
const DOT2_AREA = Math.PI * (0.9 / MAP_PPM) ** 2;
const CONTOUR_TONE = 0.13;

export function renderOverview(world) {
  const island = world.kind === WORLD.ISLAND;
  const geo = geography(world.seed);
  const { d, W, Hpx, ext, ppm, ox, oz, seen, wm, hm } = overviewRaster(world);
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
  if (seen) g.drawImage(seen.thumb, X(ox + seen.x0), Y(oz + seen.x0), seen.w * ppm, seen.w * ppm);
  grid(g, ext.x0, ext.z0, wm, hm, ppm, 0.6);
  // from the island: the unsurveyed mainland's shore, as a guess, dashed
  if (island) {
    const guess = mainlandShoreGuess(world.seed);
    g.strokeStyle = 'rgba(70, 52, 36, 0.75)';
    g.lineWidth = 0.8;
    g.setLineDash([2, 2]);
    g.beginPath();
    for (let mz = ext.z0 - oz, first = true; mz <= ext.z1 - oz; mz += 16, first = false) {
      if (first) g.moveTo(X(guess(mz) + ox), Y(mz + oz));
      else g.lineTo(X(guess(mz) + ox), Y(mz + oz));
    }
    g.stroke();
    g.setLineDash([]);
  }
  // the bridge between them, drawn wide enough to be seen at this scale
  const plan = geo.bridge(island);
  drawBridge(g, bridgeMarks(plan, !island), ext.x0, ext.z0, ppm, 4);
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
