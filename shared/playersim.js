// Deterministic player simulation: movement, stamina and weapon state machine.
// The client runs this for prediction (and replays unacknowledged commands on reconciliation);
// the server runs the exact same code as the authority.
import {
  BTN,
  CMD_DT,
  PLAYER_RADIUS,
  PLAYER_HEIGHT,
  PLAYER_CROUCH_HEIGHT,
  EYE_HEIGHT,
  EYE_HEIGHT_CROUCH,
  WALK_SPEED,
  SPRINT_SPEED,
  CROUCH_SPEED,
  ZOMBIE_PLAYER_SPEED,
  GRAVITY,
  JUMP_VELOCITY,
  GROUND_ACCEL,
  AIR_ACCEL,
  FRICTION,
  STAMINA_MAX,
  STAMINA_DRAIN,
  STAMINA_REGEN_DELAY,
  STAMINA_JUMP_COST,
  SHOVE_PRESS,
  SHOVE_HOLD,
  SHOVE_SLIP,
  PIN_FACE,
  BLIND_SPEED,
  SHAKE_MIN,
  SHAKE_GAIN,
  SHAKE_CAP,
  SHAKE_SLIP,
  SLOT_THROW,
  SLOT_BUILD,
  SLOT_MELEE,
  SLOT_PRIMARY,
  SLOT_PISTOL,
  SLOT_RADIO,
  NUM_SLOTS,
  DOWN_CRAWL_SPEED,
  EYE_HEIGHT_DOWNED,
  GUN_CARRY_SPEED,
} from './constants.js';
import { ITEM, WEAPONS, CLAWS } from './defs.js';
import { groundAt, resolveBody, deepWaterAt } from './collision.js';
import { mulberry32 } from './rng.js';
import { rideStep, rideCarry } from './fair.js';
import { cartStep, cartCarry, CART_PUMP, LEVER_HANDS } from './handcar.js';
import { driveStep, DRIVE_HANDS } from './vehicles.js';
import { swimming, waterFloor, wadeDepth, riverCurrent, SWIM_HANDS, SWIM_SPEED, SWIM_FAST, SWIM_DOWNED, SWIM_ACCEL, SWIM_DRAG, SWIM_TREAD, SWIM_DRAIN, WADE_FROM, WADE_SLOW, CROUCH_WADE, SWIM_DEPTH } from './swim.js';
import { perkMods } from './progress.js';
import { DRAG } from './roles.js';
import { simNunchaku } from './nunchaku.js';
import { spendStamina, recoverStamina } from './stamina.js';
import { isDual, pairDef, pairHand } from './akimbo.js';

// the state itself, and copying, comparing, rounding and fingerprinting it (shared/playerstate.js)
export { createPlayerState, copyPlayerState, samePlayerState, snapPlayerState, hashPlayerState } from './playerstate.js';

export function eyeHeight(s) {
  return s.downed ? EYE_HEIGHT_DOWNED : s.crouch ? EYE_HEIGHT_CROUCH : EYE_HEIGHT;
}

// the item in hand (ITEM.WALKIE for the walkie-talkie slot, which holds nothing of its own)
export function currentWeapon(s) {
  if (s.zombie) return 0;
  if (s.slot === SLOT_RADIO) return ITEM.WALKIE;
  return s.weapons[s.slot] || 0;
}

// the numbers of what is in hand: a pair's (shared/akimbo.js) when the slot holds two of the gun, else its WEAPONS row
export function heldDef(s) {
  const item = currentWeapon(s);
  return isDual(s, s.slot) ? pairDef(item) : WEAPONS[item];
}

export function canSelectSlot(s, slot) {
  if (s.zombie) return slot === SLOT_MELEE;
  if (slot === SLOT_RADIO) return true; // every survivor's walkie-talkie: down, it is how you call for help
  if (s.downed) return slot === SLOT_PISTOL && s.weapons[SLOT_PISTOL] !== 0;
  if (slot === SLOT_THROW) return s.weapons[SLOT_THROW] !== 0 && s.throwCount > 0;
  if (slot === SLOT_BUILD) return true; // build mode works with bare hands too (hammer optional)
  return s.weapons[slot] !== 0;
}

