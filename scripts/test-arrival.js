// Nobody is hurt while their page builds a new world (server/game.js newWorldForAll, safe, arrived), on the Game itself.
//
// What happened (Oct 2026): straight to the mainland (/map2), a player died while their page was still building it -
// nothing on their screen. The page builds a world in one go, and the mainland takes seconds (more on a slow
// machine); the server had the day begun and the dead about the whole while. The crossing's own cutscene covers the
// build, but a skip at its earliest, on a slow machine, could end it first; and a new run's island is built the same.
//
// Here, with two players - Ann, whose page is still building (it sends nothing), and Ben, whose page is running:
//   - /map2: the dead are on both; Ann is not hurt nor hunted, Ben is (his page runs: he is playing at once)
//   - Ann's page runs: a quarter of a second of commands, and she is playing again: the dead go for her
//   - the crossing, its cutscene to the end: the same at its end
//   - a new run on the island: the same
//   - a page that never sends anything is safe for ARRIVE_SECONDS at most
// usage: node scripts/test-arrival.js
process.env.ARRIVE_SECONDS = '12';
const { Game } = await import('../server/game.js');
const { C2S, S2C, PROTOCOL_VERSION, Writer, Reader, writeInput } = await import('../shared/protocol.js');
const { PHASE } = await import('../shared/constants.js');
const { ZTYPE } = await import('../shared/defs.js');
const { WORLD, CROSSING } = await import('../shared/acts.js');
const { randomUUID } = await import('node:crypto');

let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${ok ? '' : detail}`);
};
const join = (game, name) => {
  const c = { id: 0, seq: 0 };
  c.session = game.onOpen({
    send(bytes) {
      const r = new Reader(bytes.slice ? bytes.slice().buffer : bytes);
      if (r.u8() === S2C.WELCOME) c.id = r.u16();
    },
  });
  const w = new Writer(64);
  w.u8(C2S.JOIN);
  w.u8(PROTOCOL_VERSION);
  w.str(name);
  w.str(randomUUID());
  game.onMessage(c.session, w.bytes());
  return c;
};
// a packet of commands (standing still), as a running page sends every frame
const input = (game, c) => {
  const w = new Writer(64);
  w.u8(C2S.INPUT);
  w.u16(game.tick & 0xffff);
  w.u8(0);
  writeInput(w, [{ seq: ++c.seq & 0xffff, buttons: 0, qyaw: 0, qpitch: 0, slot: 255 }]);
  game.onMessage(c.session, w.bytes());
};
// sec of ticks; playing: the pages whose commands come in every tick -> the ids of those hurt (patched up after
// every tick: who can be hurt, not who dies)
const HP = 60;
const tick = (game, sec, playing = []) => {
  const hurt = new Set();
  for (let i = 0, n = Math.round(sec * 20); i < n; i++) {
    for (const c of playing) input(game, c);
    game.update();
    for (const p of game.players.values()) {
      if (p.hp < HP - 1e-9 || !p.alive || p.downed) hurt.add(p.id);
      if (p.alive && !p.downed && !p.zombie) p.hp = HP;
    }
  }
  return hurt;
};
const beset = (game, p, n = 3) => {
  for (let i = 0; i < n; i++) game.zm.spawn(ZTYPE.WALKER, p.state.x + Math.sin(i) * 1.2, p.state.z + Math.cos(i) * 1.2, { horde: true });
};
const hunting = (game, p) => game.zombies.filter((z) => z.target === p.id).length;

const game = new Game({ seed: 4242, dayLength: 3600, nightLength: 3600, log: () => {} });
const ann = join(game, 'Ann');
const ben = join(game, 'Ben');
tick(game, 1, [ann, ben]);
const pa = game.players.get(ann.id);
const pb = game.players.get(ben.id);
// the two pages: Ben's runs through every new world, Ann's is still building it (nothing from her) until she says
const apart = () => {
  pb.state.x = pa.state.x + 30;
  pb.state.z = pa.state.z;
  game.fillHistory(pb);
  pa.hp = pb.hp = HP;
};
const scene = (what, start) => {
  start();
  tick(game, 0.2, [ben]); // (the new world goes out; Ben's page builds it at once, Ann's not yet)
  apart();
  beset(game, pa);
  beset(game, pb);
  let hurt = tick(game, 4, [ben]);
  check(`${what}: the player whose page is still building the world is not hurt, nor hunted`, !hurt.has(ann.id) && hunting(game, pa) === 0 && pa.alive && !pa.downed, `hurt ${[...hurt]}, hunting her ${hunting(game, pa)}`);
  check(`${what}: the player whose page is running is playing at once: the dead go for him`, hurt.has(ben.id) && hunting(game, pb) > 0, `hurt ${[...hurt]}, hunting him ${hunting(game, pb)}`);
  tick(game, 0.5, [ann, ben]);
  beset(game, pa); // (the first lot went after Ben meanwhile: fresh ones on her)
  hurt = tick(game, 4, [ann, ben]);
  check(`${what}: a quarter of a second of commands from her page, and she is playing again`, hurt.has(ann.id) && hunting(game, pa) > 0, `hurt ${[...hurt]}, hunting her ${hunting(game, pa)}`);
  for (const z of [...game.zombies]) {
    game._listRemove(game.zombies, z);
    game.removeEntity(z);
  }
};

scene('straight to the mainland (/map2)', () => {
  game.cross(pa, false, false);
  game.arrive();
});
check('...and it is the mainland, by day', game.act === WORLD.MAINLAND && game.phase === PHASE.DAY);

scene('a new run on the island (/map1, or after the end)', () => game.startGame());
check('...and it is the island', game.act === WORLD.ISLAND && game.phase === PHASE.DAY);

scene('the crossing, its cutscene to the end', () => {
  game.cross(pa, false, true);
  tick(game, CROSSING.TIME + 1, [ben]);
});
check('...and it is the mainland', game.act === WORLD.MAINLAND && game.phase === PHASE.DAY);

// a page that never comes back: safe for ARRIVE_SECONDS (12 here) at most
game.startGame();
tick(game, 0.2, [ben]);
apart();
beset(game, pa);
let hurt = tick(game, 8, [ben]);
check('a page that sends nothing is safe for a while...', !hurt.has(ann.id), `hurt ${[...hurt]}`);
tick(game, 4.5, [ben]); // (past 12 s since the new world)
beset(game, pa);
hurt = tick(game, 4, [ben]);
check('...but not past ARRIVE_SECONDS: no way out of a fight by never answering', hurt.has(ann.id), `hurt ${[...hurt]}`);

console.log(failed ? `${failed} FAILED` : 'all ok');
process.exit(failed ? 1 : 0);
