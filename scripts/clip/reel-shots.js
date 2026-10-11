// The splash's reel (client/game/menureel.js, issue #290) in the real page: one headless browser (lib.js launchChrome:
// one at a time, software rendering), the game server serving the built client, the splash left up. Says how long the
// page took to its first picture and to the reel, then holds each scene on a few moments and takes a picture of each.
//
// usage: node scripts/clip/reel-shots.js [--seed 1337] [--out shots/clip/reel] [--size 1280x720] [--quality medium]
//          [--build 1] [--wait ms] [--only <scene 0-4>] [--debug 1]
// (Medium and up draw a frame every few seconds under software rendering: give them --wait 9000. Low is quicker.)
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { REPO, OUT, parseArgs, sleep, startGame, launchChrome, LIFE_MAX } from './lib.js';

const args = parseArgs(process.argv.slice(2), { seed: '1337', out: join(OUT, 'reel'), size: '1280x720', quality: 'medium' });
const out = resolve(args.out);
mkdirSync(out, { recursive: true });
const [W, H] = String(args.size).split('x').map(Number);
// [scene, seconds into it]
const MOMENTS = args.only ? [[+args.only, 2.2]] : [
  [0, 2.2],
  [0, 4.4],
  [1, 2.6],
  [1, 4.9],
  [1, 7.2],
  [2, 3.5],
  [3, 3.2],
  [3, 7.6],
  [4, 2.5],
  [4, 6.6],
];

let game = null;
const errors = [];
let chrome = null;
try {
  game = await startGame(REPO, { seed: +args.seed, build: !!args.build });
  chrome = await launchChrome({ width: W, height: H, life: LIFE_MAX, storage: { 'stn.settings': JSON.stringify({ quality: args.quality, renderScale: 1 }) } });
  const p = chrome.page;
  const t0 = Date.now();
  p.on('pageerror', (e) => errors.push(`${((Date.now() - t0) / 1000).toFixed(1)} s ${String(e.stack || e).slice(0, 900)}`));
  p.on('console', (m) => (m.type() === 'error' || /CONTEXT_LOST/.test(m.text())) && errors.push(`${((Date.now() - t0) / 1000).toFixed(1)} s ${m.text().slice(0, 200)}`));
  await p.goto(game.url, { waitUntil: 'load', timeout: 120000 });
  const loaded = Date.now() - t0;
  let drawn = 0;
  let reel = 0;
  for (let i = 0; i < 480 && !reel; i++) {
    const s = await p.evaluate(() => {
      const g = window.__game;
      return { drawn: !document.getElementById('still'), reel: !!g?.tour?.reel };
    });
    if (s.drawn && !drawn) {
      drawn = Date.now() - t0;
      await sleep(1500);
      await p.screenshot({ path: join(out, '0-walk.png') });
    }
    if (s.reel) reel = Date.now() - t0;
    else await sleep(250);
  }
  console.log(`load event ${(loaded / 1000).toFixed(1)} s, first scene drawn ${(drawn / 1000).toFixed(1)} s, reel on ${(reel / 1000).toFixed(1)} s (software rendering)`);
  if (!reel) {
    console.log(await p.evaluate(() => {
      const g = window.__game;
      return JSON.stringify({ warm: !!g.warm, warmKey: g.warmKey, loaded: !!g.MenuReel, tried: !!g.reelWorld, tour: g.tour?.constructor?.name, state: g.state, seed: g.world?.seed });
    }));
    if (errors.length) console.log('page errors:\n  ' + errors.join('\n  '));
    throw new Error('the reel never came on');
  }
  for (const [k, t] of MOMENTS) {
    await p.evaluate((k, t) => {
      const g = window.__game;
      g.tour.seek(k, t, g.camera);
    }, k, t);
    await sleep(+args.wait || 2500);
    if (args.debug) {
      console.log(
        await p.evaluate(() => {
          const g = window.__game;
          const c = g.camera;
          const r = g.tour;
          return JSON.stringify({ frame: g.frame, fps: g.fps, upd: +(g.cpuUpdateMs || 0).toFixed(1), ren: +(g.cpuRenderMs || 0).toFixed(1), lost: g.renderer.renderer.getContext().isContextLost(), cam: c.position.toArray().map((v) => +v.toFixed(1)), rot: c.rotation.toArray().slice(0, 3).map((v) => +(+v).toFixed(2)), fov: c.fov, cut: g.ui.splash.cutK, cycle: +g.env.cycle.toFixed(3), calls: g.renderer.renderer.info.render.calls, sv: r.sv[0].sv.object.position.toArray().map((v) => +v.toFixed(1)), camp: r.at(0, 0) });
        }),
      );
    }
    const name = `${k + 1}-${['scavenge', 'fortify', 'horde', 'hold', 'drive'][k]}-${t.toFixed(1)}s.png`;
    await p.screenshot({ path: join(out, name) });
    console.log('  ', name);
  }
  // a few seconds of it playing: how fast the frames come (software rendering: only a comparison, not a measure)
  await p.evaluate(() => (window.__game.tour.pinned = false));
  await sleep(6000);
  console.log('fps playing:', await p.evaluate(() => window.__game.fps));
} finally {
  const seen = new Set();
  const list = errors.filter((e) => !seen.has(e.replace(/^[\d.]+ s /, '')) && seen.add(e.replace(/^[\d.]+ s /, '')));
  if (list.length) console.log('page errors (each once):\n  ' + list.join('\n  '));
  await chrome?.close();
  game?.stop();
}
