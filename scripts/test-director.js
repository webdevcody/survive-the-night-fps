// The pacing director and the moon (server/director.js, issue #297), against a real Game in-process:
//   - intensity: a claw adds what it took, going down, a grab and a kill nearby add theirs, and it sinks by the second;
//   - a team taking heavy damage gets a breather - after a break in the hits - and the queues wait it out;
//     however hard the night, the breathers never add up past the night's allowance;
//   - an idle team gets the next wave's first group early, before that wave is due;
//   - none of it moves the boss's time or the number of the dead the night brings;
//   - the moon: never a blood moon on night 1 or two nights running, never for a team that is struggling (that team
//     gets a clear moon), picked at the dusk horn and sent in the global state; a blood moon brings a bigger horde and
//     no breathers; a clear moon gives one sooner;
//   - the director's state and the moon go across a deploy (Game.save).
import { Game } from '../server/game.js';
import * as Director from '../server/director.js';
import { PHASE, PACE, MOON, CLEAR_PACE, BLOOD_MOON_HORDE, DUSK_WARNING, WAVE_TIMES, BOSS_WAVE } from '../shared/constants.js';
import { ZTYPE, KILLER } from '../shared/defs.js';
import { C2S, S2C, PROTOCOL_VERSION, Writer, Reader } from '../shared/protocol.js';
import { readGlobal } from '../client/net/decode.js';

let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  ${detail}`}`);
};
const quiet = () => {};
const DT = 1 / 20;

function join(game, name) {
  const c = { id: 0 };
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
  w.str(name);
  w.str('');
  game.onMessage(c.session, w.bytes());
  return game.players.get(c.id);
}

// a game at nightfall of night `day` under the moon given (the horn skipped)
function nightGame(moon, day = 2, seed = 11) {
  const g = new Game({ seed, log: quiet });
  const p = join(g, 'Ann');
  g.godMode = true; // (only the director's numbers move: nothing the clock does here may down anyone)
  g.day = day;
  g.warned = true;
  g.moon = moon;
  g.startNight();
  // every group the waves send is counted, then cleared away so the alive cap never gets in the way
  g.sent = 0;
  const spawn = g.spawnHordeGroup.bind(g);
  g.spawnHordeGroup = (q, a) => {
    const n = spawn(q, a);
    g.sent += n;
    for (const z of [...g.zombies]) if (!z.boss) {
      g._listRemove(g.zombies, z);
      g.removeEntity(z);
    }
    return n;
  };
  return { g, p };
}
const queued = (g) => g.waves.reduce((a, wv) => a + wv.queue.length, 0);
// the night clock on its own (no AI, no snapshots): each() before every tick
function run(g, secs, each) {
  for (let i = 0, n = Math.round(secs / DT); i < n && g.phase === PHASE.NIGHT; i++) {
    each?.();
    g.time += DT;
    g.updatePhase(DT);
  }
}
const elapsed = (g) => g.nightLen - g.timeLeft;

// ---------------------------------------------------------------- intensity
{
  const { g, p } = nightGame(MOON.NORMAL);
  g.godMode = false;
  p.hp = p.maxHp = 1000; // (a claw must not down her)
  g.damagePlayer(p, 20, { kind: KILLER.ZOMBIE, ztype: ZTYPE.WALKER, x: p.state.x, z: p.state.z });
  check('a claw adds what it took', Math.abs(p.intensity - 20 * g.diff.hurt) < 1e-6 && g.pace.hitAt === g.time, String(p.intensity));
  p.intensity = 0;
  Director.down(g, p);
  check('going down adds PACE.DOWN', p.intensity === PACE.DOWN);
  Director.grabbed(g, p);
  check('a pin or a rope adds PACE.GRAB', p.intensity === PACE.DOWN + PACE.GRAB);
  Director.grabbed(g, p);
  Director.grabbed(g, p);
  check('it tops out at PACE.MAX', p.intensity === PACE.MAX);
  p.intensity = 0;
  Director.killed(g, { x: p.state.x + 3, z: p.state.z });
  Director.killed(g, { x: p.state.x + PACE.KILL_RANGE + 2, z: p.state.z });
  check('a kill within PACE.KILL_RANGE adds PACE.KILL, one further off nothing', p.intensity === PACE.KILL, String(p.intensity));
  p.intensity = 30;
  Director.tick(g, 1);
  check('it sinks by PACE.DECAY a second', Math.abs(p.intensity - (30 - PACE.DECAY)) < 1e-6, String(p.intensity));
  check('the team reads its highest survivor', Director.teamIntensity(g) === p.intensity);
}

