// A survivor's simulated state (p.state on the server, the prediction on the client) and the bookkeeping that keeps
// the two ends in agreement: copying it, comparing it, rounding it to what goes on the wire and fingerprinting it.
// A new field of the state goes in createPlayerState and in SIM_FIELDS (and SIM_FLOATS if it is a float that is
// sent), in hashPlayerState, and in a writeSelf chunk and readSelf (docs/ARCHITECTURE.md, Networking: "Own state").
// shared/playersim.js simulates it, and re-exports all of this.
import { STAMINA_MAX, SLOT_MELEE } from './constants.js';
import { ITEM, AMMO, AMMO_ITEMS } from './defs.js';

export function createPlayerState() {
  return {
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    yaw: 0,
    pitch: 0,
    onGround: 1,
    crouch: 0,
    stamina: STAMINA_MAX,
    exhausted: 0,
    staminaDelay: 0,
    sprinting: 0,
    // weapons
    slot: SLOT_MELEE,
    weapons: [0, ITEM.PISTOL, ITEM.KNIFE, 0, 0],
    mags: [0, 12],
    dual: 0, // the weapon slots that hold a pair of their gun (a bit each: DUAL_BIT in shared/akimbo.js)
    ammo: AMMO_ITEMS.map((_, i) => (i === AMMO.P9 ? 24 : 0)),
    throwCount: 0,
    switchT: 0,
    cooldown: 0,
    reloadT: 0,
    recoil: 0,
    // status
    zombie: 0,
    leapCd: 0,
    pulled: 0,
    pullX: 0,
    pullY: 0,
    pullZ: 0,
    pinned: 0,
    shove: 0, // pinned by a leaper: how far they have shoved it off (SHOVE_*), 0-1
    burning: 0, // set alight by a flammer (PLAYER_FIRE): no jumping, [Space] beats the flames out (set by the server)
    stunT: 0,
    ears: 0, // s left with both hands clapped over the ears (a screecher's scream, close: EARS_* in server/specials/screecher.js)
    downed: 0, // incapacitated: crawl, pistol only, waiting for a teammate to revive
    using: 0, // an item in the hands being used (a medkit, a tin: Game.useItem): set by the server, put away here
    lastBtn: 0,
    fireCount: 0,
    // on a ride at the fair (fair.js): the seat + 1, the ride clock as this player has it (commands), whether it turns
    ride: 0,
    rideT: 0,
    rideGo: 0,
    // on a handcar on the railway (handcar.js): the car + 1, where it is on the line (a point of rail.main), its speed
    cart: 0,
    cartS: 0,
    cartV: 0,
    // carrying the mounted gun (mountedgun.js): both arms full, half pace, and a weapon switch drops it
    hmg: 0,
    // the stray cat in their arms (server/cats.js): no weapon in the hands, the fire button strokes it, nobody swims
    // with it, and a weapon switch sets it down
    pet: 0,
    // dragging a downed teammate along (a Runner: shared/roles.js, server/roles.js): every pace at DRAG.pace
    drag: 0,
    // at the wheel of a vehicle (vehicles.js): its entity id and kind, where it points, its steering, its tank, whether
    // it has broken down. Then x / y / z and vx / vz are the vehicle's. Or carried in one: its id and the seat
    drive: 0,
    driveK: 0,
    dyaw: 0,
    dsteer: 0,
    dfuel: 0,
    ddead: 0,
    dhold: 0, // how many of the dead press on the nose of what they drive (0..3: the server's count; shared/vehicles.js driveStep)
    pass: 0,
    passN: 0,
    // the perks they picked (progress.js: a bitmask of perk ids), set by the server. What they do here is perkMods
    perks: 0,
  };
}

// Every field of the state that takes part in the simulation and is a plain number (the arrays - weapons, mags,
// ammo - are copied and compared element by element besides)
const SIM_FIELDS = [
  'x', 'y', 'z', 'vx', 'vy', 'vz', 'yaw', 'pitch', 'onGround', 'crouch', 'stamina', 'exhausted', 'staminaDelay', 'sprinting',
  'slot', 'dual', 'throwCount', 'switchT', 'cooldown', 'reloadT', 'recoil',
  'zombie', 'leapCd', 'pulled', 'pullX', 'pullY', 'pullZ', 'pinned', 'shove', 'burning', 'stunT', 'ears', 'downed', 'using',
  'lastBtn', 'fireCount', 'ride', 'rideT', 'rideGo', 'cart', 'cartS', 'cartV', 'hmg', 'pet', 'drag',
  'drive', 'driveK', 'dyaw', 'dsteer', 'dfuel', 'ddead', 'dhold', 'pass', 'passN', 'perks',
];
const WEAPON_SLOTS = 5; // the length of s.weapons

