// "Home": inside the walls the team has built (issue #303). At night the ambience crossfades to a quieter, warmer
// room tone there (ambience.js), so the base sounds like shelter and stepping out of it sounds exposed.
// Worked out on the client from the structures in the snapshot: nothing crosses the wire.
import { STRUCT, STRUCT_DEFS } from '../../shared/defs.js';

// what walls a place in: the pieces that stand between a survivor and the dark (not traps, lights or stations)
export const HOME_WALLS = new Set([STRUCT.BARRICADE, STRUCT.DOOR, STRUCT.WALL, STRUCT.GATE, STRUCT.METAL_WALL]);

// One night theme leaves the home bed out: nowhere feels safe on the night that comes over the walls.
export const HOMELESS_THEMES = new Set(['wings']);

const BINS = 36; // 10 degree sectors of the horizon around the listener
const TAU = Math.PI * 2;

// Hysteresis: it takes more wall to feel at home than to stop feeling it, and a little more distance to leave, so
// standing at the edge of the base does not flicker between the two. Pressed against the outside of a wall hides
// half the horizon, so home takes hold only once past the walls (0.6) and lets go a step or two outside them (0.42).
export const HOME_ENTER = { r: 8, n: 3, cover: 0.6 };
export const HOME_LEAVE = { r: 10, n: 2, cover: 0.42 };

const _bins = new Uint8Array(BINS);

// How walled in (x, z) is: n, the wall pieces whose centres are within r m, and cover, the share of the horizon
// (0..1) that they hide. structs: [{ x, z, yaw, stype }], yaw as the structure's model is turned (rotation.y).
export function enclosure(x, z, structs, r) {
  _bins.fill(0);
  let n = 0;
  const r2 = r * r;
  for (const st of structs) {
    if (!HOME_WALLS.has(st.stype)) continue;
    const dx = st.x - x;
    const dz = st.z - z;
    if (dx * dx + dz * dz > r2) continue;
    n++;
    // the wall's two ends (its long side is the model's x axis, turned by yaw about y)
    const h = STRUCT_DEFS[st.stype].sx / 2;
    const ex = Math.cos(st.yaw) * h;
    const ez = -Math.sin(st.yaw) * h;
    let a0 = Math.atan2(dx - ex, dz - ez);
    let a1 = Math.atan2(dx + ex, dz + ez);
    // the arc between the two ends that the wall actually spans (the shorter one)
    let span = a1 - a0;
    if (span > Math.PI) span -= TAU;
    else if (span < -Math.PI) span += TAU;
    if (span < 0) {
      a0 += span;
      span = -span;
    }
    for (let a = a0; a <= a0 + span + 1e-9; a += TAU / BINS / 2) _bins[(((Math.floor((a / TAU) * BINS) % BINS) + BINS) % BINS)] = 1;
    _bins[(((Math.floor(((a0 + span) / TAU) * BINS) % BINS) + BINS) % BINS)] = 1;
  }
  let c = 0;
  for (let i = 0; i < BINS; i++) c += _bins[i];
  return { n, cover: c / BINS };
}

// Inside the walls or not, with the hysteresis above. update() once per probe (game.js, every 0.2 s).
export class HomeSense {
  constructor() {
    this.home = false;
  }
  update(x, z, structs) {
    const t = this.home ? HOME_LEAVE : HOME_ENTER;
    const e = enclosure(x, z, structs, t.r);
    this.home = e.n >= t.n && e.cover >= t.cover;
    return this.home;
  }
}
