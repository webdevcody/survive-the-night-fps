// Field map overlay [M]: the baked survey map of the valley with live markers - you, your team, the
// car, pings, where the car supplies and the schematics are rumoured to be, and the places you have discovered.
// A click sets your own waypoint (the game keeps it, shows it on the compass and in the world, and shares it:
// the team's waypoints are flags here too, with who set them). A pinch or the wheel zooms, a drag pans, and [R] turns
// the map with you, the way you face up (a compass in its corner keeps north).
//
// Issue #225 ("answers first"): the panel beside the map answers in order - what the car still needs, where and how far
// (what is in your pack first), the team (a downed mate first), the schematics in one row, a short key - and a click on
// any row centres the map on it. Every marker is one colour and one shape, the same as the key (mapmarks.js). A rumour
// rings the place it names. What is off the view waits on its edge with its distance; the edges carry the survey's grid
// letters, for callouts ("Hank is down in D6"). The island is drawn as one, with the sea and the Route 9 bridge (#173).
// In a small window the panel folds into a column of chips and the key into a popover, so the map is never cut off.
//
// It is one of the kit screens (screentabs.js): the Map tab, in the same frame as the inventory, the perks and the
// achievements, under the same row of tabs (the HUD's clock in it, and the close). The map is square, as big as the
// frame lets it be, and the panel takes the rest of the width (in two columns, when there is room for them).
import './ux-map.css';
import { ZONE, ZONE_NAMES, ITEM, ITEM_DEFS, SCHEMATICS, SCHEM_BIT, supplyRumours, schematicRumours } from '../../shared/defs.js';
const VEH_LABEL = { 1: 'moped', 2: 'car', 3: 'bicycle' }; // (shared/vehicles.js VEH)
import { SUPPLIES, SUPPLY_NEED, W } from '../game/act.js'; // (this act's)
import { el, svgEl, lsGet, lsSet } from './dom.js';
import { itemIcon, glyph } from './icons.js';
import { renderMapCanvas, renderSeaCanvas, MAP_PX } from './mapcanvas.js';
import { bindLabel, liveText } from '../game/binds.js';
import { ScreenTabs, screenCame } from './screentabs.js';
import { badge, setBadge, initial, fmtDist, dirOf, gridRef, gridLetter, placeAt, GRID, PING_WORD } from './mapmarks.js';

const TEAM_BESIDE = 14; // m: a teammate's waypoint on your own waypoint's spot is drawn this far east of it
const MAX_ZOOM = 4; // the baked map is 2 px a metre: past this it is a blur
const DRAG_PX = 5; // a press that moves this far is a pan, not a click for the waypoint
const START_ZOOM = 2.5; // the first opening starts this close in on you (about 256 m across), the wheel zooms out to all of it
const FIND_ZOOM = 2; // a click on a row centres the map on what it names, at least this close in
const SEA_PAD = 56; // m of sea drawn round the island on every side
const PIN_MAX = 8; // edge pins at most (the most urgent first)
const CITY_NAMES_ZOOM = 2.2; // what is named inside a city is written from this zoom in (the mainland's Town Center)
const HEADING_KEY = 'stn.mapHeadingUp';
const ZOOM_KEY = 'stn.mapZoom';

