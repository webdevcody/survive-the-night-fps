// The crawler (ZTYPE.CRAWLER: server/zombies.js LATCH_*, fireSpecial case 2, special states 2 and 3), against the real
// server in-process with a survivor driven by real input. Crawlers are put down 4-7 m from the survivor on open ground,
// already wound up to go, and each is watched until it is on them or 6 s are up:
//   - a survivor who stands still has one on their face from every one of them: it comes down at head height, not on
//     their chest as a leaper does, and stays there, just in front of their eyes, while it has them
//   - on them it gnaws (latchDmg every latchRate s), and it lets go when it has had latchMax s
//   - mashing Space claws it off in about a second, a single tap does not, and once it is off it reels and does not
//     take them again at once
//   - a teammate's blow knocks it off, and it does not go for a face that already has something on it
//   - it joins the horde on its own night (minNight) and not before
// usage: node scripts/test-crawler.js [seed ...]   (VERBOSE=1 prints each scenario's numbers)
import { Game } from '../server/game.js';
import { leapAim } from '../server/zombies.js';
import { C2S, S2C, PROTOCOL_VERSION, Writer, Reader, qangle16, qpitch, writeInput } from '../shared/protocol.js';
import { BTN, SERVER_TICK_RATE } from '../shared/constants.js';
import { ZTYPE, ZOMBIE_DEFS } from '../shared/defs.js';
import { groundAt, raycastWorld } from '../shared/collision.js';

