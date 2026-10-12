// The island's hints at the airfield (issue #269): the AIRPORT plates on Route 9 (client/render/airportsigns.js) are
// hung on its power poles from the breakdown to where the road leaves for the bridge, in that order, turned to whoever
// walks that way and up out of a survivor's reach; the mainland has none. The plate's cell is in the city's atlas, the
// island's map has its pencilled note by the bridge, the start's billboard sells the airfield, and the car's radio
// says the owner's line word for word, in one of its two voices picked at random.
// usage: node scripts/test-airfield-hints.js
import { readFileSync, statSync, existsSync } from 'node:fs';
import { worldFor } from '../shared/worlds.js';
import { WORLD } from '../shared/acts.js';
import { airportSigns, AIRPORT_SIGN } from '../client/render/airportsigns.js';

const fails = [];
const check = (name, ok, info = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${ok ? '' : info}`);
  if (!ok) fails.push(name);
};

for (const seed of [1, 7, 4242]) {
  const w = worldFor(seed, WORLD.ISLAND);
  const signs = airportSigns(w);
  check(`seed ${seed}: Route 9 has AIRPORT signs on the way to the bridge`, signs.length >= 3 && signs.length <= AIRPORT_SIGN.MAX, `${signs.length}`);
  const poles = w.props.filter((p) => p.type === 'power_pole');
  check(`seed ${seed}: each hangs beside a power pole`, signs.every((s) => poles.some((p) => Math.hypot(p.x - s.x, p.z - s.z) < AIRPORT_SIGN.W)));
  check(`seed ${seed}: ...out of reach (its bottom over a survivor's head)`, signs.every((s) => s.y - s.h / 2 - w.heightAt(s.x, s.z) > 1.9), signs.map((s) => (s.y - s.h / 2 - w.heightAt(s.x, s.z)).toFixed(2)).join(' '));
  // the bridge end of Route 9, as the map draws it (mapcanvas.js)
  const p = w.highway.pts;
  const n = p.length / 2;
  const iB = p[(n - 1) * 2] > p[0] ? n - 1 : 0;
  const bx = p[iB * 2], bz = p[iB * 2 + 1];
  const dB = signs.map((s) => Math.hypot(s.x - bx, s.z - bz));
  check(`seed ${seed}: they run from the breakdown towards the bridge`, dB.every((d, i) => i === 0 || d < dB[i - 1] + 5) && dB[0] < Math.hypot(w.car.x - bx, w.car.z - bz) + 5, dB.map((d) => d | 0).join(' '));
  // a face looks out along its frame's -z: (-sin ry, -cos ry), towards whoever is still to pass it on the way
  check(`seed ${seed}: each is turned to whoever walks towards the bridge`, signs.every((s) => -Math.sin(s.ry) * (bx - s.x) + -Math.cos(s.ry) * (bz - s.z) < 0));
  check(`seed ${seed}: the mainland has none`, airportSigns(worldFor(seed, WORLD.MAINLAND)).length === 0);
}

const src = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
// (the atlas is packed as the module loads, and throws when a cell no longer fits: importing it is the check)
const { CITY_ATLAS } = await import('../client/render/textures.js');
check("the city's atlas has room for the plate's cell, and draws it", !!CITY_ATLAS.road_airport && src('client/render/textures.js').includes("cell(ctx, 'road_airport'"), JSON.stringify(CITY_ATLAS.road_airport));
check("the start's billboard sells the airfield", src('client/render/textures.js').includes("text('CALDER FIELD', ") && !src('client/render/textures.js').includes("text('PINE HOLLOW'"));
check("the island's map has a note by the bridge: 'to airfield'", src('client/ui/mapscreen.js').includes("el('i', 'mx-note', this.bridgeLab, 'to airfield')"));
check("the car's radio says the owner's line word for word", src('client/game/game.js').includes("const CAR_RADIO_LINE = 'if anyone can hear us, we are trying to go to the airfield, it’s our only way to escape this hell';") && src('client/game/game.js').includes('if (arg === ITEM.CAR_BATTERY && this.act !== WORLD.MAINLAND) this.carRadio();'));

// the radio's two voices: both files there, both loaded as recordings, one of the two picked each time
const takes = ['am_michael', 'af_bella'];
check('both radio takes are in the game', takes.every((t) => existsSync(new URL(`../client/audio/radio/car-radio-${t}.mp3`, import.meta.url)) && statSync(new URL(`../client/audio/radio/car-radio-${t}.mp3`, import.meta.url)).size < 400_000));
const { REC } = await import('../client/audio/samples.js');
check('...each a recording the audio engine knows', takes.every((t) => REC[`vo_radio_${t}`]) && src('client/audio/samples.js').includes("import.meta.glob('./radio/car-radio-*.mp3'"));
check('...and the radio picks one of the two at random', src('client/game/game.js').includes("const CAR_RADIO_TAKES = ['vo_radio_am_michael', 'vo_radio_af_bella'];") && src('client/game/game.js').includes('CAR_RADIO_TAKES[Math.floor(Math.random() * CAR_RADIO_TAKES.length)]'));

console.log(fails.length ? `\n${fails.length} FAILED` : '\nall passed');
process.exit(fails.length ? 1 : 0);
