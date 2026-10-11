// Finding the car supplies (and the plane's parts) without the HUD (#287).
//
// The tell: crows circle over every hiding place that still holds one, high enough to be seen against the sky from a
// street or two away, and they leave once it has been taken. The client draws them (render/crows.js) over the spots
// the global state names (global.spots); scripts/test-supplyhelp.js holds every supply spot of every map to being
// seen from CROWS.SEEN metres off.
//
// The help: a team that has found nothing by the time the clock reaches each of SUPPLY_HELP_AT gets a little more,
// one step at a time. A team that has found one never sees any of it.
//   1 NARROW  the rumour's marker moves from the middle of the place to within NARROW_R of the spot
//   2 PING    ...and then onto the spot itself, pinned to the compass's edge while it is out of view
//   3 RADIO   a voice on the walkie-talkie says where the nearest one is (NOTIFY.SUPPLY_HINT)
import { raycastWorld } from './collision.js';

// s since the act's supplies were hidden. Day 1 and night 1 take 510 s (constants.js FIRST_DAY_LENGTH +
// NIGHT_LENGTH), so the first step comes at dawn on day 2, the others 90 s apart through that day
export const SUPPLY_HELP_AT = [510, 600, 690];
export const SUPPLY_HELP = { NONE: 0, NARROW: 1, PING: 2, RADIO: 3 };
export const NARROW_R = 20; // m: the narrowed rumour's marker is this far from the spot at most

// how much help a team gets: t = s since the supplies were hidden, found = anything taken from a hiding place yet
export function supplyHelpLevel(t, found) {
  if (found) return SUPPLY_HELP.NONE;
  let n = 0;
  for (const at of SUPPLY_HELP_AT) if (t >= at) n++;
  return n;
}

// where the narrowed rumour points for hint k at spot sp: off the spot by a fixed share of NARROW_R, in a direction
// that is the same on every client (from the spot and the hint), so the marker does not sit on the shelf itself
export function narrowedAt(sp, k) {
  const a = (Math.sin(sp.x * 12.9898 + sp.z * 78.233 + k * 37.719) * 43758.5453) % (Math.PI * 2);
  const r = NARROW_R * 0.6;
  return { x: sp.x + Math.cos(a) * r, z: sp.z + Math.sin(a) * r };
}

export const CROWS = {
  COUNT: 7, // birds over one place
  RADIUS: 9, // m: the circle they wheel round
  ABOVE: 14, // m over the top of whatever stands at the spot (a roof, or the ground)
  MIN: 18, // m over the spot at least
  SEEN: 60, // m off: the test's distance
};

const _hit = { t: -1, col: null, terrain: false };
// the middle of the crows' circle over spot sp: over the roof (or the hill) above it
export function crowsAt(world, sp) {
  const top = sp.y + 200;
  raycastWorld(world, sp.x, top, sp.z, 0, -1, 0, 400, _hit);
  const roof = _hit.t >= 0 ? top - _hit.t : sp.y;
  return { x: sp.x, y: Math.max(roof + CROWS.ABOVE, sp.y + CROWS.MIN), z: sp.z };
}