// Keying the walkie-talkie: it in hand and the fire button held (not while both arms are round the mounted gun, nor
// with an item being used in the hands). Voice then goes out to every survivor at any distance (the server lists
// who is on the air, PLF.ON_AIR), and they hear the static of it.
export function radioKeyed(s) {
  return !s.zombie && !s.hmg && !s.pet && !s.using && s.slot === SLOT_RADIO && (s.lastBtn & BTN.ATTACK) !== 0;
}

// ---------------------------------------------------------------- where a round goes
// s.recoil is the gun's heat: a round adds one (0.8 with Steady Grip), up to HEAT_MAX, and it cools HEAT_COOL a
// second from the moment the trigger is let go - so a burst of three is settled a third of a second later, and a
// whole magazine in just over one. Two things come of it, both worked out here for the server and for the client's
// prediction, view and crosshair alike:
//   - the cone (shotSpread): the gun's own spread, more of it for moving, and a bloom of up to BLOOM x the gun's
//     spread that the first rounds of a burst hardly have (it grows as heat ^ 1.5). Crouching and the sights tighten
//     all of it.
//   - the climb (shotClimb): how far over the aim the round goes. It grows the same way for CLIMB_FULL rounds and
//     stays there; the sights halve it. The client lifts the view by exactly this (Game.viewClimb), so a round goes
//     where the sights or the crosshair are when it is fired, and pulling the view down holds a burst on its mark.
export const HEAT_MAX = 10;
export const HEAT_COOL = 9;
export const BLOOM = 2.5;
export const CLIMB = 0.3; // x the gun's recoil a round, at full climb
export const CLIMB_FULL = 8;
export const AIM_SPREAD = 0.35; // the sights: x the cone
export const AIM_CLIMB = 0.5; // ...and x the climb
export const CROUCH_SPREAD = 0.7;
export const AIR_SPREAD = 0.05;

// is the survivor behind the sights with these buttons held (as simulatePlayer judges it)
export function aimingWith(s, buttons) {
  const def = heldDef(s);
  return !s.hmg && !s.pet && !!(buttons & BTN.ALT) && !!def && !def.melee && !def.pair && s.reloadT <= 0 && s.switchT <= 0; // (not with the cat in their arms, nor down two barrels: a pair has no sights)
}

// the cone of the next shot: its half-angle (radians)
export function shotSpread(s, def, aiming) {
  const sp = Math.hypot(s.vx, s.vz);
  const heat = Math.min(s.recoil, HEAT_MAX) / HEAT_MAX;
  let spread = def.spread * (1 + BLOOM * heat * Math.sqrt(heat)) + def.moveSpread * Math.min(1, sp / WALK_SPEED);
  if (!s.onGround) spread += AIR_SPREAD;
  if (s.crouch) spread *= CROUCH_SPREAD;
  if (aiming) spread *= AIM_SPREAD;
  return spread;
}

// how far above the aim the next shot goes (radians)
export function shotClimb(s, def, aiming) {
  const r = Math.min(s.recoil, CLIMB_FULL);
  return def.recoil * CLIMB * r * Math.sqrt(r / CLIMB_FULL) * (aiming ? AIM_CLIMB : 1);
}

// Deterministic pellet directions. Writes [dx,dy,dz,...] into out, returns pellet count.
export function shotDirections(yaw, pitch, recoilPitch, spread, pellets, seed, out) {
  const rnd = mulberry32(seed * 2654435761);
  const p0 = pitch + recoilPitch;
  for (let i = 0; i < pellets; i++) {
    const a = rnd() * Math.PI * 2;
    const r = Math.sqrt(rnd()) * spread;
    const yw = yaw + Math.cos(a) * r;
    const pt = p0 + Math.sin(a) * r;
    const cp = Math.cos(pt);
    out[i * 3] = -Math.sin(yw) * cp;
    out[i * 3 + 1] = Math.sin(pt);
    out[i * 3 + 2] = -Math.cos(yw) * cp;
  }
  return pellets;
}

export const DRAW_TIME = 0.42; // a weapon being brought out, before it can be used

// The item being used goes away unfinished, and the weapon in hand comes back out as from a switch
function putAwayItem(s, events) {
  s.using = 0;
  s.switchT = DRAW_TIME;
  if (events) events.push({ type: 'use_cancel' });
}

