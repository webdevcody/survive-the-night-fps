// A smoker's smoke (ZTYPE.SMOKER, AREA.SMOKE): how deep in a cloud an eye is. The server only puts the clouds down
// (server/combat.js); what they do is on the client, which thickens the haze around a survivor whose eye is in one
// (render/environment.js, the `smoke` override) until they cannot see past a few metres.

// SMOKE.edge: the outer share of a cloud's radius that thins out to nothing (an eye walking in sees it close in, not a
// wall). SMOKE.height: how high over its foot a cloud stands
export const SMOKE = { edge: 0.35, height: 4.5 };

// How deep in the clouds an eye at (x, y, z) is: 0 out of all of them, 1 at the heart of one. clouds: { x, y, z,
// radius } - the thickest one counts
export function smokeCover(x, y, z, clouds) {
  let best = 0;
  for (const c of clouds) {
    if (!(c.radius > 0)) continue;
    const dy = y - c.y;
    if (dy < -1 || dy > SMOKE.height) continue;
    const d = Math.hypot(x - c.x, z - c.z) / c.radius;
    if (d >= 1) continue;
    const k = d <= 1 - SMOKE.edge ? 1 : (1 - d) / SMOKE.edge;
    if (k > best) best = k;
  }
  return best;
}