export class MapScreen {
  constructor(ui, parent) {
    this.ui = ui;
    this.open = false;
    this.root = el('div', 'mapscr', parent);
    this.root.hidden = true;
    const bg = el('div', 'map-bg', this.root);
    // the kit screens' frame: the row of tabs (the close at its end), the map's sheet under it
    const box = el('div', 'scr-frame', this.root);
    const frame = (this.frame = el('div', 'map-frame paper mx', box));
    this.tabs = new ScreenTabs(ui, box, 'map', () => this.onClose?.(), frame);
    const head = el('div', 'map-head mx-head', frame);
    // (which map: the tab says it is the map)
    this.titleName = el('span', 'map-title', head, 'Harlan Valley');
    el('span', 'mx-grow', head);
    // where you are; a click brings the map back to you
    this.youBtn = el('button', 'mx-you', head);
    this.youBtn.type = 'button';
    this.youBtn.title = 'Back to me (Space)';
    this.coords = el('span', 'map-coords', this.youBtn);
    this.youGrid = el('span', '', this.coords);
    this.youXY = el('span', 'mx-xy', this.coords); // (a small window drops it)
    this.youBtn.addEventListener('click', () => this.backToMe());
    // north up, or turned with you so the way you face is up: kept between openings, and games
    this.headingUp = lsGet(HEADING_KEY, '0') === '1';
    this.rotBtn = el('button', 'map-rot', head);
    this.rotBtn.type = 'button';
    this.rotBtn.title = 'Turn the map with you (R)';
    svgEl('i', 'map-rot-ico', this.rotBtn, glyph('compass'));
    this.rotTxt = el('span', '', this.rotBtn);
    this.rotBtn.addEventListener('click', () => this.setHeadingUp(!this.headingUp));
    const body = el('div', 'map-body mx-body', frame);
    this.view = el('div', 'map-view', body);
    // the map itself, zoomed and panned inside the view: the names and markers are placed in % of it, so a zoom
    // spreads them apart without making them any bigger. On the island it is a chart: the map with the sea round it
    this.pane = el('div', 'map-pane', this.view);
    this.seaWrap = el('div', 'mx-sea', this.pane);
    this.canvasWrap = el('div', 'map-canvas', this.pane);
    this.rings = el('div', 'mx-rings', this.pane);
    this.labels = el('div', 'map-labels', this.pane);
    this.markers = el('div', 'mx-marks', this.pane);
    this.flash = el('i', 'mx-flash', this.markers);
    this.flash.hidden = true;
    // the grid's letters and numbers along the view's edges (north up), and what is off the view, waiting on its edge
    this.ruleTop = el('div', 'mx-rule top', this.view);
    this.ruleLeft = el('div', 'mx-rule left', this.view);
    this.pins = el('div', 'mx-pins', this.view);
    // where north is, turned with the map; a click on it turns the map too
    this.north = el('button', 'map-north', this.view);
    this.north.type = 'button';
    this.north.title = 'North up / facing up (R)';
    const dial = svgEl('i', 'map-north-dial', this.north, glyph('compass'));
    el('b', '', dial, 'N');
    this.north.addEventListener('click', () => this.setHeadingUp(!this.headingUp));
    // a place's card, while the pointer is over its name
    this.card = el('div', 'mx-card', this.view);
    this.card.hidden = true;

    // ---- the panel: the car, the team, the schematics, the key (the car and the team in one column, the rest in a
    // second, when the panel is wide enough to have two: ux-map.css)
    const side = (this.side = el('div', 'mx-side', body));
    const cols = el('div', 'mx-cols', side);
    let col = null;
    const sec = (title) => {
      const h = el('div', 'mx-h', col);
      const t = el('span', 'mx-h-t', h, title);
      const n = el('span', 'mx-h-n', h, '');
      return { t, n };
    };
    col = el('div', 'mx-col', cols);
    this.carH = sec('The car');
    this.carBar = el('div', 'mx-bar', col);
    this.carRows = el('div', 'mx-rows', col);
    this.carDone = el('div', 'mx-done', col);
    this.teamH = sec('Team');
    this.teamRows = el('div', 'mx-rows', col);
    col = el('div', 'mx-col', cols);
    this.schemH = sec('Schematics');
    this.schemRow = el('div', 'mx-schems', col);
    this.keyH = sec('Key');
    this.keyGrid = el('div', 'mx-key', col);
    this._buildKey(this.keyGrid);

    // ---- small windows: the panel as chips, the key behind a button
    const chips = (this.chipsBox = el('div', 'mx-chips', body));
    this.chipList = el('div', 'mx-chiplist', chips);
    this.keysBtn = el('button', 'mx-chip mx-keysbtn', chips);
    this.keysBtn.type = 'button';
    el('span', '', this.keysBtn, 'Key');
    el('span', 'kbd sm', this.keysBtn, '?');
    this.pop = el('div', 'mx-pop', chips);
    this.pop.hidden = true;
    this.popKey = el('div', 'mx-key', this.pop);
    this._buildKey(this.popKey);
    this.popKeys = el('div', 'map-keys mx-keys', this.pop);
    this.keysBtn.addEventListener('click', () => (this.pop.hidden = !this.pop.hidden));

    // ---- the keys, under the map
    const foot = el('div', 'mx-foot', frame);
    this.footKeys = el('div', 'map-keys mx-keys', foot);
    el('span', 'mx-foot-hint', foot, 'Click a row to find it on the map');
    for (const box of [this.footKeys, this.popKeys]) {
      for (const [k, t] of [
        ['LMB', 'waypoint'],
        ['X', 'clear'],
        ['Wheel', 'zoom'],
        ['Drag', 'pan'],
        ['R', 'north up'],
        ['Space', 'back to me'],
        [() => bindLabel('map'), 'close'], // (keybinds, game/binds.js; X, R and Space are the map's own)
        [() => bindLabel('ping'), 'ping (in game)'],
      ]) {
        const s = el('span', 'gh', box);
        if (typeof k === 'function') liveText(el('span', 'kbd sm', s), k);
        else el('span', 'kbd sm', s, k);
        el('span', '', s, t);
      }
    }

    this.world = null;
    this.labelEls = [];
    this.markLabs = [];
    this.pool = [];
    this.ringPool = [];
    this.pinPool = [];
    this.rowPools = new Map(); // container -> [row]
    this.last = null; // the data of the last update (the place cards read it)
    this.pad = 0; // m of sea round the map (the island), so the pane is span m across
    this.span = 1;
    this.vw = 0; // the view's width in px (kept by an observer: reading it every frame would force a layout)
    new ResizeObserver(() => {
      this.vw = this.view.clientWidth;
      this._ruleKey = '';
    }).observe(this.view);
    // waypoint: the game sets onWaypoint and gets { x, z, zone } (zone: id of the place it snapped to, or -1),
    // or null to clear it
    this.onWaypoint = null;
    // the row's close, or a left press outside the map's sheet and the row, closes it: the game sets onClose
    this.onClose = null;
    this.root.addEventListener('pointerdown', (e) => {
      if (e.button === 0 && (e.target === bg || e.target === this.root || e.target === box)) this.onClose?.();
      // (a press anywhere but the key's button puts the key popover away)
      if (!this.pop.hidden && !e.target.closest('.mx-pop, .mx-keysbtn')) this.pop.hidden = true;
    });
    // zoom: how many times the view's width the map is, kept between openings, and games. It zooms about the focus, a
    // spot of the map (a fraction across / down) held in the middle of the view as far as the map's edges allow: you,
    // as you move, until a drag moves it somewhere else (an opening puts it back on you). cx / cy is the middle shown
    const z = parseFloat(lsGet(ZOOM_KEY, ''));
    this.zoom = z >= 1 && z <= MAX_ZOOM ? z : START_ZOOM;
    this.fx = this.fy = 0.5;
    this.follow = true;
    this.cx = this.cy = 0.5;
    // how far the map is turned clockwise on screen (rad): your yaw when it faces up, else 0
    this.yaw = 0;
    this.rot = 0;
    this.ptrs = new Map(); // pointer id -> where it was last seen (two of them are a pinch)
    this.press = null; // { id, x, y, target }: a press that has not moved far enough to be a pan; let go, it is a click
    this.gesture = null; // Safari's trackpad pinch: the zoom when it began
    this.view.addEventListener('pointerdown', (e) => {
      if (!this.world || e.target.closest('.map-north, .mx-pin')) return;
      // the right button anywhere takes the waypoint back
      if (e.button === 2) return this.onWaypoint?.(null);
      if (e.button !== 0) return;
      this.view.setPointerCapture(e.pointerId);
      this.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.press = this.ptrs.size === 1 ? { id: e.pointerId, x: e.clientX, y: e.clientY, target: e.target } : null;
    });
    this.view.addEventListener('pointermove', (e) => {
      const p = this.ptrs.get(e.pointerId);
      if (!p) return this._hoverCard(e);
      if (this.press) {
        if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < DRAG_PX) return;
        this.press = null;
        this.view.classList.add('panning');
        this.card.hidden = true;
      }
      if (this.ptrs.size === 1) {
        this._panBy(e.clientX - p.x, e.clientY - p.y);
        p.x = e.clientX;
        p.y = e.clientY;
        return;
      }
      // two fingers: the map zooms with their spread (about the focus, like the wheel)
      const a = this._spread();
      p.x = e.clientX;
      p.y = e.clientY;
      this._zoomTo((this.zoom * this._spread().d) / a.d);
    });
    this.view.addEventListener('pointerleave', () => (this.card.hidden = true));
    const release = (e) => {
      if (!this.ptrs.delete(e.pointerId)) return;
      if (!this.ptrs.size) this.view.classList.remove('panning');
      const pr = this.press;
      this.press = null;
      // a click: on the waypoint itself it takes it back, anywhere else it sets it
      if (e.type === 'pointerup' && pr?.id === e.pointerId) this.onWaypoint?.(pr.target.closest('.mx-m.way') ? null : this._pick(pr.x, pr.y, pr.target));
    };
    this.view.addEventListener('pointerup', release);
    this.view.addEventListener('pointercancel', release);
    this.view.addEventListener('contextmenu', (e) => e.preventDefault());
    // the wheel, and a trackpad pinch (Chrome and Firefox send that as the wheel with Ctrl held, in small steps)
    this.view.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault(); // (Ctrl + wheel would zoom the whole page)
        if (this.gesture !== null) return;
        const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.view.clientHeight : 1;
        this._zoomTo(this.zoom * Math.exp(-e.deltaY * unit * (e.ctrlKey ? 0.01 : 0.002)));
      },
      { passive: false },
    );
    // Safari sends a trackpad pinch as gesture events instead (on a touch screen the pointers above have it)
    this.view.addEventListener('gesturestart', (e) => {
      e.preventDefault();
      this.gesture = this.zoom;
    });
    this.view.addEventListener('gesturechange', (e) => {
      e.preventDefault();
      if (this.gesture !== null && this.ptrs.size < 2) this._zoomTo(this.gesture * e.scale);
    });
    this.view.addEventListener('gestureend', (e) => {
      e.preventDefault();
      this.gesture = null;
    });
    // (the game's own key handling is off while the map is open, like the inventory's Q / E)
    window.addEventListener('keydown', (e) => {
      if (!this.open || e.repeat || this.ui.isTyping()) return;
      if (e.code === 'KeyX') this.onWaypoint?.(null);
      else if (e.code === 'KeyR') this.setHeadingUp(!this.headingUp);
      else if (e.code === 'Space') {
        e.preventDefault(); // (not a click on the focused button)
        this.backToMe();
      }
    });
    this._showHeading();
  }

  // the key: every kind of marker as the map draws it (the vehicle's line only on the mainland: setWorld)
  _buildKey(box) {
    const rows = [
      ['you', glyph('arrowUp'), 'You'],
      ['mate', 'M', 'Teammate'],
      ['down', glyph('downed'), 'Teammate down'],
      ['car', glyph('car'), 'Your car', 'car'],
      ['part', itemIcon(ITEM.FUEL_CAN), 'Supply on the ground'],
      ['crate', glyph('hazard'), 'Supply drop'],
      ['sup', '', 'Supply rumoured'],
      ['schem', '', 'Schematic rumoured'],
      ['way', glyph('flag'), 'Your waypoint'],
      ['teamway', glyph('flag'), "A teammate's waypoint"],
      ['ping', glyph('ping'), 'Ping: go · danger · loot', 'ping'],
      ['bench', glyph('wrench'), 'Workbench'],
      ['veh', glyph('car'), 'A vehicle of the team’s', 'veh'],
    ];
    for (const [kind, ico, t, tag] of rows) {
      const r = el('div', 'mx-k', box);
      if (kind === 'ping') for (const k of [0, 1, 2]) badge('ping p' + k, ico, r);
      else badge(kind, ico, r);
      const name = el('span', '', r, t);
      if (tag === 'car') (this.carKeys ||= []).push({ r, b: r.firstChild, name });
      if (tag === 'veh') (this.vehKeys ||= []).push(r);
    }
  }

  setHeadingUp(on) {
    this.headingUp = !!on;
    lsSet(HEADING_KEY, this.headingUp ? '1' : '0');
    this._showHeading();
    this._layout();
  }

  _showHeading() {
    this.rotTxt.textContent = this.headingUp ? 'Facing up' : 'North up';
    this.rotBtn.classList.toggle('on', this.headingUp);
    this.view.classList.toggle('turned', this.headingUp);
  }

  // the middle of the first two pointers down and how far apart they are
  _spread() {
    const [a, b] = this.ptrs.values();
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)) };
  }

  _zoomTo(z) {
    this.zoom = Math.max(1, Math.min(MAX_ZOOM, z));
    this._layout();
  }

  // a spot of the world as a fraction across / down the pane (the chart: on the island the map has sea round it)
  _u(v) {
    return (v + this.world.half + this.pad) / this.span;
  }

  // a spot of the world -> px from the middle of the view, as shown (zoomed, panned, turned)
  _screen(x, z) {
    const w = this.vw * this.zoom;
    const mx = (this._u(x) - this.cx) * w;
    const my = (this._u(z) - this.cy) * w;
    const c = Math.cos(this.rot);
    const s = Math.sin(this.rot);
    return [mx * c - my * s, mx * s + my * c];
  }

  // a drag: the focus becomes the middle shown, moved with the pointer (all the map is in view at 1x north up:
  // nothing to move). The move on screen is turned back onto the map when the map is turned
  _panBy(dx, dy) {
    if (this.zoom <= 1 && !this.headingUp) return;
    this.follow = false;
    const c = Math.cos(this.rot);
    const s = Math.sin(this.rot);
    const w = this.view.clientWidth * this.zoom; // (the view is square)
    this.fx = this.cx - (dx * c + dy * s) / w;
    this.fy = this.cy - (dy * c - dx * s) / w;
    this._layout();
    this.fx = this.cx;
    this.fy = this.cy;
  }

  // a click on a row: the map centred on what it names (closer in, if it was all in view), and a ring flashed round it
  centreOn(x, z) {
    if (!this.world) return;
    this.follow = false;
    this.fx = this._u(x);
    this.fy = this._u(z);
    if (this.zoom < FIND_ZOOM) this.zoom = FIND_ZOOM;
    this._layout();
    const f = this.flash;
    f.style.left = this._u(x) * 100 + '%';
    f.style.top = this._u(z) * 100 + '%';
    f.hidden = false;
    f.classList.remove('go');
    void f.offsetWidth;
    f.classList.add('go');
    clearTimeout(this._flashT);
    this._flashT = setTimeout(() => (f.hidden = true), 1600);
  }

  backToMe() {
    this.follow = true;
    if (this.last) this.update(this.last);
  }

  // the focus in the middle, but north up the map never pulls away from the view's edges. Turned, it turns about the
  // middle and its corners come into view anyway: then only the focus stays on the map
  _layout() {
    const rot = this.headingUp ? this.yaw : 0;
    const m = this.headingUp ? 0 : 0.5 / this.zoom;
    this.cx = Math.max(m, Math.min(1 - m, this.fx));
    this.cy = Math.max(m, Math.min(1 - m, this.fy));
    const st = this.pane.style;
    st.width = st.height = this.zoom * 100 + '%';
    this.pane.classList.toggle('far', this.zoom < CITY_NAMES_ZOOM);
    st.left = (0.5 - this.cx * this.zoom) * 100 + '%';
    st.top = (0.5 - this.cy * this.zoom) * 100 + '%';
    st.transformOrigin = `${this.cx * 100}% ${this.cy * 100}%`;
    if (rot !== this.rot) {
      this.rot = rot;
      st.transform = rot ? `rotate(${rot}rad)` : '';
      // the names and markers turn back the other way, so they stay upright; the compass turns with the map
      st.setProperty('--unrot', -rot + 'rad');
      this.north.style.setProperty('--rot', rot + 'rad');
    }
    this._rules();
  }

  // the grid's letters across the top and numbers down the side, where each column / row of squares is in view (north
  // up only: turned, the squares are askew to the edges, and the panel's rows carry each one's square instead)
  _rules() {
    if (!this.world || !this.vw) return;
    const key = this.headingUp ? 'up' : `${this.zoom.toFixed(4)},${this.cx.toFixed(5)},${this.cy.toFixed(5)},${this.vw}`;
    if (key === this._ruleKey) return;
    this._ruleKey = key;
    const n = Math.round(this.world.size / GRID);
    const w = this.vw * this.zoom;
    const put = (box, centre) => {
      const pool = box._pool || (box._pool = []);
      let k = 0;
      if (!this.headingUp) {
        for (let i = 0; i < n; i++) {
          const at = (this._u(-this.world.half + (i + 0.5) * GRID) - centre) * w + this.vw / 2;
          if (at < 8 || at > this.vw - 8) continue;
          let s = pool[k];
          if (!s) s = pool[k] = el('span', '', box);
          k++;
          const t = box === this.ruleTop ? gridLetter(i) : String(i + 1);
          if (s.textContent !== t) s.textContent = t;
          s.style.setProperty('--at', at.toFixed(1) + 'px');
          s.hidden = false;
        }
      }
      for (; k < pool.length; k++) pool[k].hidden = true;
    };
    put(this.ruleTop, this.cx);
    put(this.ruleLeft, this.cy);
  }

  // where a click on the map is in the world; on a place's name or inside its yard it is that place
  _pick(px, py, target) {
    const lab = target.closest('.map-lab');
    let zone = lab && lab.dataset.zone ? this.world.zoneById[lab.dataset.zone] : null;
    // from the middle of the view, turned back onto the map
    const r = this.view.getBoundingClientRect();
    const dx = px - (r.left + r.width / 2);
    const dy = py - (r.top + r.height / 2);
    const c = Math.cos(this.rot);
    const s = Math.sin(this.rot);
    const w = this.view.clientWidth * this.zoom;
    const u = this.cx + (dx * c + dy * s) / w;
    const v = this.cy + (dy * c - dx * s) / w;
    const lim = this.world.half - 3; // the playable ground stops short of the map's edge
    const x = Math.max(-lim, Math.min(lim, u * this.span - this.world.half - this.pad));
    const z = Math.max(-lim, Math.min(lim, v * this.span - this.world.half - this.pad));
    if (!zone) {
      let best = Infinity;
      for (const zn of this.world.zones) {
        const d = Math.hypot(x - zn.x, z - zn.z);
        // (the same reach as discovering the place on foot)
        if (d < zn.flat + 6 && d < best) {
          best = d;
          zone = zn;
        }
      }
    }
    return zone ? { x: zone.x, z: zone.z, zone: zone.id } : { x, z, zone: -1 };
  }

  setWorld(world) {
    if (this.world === world) return;
    this.world = world;
    // the mainland has a plane where the island has a car (game/act.js: Game sets the act before the world)
    const plane = !!world.car?.plane;
    this.titleName.textContent = plane ? 'The Calder Coast' : 'Harlan Valley';
    this.carH.t.textContent = W.The;
    for (const k of this.carKeys || []) {
      setBadge(k.b, 'car', glyph(W.glyph));
      k.name.textContent = W.your;
    }
    for (const r of this.vehKeys || []) r.hidden = !plane;
    // the island is drawn as one: sea round it (the mainland's own sea is in its map, on its west side)
    this.pad = plane ? 0 : SEA_PAD;
    this.span = world.size + this.pad * 2;
    const inset = (this.pad / this.span) * 100 + '%';
    this.canvasWrap.style.inset = inset;
    this.seaWrap.textContent = '';
    this.seaWrap.hidden = !this.pad;
    this.sea = null;
    this.canvasWrap.textContent = '';
    this.canvas = null;
    this.labels.textContent = '';
    this._ruleKey = '';
    const pct = (v) => this._u(v) * 100 + '%';
    // (a place's name is written where the world asks for it - z.label, its middle: the mainland's, clear of each other
    // and of the roads, as the picture writes them - or under the place's spot; the lesser places smaller; a name near
    // an edge of the map kept on it)
    const at = (l, x, z, centred) => {
      const u = (x + world.half) / world.size;
      l.style.left = pct(x);
      l.style.top = pct(z);
      if (centred) l.classList.add('at');
      if (u > 0.86) l.classList.add('edge-r');
      else if (u < 0.1) l.classList.add('edge-l');
    };
    this.labelEls = world.zones.map((z) => {
      const l = el('div', 'map-lab' + (z.minor ? ' sub' : world.kind === 2 ? ' big' : ''), this.labels);
      at(l, ...(z.label || [z.x, z.z]), !!z.label);
      l.dataset.zone = z.id;
      return l;
    });
    // St. Agnes Cemetery is part of the chapel's place: a name of its own on the map, in smaller letters (a click
    // on it is a click in the chapel's yard)
    // ...and so are a city's landmarks (the mainland: world.landmarks), each where it stands
    // (what is named inside the city is written only zoomed in: at the whole map it was a pile of names on its blocks)
    this.markLabs = (world.landmarks || []).map((m) => {
      const l = el('div', 'map-lab ' + (m.big || m.pass ? 'big' : 'sub') + (m.city ? ' city' : ''), this.labels);
      at(l, ...(m.label || [m.x, m.z]), !!(m.label || m.big || m.pass));
      return l;
    });
    this.cemLab = null;
    if (world.cemetery) {
      this.cemLab = el('div', 'map-lab sub', this.labels);
      this.cemLab.style.left = pct(world.cemetery.x);
      this.cemLab.style.top = pct(world.cemetery.z);
    }
    // the bridge's name: the island's is placed once the sea is baked (where Route 9 leaves it); the mainland's is
    // where its spans go out over the sea
    this.bridgeLab = el('div', 'mx-bridge', this.labels);
    el('b', '', this.bridgeLab, 'Route 9 bridge');
    el('span', '', this.bridgeLab, plane ? 'back to Harlan Valley · its last span is down' : `to the Calder Coast · fix the ${W.thing} to cross`);
    this.bridgeLab.hidden = true;
    if (world.bridge) {
      const b = world.bridge;
      // (under the spans, and in from the map's edge by half the card)
      this.bridgeLab.style.left = Math.max(21, this._u((Math.max(b.x0, -world.half) + b.x1) / 2) * 100) + '%';
      this.bridgeLab.style.top = this._u(b.z + 60) * 100 + '%';
      this.bridgeLab.hidden = false;
    }
  }

  _ensureCanvas() {
    if (this.canvas || !this.world) return;
    const t0 = performance.now();
    this.canvas = renderMapCanvas(this.world);
    this.canvas.className = 'map-cv';
    this.canvasWrap.appendChild(this.canvas);
    if (this.pad) {
      this.sea = renderSeaCanvas(this.world, this.pad);
      this.sea.canvas.className = 'map-cv';
      this.seaWrap.appendChild(this.sea.canvas);
      const b = this.sea.bridge;
      if (b) {
        // (in the middle of the band of sea it crosses, beside the bridge rather than over it, and along that side no
        // nearer a corner than the card is long)
        const h = this.world.half;
        const mid = (this.pad / 2 / this.span) * 100;
        const along = (u) => Math.max(22, Math.min(78, (u + (u < 0.5 ? 0.17 : -0.17)) * 100));
        const ns = Math.abs(b.z) - h > Math.abs(b.x) - h;
        this.bridgeLab.style.left = (ns ? along(this._u(b.x)) : b.x > 0 ? 100 - mid : mid) + '%';
        this.bridgeLab.style.top = (ns ? (b.z > 0 ? 100 - mid : mid) : along(this._u(b.z))) + '%';
        this.bridgeLab.hidden = false;
      }
    }
    console.log(`[map] baked in ${(performance.now() - t0).toFixed(0)}ms (${MAP_PX}px)`);
  }

  // the baked map, for the minimap to draw from (baked now if the map has not been opened yet), or null before a world
  baked() {
    this._ensureCanvas();
    return this.canvas;
  }

  // ...and the sea round it (the island), { canvas, pad }, or null
  bakedSea() {
    this._ensureCanvas();
    return this.sea;
  }

  setOpen(open) {
    open = !!open;
    if (open === this.open) return;
    this.open = open;
    if (open) {
      this._ensureCanvas();
      this.follow = true;
    } else {
      lsSet(ZOOM_KEY, String(this.zoom));
      this.ptrs.clear();
      this.press = null;
      this.gesture = null;
      this.view.classList.remove('panning');
      this.card.hidden = true;
      this.pop.hidden = true;
    }
    if (open) {
      screenCame(this.root); // (from another tab: nothing fades in)
      this.tabs.sync();
      if (this.ui.screenRun?.()) this.tabs.holdClock(true);
    } else this.tabs.holdClock(false);
    this.root.hidden = !open;
    this.ui.root.classList.toggle('map-open', open);
  }

  _mk(i) {
    let m = this.pool[i];
    if (!m) {
      const e = el('div', 'mx-m', this.markers);
      const b = badge('you', '', e);
      const lab = el('span', 'mx-ml', e);
      m = { e, b, lab, l: '', c: '', rot: '' };
      this.pool[i] = m;
    }
    return m;
  }

  _ring(i) {
    let r = this.ringPool[i];
    if (!r) {
      const e = el('div', 'mx-ring', this.rings);
      const tab = el('div', 'mx-tab', e);
      r = { e, tab, c: '', k: '', w: '' };
      this.ringPool[i] = r;
    }
    return r;
  }

  // d: { self:{x,z,yaw}, mates:[{x,z,name,status}], car:{x,z}, pings:[{x,z,kind,name}], crates:[{x,z}],
  //      benches:[{x,z}], discovered:Set, hints:[zone...], found:bits (a hint whose supply has been taken),
  //      schemHints:[zone per schematic], unlocked:bits (the schematics the team has),
  //      supplies:[n...], carried:{item:n}, parts:[{item,x,z}] (car supplies lying loose), waypoint:{x,z,zone} | null,
  //      teamWays:[{x,z,zone,names:[...],mine (on the spot of your own)}] }
  update(d) {
    if (!this.open || !this.world) return;
    this.last = d;
    const world = this.world;
    const pct = (v) => this._u(v) * 100 + '%';
    this.yaw = d.self.yaw;
    if (this.follow) {
      this.fx = this._u(d.self.x);
      this.fy = this._u(d.self.z);
    }
    this._layout();
    const way = d.waypoint;
    const taken = (i) => !!(d.found & (1 << i));
    const schems = schematicRumours(d.schemHints, d.unlocked);
    // place names: known once discovered. A rumour names its place too, and rings it while what it hides is still there
    this.labelEls.forEach((l, i) => {
      const z = world.zones[i];
      const known = d.discovered.has(z.id);
      const txt = known ? ZONE_NAMES[z.id] : d.hints.includes(z.id) || d.schemHints.includes(z.id) ? ZONE_NAMES[z.id] + '?' : '?';
      if (l.textContent !== txt) l.textContent = txt;
      l.classList.toggle('unknown', !known);
      l.classList.toggle('hinted', d.hints.some((zid, k) => zid === z.id && !taken(k)) || schems.some((rm) => rm.zone === z.id));
      l.classList.toggle('way', !!way && way.zone === z.id);
    });
    // (a city's landmarks: known once the city is)
    const marks = world.landmarks || [];
    for (let i = 0; i < this.markLabs.length; i++) {
      const txt = d.discovered.has(ZONE.CITY) ? marks[i].name : '';
      if (this.markLabs[i].textContent !== txt) this.markLabs[i].textContent = txt;
    }
    if (this.cemLab) {
      // (known once you have been to it, or to the chapel it lies behind)
      const txt = d.discovered.has(ZONE.CEMETERY) || d.discovered.has(ZONE.CHURCH) ? ZONE_NAMES[ZONE.CEMETERY] : '';
      if (this.cemLab.textContent !== txt) this.cemLab.textContent = txt;
    }

    // ---- rumours: a ring round the whole place, a tab on it with what is rumoured there (orange: a supply the car
    // still needs, blue: a schematic the team lacks). Which container holds it is not known: they all have to be searched
    const rumoured = this._rumours(d, schems);
    let ri = 0;
    for (const [zid, r] of rumoured) {
      const z = world.zoneById[zid];
      if (!z) continue;
      const kind = r.sup.length ? (r.schem.length ? 'both' : 'sup') : 'schem';
      const ring = this._ring(ri++);
      const cls = 'mx-ring ' + kind;
      if (ring.c !== cls) ring.e.className = ring.c = cls;
      const w = (((z.flat || 20) + 14) * 2 * 100) / this.span + '%';
      if (ring.w !== w) {
        ring.w = w;
        ring.e.style.width = ring.e.style.height = w;
      }
      ring.e.style.left = pct(z.x);
      ring.e.style.top = pct(z.z);
      const k = r.sup.join(',') + '|' + r.schem.join(',');
      if (ring.k !== k) {
        ring.k = k;
        ring.tab.textContent = '';
        for (const it of r.sup) svgEl('i', 'mx-tab-i sup', ring.tab, itemIcon(it));
        for (const it of r.schem) svgEl('i', 'mx-tab-i schem', ring.tab, itemIcon(it));
      }
      if (ring.e.hidden) ring.e.hidden = false;
    }
    for (let i = ri; i < this.ringPool.length; i++) if (!this.ringPool[i].e.hidden) this.ringPool[i].e.hidden = true;

    // ---- markers
    let n = 0;
    const put = (x, z, kind, icon, label = '', rot = null) => {
      const m = this._mk(n++);
      const cls = 'mx-m ' + kind;
      if (m.c !== cls) m.e.className = m.c = cls;
      setBadge(m.b, kind, icon);
      if (m.l !== label) m.lab.textContent = m.l = label;
      m.e.style.left = pct(x);
      m.e.style.top = pct(z);
      const tr = rot === null ? '' : `rotate(${rot}rad)`;
      if (m.rot !== tr) m.b.style.transform = m.rot = tr;
      if (m.e.hidden) m.e.hidden = false;
    };
    // your waypoint goes under everything else (on a place its own name is the label, in the waypoint's colour)
    if (way) put(way.x, way.z, 'way', glyph('flag'), way.zone >= 0 ? '' : 'Waypoint');
    // the team's, named for who set them (one on your own spot stands just east of your ring)
    for (const t of d.teamWays) put(t.x + (t.mine ? TEAM_BESIDE : 0), t.z, 'teamway', glyph('flag'), t.names.join(', '));
    for (const b of d.benches) put(b.x, b.z, 'bench', glyph('wrench'), 'Bench');
    // the team's vehicles: where each was left (a parked car is easy to lose)
    for (const v of d.vehicles || []) if (!v.mine) put(v.x, v.z, 'veh' + (v.down ? ' down' : ''), v.kind === 2 ? glyph('car') : itemIcon(v.kind === 1 ? ITEM.MOPED_KIT : ITEM.BIKE_KIT), VEH_LABEL[v.kind] + (v.down ? ' (not running)' : ''));
    // car supplies on the ground where someone dropped them or fell, named for what they are
    for (const p of d.parts) put(p.x, p.z, 'part', itemIcon(p.item), ITEM_DEFS[p.item].name);
    // (a team that has found nothing yet: the rumour narrowed to round here, then the spot itself)
    for (const h of d.helped || []) put(h.x, h.z, 'part', itemIcon(h.item), ITEM_DEFS[h.item].name + (h.exact ? '' : ' · round here?'));
    for (const c of d.crates) put(c.x, c.z, 'crate', glyph('hazard'), 'Supply drop');
    for (const p of d.pings) put(p.x, p.z, 'ping p' + p.kind, glyph('ping'), `${PING_WORD[p.kind] || 'Ping'} · ${p.name}`);
    put(d.car.x, d.car.z, 'car', glyph(W.glyph), W.thing === 'car' ? 'Car' : 'Plane');
    for (const m of d.mates) {
      const down = m.status === 'downed';
      put(m.x, m.z, down ? 'down' : 'mate', down ? glyph('downed') : initial(m.name), down ? `${m.name} · DOWN` : m.name);
    }
    // (the marker stands upright on screen, so its arrow turns with the map as well as with you)
    put(d.self.x, d.self.z, 'you', glyph('arrowUp'), '', this.rot - d.self.yaw);
    for (let i = n; i < this.pool.length; i++) if (!this.pool[i].e.hidden) this.pool[i].e.hidden = true;

    const grid = gridRef(world, d.self.x, d.self.z);
    const yg = `You · ${grid}`;
    if (this.youGrid.textContent !== yg) this.youGrid.textContent = yg;
    const xy = ` · ${Math.round(d.self.x)} E ${Math.round(-d.self.z)} N`;
    if (this.youXY.textContent !== xy) this.youXY.textContent = xy;
    this.youBtn.classList.toggle('away', !this.follow);

    // ---- the panel (and its chips)
    const leads = this._leads(d, rumoured);
    const team = this._team(d);
    this._panel(d, leads, team);
    this._pins(d, leads, team);
  }

  // the places something is rumoured to be in: zone -> { sup: [item...], schem: [item...] }
  _rumours(d, schems) {
    const out = new Map();
    const at = (zid) => out.get(zid) || (out.set(zid, { sup: [], schem: [] }), out.get(zid));
    d.hints.forEach((zid, i) => {
      if (zid === 255 || d.found & (1 << i)) return;
      const si = Math.min(i, SUPPLIES.length - 1);
      if (d.supplies[si] >= SUPPLY_NEED[si] || !this.world.zoneById[zid]) return;
      const r = at(zid);
      if (!r.sup.includes(SUPPLIES[si])) r.sup.push(SUPPLIES[si]);
    });
    for (const rm of schems) if (this.world.zoneById[rm.zone]) at(rm.zone).schem.push(rm.item);
    return out;
  }

  // what the car still needs, and every lead on each: in your pack, on the ground, rumoured. -> [{ i, item, have,
  // need, carried, leads: [{ kind, x, z, d, title, sub }] (nearest first), none }], what you carry first, then the
  // nearest lead first, the ones nothing is known of last
  _leads(d, rumoured) {
    const { x: sx, z: sz } = d.self;
    const dist = (x, z) => Math.hypot(x - sx, z - sz);
    const out = [];
    SUPPLIES.forEach((item, i) => {
      const have = d.supplies[i] | 0;
      const need = SUPPLY_NEED[i];
      if (have >= need) return;
      const name = ITEM_DEFS[item].name;
      const leads = [];
      const carried = !!d.carried[item];
      if (carried) leads.push({ kind: 'car', x: d.car.x, z: d.car.z, d: dist(d.car.x, d.car.z), title: `${name} · in your pack`, sub: `Take it to the ${W.thing}` });
      for (const p of d.parts) {
        if (p.item !== item) continue;
        const pl = placeAt(this.world, p.x, p.z);
        const near = (pl && d.discovered.has(pl.id) ? 'near ' + ZONE_NAMES[pl.id] : 'in the open') + ' · ' + gridRef(this.world, p.x, p.z);
        leads.push({ kind: 'part', x: p.x, z: p.z, d: dist(p.x, p.z), title: `${name} · on the ground`, sub: near, short: 'on the ground ' + near });
      }
      for (const [zid, r] of rumoured) {
        if (!r.sup.includes(item)) continue;
        const z = this.world.zoneById[zid];
        const at = `${ZONE_NAMES[zid]}? · ${gridRef(this.world, z.x, z.z)}`;
        leads.push({ kind: 'sup', x: z.x, z: z.z, d: dist(z.x, z.z), title: `${name} · rumoured`, sub: at, short: 'or ' + at });
      }
      if (!carried) leads.sort((a, b) => a.d - b.d);
      const rum = supplyRumours(i, d.hints, d.found);
      out.push({ i, item, name, have, need, carried, leads, none: rum.found ? 'picked up · not in your pack' : 'nothing heard of one yet' });
    });
    out.sort((a, b) => b.carried - a.carried || (a.leads.length ? a.leads[0].d : 1e9) - (b.leads.length ? b.leads[0].d : 1e9));
    return out;
  }

  // the team, a downed mate first, then the nearest; and the waypoints. -> [{ kind, icon, x, z, d, title, sub }]
  _team(d) {
    const { x: sx, z: sz } = d.self;
    const where = (x, z) => {
      const pl = placeAt(this.world, x, z);
      return (pl ? (d.discovered.has(pl.id) ? ZONE_NAMES[pl.id] : 'an unknown place') : 'in the open') + ' · ' + gridRef(this.world, x, z);
    };
    const mates = d.mates
      .map((m) => {
        const down = m.status === 'downed';
        return { kind: down ? 'down' : 'mate', icon: down ? glyph('downed') : initial(m.name), x: m.x, z: m.z, d: Math.hypot(m.x - sx, m.z - sz), title: down ? `${m.name} · DOWN` : m.name, sub: where(m.x, m.z) + (down ? ' · needs a revive' : ''), name: m.name };
      })
      .sort((a, b) => (b.kind === 'down') - (a.kind === 'down') || a.d - b.d);
    const ways = [];
    if (d.waypoint) ways.push({ kind: 'way', icon: glyph('flag'), x: d.waypoint.x, z: d.waypoint.z, d: Math.hypot(d.waypoint.x - sx, d.waypoint.z - sz), title: 'Your waypoint', sub: where(d.waypoint.x, d.waypoint.z) });
    for (const t of d.teamWays) ways.push({ kind: 'teamway', icon: glyph('flag'), x: t.x, z: t.z, d: Math.hypot(t.x - sx, t.z - sz), title: `${t.names.join(', ')}’s waypoint`, sub: where(t.x, t.z) });
    return { mates, ways };
  }

  // a list of rows, kept between frames (only what changed is written). rows: [{ key, kind, icon, title, sub, d, dir,
  // x, z, cls }]; a click centres the map on (x, z)
  _rows(box, rows) {
    let pool = this.rowPools.get(box);
    if (!pool) this.rowPools.set(box, (pool = []));
    rows.forEach((r, i) => {
      let e = pool[i];
      if (!e) {
        const b = el('button', 'mx-row', box);
        b.type = 'button';
        const bd = badge('you', '', b);
        const t = el('span', 'mx-row-t', b);
        const title = el('b', '', t);
        const sub = el('span', '', t);
        const dd = el('span', 'mx-row-d', b);
        const dist = el('b', '', dd);
        const dir = el('span', '', dd);
        e = pool[i] = { b, bd, title, sub, dist, dir, c: '', at: null };
        b.addEventListener('click', () => e.at && this.centreOn(e.at.x, e.at.z));
      }
      const cls = 'mx-row' + (r.cls ? ' ' + r.cls : '') + (r.x === undefined ? ' static' : '');
      if (e.c !== cls) e.b.className = e.c = cls;
      setBadge(e.bd, r.kind, r.icon);
      if (e.title.textContent !== r.title) e.title.textContent = r.title;
      if (e.sub.textContent !== (r.sub || '')) e.sub.textContent = r.sub || '';
      const ds = r.d === undefined ? '' : fmtDist(r.d);
      if (e.dist.textContent !== ds) e.dist.textContent = ds;
      const dr = r.dir || '';
      if (e.dir.textContent !== dr) e.dir.textContent = dr;
      e.at = r.x === undefined ? null : { x: r.x, z: r.z };
      e.b.disabled = !e.at;
      if (e.b.hidden) e.b.hidden = false;
    });
    for (let i = rows.length; i < pool.length; i++) if (!pool[i].b.hidden) pool[i].b.hidden = true;
  }

  _panel(d, leads, team) {
    const { x: sx, z: sz } = d.self;
    const dirTo = (x, z) => dirOf(x - sx, z - sz);
    // the car: n / m supplies, a bar of them (installed, in your pack, still out there), a row a supply
    let have = 0;
    let need = 0;
    const segs = [];
    SUPPLIES.forEach((item, i) => {
      const h = Math.min(d.supplies[i] | 0, SUPPLY_NEED[i]);
      have += h;
      need += SUPPLY_NEED[i];
      const c = Math.min(SUPPLY_NEED[i] - h, d.carried[item] | 0);
      for (let k = 0; k < SUPPLY_NEED[i]; k++) segs.push(k < h ? 'in' : k < h + c ? 'pack' : '');
    });
    const cn = `${have} / ${need} ${W.supplies}`;
    if (this.carH.n.textContent !== cn) this.carH.n.textContent = cn;
    const sk = segs.join(',');
    if (this._segKey !== sk) {
      this._segKey = sk;
      this.carBar.textContent = '';
      for (const s of segs) el('i', s, this.carBar);
    }
    const rows = [];
    for (const L of leads) {
      const label = ITEM_DEFS[L.item].name + (L.need > 1 ? ` ${L.have}/${L.need}` : '');
      const first = L.leads[0];
      if (!first) {
        rows.push({ kind: 'part', icon: itemIcon(L.item), title: label, sub: L.none, cls: 'dim' });
        continue;
      }
      rows.push({ kind: first.kind === 'car' ? 'part' : first.kind === 'sup' ? 'sup' : 'part', icon: itemIcon(L.item), title: first.title.replace(ITEM_DEFS[L.item].name, label), sub: first.sub, d: first.d, dir: dirTo(first.x, first.z), x: first.x, z: first.z, cls: L.carried ? 'pack' : first.kind === 'sup' ? 'rumour' : 'ground' });
      // the other leads on the same supply, under it
      for (const o of L.leads.slice(1, 3)) rows.push({ kind: o.kind === 'sup' ? 'sup' : 'part', icon: itemIcon(L.item), title: o.short, d: o.d, dir: dirTo(o.x, o.z), x: o.x, z: o.z, cls: 'sub' });
    }
    if (!leads.length) rows.push({ kind: 'car', icon: glyph(W.glyph), title: `Every ${W.supplies === 'parts' ? 'part' : 'supply'} is in`, sub: `${W.The}: ${W.start}`, d: Math.hypot(d.car.x - sx, d.car.z - sz), dir: dirTo(d.car.x, d.car.z), x: d.car.x, z: d.car.z, cls: 'pack' });
    this._rows(this.carRows, rows);
    // what is in already, as a line of icons
    const doneKey = SUPPLIES.filter((it, i) => (d.supplies[i] | 0) >= SUPPLY_NEED[i]).join(',');
    if (this._doneKey !== doneKey) {
      this._doneKey = doneKey;
      this.carDone.textContent = '';
      if (doneKey) {
        for (const it of doneKey.split(',')) svgEl('i', 'mx-done-i', this.carDone, itemIcon(+it)).title = ITEM_DEFS[+it].name;
        el('span', '', this.carDone, 'installed');
      }
    }
    // the team
    const down = team.mates.filter((m) => m.kind === 'down').length;
    const tn = d.mates.length ? `${d.mates.length - down} up · ${down} down` : '';
    if (this.teamH.n.textContent !== tn) this.teamH.n.textContent = tn;
    const trows = team.mates.map((m) => ({ ...m, dir: dirTo(m.x, m.z), cls: m.kind === 'down' ? 'alarm' : '' }));
    if (!trows.length) trows.push({ kind: 'mate', icon: '–', title: 'On your own', sub: 'nobody else is out here', cls: 'dim' });
    for (const w of team.ways) trows.push({ ...w, dir: dirTo(w.x, w.z) });
    this._rows(this.teamRows, trows);
    // the schematics, in one row: found, rumoured (where), or not heard of
    const got = SCHEMATICS.filter((it) => d.unlocked & (1 << SCHEM_BIT[it])).length;
    const sn = `${got} / ${SCHEMATICS.length}`;
    if (this.schemH.n.textContent !== sn) this.schemH.n.textContent = sn;
    const sKey = JSON.stringify([d.schemHints, d.unlocked]);
    if (sKey !== this._schemKey) {
      this._schemKey = sKey;
      this.schemRow.textContent = '';
      SCHEMATICS.forEach((item, k) => {
        const has = !!(d.unlocked & (1 << SCHEM_BIT[item]));
        const zid = d.schemHints[k];
        const z = !has && zid !== 255 ? this.world.zoneById[zid] : null;
        const t = el('button', 'mx-schem' + (has ? ' got' : z ? ' rumour' : ' none'), this.schemRow);
        t.type = 'button';
        svgEl('i', 'mx-schem-i', t, itemIcon(item));
        el('span', '', t, has ? 'found' : z ? ZONE_NAMES[zid] : 'unknown');
        t.title = ITEM_DEFS[item].name + (has ? ' · found' : z ? ` · rumoured at ${ZONE_NAMES[zid]} (${gridRef(this.world, z.x, z.z)})` : ' · nothing heard of it yet');
        if (z) t.addEventListener('click', () => this.centreOn(z.x, z.z));
        else t.disabled = true;
      });
    }
    this._chips(d, leads, team, have, need, got);
  }

  // small windows: the panel as chips - the car (how many in, what is still out, how far), each teammate, the
  // waypoint, the schematics - each one a click to find it, like the rows
  _chips(d, leads, team, have, need, got) {
    const { x: sx, z: sz } = d.self;
    const chips = [];
    const carD = Math.hypot(d.car.x - sx, d.car.z - sz);
    chips.push({ kind: 'car', icon: glyph(W.glyph), text: `${have}/${need}`, d: carD, x: d.car.x, z: d.car.z, items: leads.map((L) => ({ item: L.item, pack: L.carried })) });
    for (const m of team.mates) chips.push({ kind: m.kind, icon: m.icon, text: m.kind === 'down' ? 'DOWN' : '', d: m.d, x: m.x, z: m.z, title: m.title, cls: m.kind === 'down' ? 'alarm' : '' });
    for (const w of team.ways) chips.push({ kind: w.kind, icon: w.icon, text: '', d: w.d, x: w.x, z: w.z, title: w.title });
    chips.push({ kind: 'schem', icon: '', text: `${got}/${SCHEMATICS.length}`, title: 'Schematics found', static: true });
    const pool = this._chipPool || (this._chipPool = []);
    chips.forEach((c, i) => {
      let e = pool[i];
      if (!e) {
        const b = el('button', 'mx-chip', this.chipList);
        b.type = 'button';
        const bd = badge('you', '', b);
        const items = el('span', 'mx-chip-items', b);
        const t = el('b', '', b);
        const dd = el('span', 'mx-chip-d', b);
        e = pool[i] = { b, bd, items, t, dd, c: '', ik: '', at: null };
        b.addEventListener('click', () => e.at && this.centreOn(e.at.x, e.at.z));
      }
      const cls = 'mx-chip' + (c.cls ? ' ' + c.cls : '');
      if (e.c !== cls) e.b.className = e.c = cls;
      setBadge(e.bd, c.kind, c.icon);
      const ik = c.items ? c.items.map((it) => it.item + (it.pack ? 'p' : '')).join(',') : '';
      if (e.ik !== ik) {
        e.ik = ik;
        e.items.textContent = '';
        for (const it of c.items || []) svgEl('i', it.pack ? 'pack' : '', e.items, itemIcon(it.item));
      }
      if (e.t.textContent !== c.text) e.t.textContent = c.text;
      const ds = c.d === undefined ? '' : fmtDist(c.d);
      if (e.dd.textContent !== ds) e.dd.textContent = ds;
      if (e.b.title !== (c.title || '')) e.b.title = c.title || '';
      e.at = c.static ? null : { x: c.x, z: c.z };
      if (e.b.hidden) e.b.hidden = false;
    });
    for (let i = chips.length; i < pool.length; i++) if (!pool[i].b.hidden) pool[i].b.hidden = true;
  }

  // what is off the view waits on its edge, in its direction, with how far it is from you: a downed mate, the car, you
  // (once the map has been moved off you), your waypoint, the team, a supply on the ground, the nearest rumour of each
  // supply still needed. A pin a click centres the map on. Pins on one edge are spread apart, not piled up
  _pins(d, leads, team) {
    const vw = this.vw;
    if (!vw) return;
    const { x: sx, z: sz } = d.self;
    const want = [];
    for (const m of team.mates) if (m.kind === 'down') want.push(m);
    want.push({ kind: 'car', icon: glyph(W.glyph), x: d.car.x, z: d.car.z, title: W.thing === 'car' ? 'Car' : 'Plane' });
    if (!this.follow) want.push({ kind: 'you', icon: glyph('arrowUp'), x: sx, z: sz, title: 'You', me: true });
    if (d.waypoint) want.push({ kind: 'way', icon: glyph('flag'), x: d.waypoint.x, z: d.waypoint.z, title: 'Waypoint' });
    for (const m of team.mates) if (m.kind !== 'down') want.push({ ...m, title: m.name });
    for (const L of leads) {
      const l = L.leads.find((o) => o.kind !== 'car');
      if (l) want.push({ kind: l.kind === 'sup' ? 'sup' : 'part', icon: itemIcon(L.item), x: l.x, z: l.z, title: ITEM_DEFS[L.item].name });
    }
    const half = vw / 2;
    const M = 6; // px in from the edge
    const placed = [];
    for (const w of want) {
      if (placed.length >= PIN_MAX) break;
      const [px, py] = this._screen(w.x, w.z);
      if (Math.abs(px) < half - 10 && Math.abs(py) < half - 10) continue; // (in view: the marker itself shows)
      const t = Math.min((half - M) / Math.max(1e-6, Math.abs(px)), (half - M) / Math.max(1e-6, Math.abs(py)));
      const ex = px * t;
      const ey = py * t;
      const side = Math.abs(ex) >= half - M - 0.5 ? (ex > 0 ? 'r' : 'l') : ey > 0 ? 'b' : 't';
      const text = w.title + ' · ' + fmtDist(w.me ? 0 : Math.hypot(w.x - sx, w.z - sz));
      placed.push({ w, side, ex, ey, ang: Math.atan2(py, px), text, wid: 46 + text.length * 7.2 });
    }
    // spread along each edge: in order along it, each at least a pin's length (or height) from the one before
    for (const sd of ['l', 'r', 't', 'b']) {
      const on = placed.filter((p) => p.side === sd);
      const vert = sd === 'l' || sd === 'r';
      on.sort((a, b) => (vert ? a.ey - b.ey : a.ex - b.ex));
      let prev = -Infinity;
      let prevW = 0;
      for (const p of on) {
        const gap = vert ? 30 : (prevW + p.wid) / 2 + 6;
        let at = vert ? p.ey : p.ex;
        if (at < prev + gap) at = prev + gap;
        const lim = half - (vert ? 18 : p.wid / 2 + 4);
        // (the north dial has the top right corner)
        at = Math.max(-lim, Math.min(lim - (sd === 't' ? 50 : 0), at));
        if (vert) p.ey = at;
        else p.ex = at;
        prev = at;
        prevW = p.wid;
      }
    }
    placed.forEach((p, i) => {
      let e = this.pinPool[i];
      if (!e) {
        const b = el('button', 'mx-pin', this.pins);
        b.type = 'button';
        const arrow = svgEl('i', 'mx-pin-arr', b, glyph('arrowUp'));
        const bd = badge('you', '', b);
        const t = el('span', 'mx-pin-t', b);
        e = this.pinPool[i] = { b, arrow, bd, t, c: '', at: null, me: false };
        b.addEventListener('click', () => (e.me ? this.backToMe() : e.at && this.centreOn(e.at.x, e.at.z)));
      }
      const cls = 'mx-pin ' + p.side + ' ' + p.w.kind;
      if (e.c !== cls) e.b.className = e.c = cls;
      setBadge(e.bd, p.w.kind, p.w.icon);
      if (e.t.textContent !== p.text) e.t.textContent = p.text;
      e.b.style.transform = `translate(${(half + p.ex).toFixed(1)}px, ${(half + p.ey).toFixed(1)}px)`;
      e.arrow.style.transform = `rotate(${(p.ang + Math.PI / 2).toFixed(3)}rad)`;
      e.at = { x: p.w.x, z: p.w.z };
      e.me = !!p.w.me;
      if (e.b.hidden) e.b.hidden = false;
    });
    for (let i = placed.length; i < this.pinPool.length; i++) if (!this.pinPool[i].b.hidden) this.pinPool[i].b.hidden = true;
  }

  // a place's card, while the pointer is over its name: what it is, what is rumoured there, who is there, how far and
  // which way it is from you, its grid square
  _hoverCard(e) {
    const lab = e.target.closest?.('.map-lab');
    const zone = lab && lab.dataset.zone ? this.world?.zoneById[lab.dataset.zone] : null;
    const d = this.last;
    if (!zone || !d) {
      if (!this.card.hidden) this.card.hidden = true;
      return;
    }
    if (this._cardZone !== zone.id || this.card.hidden) {
      this._cardZone = zone.id;
      const c = this.card;
      c.textContent = '';
      const known = d.discovered.has(zone.id);
      el('b', 'mx-card-h', c, known ? ZONE_NAMES[zone.id] : 'Unknown place');
      const r = this._rumours(d, schematicRumours(d.schemHints, d.unlocked)).get(zone.id);
      for (const it of r?.sup || []) el('span', 'mx-card-sup', c, `${ITEM_DEFS[it].name} rumoured here`);
      for (const it of r?.schem || []) el('span', 'mx-card-schem', c, `${ITEM_DEFS[it].name} rumoured here`);
      const here = d.mates.filter((m) => placeAt(this.world, m.x, m.z)?.id === zone.id).map((m) => m.name + (m.status === 'downed' ? ' (down)' : ''));
      if (here.length) el('span', 'mx-card-team', c, here.join(', ') + (here.length > 1 ? ' are here' : ' is here'));
      const dd = Math.hypot(zone.x - d.self.x, zone.z - d.self.z);
      el('span', '', c, `${fmtDist(dd)} ${dirOf(zone.x - d.self.x, zone.z - d.self.z)} of you · ${gridRef(this.world, zone.x, zone.z)}`);
      el('span', 'mx-card-k', c, 'Click: set your waypoint');
    }
    const vr = this.view.getBoundingClientRect();
    const cw = this.card.offsetWidth || 220;
    const ch = this.card.offsetHeight || 90;
    let x = e.clientX - vr.left + 16;
    let y = e.clientY - vr.top + 16;
    if (x + cw > vr.width - 6) x = e.clientX - vr.left - cw - 12;
    if (y + ch > vr.height - 6) y = e.clientY - vr.top - ch - 12;
    this.card.style.transform = `translate(${Math.max(4, x).toFixed(0)}px, ${Math.max(4, y).toFixed(0)}px)`;
    this.card.hidden = false;
  }
}