// Simulate one command (fixed CMD_DT). events: array to push {type,...} into (may be null).
// cmd = { seq, buttons, yaw, pitch, slot (255 = no change) }
// The command goes through the steps below in this order, each one a function of its own: the weapon asked for,
// what the body is in (a ride, a handcar, a vehicle, a seat, the water), stamina and pace, the shove meter, the
// steering, a jump, the move through the world, and last whatever the hands hold.
export function simulatePlayer(s, cmd, world, events, dt = CMD_DT) {
  let b = cmd.buttons;
  let pressed = b & ~s.lastBtn;
  // how fast the view turned this command (a crawler on the face is shaken off by it)
  const dyaw = cmd.yaw - s.yaw;
  const turn = Math.hypot(Math.atan2(Math.sin(dyaw), Math.cos(dyaw)), cmd.pitch - s.pitch) / dt;
  s.yaw = cmd.yaw;
  s.pitch = cmd.pitch;
  switchSlot(s, cmd.slot, events);

  // ------------------------------------------------ movement
  // in a seat of a ride the body goes where the seat does (fair.js): nothing below moves it, and it is put there
  // once the command is through
  const riding = s.ride !== 0 && rideStep(s, pressed, world, events);
  // ...and on a handcar where the car does (handcar.js). Working its lever takes both hands: the weapon in them
  // does nothing while they do
  const carted = s.cart !== 0 ? cartStep(s, b, pressed, world, events, dt) : 0;
  if (carted === CART_PUMP) {
    b &= ~LEVER_HANDS;
    pressed &= ~LEVER_HANDS;
  }
  // at the wheel of a vehicle (vehicles.js): the command drives it, and the body is where it is
  if (s.drive !== 0 && driveStep(s, b, world, events, dt)) return handsOnWheel(s, cmd, events, dt);
  // carried in one: the seat has them (the server puts them in it, wherever it goes). Their hands are their own
  const seated = s.pass !== 0 && !s.zombie && !s.downed && !s.pulled && !s.pinned;
  if (s.pass !== 0 && !seated) s.pass = s.passN = 0; // (pulled out of it, or down: the server puts the body beside it)
  const sx0 = s.x;
  const sy0 = s.y;
  const sz0 = s.z;
  // afloat in the lake or a pond (swim.js): both hands are swimming, and nothing in them works
  const swim = !riding && !carted && !seated && swimming(world, s);
  if (swim) {
    b &= ~SWIM_HANDS;
    pressed &= ~SWIM_HANDS;
  }
  const wade = swim || s.zombie ? 0 : wadeDepth(world, s.x, s.y, s.z);
  // (a crawler on the face blinds them but leaves them their feet: they stumble on, slowed)
  const face = s.pinned === PIN_FACE && !s.zombie;
  const disabled = (s.pinned && !face) || s.stunT > 0 || riding || carted || seated;
  // the way the keys ask to go, on the ground (wx, wz: a unit vector, or none)
  let fwd = 0;
  let right = 0;
  if (!disabled) {
    if (b & BTN.FWD) fwd += 1;
    if (b & BTN.BACK) fwd -= 1;
    if (b & BTN.RIGHT) right += 1;
    if (b & BTN.LEFT) right -= 1;
  }
  const sy = Math.sin(s.yaw);
  const cy = Math.cos(s.yaw);
  let wx = -sy * fwd + cy * right;
  let wz = -cy * fwd - sy * right;
  const wl = Math.hypot(wx, wz);
  if (wl > 0) {
    wx /= wl;
    wz /= wl;
  }
  s.crouch = !s.zombie && (s.downed || (b & BTN.CROUCH && !disabled && !swim && wade < CROUCH_WADE)) ? 1 : 0; // (never ducking the eyes under the water)
  const weapon = currentWeapon(s);
  const wdef = heldDef(s);
  const aiming = aimingWith(s, b);
  const moving = wl > 0;
  const pm = perkMods(s.zombie ? 0 : s.perks);
  const sprint = stepStamina(s, b, fwd, moving, swim, aiming, face, pm, events, dt);
  s.sprinting = sprint && moving ? 1 : 0;
  const wishSpeed = paceOf(s, sprint, swim, wade, aiming, face, moving, pm);

  if (s.stunT > 0) s.stunT -= dt;
  if (s.leapCd > 0) s.leapCd -= dt;
  // a screecher screamed right by them: both hands are over their ears until it lets up (the server sets it)
  const ears = s.ears > 0 && !s.zombie;
  if (s.ears > 0) s.ears = Math.max(0, s.ears - dt);
  const pinned = s.pinned && !s.zombie;
  stepShove(s, cmd.buttons, face, pinned, turn, events, dt);

  steer(s, wx, wz, wishSpeed, moving, swim, dt);
  // jumping / zombie leap (not afloat: there is nothing to push off)
  if (!disabled && !face && s.onGround && !s.pulled && !s.downed && !swim) jumpOrLeap(s, b, pressed, sy, cy, events);
  moveBody(s, world, swim, riding, carted, events, dt);
  if (riding) rideCarry(s, world);
  else if (carted) cartCarry(s, world);
  else if (seated) {
    s.x = sx0;
    s.y = sy0;
    s.z = sz0;
    s.vx = s.vy = s.vz = 0;
    s.onGround = 1;
  }

  // both hands on the leaper (pinned), or over the ears: an item in them is put away and a reload let go of
  if (pinned || ears) {
    if (s.using) putAwayItem(s, events);
    s.reloadT = 0;
    s.recoil = 0;
  }
  // both arms round the mounted gun or the cat, both hands shoving a leaper off or over the ears: no weapon goes off, reloads, throws
  // or swings (the clocks run on). The fire button with the cat in their arms strokes it, which is the server's
  // business (Cats.update), not this
  if (s.hmg || s.pet || pinned || ears) {
    if (s.switchT > 0) s.switchT -= dt;
    if (s.cooldown > 0) s.cooldown -= dt;
    s.lastBtn = cmd.buttons;
    return s;
  }

  stepWeapons(s, cmd, b, pressed, weapon, wdef, aiming, pm, events, dt);
  s.lastBtn = cmd.buttons; // (as held: hands that come off the lever onto a trigger held down have not clicked it)
  return s;
}

