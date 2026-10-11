// The night's home bed (issue #303, client/audio/home.js and ambience.js): inside the walls the team has built the
// ambience crossfades to a warm room tone.
//   - detection: a walled ring is home from anywhere inside it, open ground, a single wall or the far side of a base
//     are not, and traps, lights and stations do not count as walls
//   - hysteresis: walking slowly out of a base flips home off once (and back on once walking in), never flickering
//     at the edge
//   - the crossfade is done within 1.5 s; the room tone loops cleanly and sits under the night drone
//   - one night theme (and only themes that exist) leaves the home bed out
// usage: node scripts/test-home.js
import { enclosure, HomeSense, HOME_ENTER, HOME_LEAVE, HOMELESS_THEMES } from '../client/audio/home.js';
import { HOME_TC, HOME_TONE } from '../client/audio/ambience.js';
import { bedHome } from '../client/audio/synth-amb.js';
import { LO } from '../client/audio/synth.js';
import { STRUCT } from '../shared/defs.js';
import { NIGHT_THEMES } from '../shared/nights.js';
import { mulberry32 } from '../shared/rng.js';

let fails = 0;
const check = (ok, msg) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!ok) fails++;
};

// a square ring of `per` 3 m walls a side around (cx, cz), each wall along its side (yaw 0: along x)
function ring(cx, cz, per, stype = STRUCT.WALL, gap = -1) {
  const half = (per * 3) / 2;
  const out = [];
  let k = 0;
  for (let i = 0; i < per; i++) {
    const t = -half + 1.5 + i * 3;
    for (const [x, z, yaw] of [[cx + t, cz - half, 0], [cx + t, cz + half, 0], [cx - half, cz + t, Math.PI / 2], [cx + half, cz + t, Math.PI / 2]]) {
      if (k++ !== gap) out.push({ x, z, yaw, stype });
    }
  }
  return out;
}

// ---- detection
const base = ring(0, 0, 3); // a 9 m square, 12 walls
const e0 = enclosure(0, 0, base, HOME_ENTER.r);
check(e0.n === 12 && e0.cover > 0.95, `the middle of a 9 m walled square is walled in (n ${e0.n}, cover ${e0.cover.toFixed(2)})`);
check(new HomeSense().update(0, 0, base), 'the middle of the base is home');
check(new HomeSense().update(3, 3, base), 'a corner inside the base is home');
check(new HomeSense().update(0, 0, ring(0, 0, 3, STRUCT.BARRICADE, 4)), 'a ring of barricades with a gap in it is still home');
check(!new HomeSense().update(0, 0, []), 'open ground is not home');
check(!new HomeSense().update(0, 1, [{ x: 0, z: 0, yaw: 0, stype: STRUCT.WALL }]), 'standing against one wall is not home');
check(!new HomeSense().update(0, -5, base), 'pressed against the outside of the base is not home yet');
const out1 = enclosure(0, -9, base, HOME_ENTER.r);
check(!new HomeSense().update(0, -9, base), `4.5 m outside the base's wall is not home (n ${out1.n}, cover ${out1.cover.toFixed(2)})`);
check(!new HomeSense().update(0, 0, ring(0, 0, 3, STRUCT.SPIKES)), 'a ring of spike traps is not a wall');
check(!new HomeSense().update(0, 0, ring(0, 0, 3, STRUCT.TORCH)), 'a ring of torches is not a wall');
// a turned wall covers as much horizon as an unturned one at the same spot (its yaw is honoured, not ignored)
const side = enclosure(0, 0, [{ x: 0, z: 3, yaw: 0, stype: STRUCT.WALL }], 8).cover;
const edge = enclosure(0, 0, [{ x: 0, z: 3, yaw: Math.PI / 2, stype: STRUCT.WALL }], 8).cover;
check(side > 0.12 && edge < 0.06, `a wall faced side-on hides more of the horizon than one end-on (${side.toFixed(2)} vs ${edge.toFixed(2)})`);

// ---- hysteresis: walk out of the base and back in, 5 cm a step, and count the flips
{
  const h = new HomeSense();
  let flips = 0;
  let prev = h.update(0, 0, base);
  const path = [];
  for (let z = 0; z >= -16; z -= 0.05) path.push(z);
  for (let z = -16; z <= 0; z += 0.05) path.push(z);
  let leftAt = null;
  let backAt = null;
  for (const z of path) {
    const now = h.update(0, z, base);
    if (now !== prev) {
      flips++;
      if (!now) leftAt = z;
      else backAt = z;
    }
    prev = now;
  }
  check(flips === 2, `walking out and back in flips home twice, not more (${flips})`);
  // (the wall is at z = -4.5)
  check(leftAt !== null && backAt !== null && leftAt < backAt, `it lets go further out than it takes hold (out at ${leftAt?.toFixed(2)} m, in at ${backAt?.toFixed(2)} m)`);
  check(backAt > -4.5 && leftAt > -4.5 - 3, 'it takes hold once inside the wall and lets go within 3 m outside it');
  // jitter right where it let go: stays out
  const j = new HomeSense();
  j.update(0, 0, base);
  for (let z = 0; z >= leftAt; z -= 0.05) j.update(0, z, base);
  let jf = 0;
  let jp = j.home;
  for (let i = 0; i < 200; i++) {
    const v = j.update(0, leftAt + (i % 2 ? 0.3 : -0.3), base);
    if (v !== jp) jf++;
    jp = v;
  }
  check(jf <= 1, `stepping back and forth across the edge does not flicker (${jf} flips in 200 steps)`);
}
check(HOME_LEAVE.r > HOME_ENTER.r && HOME_LEAVE.cover < HOME_ENTER.cover && HOME_LEAVE.n < HOME_ENTER.n, 'leaving takes less wall than entering');

// ---- the crossfade and the room tone
check(3 * HOME_TC < 1.5, `the crossfade is 95% done in ${(3 * HOME_TC).toFixed(2)} s (under 1.5 s)`);
{
  const [l, r] = bedHome(LO, mulberry32(7));
  let ok = l.length > LO * 5 && l.length === r.length;
  let sum = 0;
  for (const c of [l, r]) for (let i = 0; i < c.length; i++) {
    if (!Number.isFinite(c[i]) || Math.abs(c[i]) > 1) ok = false;
    sum += c[i] * c[i];
  }
  const rms = Math.sqrt(sum / (l.length * 2));
  check(ok, `the room tone is a finite stereo loop of ${(l.length / LO).toFixed(1)} s`);
  const seam = Math.max(Math.abs(l[0] - l[l.length - 1]), Math.abs(r[0] - r[r.length - 1]));
  check(seam < 0.05, `it loops without a click (seam step ${seam.toFixed(4)})`);
  // the night drone plays at 0.28 at full night; the home tone sits below it (both peak-normalised loops)
  const db = 20 * Math.log10(rms * HOME_TONE);
  check(HOME_TONE < 0.28 && db < -25, `the room tone plays at ${db.toFixed(1)} dBFS on the ambience bus, under the night drone`);
}

// ---- the homeless night
const ids = new Set(NIGHT_THEMES.map((t) => t.id));
check(HOMELESS_THEMES.size === 1 && [...HOMELESS_THEMES].every((id) => ids.has(id)), `one night theme leaves the home bed out (${[...HOMELESS_THEMES].join(', ')})`);

console.log(fails ? `\n${fails} check(s) failed` : '\nall home-bed checks passed');
process.exit(fails ? 1 : 0);
