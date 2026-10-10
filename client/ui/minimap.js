// The minimap: the field map in a disc in the top-left corner,
// turned with you so the way you face is always up, with the field map's markers on it. What matters wherever it is
// (the car, waypoints, the team, pings, supply drops, a car supply lying loose) waits on the rim, in its direction, while it is out of range;
// the places a car supply or a schematic is rumoured to be in only show once they are in range.
// Enemies in range are red dots on a canvas of their own, redrawn every frame (a horde is too many to be DOM markers).
// The car supplies shrink to a row of icons under it (Objective's slim mode).
import { ZONE_NAMES, ITEM, schematicRumours } from '../../shared/defs.js';
import { SUPPLIES, SUPPLY_NEED, W } from '../game/act.js'; // (this act's)
import { el, svgEl, replay } from './dom.js';
import { badge, setBadge, initial } from './mapmarks.js';
import { itemIcon, glyph } from './icons.js';
import { MAP_PPM, mapX, mapY } from './mapcanvas.js';

const RANGE = 70; // m from you to the rim
const RIM = 9; // px: a pinned marker sits this far inside the rim
const LABEL_IN = 0.82; // a place's name shows while it is inside this much of the radius

export class Minimap {
  constructor(parent) {
    this.root = el('div', 'mmap', parent);
    this.root.hidden = true;
    this.cv = el('canvas', 'mmap-cv', this.root);
    this.g = this.cv.getContext('2d', { alpha: false });
    el('i', 'mmap-fov', this.root); // a faint wedge: what is in front of you
    this.en = el('canvas', 'mmap-en', this.root);
    this.eg = this.en.getContext('2d');
    this.enN = 0; // dots drawn last frame, so an empty disc is not cleared every frame
    this.labels = el('div', 'mmap-labs', this.root);
    this.marks = el('div', 'mmap-mks', this.root);
    svgEl('i', 'mmap-you', this.root, glyph('arrowUp'));
    this.north = el('b', 'mmap-n', this.root, 'N');
    this.ring = el('i', 'mmap-heard', this.root); // a noise of yours that woke the dead (heard.js)
    this.pool = [];
    this.distPool = [];
    this.labPool = [];
    this.pinPx = 16; // a rim pin's size in px (set with the disc's size: the CSS draws it so)
    this.size = 0; // css px across, kept by the observer (reading it every frame would force a layout)
    this.drawn = ''; // what the canvas shows, so a frame standing still draws nothing
    new ResizeObserver(() => this._resize()).observe(this.root);
  }

  _resize() {
    const s = this.root.clientWidth;
    if (!s) return;
    this.size = s;
    this.pinPx = Math.max(14, s * 0.085);
    const n = Math.round(s * Math.min(2, window.devicePixelRatio || 1));
    // (both sides: a canvas starts 300 x 150, so at 150 css px on a 2x screen - a phone's - the width is right already and
    // a check of it alone left the height at 150, the disc stretched to twice its height)
    if (this.cv.width !== n || this.cv.height !== n) this.cv.width = this.cv.height = n;
    if (this.en.width !== n || this.en.height !== n) this.en.width = this.en.height = n;
    this.enN = -1;
    this.drawn = '';
  }

  setVisible(v) {
    if (this.root.hidden === !v) return;
    this.root.hidden = !v;
    this.drawn = '';
  }

  // a ring out from you as far as a noise of yours carried (to the rim, past RANGE), for a moment
  heard(loud) {
    this.ring.style.setProperty('--r', (Math.min(1, loud / RANGE) * 100).toFixed(1) + '%');
    replay(this.ring, 'on');
  }

