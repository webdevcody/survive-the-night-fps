// The island's AIRPORT signs (issue #269): green highway plates hung on the power poles of Route 9, on the stretch
// from the breakdown to where the road leaves the island for the bridge, each one turned to whoever walks that way.
// They are only drawn (citykit.js buildSigns, the city atlas's 'road_airport'): a plate is up out of reach on a pole
// that already has its collider, and the world's generation is not touched (a game carried over by a deploy keeps
// its map). -> [{ x, y, z, ry, w, h, cell, back }], what citykit.js sign() lays down.
import { WORLD } from '../../shared/acts.js';

export const AIRPORT_SIGN = { W: 1.6, H: 0.8, UP: 2.4, EVERY: 1, MAX: 8 };

export function airportSigns(world) {
  if (world.kind === WORLD.MAINLAND || !world.car) return [];
  const p = world.highway?.pts;
  if (!p || p.length < 8) return [];
  const n = p.length / 2;
  // the end of Route 9 the bridge goes on from (mapcanvas.js: the end further east)
  const iB = p[(n - 1) * 2] > p[0] ? n - 1 : 0;
  const near = (x, z) => {
    let best = -1, bd = Infinity;
    for (let i = 0; i < n; i++) {
      const d = Math.hypot(p[i * 2] - x, p[i * 2 + 1] - z);
      if (d < bd) [best, bd] = [i, d];
    }
    return [best, bd];
  };
  const [iC] = near(world.car.x, world.car.z);
  const step = iB >= iC ? 1 : -1;
  const lo = Math.min(iC, iB), hi = Math.max(iC, iB);
  const poles = [];
  for (const pr of world.props || []) {
    if (pr.type !== 'power_pole') continue;
    const [i, d] = near(pr.x, pr.z);
    if (d < 12 && i >= lo && i <= hi && i + step >= 0 && i + step < n) poles.push({ pr, i, along: (i - iC) * step });
  }
  poles.sort((a, b) => a.along - b.along);
  const out = [];
  for (let k = 0; k < poles.length && out.length < AIRPORT_SIGN.MAX; k += AIRPORT_SIGN.EVERY) {
    const { pr, i } = poles[k];
    // the way to the bridge here, and the road from the pole
    let tx = p[(i + step) * 2] - p[i * 2];
    let tz = p[(i + step) * 2 + 1] - p[i * 2 + 1];
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl;
    tz /= tl;
    let rx = p[i * 2] - pr.x;
    let rz = p[i * 2 + 1] - pr.z;
    const rl = Math.hypot(rx, rz) || 1;
    rx /= rl;
    rz /= rl;
    const off = AIRPORT_SIGN.W / 2 + 0.2; // (beside the pole, over the shoulder)
    // a sign's face looks out along its frame's -z (citykit.js sign): back down the road, at whoever is coming
    const x = pr.x + rx * off;
    const z = pr.z + rz * off;
    const ground = Math.max(pr.y, world.heightAt ? world.heightAt(x, z) : pr.y); // (on a slope: up off the higher side)
    out.push({ x, y: ground + AIRPORT_SIGN.UP + AIRPORT_SIGN.H / 2, z, ry: Math.atan2(tx, tz), w: AIRPORT_SIGN.W, h: AIRPORT_SIGN.H, cell: 'road_airport', back: 0.04 });
  }
  return out;
}
