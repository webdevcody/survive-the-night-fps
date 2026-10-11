// The island's final stand waits for night STAND_NIGHT (issue #269, shared/acts.js standOpen): a team that has every
// supply in on day 1 can't start the engine, and is told why; once night STAND_NIGHT has fallen (or any later day)
// the same hold starts it as before. The mainland's runway stand has no such floor, and /engine still starts at once.
// usage: node scripts/test-standgate.js [seed]
import { Game } from '../server/game.js';
import { C2S, S2C, CAR_ID, HOLD, PROTOCOL_VERSION, Writer, Reader } from '../shared/protocol.js';
import { PHASE, ENGINE_START_TIME, SERVER_DT } from '../shared/constants.js';
import { WORLD, STAND_NIGHT, standOpen } from '../shared/acts.js';

const seed = +(process.argv[2] || 4242);
const fails = [];
const check = (name, ok, info = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${info}`);
  if (!ok) fails.push(name);
};

// ---- the rule itself
check('the floor is night 3', STAND_NIGHT === 3);
check('closed on day 1 and 2, day or night', [1, 2].every((d) => !standOpen(WORLD.ISLAND, d, false) && !standOpen(WORLD.ISLAND, d, true)));
check('closed on day 3 before dark', !standOpen(WORLD.ISLAND, 3, false));
check('open once night 3 has fallen', standOpen(WORLD.ISLAND, 3, true));
check('open on any later day', standOpen(WORLD.ISLAND, 4, false) && standOpen(WORLD.ISLAND, 9, true));
check('the mainland is never held back', standOpen(WORLD.MAINLAND, 1, false) && standOpen(WORLD.MAINLAND, 4, false));

// ---- in a real game: the hold at the car
const game = new Game({ seed, godMode: true, dayLength: 36000, log: () => {} });
const chats = [];
const c = { id: 0 };
c.conn = {
  send(bytes) {
    const r = new Reader(bytes.slice ? bytes.slice().buffer : bytes);
    if (r.u8() === S2C.WELCOME) c.id = r.u16();
  },
};
const session = game.onOpen(c.conn);
const w = new Writer(64);
w.u8(C2S.JOIN);
w.u8(PROTOCOL_VERSION);
w.str('Ann');
game.onMessage(session, w.bytes().slice());
game.update();
const p = game.players.get(c.id);
const sendChat = game.sendChat.bind(game);
game.sendChat = (to, id, flags, text) => {
  if (to === p) chats.push(text);
  return sendChat(to, id, flags, text);
};
const car = game.world.car;
const atCar = () => {
  p.state.x = car.x + 2;
  p.state.z = car.z + 2;
  p.state.y = game.world.heightAt(p.state.x, p.state.z);
};
const hold = () => {
  atCar();
  p.hold = null;
  p.useItem = null;
  game.holdBegin(p, CAR_ID);
  return p.hold;
};

check('the run starts on the island, on day 1 by day', game.act === WORLD.ISLAND && game.day === 1 && game.phase === PHASE.DAY, `act ${game.act} day ${game.day} phase ${game.phase}`);
game.supplies = game.sup.need.slice();
check('day 1, every supply in: the engine will not start', hold() === null && !game.escape.active);
check('...and the survivor is told why, and when', chats.some((t) => t.includes(`night ${STAND_NIGHT}`)), JSON.stringify(chats));
game.day = 2;
game.phase = PHASE.NIGHT;
check('night 2: still not', hold() === null && !game.escape.active);
game.day = 3;
game.phase = PHASE.DAY;
check('day 3 before dark: still not', hold() === null && !game.escape.active);
game.phase = PHASE.NIGHT;
const h = hold();
check('night 3: the hold to start the engine begins', h?.kind === HOLD.ENGINE, JSON.stringify(h));
for (let t = 0; t < ENGINE_START_TIME + 0.3; t += SERVER_DT) {
  atCar();
  game.update();
}
check('...and the final stand begins', game.escape.active, JSON.stringify(game.escape));

// ---- the admin's /engine skips the wait (a test and debug tool, not a player's way round it)
const g2 = new Game({ seed, godMode: true, dayLength: 36000, log: () => {} });
g2.update();
g2.day = 1;
g2.phase = PHASE.DAY;
g2.supplies = g2.sup.need.slice();
g2.startEngine(null);
check('Game.startEngine itself (what /engine calls) is not held back', g2.escape.active && g2.day === 1);

console.log(fails.length ? `\n${fails.length} FAILED` : '\nall passed');
process.exit(fails.length ? 1 : 0);