// ------------------------------------------------ slot switching
// The weapon slot the command asks for (255: none). Asking for a weapon puts away the item being used, and lets go
// of the mounted gun or the cat in their arms; then whatever the state allows in the hands is put there.
function switchSlot(s, slot, events) {
  if (s.using && slot !== 255) putAwayItem(s, events);
  if (slot !== 255 && slot !== s.slot && slot < NUM_SLOTS && canSelectSlot(s, slot)) {
    s.slot = slot;
    s.switchT = s.zombie ? 0.1 : DRAW_TIME;
    s.reloadT = 0;
    s.recoil = 0;
    if (events) events.push({ type: 'switch', slot: s.slot });
  }
  // carrying the mounted gun: reaching for any weapon lets go of it, and it drops where they stand (the server puts
  // it there: the event). The switch above goes ahead
  if (s.hmg && slot !== 255 && slot < NUM_SLOTS) {
    s.hmg = 0;
    if (events) events.push({ type: 'gun_drop' });
  }
  // ...and so does the cat in their arms, which is set down at their feet (the server: 'cat_drop')
  if (s.pet && slot !== 255 && slot < NUM_SLOTS) {
    s.pet = 0;
    if (events) events.push({ type: 'cat_drop' });
  }
  if (s.zombie) s.slot = SLOT_MELEE;
  if (s.downed && s.slot !== SLOT_PISTOL && s.slot !== SLOT_RADIO && s.weapons[SLOT_PISTOL]) {
    s.slot = SLOT_PISTOL;
    s.switchT = 0.3;
    s.reloadT = 0;
  }
  // lost the item in the active slot (dropped / used up)
  if (!s.zombie && !s.downed && s.slot !== SLOT_BUILD && !canSelectSlot(s, s.slot)) {
    s.slot = s.weapons[SLOT_PRIMARY] ? SLOT_PRIMARY : s.weapons[SLOT_PISTOL] ? SLOT_PISTOL : SLOT_MELEE;
    s.switchT = DRAW_TIME;
    s.reloadT = 0;
  }
}

// At the wheel (driveStep has moved the vehicle and them with it): both hands are on the bars or the wheel, so
// nothing in them works, and only the clocks run on. The rest of the command is over.
function handsOnWheel(s, cmd, events, dt) {
  if (s.using) putAwayItem(s, events);
  s.reloadT = 0;
  s.recoil = 0;
  if (s.stunT > 0) s.stunT -= dt;
  if (s.ears > 0) s.ears = Math.max(0, s.ears - dt);
  if (s.leapCd > 0) s.leapCd -= dt;
  if (s.switchT > 0) s.switchT -= dt;
  if (s.cooldown > 0) s.cooldown -= dt;
  s.shove = 0;
  s.lastBtn = cmd.buttons & ~DRIVE_HANDS;
  return s;
}

