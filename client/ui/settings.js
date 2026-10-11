// Settings: persistence + the settings panel (shared by splash and pause menu).
import { el, svgEl, lsGet, lsSet, clamp } from './dom.js';
import { glyph } from './icons.js';
import { loadRecord, clearRecord } from './records.js';
import { QUALITY, grassRadius } from '../render/renderer.js';
import { KeybindsSection } from './keybinds.js';
import { ACTIONS } from '../../shared/binds.js';
import { isDefault, onBindsChange } from '../game/binds.js';
import './ux-settings.css';
import { touchDevice } from '../game/touchmode.js';

const KEY = 'stn.settings';

export const DEFAULT_SETTINGS = Object.freeze({
  sensitivity: 1.0,
  aimSensitivity: 1.0,
  fov: 75,
  masterVolume: 0.4,
  musicVolume: 0.6,
  sfxVolume: 0.9,
  voiceVolume: 1, // 100% = the level the mix is balanced at (audio.js VOICE_BUS); the slider runs to 200%
  voiceDuck: true,
  quality: 'medium',
  grassDistance: 1, // x the quality preset's grass radius (0: no grass at all)
  renderScale: 1,
  ps1: false,
  ps1Strength: 0.5,
  highlight: 'subtle', // the outline on what [E] would act on (game/highlight.js): off / subtle / strong
  pushToTalk: true,
  invertY: false,
  rawMouse: true,
  fullscreen: true,
  weaponSway: true,
  keyHints: true,
  fullHud: false, // on a player's first runs the HUD keeps to health, ammo, the goal and the compass (firstrun.js)
  holdToDrop: true, // the drop key has to be held a moment (game/drophold.js), so a stray press keeps the gun
  showFps: true,
  achBanners: true, // a banner when an achievement unlocks (ui/achievements.js)...
  achSound: true, // ...and its chime
  hudScale: 1, // the HUD's size (ui/hud.js, ux-hud.css): a short window at this size gets the compact layout
  // Accessibility
  cameraShake: 1, // x the view's shake (game.js: explosions, a tank's footfalls, hits, crashes); 0 holds it still
  viewBob: true, // the view rising and falling with each stride (and riding the water, afloat)
  reduceFlashes: false, // muzzle flashes, blasts and lightning drawn far dimmer (render/comfort.js)
  aimMode: 'hold', // 'toggle': a press of the key latches the button on, the next lets go (game/input.js)
  sprintMode: 'hold',
  crouchMode: 'hold',
  touchControls: 'auto', // on-screen controls (game/touchmode.js): auto = on a phone or a tablet
  touchLook: 1, // how far a finger's drag turns the view
  touchSize: 1, // the touch buttons' size
});

const NUM_RANGES = {
  sensitivity: [0.1, 3],
  aimSensitivity: [0.25, 2],
  fov: [60, 100],
  masterVolume: [0, 1],
  musicVolume: [0, 1],
  sfxVolume: [0, 1],
  voiceVolume: [0, 2],
  renderScale: [0.5, 1],
  grassDistance: [0, 3],
  ps1Strength: [0.1, 1],
  cameraShake: [0, 1],
  hudScale: [0.75, 1.5],
  touchLook: [0.2, 3],
  touchSize: [0.75, 1.4],
};
const ENUMS = {
  quality: ['low', 'medium', 'high', 'ultra'],
  highlight: ['off', 'subtle', 'strong'],
  aimMode: ['hold', 'toggle'],
  sprintMode: ['hold', 'toggle'],
  crouchMode: ['hold', 'toggle'],
  touchControls: ['auto', 'on', 'off'],
};

export function sanitizeSettings(s) {
  const out = { ...DEFAULT_SETTINGS };
  if (s && typeof s === 'object') {
    for (const k of Object.keys(NUM_RANGES)) {
      const v = Number(s[k]);
      if (Number.isFinite(v)) out[k] = clamp(v, NUM_RANGES[k][0], NUM_RANGES[k][1]);
    }
    for (const k in ENUMS) if (ENUMS[k].includes(s[k])) out[k] = s[k];
    for (const k of ['pushToTalk', 'voiceDuck', 'invertY', 'rawMouse', 'fullscreen', 'weaponSway', 'keyHints', 'fullHud', 'holdToDrop', 'showFps', 'ps1', 'achBanners', 'achSound', 'viewBob', 'reduceFlashes']) if (typeof s[k] === 'boolean') out[k] = s[k];
  }
  return out;
}