const seeds = process.argv.slice(2).map(Number).filter((n) => n > 0);
if (!seeds.length) seeds.push(1, 2, 3);
const TRIALS = 8;
const DT = 1 / SERVER_TICK_RATE;
const DEF = ZOMBIE_DEFS[ZTYPE.CRAWLER];
const fails = [];
const check = (name, ok, info = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${info}`);
  if (!ok) fails.push(name);
};
const mulberry = (a) => () => {
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

function setup(seed) {
  const game = new Game({ seed, godMode: true, dayLength: 3600, themes: false, log: () => {} });
  const c = { id: 0, seq: 0, yaw: 0 };
  c.conn = {
    send(bytes) {
      const r = new Reader(bytes.slice ? bytes.slice().buffer : bytes);
      if (r.u8() === S2C.WELCOME) c.id = r.u16();
    },
  };
  c.session = game.onOpen(c.conn);
  const w = new Writer(64);
  w.u8(C2S.JOIN);
  w.u8(PROTOCOL_VERSION);
  w.str('Prey');
  game.onMessage(c.session, w.bytes().slice());
  c.input = (buttons) => {
    const w2 = new Writer(64);
    w2.u8(C2S.INPUT);
    w2.u16(game.tick & 0xffff);
    w2.u8(0);
    const cmds = [];
    for (let i = 0; i < 3; i++) {
      c.seq = (c.seq + 1) & 0xffff;
      cmds.push({ seq: c.seq, buttons, qyaw: qangle16(c.yaw), qpitch: qpitch(0), slot: 255 });
    }
    writeInput(w2, cmds);
    game.onMessage(c.session, w2.bytes().slice());
  };
  for (let i = 0; i < 5; i++) {
    c.input(0);
    game.update();
  }
  // every bite it lands (godMode keeps the survivor's health where it is)
  const bites = [];
  const dp = game.damagePlayer.bind(game);
  game.damagePlayer = (p, amount, src, ...rest) => {
    if (src?.ztype === ZTYPE.CRAWLER) bites.push({ t: game.tick * DT, amount });
    return dp(p, amount, src, ...rest);
  };
  return { game, c, p: game.players.get(c.id), bites };
}

// open, flat-ish ground around the car's valley: nothing standing within R m at knee or head height, no water
const _ray = { t: -1, col: null, terrain: false };
function findSpot(game, R = 12) {
  const w = game.world;
  const car = w.car;
  for (let r = 60; r < 280; r += 7) {
    for (let a = 0; a < 6.28; a += 0.21) {
      const x = car.x + Math.sin(a) * r;
      const z = car.z + Math.cos(a) * r;
      if (Math.abs(x) > 290 || Math.abs(z) > 290 || w.isDeepWater(x, z) || game.nav.isBlocked(x, z)) continue;
      let mn = Infinity;
      let mx = -Infinity;
      let ok = true;
      for (let k = 0; k < 16 && ok; k++) {
        const b = (k / 16) * 6.28;
        for (const rr of [3, 6, 9, R]) {
          const h = w.heightAt(x + Math.sin(b) * rr, z + Math.cos(b) * rr);
          mn = Math.min(mn, h);
          mx = Math.max(mx, h);
          if (w.isDeepWater(x + Math.sin(b) * rr, z + Math.cos(b) * rr)) ok = false;
        }
        const y0 = w.heightAt(x, z);
        for (const hh of [0.3, 1.4]) {
          raycastWorld(w, x, y0 + hh, z, Math.sin(b), 0, Math.cos(b), R, _ray);
          if (_ray.t >= 0 && !_ray.terrain) ok = false;
        }
      }
      if (ok && mx - mn <= 0.6) return { x, z };
    }
  }
  return null;
}

function clear(game) {
  for (const z of [...game.zombies]) {
    game._listRemove(game.zombies, z);
    game.removeEntity(z);
  }
  game.zm.herds.reset();
  game.zm.maintainT = game.zm.herds.spawnT = 1e9;
}

// a crawler put down d m from the survivor standing at spot, ready to spring; watched until it is on them or 6 s are
// up. Returns the crawler, and what it was doing the tick it took them
function trial(env, spot, d, rng) {
  const { game, c, p } = env;
  clear(game);
  const s = p.state;
  s.x = spot.x;
  s.z = spot.z;
  s.y = groundAt(game.world, s.x, s.z, 200, 0.3);
  s.vx = s.vy = s.vz = 0;
  s.pinned = s.pulled = 0;
  s.shove = 0;
  s.stunT = 0;
  p.pinnedBy = 0;
  const a = rng() * Math.PI * 2;
  const z = game.zm.spawn(ZTYPE.CRAWLER, spot.x + Math.sin(a) * d, spot.z + Math.cos(a) * d, { horde: true });
  z.specialCd = 0.3;
  const r = { z, latched: false, leaps: 0, peak: -Infinity };
  let air = false;
  for (let i = 0; i < 6 / DT; i++) {
    c.input(0);
    game.update();
    if (z.state === 2 && !air) r.leaps++;
    air = z.state === 2;
    if (air) r.peak = Math.max(r.peak, z.y - s.y);
    if (z.state === 3 && s.pinned && p.pinnedBy === z.id) {
      r.latched = true;
      break;
    }
  }
  return r;
}

const runs = { tried: 0, latched: 0, onFace: 0, gnaw: [], time: [], mash: { n: 0, ok: 0, t: [] }, tap: { n: 0, ok: 0 }, struck: { n: 0, ok: 0 }, taken: { n: 0, ok: 0 } };

for (const seed of seeds) {
  const env = setup(seed);
  const spot = findSpot(env.game);
  if (!spot) {
    check(`seed ${seed}: open ground to try it on`, false);
    continue;
  }
  const rng = mulberry(seed * 977);
  const { game, c, p, bites } = env;
  const s = p.state;

  // a survivor standing still: it springs, comes down on their face and holds on there
  for (let k = 0; k < TRIALS; k++) {
    const r = trial(env, spot, 4 + (k % 4), rng);
    runs.tried++;
    if (!r.latched) {
      if (process.env.VERBOSE) console.log(`      seed ${seed} trial ${k}: not latched (${r.leaps} leaps)`);
      continue;
    }
    runs.latched++;
    // a few ticks on: where it is held (just in front of their eyes, at their head) and what it does there
    let ok = true;
    for (let i = 0; i < 10; i++) {
      c.input(0);
      game.update();
      const fwd = -(Math.sin(s.yaw) * (r.z.x - s.x) + Math.cos(s.yaw) * (r.z.z - s.z)); // (in front of them: + along their view)
      if (!(r.z.y - s.y > 1.3 && r.z.y - s.y < 1.65 && fwd > 0 && fwd < 0.5 && s.pinned)) ok = false;
    }
    if (ok) runs.onFace++;
  }

  // it gnaws while it holds on, and lets go once it has had latchMax s
  {
    const r = trial(env, spot, 5, rng);
    if (r.latched) {
      bites.length = 0;
      const t0 = game.tick * DT;
      let released = -1;
      for (let i = 0; i < (DEF.latchMax + 2) / DT; i++) {
        c.input(0);
        game.update();
        if (!s.pinned) {
          released = game.tick * DT - t0;
          break;
        }
      }
      runs.gnaw.push(bites.length);
      runs.time.push(released);
      if (process.env.VERBOSE) console.log(`      seed ${seed}: ${bites.length} bites of ${bites[0]?.amount.toFixed(1)} hp, let go after ${released.toFixed(2)} s`);
    }
  }

  // Space claws it off: mashed (a press every 3 ticks), it is off in about a second; a single tap is not enough. Off, it
  // reels, and does not take them again while they run
  for (const how of ['mash', 'tap']) {
    const r = trial(env, spot, 5, rng);
    if (!r.latched) continue;
    const z = r.z;
    let released = -1;
    let full = 0;
    let again = false;
    let dazed = false;
    for (let i = 0; i < 3 / DT; i++) {
      let btn = 0;
      if (released >= 0) btn = BTN.FWD | BTN.SPRINT;
      else btn = how === 'tap' ? (i === 0 ? BTN.JUMP : 0) : i % 3 === 0 ? BTN.JUMP : 0;
      c.input(btn);
      game.update();
      full = Math.max(full, s.shove);
      if (released < 0 && !s.pinned) released = i;
      if (released >= 0 && z.dazedT > 0) dazed = true;
      if (released >= 0 && i > released + 2 && (z.state === 3 || s.pinned)) again = true;
    }
    runs[how].n++;
    if (how === 'tap') {
      if (released < 0 && full < 0.5) runs.tap.ok++;
    } else {
      const took = released * DT;
      runs.mash.t.push(took);
      if (released >= 0 && took < 1.6 && dazed && !again) runs.mash.ok++;
    }
  }

  // a teammate's blow knocks it off
  {
    const r = trial(env, spot, 5, rng);
    if (r.latched) {
      runs.struck.n++;
      game.combat.damageZombie(r.z, 8, null, { melee: true });
      if (!s.pinned && r.z.state !== 3 && !r.z.dead) runs.struck.ok++;
    }
  }

  // it leaves a face that already has something on it alone
  {
    clear(game);
    s.x = spot.x;
    s.z = spot.z;
    s.y = groundAt(game.world, s.x, s.z, 200, 0.3);
    s.vx = s.vy = s.vz = 0;
    const leaper = game.zm.spawn(ZTYPE.LEAPER, s.x - Math.sin(s.yaw) * 0.55, s.z - Math.cos(s.yaw) * 0.55, { horde: true });
    leaper.state = 3;
    leaper.link = p.id;
    leaper.linkT = -100; // (it holds on for the length of this)
    p.pinnedBy = leaper.id;
    s.pinned = 1;
    const z = game.zm.spawn(ZTYPE.CRAWLER, s.x + 5, s.z, { horde: true });
    z.specialCd = 0.3;
    let leapt = false;
    for (let i = 0; i < 3 / DT; i++) {
      c.input(0);
      game.update();
      if (z.state === 1 || z.state === 2 || z.state === 3) leapt = true;
    }
    runs.taken.n++;
    if (!leapt) runs.taken.ok++;
    game.zm.releaseLink(leaper);
  }
}

const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '-');
check('a survivor standing still has one on their face from every crawler that springs at them', runs.tried >= seeds.length * TRIALS && runs.latched === runs.tried, `${runs.latched} of ${runs.tried} (${pct(runs.latched, runs.tried)})`);
check('...held at their head, just in front of their eyes (not on their chest, as a leaper)', runs.latched > 0 && runs.onFace === runs.latched, `${runs.onFace} of ${runs.latched}`);
const expBites = DEF.latchMax / DEF.latchRate;
check(`on them it gnaws (every ${DEF.latchRate} s) and lets go after ${DEF.latchMax} s`, runs.gnaw.length === seeds.length && runs.gnaw.every((n) => n >= expBites - 2 && n <= expBites + 2) && runs.time.every((t) => t >= DEF.latchMax - 0.2 && t <= DEF.latchMax + 0.5), `bites ${runs.gnaw.join('/')}, let go after ${runs.time.map((t) => t.toFixed(2)).join('/')} s`);
check('mashing Space claws it off in about a second; off, it reels and does not take them again as they run', runs.mash.n >= seeds.length && runs.mash.ok === runs.mash.n, `${runs.mash.ok} of ${runs.mash.n} (${runs.mash.t.map((t) => t.toFixed(2)).join('/')} s)`);
check('...and a single tap does not', runs.tap.n >= seeds.length && runs.tap.ok === runs.tap.n, `${runs.tap.ok} of ${runs.tap.n}`);
check("a teammate's blow knocks it off", runs.struck.n >= seeds.length && runs.struck.ok === runs.struck.n, `${runs.struck.ok} of ${runs.struck.n}`);
check('it does not spring at a face that already has something on it', runs.taken.n === seeds.length && runs.taken.ok === runs.taken.n, `${runs.taken.ok} of ${runs.taken.n}`);
check('a crawler goes for the face, a leaper still for the chest', leapAim({ ztype: ZTYPE.CRAWLER }) > 1.2 && leapAim({ ztype: ZTYPE.LEAPER }) < 1);

// the horde: none before its night, and on its night at least one (the dawn card says so)
{
  const game = new Game({ seed: 5, dayLength: 3600, themes: false, log: () => {} });
  const count = (night) => {
    game.day = night;
    game.startNight();
    return game.waves.reduce((n, wv) => n + wv.queue.filter((t) => t === ZTYPE.CRAWLER).length, 0);
  };
  const before = [];
  for (let n = 1; n < DEF.minNight; n++) before.push(count(n));
  const on = count(DEF.minNight);
  const after = count(DEF.minNight + 2);
  check(`crawlers join the horde on night ${DEF.minNight} and not before`, before.every((k) => k === 0) && on >= 1 && after >= 1, `nights 1-${DEF.minNight - 1}: ${before.join('/')}, night ${DEF.minNight}: ${on}, night ${DEF.minNight + 2}: ${after}`);
}

if (fails.length) {
  console.log(`\n${fails.length} failed`);
  process.exit(1);
}
console.log('\nall passed');
process.exit(0);