// ------------------------------------------------ stamina and pace
// Stamina for this command: drained by sprinting (and by any swimming), won back after STAMINA_REGEN_DELAY standing
// easy. -> whether they sprint (1 / 0)
function stepStamina(s, b, fwd, moving, swim, aiming, face, pm, events, dt) {
  let sprint = 0;
  if (s.zombie) {
    s.stamina = STAMINA_MAX;
    s.exhausted = 0;
  } else if (swim) {
    // in deep water stamina only goes: treading water, swimming, hard strokes at the sprinting rate. Run out and the
    // survivor is exhausted and drowning (the server: Game.updatePlayers) until their feet find the bottom again
    sprint = b & BTN.SPRINT && fwd > 0 && !s.exhausted && s.stamina > 0 && !s.downed ? 1 : 0;
    s.stamina -= (sprint && moving ? STAMINA_DRAIN * pm.staminaDrain : (moving ? SWIM_DRAIN : SWIM_TREAD) * pm.swimDrain) * dt;
    s.staminaDelay = STAMINA_REGEN_DELAY;
    if (s.stamina <= 0) {
      s.stamina = 0;
      if (!s.exhausted && events) events.push({ type: 'exhausted' });
      s.exhausted = 1;
    }
  } else {
    sprint = b & BTN.SPRINT && fwd > 0 && !s.crouch && !s.exhausted && s.stamina > 0 && !aiming && !s.downed && !face ? 1 : 0;
    if (sprint && moving) spendStamina(s, STAMINA_DRAIN * pm.staminaDrain * dt, events);
    else recoverStamina(s, dt);
  }
  return sprint;
}

// the speed (m/s) they are trying to go at: their gait, then everything that slows it
function paceOf(s, sprint, swim, wade, aiming, face, moving, pm) {
  let wishSpeed = s.zombie ? ZOMBIE_PLAYER_SPEED : s.downed ? DOWN_CRAWL_SPEED : sprint ? SPRINT_SPEED * pm.sprint : s.crouch ? CROUCH_SPEED : WALK_SPEED;
  if (swim) wishSpeed = s.downed ? SWIM_DOWNED : (sprint ? SWIM_FAST : SWIM_SPEED) * pm.swim;
  else if (wade > WADE_FROM) wishSpeed *= 1 - WADE_SLOW * Math.min(1, (wade - WADE_FROM) / (SWIM_DEPTH - WADE_FROM)); // wading in deeper
  if (aiming) wishSpeed *= 0.62;
  if (s.hmg) wishSpeed *= GUN_CARRY_SPEED;
  if (s.drag) wishSpeed *= DRAG.pace;
  if (face) wishSpeed *= BLIND_SPEED;
  if (!moving) wishSpeed = 0;
  return wishSpeed;
}

// Pinned by a leaper: both hands on it, shoving (SHOVE_*). Every press counts at once (the event: the client's early
// presses go into the first command they act in, inputbuffer.js); full, the server throws it off (Zombies.throwOff).
// A crawler on the face is shaken off instead (SHAKE_*): each fifth of the meter is a jolt (the 'shove' event).
// buttons: the command's, as held (not what the lever or the water leaves the hands)
function stepShove(s, buttons, face, pinned, turn, events, dt) {
  if (face) {
    const m0 = s.shove;
    if (turn > SHAKE_MIN) s.shove = Math.min(1, s.shove + SHAKE_GAIN * Math.min(turn - SHAKE_MIN, SHAKE_CAP) * dt);
    else s.shove = Math.max(0, s.shove - SHAKE_SLIP * dt);
    if (events && Math.floor(s.shove * 5) > Math.floor(m0 * 5)) events.push({ type: 'shove', v: s.shove });
  } else if (pinned) {
    if (buttons & BTN.JUMP & ~s.lastBtn) {
      s.shove = Math.min(1, s.shove + SHOVE_PRESS);
      if (events) events.push({ type: 'shove', v: s.shove });
    } else if (buttons & BTN.JUMP) s.shove = Math.min(1, s.shove + SHOVE_HOLD * dt);
    else s.shove = Math.max(0, s.shove - SHOVE_SLIP * dt);
  } else s.shove = 0;
}