export function loadSettings() {
  let s = null;
  try {
    s = JSON.parse(lsGet(KEY, 'null'));
  } catch {}
  // a phone's first visit: the settings a phone can run (the low preset, at a little under its own pixels)
  if (!s && touchDevice()) return sanitizeSettings({ quality: 'low', renderScale: 0.85, grassDistance: 0.7 });
  return sanitizeSettings(s);
}

export function saveSettings(s) {
  lsSet(KEY, JSON.stringify(s));
}

// is a setting off its default? (a slider's value is a float: near enough is the same)
const changed = (s, k) => (typeof DEFAULT_SETTINGS[k] === 'number' ? Math.abs(s[k] - DEFAULT_SETTINGS[k]) > 1e-6 : s[k] !== DEFAULT_SETTINGS[k]);

// ---------------------------------------------------------------- panel
const pct = (v) => Math.round(v * 100) + '%';

// The panel's tabs, down its left side, named for what a player looks for: each with a line of what is in it (sum) and
// a line at the top of its page (desc). A { head } entry in rows starts a sub-group within the tab. Keys & controls and
// Your record draw their own pages (keybinds.js, _recordTab).
const TABS = [
  {
    id: 'display',
    label: 'Display',
    icon: 'eye',
    sum: 'Quality, FOV, PS1',
    desc: 'How the world is drawn. The game stays in view behind this page, so you can see a change as you make it.',
    rows: [
      { head: 'Performance' },
      { k: 'quality', label: 'Quality', type: 'seg', options: ['low', 'medium', 'high', 'ultra'], hint: 'Shadows, sun rays, ambient occlusion, grass density, view distance' },
      // (not a setting of its own: the grass distance slider all the way down. Turned off, the grass is back as far
      // out as it is by default)
      {
        k: 'noGrass',
        label: 'No grass',
        type: 'toggle',
        of: (s) => !(s.grassDistance > 0),
        to: (on) => ({ grassDistance: on ? 0 : DEFAULT_SETTINGS.grassDistance }),
        hint: 'No grass drawn at all, for a higher frame rate. The same as the grass distance all the way down',
      },
      {
        k: 'grassDistance',
        link: 'noGrass',
        label: 'Grass distance',
        type: 'range',
        min: 0,
        max: 3,
        step: 0.05,
        fmt: (v, s) => (v > 0 ? Math.round(grassRadius(QUALITY[s.quality] || QUALITY.medium, v)) + ' m' : 'Off'),
        hint: 'How far out grass is drawn. Further costs frame rate; all the way down, none at all (No grass)',
      },
      { k: 'renderScale', label: 'Render scale', type: 'range', min: 0.5, max: 1, step: 0.05, fmt: pct, hint: 'Lower draws fewer pixels: faster, softer' },
      { head: 'View' },
      { k: 'fov', label: 'Field of view', type: 'range', min: 60, max: 100, step: 1, fmt: (v) => Math.round(v) + '°', hint: 'Wider sees more at the edges' },
      { k: 'ps1', label: 'PS1 shader', type: 'toggle', hint: 'Low resolution, wobbling polygons, dithered colour, thicker fog' },
      { k: 'ps1Strength', label: 'PS1 intensity', type: 'range', min: 0.1, max: 1, step: 0.05, fmt: pct, needs: 'ps1', hint: 'Pixel size, wobble, colour banding and fog' },
      { head: 'Window' },
      { k: 'fullscreen', label: 'Fullscreen while playing', type: 'toggle', hint: 'Keeps Ctrl+W (crouch + forward) from closing the tab. Off = the tab asks before it closes. On a phone: the whole screen, held on its side' },
    ],
  },
  {
    id: 'audio',
    label: 'Audio & voice',
    icon: 'speaker',
    sum: 'Volumes, push to talk',
    desc: 'How loud each part of the mix is, and how your voice goes out.',
    rows: [
      { head: 'Volume' },
      { k: 'masterVolume', label: 'Master', type: 'range', min: 0, max: 1, step: 0.01, fmt: pct },
      { k: 'musicVolume', label: 'Music & ambience', type: 'range', min: 0, max: 1, step: 0.01, fmt: pct },
      { k: 'sfxVolume', label: 'Effects', type: 'range', min: 0, max: 1, step: 0.01, fmt: pct },
      { k: 'voiceVolume', label: 'Voice chat', type: 'range', min: 0, max: 2, step: 0.01, fmt: pct },
      { head: 'Voice chat' },
      { k: 'pushToTalk', label: 'Push to talk', type: 'toggle', hint: 'Off = open mic' },
      { k: 'voiceDuck', label: 'Lower game for voices', type: 'toggle', hint: 'Music and effects step back while someone you can hear is talking' },
    ],
  },
  {
    id: 'mouse',
    label: 'Mouse & aim',
    icon: 'headshot',
    sum: 'Sensitivity, invert, touch',
    desc: 'How the view turns with the mouse, or with a finger on a phone.',
    rows: [
      { head: 'Mouse' },
      { k: 'sensitivity', label: 'Mouse sensitivity', type: 'range', min: 0.1, max: 3, step: 0.05, fmt: (v) => v.toFixed(2) + '×', mouse: true },
      { k: 'aimSensitivity', label: 'Aim sensitivity', type: 'range', min: 0.25, max: 2, step: 0.05, fmt: (v) => v.toFixed(2) + '×', hint: 'While aiming, on top of the zoom' },
      { k: 'invertY', label: 'Invert mouse Y', type: 'toggle' },
      { k: 'rawMouse', label: 'Raw mouse input', type: 'toggle', hint: 'Off = OS mouse acceleration applies', mouse: true },
      { head: 'Touch' },
      { k: 'touchControls', label: 'Touch controls', type: 'seg', options: ['auto', 'on', 'off'], hint: 'A stick, buttons and drag to look. Auto = on a phone or a tablet' },
      { k: 'touchLook', label: 'Touch look speed', type: 'range', min: 0.2, max: 3, step: 0.05, fmt: (v) => v.toFixed(2) + '×' },
      { k: 'touchSize', label: 'Button size', type: 'range', min: 0.75, max: 1.4, step: 0.05, fmt: pct },
    ],
  },
  { id: 'keys', label: 'Keys & controls', icon: 'keyboard', sum: `${ACTIONS.length} actions, 2 keys each` },
  {
    id: 'interface',
    label: 'Interface',
    icon: 'grid',
    sum: 'Highlight, hints, FPS',
    desc: 'What the screen tells you while you play.',
    rows: [
      { head: 'On screen' },
      { k: 'highlight', label: 'Interaction highlight', type: 'seg', options: ['off', 'subtle', 'strong'], hint: 'A faint outline on what you can use, while you look at it up close' },
      { k: 'keyHints', label: 'Key hints', type: 'toggle', hint: 'Names a key when it would help, until you have used it twice' },
      { k: 'fullHud', label: 'Show the whole HUD', type: 'toggle', hint: 'Your first three runs leave out the minimap, the info line and achievement banners. On: show them from the start' },
      { k: 'showFps', label: 'Show FPS counter', type: 'toggle' },
      { k: 'hudScale', label: 'HUD size', type: 'range', min: 0.75, max: 1.5, step: 0.05, fmt: pct, hint: 'Text and blocks on screen while you play. On a small window the HUD folds to a compact layout' },
      { head: 'Achievements' },
      { k: 'achBanners', label: 'Unlock banners', type: 'toggle', hint: 'A banner at the top of the screen when you unlock an achievement' },
      { k: 'achSound', label: 'Unlock sound', type: 'toggle', hint: 'A chime when you unlock one' },
    ],
  },
  {
    id: 'access',
    label: 'Accessibility',
    icon: 'person',
    sum: 'Motion, hold or toggle',
    desc: 'Comfort and reach. A preset sets several rows at once; change any row after.',
    presets: [
      {
        label: 'Motion comfort',
        what: 'Shake and bob off, sway off, flashes dimmed, field of view 90°',
        set: { cameraShake: 0, viewBob: false, weaponSway: false, reduceFlashes: true, fov: 90 },
      },
      {
        label: 'Trackpad / one hand',
        what: 'Aim, sprint and crouch on toggle, drop needs a hold',
        set: { aimMode: 'toggle', sprintMode: 'toggle', crouchMode: 'toggle', holdToDrop: true },
      },
    ],
    rows: [
      { head: 'Motion & camera', note: 'for motion sickness' },
      { k: 'cameraShake', label: 'Camera shake', type: 'range', min: 0, max: 1, step: 0.05, fmt: pct, hint: "Explosions, a Tank's footfalls, hits and crashes. 0% holds the view still" },
      { k: 'viewBob', label: 'View bob', type: 'toggle', hint: 'The view rises and falls with each stride, and rides the water when you swim' },
      { k: 'weaponSway', label: 'Weapon look sway', type: 'toggle', hint: 'The gun trails behind fast turns; off also keeps small landings from dipping the view' },
      { k: 'reduceFlashes', label: 'Reduce flashes', type: 'toggle', hint: 'Muzzle flashes, blasts and lightning drawn far dimmer' },
      { head: 'Hold or toggle', note: 'for trackpads and tired hands' },
      { k: 'aimMode', label: 'Aim', type: 'seg', options: ['hold', 'toggle'], hint: 'Toggle: one press aims, the next lets go (so does a weapon switch)' },
      { k: 'sprintMode', label: 'Sprint', type: 'seg', options: ['hold', 'toggle'], hint: 'Toggle: one press runs until you stop moving or press it again' },
      { k: 'crouchMode', label: 'Crouch', type: 'seg', options: ['hold', 'toggle'], hint: 'Toggle: one press crouches, the next stands you up' },
      { k: 'holdToDrop', label: 'Hold to drop weapon', type: 'toggle', hint: 'The drop key has to be held a moment, so a stray press in a fight keeps your gun. Off = a press drops it' },
    ],
  },
  { id: 'record', label: 'Your record', icon: 'trophy', sum: '', apart: true },
];
const TAB_KEY = 'stn.settingsTab';
// the tabs as they were named before they were regrouped (a page remembered from then still opens)
const OLD_TABS = { controls: 'mouse', keybinds: 'keys', graphics: 'display' };
const TAB_IDS = TABS.map((t) => t.id);
const settingKeys = (tab) => (tab.rows || []).filter((r) => r.k).map((r) => r.k);

