// The pacing director (issue #297): a light layer over the fixed night waves. It keeps a rough read of how hard the
// night is landing on each survivor (p.intensity) and moves *when* the waves' groups come in - a breather after a
// peak, the next group early when it has gone quiet - never how many, nor the boss's time (Game.startNight sets those).
// Left 4 Dead's Director is the model: Build Up, Peak, wait for a break, Relax.
//
// It also picks tonight's moon at the dusk horn (pickMoon): now and then a blood moon, a hard night that looks it,
// unless the team is already struggling - then a clear moon, a bright one and a gentler night.
//
// Its state is plain data on the game (g.pace, g.moon, g.lastMoon, p.intensity), so a deploy carries it over
// (server/gamestate.js GAME_FIELDS; a player is saved whole).
import { PACE, MOON, BLOOD_MOON_FROM, BLOOD_MOON_CHANCE, BLOOD_QUIET_TIME, CLEAR_PACE, PHASE } from '../shared/constants.js';
import { KILLER } from '../shared/defs.js';

export const newPace = () => ({ relaxT: 0, pending: false, held: 0, quietT: 0, hitAt: -1e9, relaxes: 0, pulls: 0, peak: 0 });

// tonight's limits: a clear moon gives a breather sooner and longer, a blood moon none at all
export function paceLimits(moon) {
  if (moon === MOON.BLOOD) return { peak: Infinity, relax: 0, holdMax: 0, quietTime: BLOOD_QUIET_TIME };
  if (moon === MOON.CLEAR) return { peak: CLEAR_PACE.PEAK, relax: CLEAR_PACE.RELAX, holdMax: CLEAR_PACE.HOLD_MAX, quietTime: PACE.QUIET_TIME };
  return { peak: PACE.PEAK, relax: PACE.RELAX, holdMax: PACE.HOLD_MAX, quietTime: PACE.QUIET_TIME };
}

const bump = (p, n) => {
  if (!p || p.zombie) return;
  p.intensity = Math.min(PACE.MAX, (p.intensity || 0) + n);
};

// ---------------------------------------------------------------- what moves it (called from where it happens)
// Game.damagePlayer, once the blow has landed on a survivor
export function hurt(g, p, amount, src) {
  if (g.phase !== PHASE.NIGHT || p.zombie) return;
  bump(p, amount);
  if (src && src.kind === KILLER.ZOMBIE) g.pace.hitAt = g.time;
}
// Game.goDown
export function down(g, p) {
  if (g.phase !== PHASE.NIGHT) return;
  bump(p, PACE.DOWN);
  g.pace.hitAt = g.time;
}
// a leaper's pin or a roper's rope took hold of p
export function grabbed(g, p) {
  if (g.phase !== PHASE.NIGHT) return;
  bump(p, PACE.GRAB);
  g.pace.hitAt = g.time;
}
// Combat.killZombie: every survivor near where one of the dead went down felt that one
export function killed(g, z) {
  if (g.phase !== PHASE.NIGHT) return;
  for (const p of g.players.values()) {
    if (!p.alive || p.zombie) continue;
    if (Math.hypot(p.state.x - z.x, p.state.z - z.z) <= PACE.KILL_RANGE) bump(p, PACE.KILL);
  }
}

export function teamIntensity(g) {
  let m = 0;
  for (const p of g.players.values()) if (p.alive && !p.zombie) m = Math.max(m, p.intensity || 0);
  return m;
}

// ---------------------------------------------------------------- the night's tick
// Game.updatePhase, each night tick before the waves spawn. Returns true while the wave queues are held.
export function tick(g, dt) {
  const pc = g.pace;
  for (const p of g.players.values()) if (p.intensity) p.intensity = Math.max(0, p.intensity - PACE.DECAY * dt);
  const team = teamIntensity(g);
  pc.peak = Math.max(pc.peak, team);
  const lim = paceLimits(g.moon);
  // Relax: hold the queues, but never for more than the night's allowance
  if (pc.relaxT > 0) {
    const step = Math.min(dt, pc.relaxT);
    pc.relaxT -= step;
    pc.held += step;
    if (pc.held >= lim.holdMax) pc.relaxT = 0;
    return true;
  }
  // Peak fade: past the peak, wait for a natural break - nobody hit by the dead for a moment - before the breather
  if (pc.pending) {
    if (g.time - pc.hitAt >= PACE.BREAK) {
      pc.pending = false;
      if (pc.held < lim.holdMax && queued(g)) {
        pc.relaxT = Math.min(lim.relax, lim.holdMax - pc.held);
        pc.relaxes++;
      }
    }
  } else if (team >= lim.peak && pc.held < lim.holdMax && queued(g)) {
    pc.pending = true;
  }
  // Build up: a quiet spell between waves brings the next wave in early, its first group at once (once a wave). It
  // starts the way a wave on time does (Game.updatePhase, just after this), so it is announced and the cemetery takes
  // its share of it; its head count is the one it was planned with. (A wave that never starts on its own - the
  // cemetery's share, start Infinity - is not one to bring forward.)
  const next = g.waves.find((wv) => !wv.started && Number.isFinite(wv.start));
  const between = next && !g.waves.some((wv) => wv.started && wv.queue.length);
  if (between && !next.pulled && team < PACE.QUIET) pc.quietT += dt;
  else pc.quietT = 0;
  if (pc.quietT >= lim.quietTime) {
    pc.quietT = 0;
    next.pulled = true;
    next.start = Math.min(next.start, g.nightLen - g.timeLeft);
    pc.pulls++;
  }
  return false;
}

// any of the night's dead still waiting to come in
function queued(g) {
  return g.waves.some((wv) => wv.queue.length);
}

// ---------------------------------------------------------------- the moon
// The team is struggling: someone fell and has not come back (dead, or walking with the horde), last night put as
// many of them down as there are survivors or needed two breathers, or they come into the dusk hurt.
// Read at the dusk horn, while g.nightStats and g.pace still hold the night before.
export function struggling(g) {
  let humans = 0;
  let fallen = 0;
  let hp = 0;
  let max = 0;
  for (const p of g.players.values()) {
    if (p.zombie || !p.alive) {
      fallen++;
      continue;
    }
    humans++;
    if (p.downed) fallen++;
    else {
      hp += Math.max(0, p.hp);
      max += p.maxHp || 100;
    }
  }
  if (!humans) return false;
  if (fallen) return true;
  const st = g.nightStats || {};
  if ((st.downs || 0) + (st.deaths || 0) >= humans) return true;
  if ((g.pace?.relaxes || 0) >= 2) return true;
  return max > 0 && hp / max < 0.5;
}

// Tonight's moon (MOON). night: the night it is for. rng: the game's stream.
export function pickMoon(g, night, rng) {
  if (struggling(g)) return MOON.CLEAR;
  if (night < BLOOD_MOON_FROM || g.lastMoon === MOON.BLOOD) return MOON.NORMAL;
  return rng() < BLOOD_MOON_CHANCE ? MOON.BLOOD : MOON.NORMAL;
}