// ------------------------------------------------ the body
// The velocity: dragged by a roper's tongue towards it, or friction and acceleration on the ground (or in the water)
// towards wishSpeed along (wx, wz), or a little steering in the air
function steer(s, wx, wz, wishSpeed, moving, swim, dt) {
  if (s.pulled) {
    const dx = s.pullX - s.x;
    const dz = s.pullZ - s.z;
    const d = Math.hypot(dx, dz);
    if (d > 1.3) {
      s.vx = (dx / d) * 4.4;
      s.vz = (dz / d) * 4.4;
    } else {
      s.vx = 0;
      s.vz = 0;
    }
  } else if (s.onGround) {
    const sp = Math.hypot(s.vx, s.vz);
    if (sp > 0) {
      const drop = Math.max(sp, 1.6) * (swim ? SWIM_DRAG : FRICTION) * dt;
      const ns = Math.max(0, sp - drop);
      s.vx *= ns / sp;
      s.vz *= ns / sp;
    }
    const cur = s.vx * wx + s.vz * wz;
    const add = wishSpeed - cur;
    if (add > 0 && moving) {
      const acc = Math.min((swim ? SWIM_ACCEL : GROUND_ACCEL) * dt * wishSpeed, add);
      s.vx += acc * wx;
      s.vz += acc * wz;
    }
  } else if (moving) {
    const cur = s.vx * wx + s.vz * wz;
    const add = wishSpeed - cur;
    if (add > 0) {
      const acc = Math.min(AIR_ACCEL * dt * wishSpeed, add);
      s.vx += acc * wx;
      s.vz += acc * wz;
    }
  }
}

// On their feet and free to: a turned player's leap (ALT), or a jump (the press of it) - not while burning, and it
// costs a survivor stamina. sy, cy: the sine and cosine of their yaw
function jumpOrLeap(s, b, pressed, sy, cy, events) {
  if (s.zombie && b & BTN.ALT && s.leapCd <= 0) {
    const cp = Math.cos(Math.max(-0.2, s.pitch));
    s.vx = -sy * CLAWS.leapSpeed * cp;
    s.vz = -cy * CLAWS.leapSpeed * cp;
    s.vy = CLAWS.leapUp;
    s.onGround = 0;
    s.leapCd = CLAWS.leapCooldown;
    if (events) events.push({ type: 'leap' });
  } else if (pressed & BTN.JUMP && !s.burning && (s.zombie || s.stamina >= STAMINA_JUMP_COST)) {
    s.vy = JUMP_VELOCITY * (s.zombie ? 1.15 : 1);
    if (!s.zombie) {
      s.stamina -= STAMINA_JUMP_COST;
      s.staminaDelay = STAMINA_REGEN_DELAY;
    }
    s.onGround = 0;
    if (events) events.push({ type: 'jump' });
  }
}

const _pos = { x: 0, y: 0, z: 0 };

