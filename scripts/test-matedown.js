// A teammate going down is the top of the night's order (client/ui/hud2.js, #272): the rest of the team is told by
// sight and by sound at once. Checks:
//   - mateDown (client/game/matedown.js) puts up the red toast with the revive key and plays the mate_down alarm;
//   - the alarm is a real ui-bus sound: listed for playLocal, rendered by the synth (finite, not silent, no clipping),
//     short, and louder than the soft notify chime;
//   - a downed teammate keeps its place over every other compass marker.
// usage: node scripts/test-matedown.js
import { readFileSync } from 'node:fs';
import { mateDown } from '../client/game/matedown.js';
import { renderJob, DEF_BY_BANK } from '../client/audio/registry.js';

const fails = [];
const check = (name, ok, info = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${info}`);
  if (!ok) fails.push(name);
};

// ---------------------------------------------------------------- the toast and the alarm, together
{
  const toasts = [];
  const sounds = [];
  const g = { name: (id) => (id === 7 ? 'Old Hank' : '???'), ui: { notify: (text, style, secs) => toasts.push({ text, style, secs }) }, audio: { playLocal: (n) => sounds.push(n) } };
  mateDown(g, 7);
  check('teammate down: one toast, red', toasts.length === 1 && toasts[0].style === 'danger', JSON.stringify(toasts));
  check('teammate down: the toast names them and the revive key', /Old Hank is down!/.test(toasts[0]?.text) && /revive/.test(toasts[0]?.text), toasts[0]?.text);
  check('teammate down: the alarm plays', sounds.length === 1 && sounds[0] === 'mate_down', JSON.stringify(sounds));
}

// ---------------------------------------------------------------- the alarm itself
const stats = (bank) => {
  const { chans, sr } = renderJob(bank, 0, 48000);
  let peak = 0;
  let sum = 0;
  let bad = 0;
  let n = 0;
  for (const c of chans)
    for (const v of c) {
      if (!Number.isFinite(v)) bad++;
      peak = Math.max(peak, Math.abs(v));
      sum += v * v;
      n++;
    }
  return { peak, rms: Math.sqrt(sum / n), bad, secs: chans[0].length / sr };
};
{
  const src = readFileSync(new URL('../client/audio/audio.js', import.meta.url), 'utf8');
  const local = src.match(/^\s*mate_down:\s*\{([^}]*)\}/m);
  check('alarm: listed for playLocal on the ui bus (heard over the dead-muffle)', !!local && /bank:\s*'mate_down'/.test(local[1]) && /bus:\s*'ui'/.test(local[1]), local?.[0]?.trim());
  check('alarm: the synth has a bank for it', DEF_BY_BANK.has('mate_down'));
  const s = stats('mate_down');
  check('alarm: finite, not silent, not clipping', s.bad === 0 && s.rms > 0.05 && s.peak <= 1, JSON.stringify(s));
  check('alarm: over within a second (it must not mask the fight)', s.secs <= 1, s.secs.toFixed(2) + ' s');
  const chime = stats('notify');
  const loud = (x) => x.rms * +(src.match(new RegExp(`^\\s*${x.name}:\\s*\\{[^}]*vol:\\s*([\\d.]+)`, 'm'))?.[1] ?? 0);
  const a = loud({ ...s, name: 'mate_down' });
  const b = loud({ ...chime, name: 'notify' });
  check('alarm: louder than the notify chime', a > b * 1.5, `${a.toFixed(3)} vs ${b.toFixed(3)}`);
}

// ---------------------------------------------------------------- the compass
{
  const src = readFileSync(new URL('../client/ui/hud2.js', import.meta.url), 'utf8');
  check('compass: a downed teammate ranks first', /r\.rank = mk\.cls === 'downed'[^\n]*\? 0 :/.test(src));
  check('the order is written down at the top of the HUD', /what matters most \(#272\)/.test(src) && /Night:\s+a downed teammate >/.test(src));
}

if (fails.length) {
  console.log(`\n${fails.length} FAILED`);
  process.exit(1);
}
console.log('\nall passed');