// copies the fields that participate in simulation (used for reconciliation snapshots)
export function copyPlayerState(dst, src) {
  for (const k of SIM_FIELDS) dst[k] = src[k];
  for (let i = 0; i < WEAPON_SLOTS; i++) dst.weapons[i] = src.weapons[i];
  dst.mags[0] = src.mags[0];
  dst.mags[1] = src.mags[1];
  for (let i = 0; i < AMMO_ITEMS.length; i++) dst.ammo[i] = src.ammo[i];
  return dst;
}

// true when two states are identical in every field copyPlayerState carries
export function samePlayerState(a, b) {
  for (const k of SIM_FIELDS) if (a[k] !== b[k]) return false;
  for (let i = 0; i < WEAPON_SLOTS; i++) if (a.weapons[i] !== b.weapons[i]) return false;
  for (let i = 0; i < AMMO_ITEMS.length; i++) if (a.ammo[i] !== b.ammo[i]) return false;
  return a.mags[0] === b.mags[0] && a.mags[1] === b.mags[1];
}

// Rounds every float of the state to float32, which is how the server puts it on the wire: after the server has
// snapped its state and the client has taken it over, both simulate on from bit-identical numbers.
const SIM_FLOATS = ['x', 'y', 'z', 'vx', 'vy', 'vz', 'stamina', 'staminaDelay', 'switchT', 'cooldown', 'reloadT', 'recoil', 'leapCd', 'stunT', 'ears', 'shove', 'pullX', 'pullY', 'pullZ', 'cartS', 'cartV', 'dyaw', 'dsteer', 'dfuel'];
export function snapPlayerState(s) {
  for (const k of SIM_FLOATS) s[k] = Math.fround(s[k]);
  return s;
}

// 8-bit fingerprint of the simulated state (the view angles aside: those come with every command). The client sends
// the fingerprint of its prediction with its commands and the server compares it with its own state after the same
// command: as long as they agree the state itself never has to be sent. Floats go in rounded (millimetres,
// milliseconds), so the last-bit differences between JS engines' Math.sin / hypot don't count as a mismatch; a real
// divergence that small is harmless, and it gets caught as soon as it grows.
export function hashPlayerState(s) {
  let h = 0x811c9dc5;
  const mix = (v) => {
    h = Math.imul(h ^ v, 0x01000193);
    h ^= h >>> 15;
  };
  // (carried in a vehicle, where they are is the seat's: the server puts them there, and their own copy stands still)
  if (!s.pass) {
    mix(Math.round(s.x * 512));
    mix(Math.round(s.y * 512));
    mix(Math.round(s.z * 512));
  }
  mix(Math.round(s.vx * 128));
  mix(Math.round(s.vy * 128));
  mix(Math.round(s.vz * 128));
  mix((s.onGround ? 1 : 0) | (s.crouch ? 2 : 0) | (s.exhausted ? 4 : 0) | (s.sprinting ? 8 : 0) | (s.zombie ? 16 : 0) | (s.pulled ? 32 : 0) | (s.pinned ? 64 : 0) | (s.downed ? 128 : 0) | (s.using ? 256 : 0) | (s.burning ? 512 : 0));
  mix(Math.round(s.stamina * 64));
  mix(Math.round(s.staminaDelay * 512));
  mix(s.slot | (s.mags[0] << 8) | (s.mags[1] << 16) | (s.throwCount << 24));
  if (s.dual) mix(s.dual | 0x6475);
  for (let i = 0; i < WEAPON_SLOTS; i++) mix(s.weapons[i]);
  for (let i = 0; i < AMMO_ITEMS.length; i++) mix(s.ammo[i]);
  mix(Math.round(s.switchT * 512));
  mix(Math.round(s.cooldown * 512));
  mix(Math.round(s.reloadT * 512));
  mix(Math.round(s.recoil * 256));
  mix(Math.round(s.leapCd * 512));
  mix(Math.round(s.stunT * 512));
  mix(Math.round(s.ears * 512));
  if (s.pinned) mix(Math.round(s.shove * 512));
  if (s.pulled) {
    mix(Math.round(s.pullX * 64));
    mix(Math.round(s.pullY * 64));
    mix(Math.round(s.pullZ * 64));
  }
  mix(s.lastBtn | (s.fireCount << 16));
  if (s.ride) {
    mix(s.ride | (s.rideGo << 8));
    mix(s.rideT | 0);
  }
  if (s.cart) {
    mix(s.cart);
    mix(Math.round(s.cartS * 512));
    mix(Math.round(s.cartV * 128));
  }
  if (s.drive) {
    mix(s.drive | (s.driveK << 16) | (s.ddead << 20) | (s.dhold << 21));
    mix(Math.round(s.dyaw * 2048));
    mix(Math.round(s.dsteer * 2048));
    mix(Math.round(s.dfuel * 64));
  }
  if (s.pass) mix(s.pass | (s.passN << 16) | 0x70000000);
  if (s.hmg) mix(0x686d67);
  if (s.pet) mix(0x636174);
  if (s.drag) mix(0x647267);
  if (s.perks) mix(s.perks);
  return (h ^ (h >>> 8) ^ (h >>> 16) ^ (h >>> 24)) & 255;
}