// Gravity, then the move through the world for this command: the river's current, the colliders, the water's edge
// for whoever may not swim, the map's edge, and the ground (or the water's surface) under the feet
function moveBody(s, world, swim, riding, carted, events, dt) {
  s.vy -= GRAVITY * dt;
  const ox = s.x;
  const oz = s.z;
  const height = s.crouch ? PLAYER_CROUCH_HEIGHT : PLAYER_HEIGHT;
  _pos.x = s.x + s.vx * dt;
  _pos.y = s.y;
  _pos.z = s.z + s.vz * dt;
  // afloat in the mainland's river the current carries them on top of their own stroke (swim.js)
  if (swim) {
    const cur = riverCurrent(world, s.x, s.z);
    if (cur) {
      _pos.x += cur[0] * dt;
      _pos.z += cur[1] * dt;
    }
  }
  const human = !s.zombie;
  const hit = resolveBody(world, _pos, PLAYER_RADIUS, height, human);
  // a survivor swims where the water is deep (below); a turned one, like the rest of the dead, stops at its edge, and
  // so does one carrying the mounted gun or the cat, which nobody swims with (they wade as far as their feet keep the
  // bottom)
  if ((!human && deepWaterAt(world, _pos.x, _pos.z, s.y, PLAYER_RADIUS * 0.7, human)) || ((s.hmg || s.pet) && waterFloor(world, s, _pos.x, _pos.z) > groundAt(world, _pos.x, _pos.z, s.y, PLAYER_RADIUS * 0.7, human))) {
    _pos.x = ox;
    _pos.z = oz;
    s.vx = 0;
    s.vz = 0;
  }
  const lim = world.half - 3; // (the world being played: the mainland is twice the island across)
  if (_pos.x < -lim) _pos.x = -lim;
  if (_pos.x > lim) _pos.x = lim;
  if (_pos.z < -lim) _pos.z = -lim;
  if (_pos.z > lim) _pos.z = lim;
  if (hit && s.onGround) {
    s.vx = (_pos.x - ox) / dt;
    s.vz = (_pos.z - oz) / dt;
  }
  let ground = groundAt(world, _pos.x, _pos.z, s.y, PLAYER_RADIUS * 0.7, human);
  // ...and where the water is deeper than they stand it holds them up (swim.js): a floor at the float height
  const water = human && !riding && !carted ? waterFloor(world, s, _pos.x, _pos.z) : -Infinity;
  const afloat = water > ground;
  if (afloat) ground = water;
  let ny = s.y + s.vy * dt;
  const wasGround = s.onGround;
  if (ny <= ground) {
    if (!wasGround && afloat) {
      if (s.vy < -3 && events) events.push({ type: 'splash', v: -s.vy }); // into the water: no fall hurts there
    } else if (!wasGround && s.vy < -9 && events) events.push({ type: 'land', v: -s.vy });
    ny = ground;
    s.vy = 0;
    s.onGround = 1;
  } else if (wasGround && s.vy <= 0 && ny - ground < 0.4) {
    ny = ground;
    s.vy = 0;
    s.onGround = 1;
  } else {
    s.onGround = 0;
  }
  s.x = _pos.x;
  s.y = ny;
  s.z = _pos.z;
}

// ------------------------------------------------ weapons
// Whatever is in the hands for this command: the clocks, then an item being used, the claws, the throw, the
// nunchucks' moveset, a melee swing or a gun. b / pressed: the buttons the hands are free for (held / just pressed)
function stepWeapons(s, cmd, b, pressed, weapon, wdef, aiming, pm, events, dt) {
  if (s.switchT > 0) s.switchT -= dt;
  const cd0 = s.cooldown;
  if (s.cooldown > 0) s.cooldown -= dt;
  const attack = b & BTN.ATTACK;
  const attackPressed = pressed & BTN.ATTACK;

  if (s.using) {
    // The hands are busy with an item (Game.useItem) and nothing in them goes off: no shot, swing, throw or reload.
    // A click puts the item away and brings the weapon back out instead, and that click is not a shot. A button
    // held down since before the item came out is not a click.
    s.reloadT = 0;
    s.recoil = 0;
    if (attackPressed) putAwayItem(s, events);
  } else if (s.zombie) {
    if ((attack || attackPressed) && s.cooldown <= 0 && s.switchT <= 0) {
      s.cooldown = CLAWS.rate;
      s.fireCount = (s.fireCount + 1) & 255;
      if (events) events.push({ type: 'melee', weapon: 0, heavy: false });
    }
  } else if (s.downed && s.slot !== SLOT_PISTOL) {
    // downed without a pistol: nothing to do but wait
  } else if (s.slot === SLOT_BUILD) {
    // build mode: placement is a discrete action
  } else if (s.slot === SLOT_THROW) {
    if (attackPressed && s.cooldown <= 0 && s.switchT <= 0 && s.throwCount > 0) {
      s.cooldown = 1.1;
      s.throwCount--;
      s.fireCount = (s.fireCount + 1) & 255;
      if (events) events.push({ type: 'throw', item: s.weapons[SLOT_THROW] });
    }
  } else if (wdef && wdef.nunchaku) {
    // a moveset: combos, blows that land a set time into a move, a heavy attack that is wound up (shared/nunchaku.js).
    // Its combo step, its window and its wind-up ride in recoil, cooldown (below zero) and reloadT
    simNunchaku(s, b, cd0, weapon, events, dt);
  } else if (wdef && wdef.melee) {
    const alt = b & BTN.ALT;
    if ((attack || alt) && s.cooldown <= 0 && s.switchT <= 0) {
      const heavy = !attack && !!alt;
      s.cooldown = heavy ? wdef.altRate : wdef.rate;
      s.fireCount = (s.fireCount + 1) & 255;
      if (events) events.push({ type: 'melee', weapon, heavy });
    }
  } else if (wdef) {
    stepGun(s, cmd, attack, attackPressed, pressed, weapon, wdef, aiming, pm, events, dt);
  }
}