// ---------------------------------------------------------------- a team in trouble gets a breather
{
  const { g, p } = nightGame(MOON.NORMAL);
  run(g, WAVE_TIMES[0] + 2); // the first wave is coming in
  const w0 = g.waves[0];
  check('(the first wave is under way with more to come)', w0.started && w0.queue.length > 0, String(w0.queue.length));
  // a mauling: high intensity, still being hit
  p.intensity = 95;
  let pendingSeen = false;
  run(g, 2, () => {
    g.pace.hitAt = g.time;
    p.intensity = 95;
    pendingSeen ||= g.pace.pending;
  });
  check('past the peak, it waits for a break while the hits keep landing', pendingSeen && g.pace.relaxes === 0 && g.pace.relaxT === 0);
  run(g, PACE.BREAK + 0.2);
  check('a break in the hits starts the breather', g.pace.relaxes === 1 && g.pace.relaxT > 0, JSON.stringify(g.pace));
  const left = w0.queue.length;
  const sent = g.sent;
  run(g, PACE.RELAX - 1);
  check('the queue waits out the breather: nobody new comes in', w0.queue.length === left && g.sent === sent, `${left} -> ${w0.queue.length}`);
  p.intensity = 0;
  run(g, 15);
  check('after it, the wave comes on again', g.sent > sent && g.pace.relaxT === 0, `${sent} -> ${g.sent}`);
}

// ---------------------------------------------------------------- the breathers have a cap, and nothing is lost
const baseline = (() => {
  const { g } = nightGame(MOON.NORMAL);
  const total = queued(g);
  let bossAt = -1;
  run(g, g.nightLen + 1, () => {
    if (g.bossPending === null && bossAt < 0) bossAt = elapsed(g);
  });
  return { total, bossAt, sent: g.sent };
})();
{
  const { g, p } = nightGame(MOON.NORMAL);
  const total = queued(g);
  let bossAt = -1;
  // hammered all night, a break every so often
  run(g, g.nightLen + 1, () => {
    p.intensity = PACE.MAX;
    if (Math.floor(g.time) % 12 === 0) g.pace.hitAt = g.time;
    if (g.bossPending === null && bossAt < 0) bossAt = elapsed(g);
  });
  check('a night of breathers holds no more than PACE.HOLD_MAX in all', g.pace.held <= PACE.HOLD_MAX + DT && g.pace.held > PACE.RELAX - 1 && g.pace.relaxes >= 1, JSON.stringify(g.pace));
  check('...and the night still sends every one of the dead it planned', g.sent + queued(g) === total && queued(g) === 0, `${g.sent} sent, ${queued(g)} left of ${total}`);
  check('the boss comes when it always does', bossAt > 0 && Math.abs(bossAt - baseline.bossAt) < 0.1 && Math.abs(bossAt - (WAVE_TIMES[BOSS_WAVE] + 8) * (g.nightLen / 150)) < 0.2, `${bossAt} vs ${baseline.bossAt}`);
  check('(left alone, a night sends them all too)', baseline.sent === baseline.total, `${baseline.sent}/${baseline.total}`);
}

// ---------------------------------------------------------------- an idle team gets the next group early
{
  const { g } = nightGame(MOON.NORMAL);
  const total = queued(g);
  const w1 = g.waves[1];
  const before = w1.queue.length;
  let pulledAt = -1;
  run(g, w1.start - 0.5, () => {
    if (g.pace.pulls && pulledAt < 0) pulledAt = elapsed(g);
  });
  check('a quiet spell between waves brings the next wave\'s first group in early', g.pace.pulls === 1 && w1.pulled && !w1.started && w1.queue.length < before && pulledAt > 0 && pulledAt < w1.start, `pulls ${g.pace.pulls}, at ${pulledAt}, queue ${before} -> ${w1.queue.length}`);
  check('...once a wave', (run(g, 1), g.pace.pulls === 1));
  run(g, g.nightLen);
  check('pulling forward changes when they come, not how many', g.sent === total, `${g.sent}/${total}`);
}

