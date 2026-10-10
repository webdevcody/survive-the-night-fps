// "You were heard" (#304): a noise of yours that wakes the dead is told to you (EVT.HEARD, server/zombies.js noise),
// so a ring on the minimap can show how far it carried (client/ui/heard.js). In-process, against the real server, with
// what it sends decoded as a client does:
//   - a gunshot near 5 dormant dead tells the shooter (what, how many it woke, how far it carried) and nobody else
//   - a footstep does not (walking about among them makes no such noise)
//   - a noise that wakes fewer than HEARD_MIN, or wakes only the dead already on their way somewhere, is not told
//   - a second one inside HEARD_GAP is not told; one after it is
//   - the client: the first of each kind is named and ringed; after that a ring only on Ember or with the setting on
// usage: node scripts/test-heard.js [seed = 1]
import { Game } from '../server/game.js';
import { C2S, S2C, PROTOCOL_VERSION, Writer, Reader, qangle16, qpitch, writeInput } from '../shared/protocol.js';
import { BTN, SERVER_TICK_RATE, NOISE, EYE_HEIGHT } from '../shared/constants.js';
import { ITEM, WEAPONS, ZTYPE, HEARD, HEARD_MIN, HEARD_GAP } from '../shared/defs.js';
import { readSnapshot } from '../client/net/decode.js';
import { heardShow, heardLabel } from '../client/ui/heard.js';