  // screen: the field map (MapScreen: its world and baked map). d: what it shows (Game.mapData())
  update(screen, d) {
    if (this.root.hidden || !this.size) return;
    const map = screen.baked();
    const world = screen.world;
    if (!map) return;
    const { x, z, yaw } = d.self;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const n = this.cv.width;
    const key = `${x.toFixed(2)},${z.toFixed(2)},${yaw.toFixed(4)},${n}`;
    if (key !== this.drawn) {
      this.drawn = key;
      const g = this.g;
      const k = n / (2 * RANGE) / MAP_PPM;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.fillStyle = '#3a2f22'; // past the edge of the survey
      g.fillRect(0, 0, n, n);
      // turned so your facing is up: the same turn as the field map's "facing up" (rotate by your yaw)
      g.setTransform(k * c, k * s, -k * s, k * c, n / 2, n / 2);
      // (the island: its sea and bluffs past the edge, as the field map draws them)
      const sea = screen.bakedSea?.();
      if (sea) g.drawImage(sea.canvas, -mapX(x) - sea.pad * MAP_PPM, -mapY(z) - sea.pad * MAP_PPM);
      g.drawImage(map, -mapX(x), -mapY(z));
    }

    // world -> px from the middle of the disc
    const ppm = this.size / (2 * RANGE);
    const r = this.size / 2;
    const at = (wx, wz) => {
      const dx = wx - x;
      const dz = wz - z;
      return [(dx * c - dz * s) * ppm, (dx * s + dz * c) * ppm];
    };
    const tf = (px, py) => `translate(${px.toFixed(1)}px,${py.toFixed(1)}px)`;

    // north on the rim
    const nt = tf(s * (r - RIM), -c * (r - RIM));
    if (this.nTf !== nt) this.north.style.transform = this.nTf = nt;

    // names of the places you have found, while they are well inside the disc
    let li = 0;
    for (const zn of world.zones) {
      if (!d.discovered.has(zn.id)) continue;
      const [px, py] = at(zn.x, zn.z);
      if (Math.hypot(px, py) > r * LABEL_IN) continue;
      let l = this.labPool[li];
      if (!l) l = this.labPool[li] = { e: el('span', 'mmap-lab', this.labels), t: '', tf: '' };
      li++;
      const t = ZONE_NAMES[zn.id];
      if (l.t !== t) l.e.textContent = l.t = t;
      const lt = tf(px, py) + ' translate(-50%,-50%)';
      if (l.tf !== lt) l.e.style.transform = l.tf = lt;
      if (l.e.hidden) l.e.hidden = false;
    }
    for (let i = li; i < this.labPool.length; i++) if (!this.labPool[i].e.hidden) this.labPool[i].e.hidden = true;

    // enemies in range: red dots, a Tank's or a boss's bigger
    const eg = this.eg;
    const sc = n / this.size;
    const dot = this.size * 0.018 * sc;
    let en = 0;
    if (this.enN) eg.clearRect(0, 0, n, n);
    // (every dot one path, filled and outlined once: a horde in range is two draws, not two a zombie)
    for (const e of d.enemies || []) {
      const [px, py] = at(e.x, e.z);
      if (px * px + py * py > (r - 2) * (r - 2)) continue;
      if (!en++) eg.beginPath();
      const cx = (px + r) * sc, cy = (py + r) * sc, rad = e.big ? dot * 1.7 : dot;
      eg.moveTo(cx + rad, cy);
      eg.arc(cx, cy, rad, 0, Math.PI * 2);
    }
    if (en) {
      eg.fillStyle = '#c41414';
      eg.strokeStyle = 'rgba(232, 220, 192, 0.9)';
      eg.lineWidth = Math.max(1, 1.2 * sc);
      eg.fill();
      eg.stroke();
    }
    this.enN = en;

    // markers: the field map's own badges (mapmarks.js), so the key learnt there reads here. What matters waits on the
    // rim while it is out of range, in its direction; pins that would sit on one another are spread apart round the
    // rim, and the three that matter most - the car, your waypoint, a downed mate - say how far they are
    const list = [];
    const put = (wx, wz, kind, icon, pin, far = false) => {
      const [px, py] = at(wx, wz);
      const dist = Math.hypot(px, py);
      const edge = dist > r - RIM;
      if (edge && !pin) return;
      list.push({ px, py, kind, icon, edge, far: far && edge, m: dist / ppm, a: Math.atan2(py, px) });
    };
    // drawn in this order, so the later ones are on top
    const taken = (i) => !!(d.found & (1 << i));
    const seen = new Set();
    d.hints.forEach((zid, i) => {
      if (zid === 255 || taken(i)) return;
      const si = Math.min(i, 4);
      if (d.supplies[si] >= SUPPLY_NEED[si] || seen.has(zid + ':' + si)) return;
      seen.add(zid + ':' + si);
      const zn = world.zoneById[zid];
      if (zn) put(zn.x, zn.z, 'sup tab', itemIcon(SUPPLIES[si]), false);
    });
    // rumoured schematics, beside a supply rumoured to the same place and side by side with each other
    const perPlace = new Map();
    for (const rm of schematicRumours(d.schemHints, d.unlocked)) {
      const zn = world.zoneById[rm.zone];
      if (!zn) continue;
      const n = perPlace.get(rm.zone) || 0;
      perPlace.set(rm.zone, n + 1);
      put(zn.x + 8 + n * 6, zn.z + 4, 'schem tab', itemIcon(rm.item), false);
    }
    for (const b of d.benches) put(b.x, b.z, 'bench', glyph('wrench'), false);
    for (const v of d.vehicles || []) if (!v.mine) put(v.x, v.z, 'veh', v.kind === 2 ? glyph('car') : itemIcon(v.kind === 1 ? ITEM.MOPED_KIT : ITEM.BIKE_KIT), true);
    for (const p of d.parts) put(p.x, p.z, 'part', itemIcon(p.item), true);
    for (const t of d.teamWays) put(t.x, t.z, 'teamway', glyph('flag'), true);
    if (d.waypoint) put(d.waypoint.x, d.waypoint.z, 'way', glyph('flag'), true, true);
    for (const cr of d.crates) put(cr.x, cr.z, 'crate', glyph('hazard'), true);
    for (const p of d.pings) put(p.x, p.z, 'ping p' + p.kind, glyph('ping'), true);
    put(d.car.x, d.car.z, 'car', glyph(W.glyph), true, true);
    for (const m of d.mates) {
      const down = m.status === 'downed';
      put(m.x, m.z, down ? 'down' : 'mate', down ? glyph('downed') : initial(m.name), true, down);
    }
    // spread the pins on the rim: in order round it, each at least a pin's width from the next (and from the N, which
    // stays where north is)
    const rim = list.filter((p) => p.edge);
    if (rim.length) {
      rim.push({ a: Math.atan2(-c, s), fixed: true });
      const R = r - RIM;
      const gap = Math.min((Math.PI * 2) / rim.length, (this.pinPx + 3) / R);
      rim.sort((a, b) => a.a - b.a);
      for (let it = 0; it < 12; it++) {
        let moved = false;
        for (let i = 0; i < rim.length; i++) {
          const a = rim[i];
          const b = rim[(i + 1) % rim.length];
          let da = b.a - a.a;
          if (i === rim.length - 1) da += Math.PI * 2;
          if (da < gap - 1e-4 && !(a.fixed && b.fixed)) {
            const push = gap - da;
            if (a.fixed) b.a += push;
            else if (b.fixed) a.a -= push;
            else {
              a.a -= push / 2;
              b.a += push / 2;
            }
            moved = true;
          }
        }
        if (!moved) break;
      }
    }
    let mi = 0;
    let di = 0;
    for (const p of list) {
      if (p.edge) {
        p.px = Math.cos(p.a) * (r - RIM);
        p.py = Math.sin(p.a) * (r - RIM);
      }
      let m = this.pool[mi];
      if (!m) m = this.pool[mi] = { e: badge('you', '', this.marks), c: '', tf: '' };
      mi++;
      setBadge(m.e, p.kind, p.icon);
      const cl = 'mk k-' + p.kind + (p.edge ? ' edge' : '');
      if (m.c !== cl) m.e.className = m.c = cl;
      const mt = tf(p.px, p.py);
      if (m.tf !== mt) m.e.style.transform = m.tf = mt;
      if (m.e.hidden) m.e.hidden = false;
      // how far, just inside the pin (the disc clips anything past its rim)
      if (p.far) {
        let t = this.distPool[di];
        if (!t) t = this.distPool[di] = { e: el('b', 'mmap-d', this.marks), t: '', tf: '' };
        di++;
        const txt = String(Math.round(p.m));
        if (t.t !== txt) t.e.textContent = t.t = txt;
        const k = (r - RIM - this.pinPx * 1.05) / (r - RIM);
        const dt = tf(p.px * k, p.py * k);
        if (t.tf !== dt) t.e.style.transform = t.tf = dt;
        if (t.e.hidden) t.e.hidden = false;
      }
    }
    for (let i = di; i < this.distPool.length; i++) if (!this.distPool[i].e.hidden) this.distPool[i].e.hidden = true;
    for (let i = mi; i < this.pool.length; i++) if (!this.pool[i].e.hidden) this.pool[i].e.hidden = true;
  }
}