// a circling arrow: put this one back
const RESET_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.6 12a7.4 7.4 0 1 0 2.2-5.3" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M4 3.4v5.2h5.2" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export class SettingsPanel {
  constructor(ui, parent) {
    this.ui = ui;
    this.root = el('div', 'stn-settings ux-set', parent);
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', 'Settings');
    this.root.hidden = true;
    const card = el('div', 'set-card paper', this.root);
    const head = el('div', 'set-head', card);
    el('h2', 'set-title', head, 'Settings');
    const sub = el('span', 'set-sub', head, 'Changes apply at once. A ');
    el('i', 'ux-bar-key', sub);
    sub.append(' bar marks anything you changed from its default.');
    const close = svgEl('button', 'set-close btn-icon', head, glyph('xmark'));
    close.title = 'Close';
    close.addEventListener('click', () => this.hide());

    this.inputs = {};
    this.rowEls = {};
    this.tabs = {};
    const body = el('div', 'set-body set-split', card);
    const nav = el('nav', 'set-nav', body);
    nav.setAttribute('role', 'tablist');
    nav.setAttribute('aria-orientation', 'vertical');
    nav.addEventListener('keydown', (e) => this._navKey(e));
    this.main = el('div', 'set-main', body);
    for (const tab of TABS) {
      if (tab.apart) el('div', 'ux-nav-sep', nav);
      const btn = svgEl('button', 'set-tab', nav, glyph(tab.icon, 'set-tab-ico'));
      const txt = el('span', 'set-tab-txt', btn);
      el('span', 'ux-tab-name', txt, tab.label);
      const sum = el('span', 'ux-tab-sum', txt, tab.sum);
      const count = el('span', 'ux-tab-count', btn, '');
      btn.type = 'button';
      btn.title = tab.label;
      btn.setAttribute('role', 'tab');
      btn.addEventListener('click', () => this.select(tab.id));
      let pane;
      if (tab.id === 'keys') pane = (this.keybinds = new KeybindsSection(this, this.main)).root;
      else {
        pane = el('section', 'set-sec', this.main);
        this._paneHead(pane, tab.label, tab.desc);
        if (tab.id === 'record') this._recordTab(pane);
        else {
          if (tab.presets) this._presets(pane, tab.presets);
          for (const row of tab.rows) row.head ? this._group(pane, row) : this._row(pane, row, tab.id);
        }
      }
      pane.classList.add('set-pane');
      pane.setAttribute('role', 'tabpanel');
      this.tabs[tab.id] = { btn, pane, count, sum, tab };
    }
    this.recSum = this.tabs.record.sum;
    const remembered = lsGet(TAB_KEY, '');
    this.select(OLD_TABS[remembered] || (TAB_IDS.includes(remembered) ? remembered : TABS[0].id));

    // the foot: this tab's reset (with how many it would put back), every tab's behind a second click, and Done
    const foot = el('div', 'set-foot ux-foot', card);
    this.resetTab = el('button', 'btn btn-ghost ux-reset-tab', foot, '');
    this.resetTab.type = 'button';
    this.resetTab.addEventListener('click', () => this._resetTab(this.tab));
    const all = (this.allBox = el('div', 'ux-all', foot));
    this.changedHere = el('span', 'ux-changed', all, '');
    this.allBtn = el('button', 'ux-link', all, 'Reset all tabs…');
    this.allBtn.type = 'button';
    this.allBtn.title = 'Every setting and every key back to its default';
    this.allBtn.addEventListener('click', () => this._armAll(true));
    this.allAsk = el('span', 'ux-all-ask', all);
    el('span', '', this.allAsk, 'Every tab and every key back to its default?');
    const yes = el('button', 'btn btn-ghost btn-danger ux-mini', this.allAsk, 'Yes, reset');
    const no = el('button', 'btn btn-ghost ux-mini', this.allAsk, 'Keep');
    yes.type = no.type = 'button';
    yes.addEventListener('click', () => {
      this.keybinds.resetAll();
      this.ui._applySettings({ ...DEFAULT_SETTINGS });
      this._armAll(false);
      this.sync();
    });
    no.addEventListener('click', () => this._armAll(false));
    this._armAll(false);
    const done = el('button', 'btn btn-blood', foot, 'Done');
    done.addEventListener('click', () => this.hide());

    onBindsChange(() => this._syncCounts());

    this.root.addEventListener('pointerdown', (e) => {
      if (e.target === this.root) this.hide();
    });
    this._onKey = (e) => {
      if (!this.root.hidden && e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.hide();
      }
    };
    document.addEventListener('keydown', this._onKey, true);
  }

  select(id) {
    id = OLD_TABS[id] || id;
    if (!this.tabs[id]) return;
    if (this.tab !== id) {
      this.keybinds?.cancel(); // (a key being listened for is not left waiting on a tab out of sight)
      this._armAll?.(false);
    }
    this.tab = id;
    lsSet(TAB_KEY, id);
    for (const k in this.tabs) {
      const { btn, pane } = this.tabs[k];
      const on = k === id;
      btn.classList.toggle('on', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
      btn.tabIndex = on ? 0 : -1;
      pane.hidden = !on;
    }
    // Display: the game is not dimmed behind the card, so a change to the view can be seen as it is made
    this.root.classList.toggle('ux-live', id === 'display');
    this.root.classList.toggle('ux-keys', id === 'keys');
    this.main.scrollTop = 0;
    this._syncCounts();
  }

  // up / down (or left / right, when the narrow layout lays the tabs out in a row) walk the tabs
  _navKey(e) {
    const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const i = TAB_IDS.indexOf(this.tab);
    const next = TAB_IDS[(i + step + TAB_IDS.length) % TAB_IDS.length];
    this.select(next);
    this.tabs[next].btn.focus();
  }

  _paneHead(pane, title, desc) {
    const h = el('div', 'ux-pane-head', pane);
    el('h3', 'set-sec-title', h, title);
    if (desc) el('p', 'ux-pane-desc', h, desc);
    return h;
  }

  _group(pane, row) {
    const g = el('h4', 'set-group', pane, row.head);
    if (row.note) el('span', 'ux-group-note', g, row.note);
  }

  // presets: a card each, naming what it sets; Apply sets those rows (and says Applied while they all still match)
  _presets(pane, presets) {
    const box = el('div', 'ux-presets', pane);
    this.presetEls = presets.map((p) => {
      const c = el('div', 'ux-preset', box);
      const t = el('div', 'ux-preset-t', c);
      el('b', '', t, p.label);
      el('small', '', t, p.what);
      const b = el('button', 'btn btn-ghost ux-mini', c, 'Apply');
      b.type = 'button';
      b.addEventListener('click', () => {
        this.ui._applySettings({ ...this.ui.settings, ...p.set });
        this.sync();
      });
      return { p, b };
    });
  }

  // not a setting, but this is where a player looks for it: wiping the personal record (records.js).
  // It takes two clicks: the first only arms the button.
  _recordTab(rs) {
    this.recRow = el('div', 'set-row set-rec', rs);
    this.recHint = el('small', 'set-hint', el('label', 'set-label', this.recRow, 'Personal bests & run history'));
    const rc = el('div', 'set-ctl', this.recRow);
    this.recKeep = el('button', 'btn btn-ghost', rc, 'Keep it');
    this.recClear = el('button', 'btn btn-ghost btn-danger', rc);
    this.recKeep.type = this.recClear.type = 'button';
    this.recKeep.addEventListener('click', () => this._syncRecord());
    this.recClear.addEventListener('click', () => {
      if (!this.recArmed) return this._syncRecord(true);
      clearRecord();
      this._syncRecord();
      this.ui.splash.syncRecord();
    });
  }

  _row(parent, row) {
    // (mouse: only for a mouse - hidden in touch mode, touch.css)
    const r = el('div', 'set-row sr-' + row.type + (row.mouse ? ' set-mouse' : ''), parent);
    const lab = el('label', 'set-label', r, row.label);
    if (row.hint) el('small', 'set-hint', lab, row.hint);
    const ctl = el('div', 'set-ctl', r);
    // this row back to its default: there only while it is off it (the others keep its room, so the controls line up)
    const back = svgEl('button', 'ux-row-reset', null, RESET_SVG);
    back.type = 'button';
    back.title = 'Back to the default';
    back.setAttribute('aria-label', `${row.label}: back to the default`);
    back.addEventListener('click', () => {
      this.ui._applySettings({ ...this.ui.settings, [row.k]: DEFAULT_SETTINGS[row.k] });
      this.sync();
    });
    this.rowEls[row.k] = { r, back };
    if (row.type === 'range') {
      const inp = el('input', 'set-range', ctl);
      inp.type = 'range';
      inp.min = row.min;
      inp.max = row.max;
      inp.step = row.step;
      inp.setAttribute('aria-label', row.label);
      const val = el('output', 'set-val', ctl);
      inp.addEventListener('input', () => {
        const v = parseFloat(inp.value);
        val.textContent = row.fmt(v, this.ui.settings);
        this._paintRange(inp);
        this.ui._applySettings({ ...this.ui.settings, [row.k]: v });
        this._syncChanged();
        if (row.link) this.inputs[row.link]?.sync(this.ui.settings); // (a toggle that is this slider at one end)
      });
      this.inputs[row.k] = {
        sync: (s) => {
          inp.value = s[row.k];
          val.textContent = row.fmt(s[row.k], s);
          this._paintRange(inp);
          // a row that only means something with another setting on is dimmed while that one is off
          if (row.needs) r.classList.toggle('set-off', (inp.disabled = !s[row.needs]));
        },
      };
    } else if (row.type === 'toggle') {
      const b = el('button', 'set-toggle', ctl);
      b.type = 'button';
      b.setAttribute('aria-label', row.label);
      el('i', 'knob', b);
      const txt = el('span', 'set-toggle-txt', ctl);
      // of / to: a toggle that is another setting seen one way (of: whether it is on; to(on): the settings that turn
      // it so), not a setting of its own
      const isOn = (s) => (row.of ? row.of(s) : !!s[row.k]);
      b.addEventListener('click', () => {
        const on = !isOn(this.ui.settings);
        this.ui._applySettings({ ...this.ui.settings, ...(row.to ? row.to(on) : { [row.k]: on }) });
        this.sync();
      });
      this.inputs[row.k] = {
        sync: (s) => {
          const on = isOn(s);
          b.classList.toggle('on', on);
          b.setAttribute('aria-pressed', on ? 'true' : 'false');
          txt.textContent = on ? 'On' : 'Off';
        },
      };
    } else if (row.type === 'seg') {
      const seg = el('div', 'set-seg', ctl);
      seg.setAttribute('role', 'group');
      seg.setAttribute('aria-label', row.label);
      const btns = row.options.map((o) => {
        const b = el('button', 'seg-btn', seg, o);
        b.type = 'button';
        b.addEventListener('click', () => {
          this.ui._applySettings({ ...this.ui.settings, [row.k]: o });
          this.sync();
        });
        return b;
      });
      this.inputs[row.k] = {
        sync: (s) =>
          btns.forEach((b, i) => {
            b.classList.toggle('on', row.options[i] === s[row.k]);
            b.setAttribute('aria-pressed', row.options[i] === s[row.k] ? 'true' : 'false');
          }),
      };
    }
    ctl.append(back);
  }

  _paintRange(inp) {
    const p = ((inp.value - inp.min) / (inp.max - inp.min)) * 100;
    inp.style.setProperty('--p', p.toFixed(1) + '%');
  }

  // ---------------------------------------------------------------- what is off its default
  _changedIn(id) {
    if (id === 'keys') return ACTIONS.filter((a) => !isDefault(a.id)).length;
    const tab = this.tabs[id]?.tab;
    return tab ? settingKeys(tab).filter((k) => changed(this.ui.settings, k)).length : 0;
  }

  _resetTab(id) {
    if (id === 'keys') return this.keybinds.resetAll();
    const keys = settingKeys(this.tabs[id].tab);
    if (!keys.length) return;
    this.ui._applySettings({ ...this.ui.settings, ...Object.fromEntries(keys.map((k) => [k, DEFAULT_SETTINGS[k]])) });
    this.sync();
  }

  _armAll(on) {
    if (!this.allAsk) return;
    this.allArmed = on;
    this.allAsk.hidden = !on;
    this.allBtn.hidden = this.changedHere.hidden = on;
    this.resetTab.hidden = on || this.tab === 'record';
  }

  // the amber bar and the row's own reset on each changed row, the counts on the tabs, and the foot's reset
  _syncChanged() {
    const s = this.ui.settings;
    for (const k in this.rowEls) {
      const on = changed(s, k);
      this.rowEls[k].r.classList.toggle('ux-changed-row', on);
      this.rowEls[k].back.classList.toggle('off', !on);
      this.rowEls[k].back.disabled = !on;
    }
    for (const { p, b } of this.presetEls || []) {
      const applied = Object.entries(p.set).every(([k, v]) => s[k] === v);
      b.textContent = applied ? 'Applied' : 'Apply';
      b.disabled = applied;
    }
    this._syncCounts();
  }

  _syncCounts() {
    if (!this.resetTab) return;
    for (const id in this.tabs) {
      const n = this._changedIn(id);
      this.tabs[id].count.textContent = n ? String(n) : '';
      this.tabs[id].btn.title = this.tabs[id].tab.label + (n ? ` · ${n} changed` : '');
    }
    const id = this.tab;
    const n = this._changedIn(id);
    const name = id === 'keys' ? 'keys' : this.tabs[id].tab.label;
    this.resetTab.textContent = `Reset ${name}` + (n ? ` (${n})` : '');
    this.resetTab.disabled = !n;
    this.resetTab.hidden = this.allArmed || id === 'record';
    this.changedHere.textContent = id === 'record' ? '' : n ? `${n} changed here ·` : 'All defaults here ·';
    this.changedHere.classList.toggle('some', !!n);
  }

  sync() {
    const s = this.ui.settings;
    for (const k in this.inputs) this.inputs[k].sync(s);
    this._syncChanged();
    this._syncRecord();
  }

  _syncRecord(armed = false) {
    const { runs, escapes } = loadRecord().total;
    const n = `${runs} run${runs === 1 ? '' : 's'}`;
    this.recArmed = armed;
    this.recRow.classList.toggle('armed', armed);
    this.recKeep.hidden = !armed;
    this.recClear.textContent = armed ? 'Yes, clear it' : 'Clear record';
    this.recClear.disabled = !runs;
    this.recSum.textContent = runs ? `${n} · clear it here` : 'No runs yet';
    this.recHint.textContent = armed
      ? `Erase ${n} and your bests for good?`
      : runs
        ? `${n}, ${escapes} escape${escapes === 1 ? '' : 's'}. Kept in this browser only.`
        : 'Nothing recorded yet. Kept in this browser only.';
  }

  show(tab) {
    if (tab) this.select(tab);
    this._armAll(false);
    this.sync();
    this.root.hidden = false;
    this.root.classList.remove('in');
    void this.root.offsetWidth;
    this.root.classList.add('in');
  }

  hide() {
    this.keybinds.cancel(); // (a bind being listened for is not set by a key pressed after the panel shut)
    this.root.hidden = true;
  }

  get visible() {
    return !this.root.hidden;
  }
}