const seed = +(process.argv[2] || 1);
const DT = 1 / SERVER_TICK_RATE;
const fails = [];
const check = (name, ok, info = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${info}`);
  if (!ok) fails.push(name);
};

const game = new Game({ seed, godMode: true, dayLength: 3600, themes: false, log: () => {} });

function client(name) {
  const c = { name, id: 0, net: { tick: 0, ack: 0 }, global: null, self: {}, store: { ents: new Map(), onCreate() {}, onRemove() {}, onUpdate() {} }, heard: [], seq: 0 };
  const nop = () => {};
  c.handler = new Proxy({ heard: (what, woke, loud) => c.heard.push({ what, woke, loud }) }, { get: (t, k) => t[k] || nop });
  c.conn = {
    send(bytes) {
      const r = new Reader(bytes.slice ? bytes.slice().buffer : bytes);
      const t = r.u8();
      if (t === S2C.WELCOME) c.id = r.u16();
      else if (t === S2C.SNAPSHOT) readSnapshot(r, c);
    },
  };
  c.session = game.onOpen(c.conn);
  const w = new Writer(64);
  w.u8(C2S.JOIN);
  w.u8(PROTOCOL_VERSION);
  w.str(name);
  game.onMessage(c.session, w.bytes().slice());
  c.p = () => game.players.get(c.id);
  c.input = (buttons) => {
    const w2 = new Writer(64);
    w2.u8(C2S.INPUT);
    w2.u16(game.tick & 0xffff);
    w2.u8(0);
    const cmds = [];
    for (let i = 0; i < 3; i++) {
      c.seq = (c.seq + 1) & 0xffff;
      cmds.push({ seq: c.seq, buttons, qyaw: qangle16(0), qpitch: qpitch(0), slot: 255 });
    }
    writeInput(w2, cmds);
    game.onMessage(c.session, w2.bytes().slice());
  };
  return c;
}

const A = client('Alice');
const B = client('Bob');
const tick = (n = 1, buttons = 0) => {
  for (let i = 0; i < n; i++) {
    A.input(buttons);
    B.input(0);
    game.update();
  }
};
tick(5);
const a = A.p();

// Bob well out of earshot of anything here, so only Alice can be the one told
const b = B.p();
b.state.x = a.state.x + 200;
b.state.z = a.state.z + 200;

// the dead round Alice: n of them, 15-30 m out, heading for nothing (dormant), and every other one out of the way
function dormant(n) {
  for (const z of game.zombies) z.dead = true;
  game.zombies.length = 0;
  const out = [];
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2;
    const d = 15 + (i % 4) * 5;
    const z = game.zm.spawn(ZTYPE.WALKER, a.state.x + Math.sin(ang) * d, a.state.z + Math.cos(ang) * d, {});
    out.push(z);
  }
  for (const z of out) {
    z.target = null;
    z.alertT = 0;
  }
  return out;
}

// a pistol shot from where Alice stands, into the sky (it is the noise that matters, not what it hits)
function shoot() {
  const s = a.state;
  game.combat.fire(a, { weapon: ITEM.PISTOL, x: s.x, y: s.y + EYE_HEIGHT, z: s.z, yaw: 0, pitch: 1.4, seed: 1, spread: 0, recoilPitch: 0 });
}

const take = () => {
  tick(1);
  const out = { a: A.heard.splice(0), b: B.heard.splice(0) };
  return out;
};

// ---------------------------------------------------------------- a gunshot near 5 dormant dead
dormant(5);
shoot();
let got = take();
check('a gunshot near 5 dormant dead tells the shooter', got.a.length === 1 && got.a[0].what === HEARD.GUNSHOT, JSON.stringify(got.a));
check('...how many it woke', got.a[0]?.woke === 5, `woke ${got.a[0]?.woke}`);
check('...and how far it carried', got.a[0]?.loud === (WEAPONS[ITEM.PISTOL].noise || NOISE.GUNSHOT), `${got.a[0]?.loud} m`);
check('nobody else is told', got.b.length === 0, JSON.stringify(got.b));

// ---------------------------------------------------------------- a footstep does not
game.time += HEARD_GAP + 1;
dormant(5);
tick(2 * SERVER_TICK_RATE, BTN.FWD);
got = { a: A.heard.splice(0) };
check('walking about among 5 dormant dead tells nobody anything', got.a.length === 0, JSON.stringify(got.a));

// ---------------------------------------------------------------- too few, or none fresh
game.time += HEARD_GAP + 1;
dormant(HEARD_MIN - 1);
shoot();
got = take();
check(`a shot that wakes only ${HEARD_MIN - 1} is not told`, got.a.length === 0, JSON.stringify(got.a));

game.time += HEARD_GAP + 1;
const busy = dormant(5);
for (const z of busy) {
  z.alertT = 30; // already heading for something louder
  z.alertLvl = 200;
}
shoot();
got = take();
check('a shot heard only by the dead already on their way elsewhere is not told', got.a.length === 0, JSON.stringify(got.a));

// ---------------------------------------------------------------- rate limit
game.time += HEARD_GAP + 1;
dormant(5);
shoot();
got = take();
check('the next shot (after a gap) is told again', got.a.length === 1, JSON.stringify(got.a));
dormant(5);
shoot();
got = take();
check(`one more inside ${HEARD_GAP} s is not`, got.a.length === 0, JSON.stringify(got.a));
game.time += HEARD_GAP;
dormant(5);
shoot();
got = take();
check(`one ${HEARD_GAP} s later is`, got.a.length === 1, JSON.stringify(got.a));

// ---------------------------------------------------------------- the client: what it shows
{
  const seen = new Set();
  const first = heardShow(HEARD.GUNSHOT, 5, 70, { seen });
  check('the first gunshot is ringed and named', first.ring && first.label === heardLabel(HEARD.GUNSHOT, 5, 70), JSON.stringify(first));
  check('...as "Gunshot: heard 70 m away, woke 5"', first.label === 'Gunshot: heard 70 m away, woke 5', first.label);
  const again = heardShow(HEARD.GUNSHOT, 5, 70, { seen });
  check('the second is neither ringed nor named', !again.ring && !again.label, JSON.stringify(again));
  const other = heardShow(HEARD.BLAST, 9, 170, { seen });
  check('the first of another kind is', other.ring && /^Explosion/.test(other.label || ''), JSON.stringify(other));
  const ember = heardShow(HEARD.GUNSHOT, 5, 70, { seen, ember: true });
  check('on Ember it is ringed every time (not named again)', ember.ring && !ember.label, JSON.stringify(ember));
  const always = heardShow(HEARD.GUNSHOT, 5, 70, { seen, always: true });
  check('with the setting on it is ringed every time', always.ring && !always.label, JSON.stringify(always));
}

console.log(fails.length ? `\n${fails.length} FAILED` : '\nall passed');
process.exit(fails.length ? 1 : 0);