// A gun in the hands: the reload under way, a reload asked for (or an empty magazine's trigger pull), a shot, a dry
// click; and the heat (s.recoil) cooling while the trigger is let go
function stepGun(s, cmd, attack, attackPressed, pressed, weapon, wdef, aiming, pm, events, dt) {
  const mi = s.slot === SLOT_PRIMARY ? 0 : 1;
  // reload progress
  if (s.reloadT > 0) {
    if (wdef.reloadEach && attackPressed && s.mags[mi] > 0) {
      s.reloadT = 0; // interrupt shotgun reload to shoot
    } else {
      s.reloadT -= dt;
      if (s.reloadT <= 0) {
        s.reloadT = 0;
        finishReload(s, wdef, mi, pm, events);
      }
    }
  }
  // an empty magazine reloads on the next trigger pull; autoReload weapons (crossbow) re-cock on their own
  const wantReload = (pressed & BTN.RELOAD) || (s.mags[mi] === 0 && (attackPressed || (wdef.autoReload && s.cooldown <= 0)));
  if (wantReload && s.reloadT <= 0 && s.switchT <= 0 && s.mags[mi] < wdef.mag && s.ammo[wdef.ammo] > 0) {
    s.reloadT = wdef.reload * pm.reload;
    s.recoil = 0;
    if (events) events.push({ type: 'reload', each: !!wdef.reloadEach, time: s.reloadT });
  } else if ((wdef.auto ? attack : attackPressed) && s.cooldown <= 0 && s.switchT <= 0 && s.reloadT <= 0) {
    if (s.mags[mi] > 0) fireRound(s, cmd, mi, weapon, wdef, aiming, pm, events);
    else if (attackPressed) {
      s.cooldown = 0.25;
      if (events) events.push({ type: 'dry' });
    }
  }
  if (!attack && s.recoil > 0) s.recoil = Math.max(0, s.recoil - dt * HEAT_COOL);
}

// The reload's clock has run out: a whole magazine goes in from the reserve, or (reloadEach: shell by shell) one
// round, and the next one is started while there is room and rounds to fill it
function finishReload(s, wdef, mi, pm, events) {
  const reserve = s.ammo[wdef.ammo];
  if (wdef.reloadEach) {
    if (reserve > 0 && s.mags[mi] < wdef.mag) {
      s.mags[mi]++;
      s.ammo[wdef.ammo]--;
      if (events) events.push({ type: 'shell' });
    }
    if (s.mags[mi] < wdef.mag && s.ammo[wdef.ammo] > 0) {
      s.reloadT = wdef.reload * pm.reload;
      if (events) events.push({ type: 'reload', each: true, time: s.reloadT });
    } else if (events) events.push({ type: 'reload_done' });
  } else {
    const take = Math.min(wdef.mag - s.mags[mi], reserve);
    s.mags[mi] += take;
    s.ammo[wdef.ammo] -= take;
    if (events) events.push({ type: 'reload_done' });
  }
}

// One round out of magazine mi: its cone and climb as the gun stands now (before this round's heat), and the 'fire'
// event the server resolves the shot from (its seed draws the pellets: shotDirections). A pair's says which of its
// guns went off (hand: 1 the right, -1 the left; 0 a gun on its own)
function fireRound(s, cmd, mi, weapon, wdef, aiming, pm, events) {
  const hand = wdef.pair ? pairHand(s.mags[mi]) : 0;
  s.mags[mi]--;
  s.cooldown = wdef.rate;
  const spread = shotSpread(s, wdef, aiming);
  const recoilPitch = shotClimb(s, wdef, aiming);
  s.recoil = Math.min(HEAT_MAX, s.recoil + pm.recoil);
  s.fireCount = (s.fireCount + 1) & 255;
  if (events) {
    events.push({
      type: 'fire',
      weapon,
      seed: ((cmd.seq * 7919) ^ (s.fireCount * 131)) & 0xffff,
      spread,
      recoilPitch,
      x: s.x,
      y: s.y + eyeHeight(s),
      z: s.z,
      yaw: s.yaw,
      pitch: s.pitch,
      aiming,
      hand,
    });
  }
}