// ---------------------------------------------------------------- the moon
{
  const { g, p } = nightGame(MOON.NORMAL);
  g.phase = PHASE.DAY;
  g.nightStats = { kills: 0, structLost: 0, downs: 0, deaths: 0, revives: 0 };
  g.pace = Director.newPace();
  g.lastMoon = MOON.NORMAL;
  const lucky = () => 0; // (every roll a blood moon)
  check('night 1 is never a blood moon', Director.pickMoon(g, 1, lucky) === MOON.NORMAL);
  check('from night 2 a roll can bring one', Director.pickMoon(g, 2, lucky) === MOON.BLOOD && Director.pickMoon(g, 2, () => 0.99) === MOON.NORMAL);
  g.lastMoon = MOON.BLOOD;
  check('never two blood moons running', Director.pickMoon(g, 3, lucky) === MOON.NORMAL);
  g.lastMoon = MOON.NORMAL;
  p.hp = p.maxHp * 0.3;
  check('a team that comes into the dusk badly hurt gets a clear moon, never a blood one', Director.struggling(g) && Director.pickMoon(g, 3, lucky) === MOON.CLEAR);
  p.hp = p.maxHp;
  g.nightStats.downs = 1;
  check('...so does one that went down as often as it has survivors last night', Director.pickMoon(g, 3, lucky) === MOON.CLEAR);
  g.nightStats.downs = 0;
  g.pace.relaxes = 2;
  check('...and one that needed two breathers', Director.pickMoon(g, 3, lucky) === MOON.CLEAR);
  g.pace.relaxes = 0;
  const q = join(g, 'Bea');
  q.zombie = true;
  check('...and one with a survivor fallen and not back', Director.pickMoon(g, 3, lucky) === MOON.CLEAR);
  q.zombie = false;
  check('a team doing fine is not struggling', !Director.struggling(g) && Director.pickMoon(g, 3, () => 0.99) === MOON.NORMAL);

  // the horn picks it and the clients hear of it
  g.day = 3;
  g.warned = false;
  g.timeLeft = DUSK_WARNING + 0.01;
  g.rng = lucky;
  g.globalDirty = false;
  g.updatePhase(DT);
  check('the dusk horn picks tonight\'s moon', g.warned && g.moon === MOON.BLOOD && g.globalDirty);
  const w = new Writer(512);
  w.u8(1);
  g.writeGlobal(w);
  const gl = readGlobal(new Reader(w.bytes().slice().buffer), {});
  check('the global state carries it to the clients', gl.moon === MOON.BLOOD && gl.day === 3 && gl.benches && gl.parts, JSON.stringify({ moon: gl.moon, day: gl.day }));
  const s = g.save();
  check('the moon and the director go across a deploy', s.moon === MOON.BLOOD && s.pace && typeof s.pace.relaxes === 'number' && 'lastMoon' in s);
  g.timeLeft = 0.01;
  g.updatePhase(DT);
  check('nightfall keeps the horn\'s moon', g.phase === PHASE.NIGHT && g.moon === MOON.BLOOD);
  g.timeLeft = 0.01;
  g.updatePhase(DT);
  check('dawn puts it away and remembers it for tomorrow', g.phase === PHASE.DAY && g.moon === MOON.NORMAL && g.lastMoon === MOON.BLOOD);
}
{
  const plain = nightGame(MOON.NORMAL, 4, 21).g;
  const blood = nightGame(MOON.BLOOD, 4, 21).g;
  const a = queued(plain);
  const b = queued(blood);
  check('a blood moon brings BLOOD_MOON_HORDE times the horde', Math.abs(b - a * BLOOD_MOON_HORDE) <= 3 && b > a, `${a} -> ${b}`);
  check('...with the same boss at the same time', plain.bossPending.t === blood.bossPending.t && plain.bossPending.types[0] === blood.bossPending.types[0]);
  const p = [...blood.players.values()][0];
  run(blood, WAVE_TIMES[0] + 2);
  run(blood, 30, () => (p.intensity = PACE.MAX));
  check('a blood moon gives no breathers, however hard it goes', blood.pace.relaxes === 0 && blood.pace.held === 0 && !blood.pace.pending, JSON.stringify(blood.pace));
}
{
  const { g, p } = nightGame(MOON.CLEAR);
  run(g, WAVE_TIMES[0] + 2);
  p.intensity = (CLEAR_PACE.PEAK + PACE.PEAK) / 2; // past a clear moon's peak, short of a plain one's
  g.pace.hitAt = g.time;
  run(g, PACE.BREAK + 0.5, () => (p.intensity = Math.max(p.intensity, CLEAR_PACE.PEAK + 1)));
  check('under a clear moon a breather comes sooner, and lasts longer', g.pace.relaxes === 1 && g.pace.relaxT > PACE.RELAX, JSON.stringify(g.pace));
  const n = nightGame(MOON.NORMAL);
  run(n.g, WAVE_TIMES[0] + 2);
  n.g.pace.hitAt = n.g.time;
  run(n.g, PACE.BREAK + 0.5, () => (n.p.intensity = Math.max(n.p.intensity, CLEAR_PACE.PEAK + 1)));
  check('...where a plain night would not have stepped in yet', n.g.pace.relaxes === 0);
}

if (failed) {
  console.log(`${failed} failed`);
  process.exit(1);
}
console.log('director ok');
