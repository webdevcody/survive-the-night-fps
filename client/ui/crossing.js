// The crossing (act 1 -> act 2, shared/acts.js): the car over the old county bridge to the mainland, played over
// everything while the mainland is built behind it (Game.loadWorld holds the thread for a second or so of it). None of
// it is the world: a dawn silhouette on a canvas of its own - the river, the rusted truss bridge with one span half
// down, the car's lights crossing it, gulls - and the act's title. Once, CROSSING_SECONDS long, then it fades out on
// the game. Time only runs while frames come (a frame's step is capped), so the load's hitch pauses it, never skips it.
import { el, clamp } from './dom.js';

export const CROSSING_SECONDS = 8.5;
const FADE_IN = 0.7;
const FADE_OUT = 0.9;
const DRIVE = [0.5, 7.3]; // s: the car from the valley's end of the bridge to the mainland's
const BRIDGE = [-260, 2060]; // the bridge's ends, in scene units (a unit is a pixel at a 720 px tall screen)
const SPAN = 290; // between two piers
const BROKEN = 3; // the span that is half down
const CAR_FROM = -160;
const CAR_TO = 1980;

const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
// hills: a few sines, the same every time
const ridge = (x, k) => Math.sin(x * 0.0023 + k) * 34 + Math.sin(x * 0.0071 + k * 3.1) * 14 + Math.sin(x * 0.019 + k * 7.3) * 5;

export class Crossing {
  constructor(parent) {
    this.parent = parent;
    this.root = null;
    this.raf = 0;
  }

  get active() {
    return !!this.root;
  }

  // onEnd: once it has faded out (or was stopped)
  play(onEnd) {
    this.stop();
    const root = (this.root = el('div', 'crossing', this.parent));
    this.cv = el('canvas', 'crossing-cv', root);
    const card = el('div', 'crossing-card', root);
    el('div', 'crossing-act', card, 'Act II');
    el('div', 'crossing-title', card, 'The Mainland');
    el('div', 'crossing-sub', card, 'Over the old county bridge. The car will not get much further: a wrecked plane on Kessler Airfield is the way out.');
    this.card = card;
    this.onEnd = onEnd;
    this.t = 0;
    this.last = performance.now();
    this.resize();
    this.draw();
    const frame = (now) => {
      if (this.root !== root) return;
      this.t += Math.min(0.05, Math.max(0, (now - this.last) / 1000));
      this.last = now;
      if (this.t >= CROSSING_SECONDS) return this.stop();
      this.resize();
      this.draw();
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  stop() {
    if (!this.root) return;
    cancelAnimationFrame(this.raf);
    this.root.remove();
    this.root = null;
    const done = this.onEnd;
    this.onEnd = null;
    done?.();
  }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(window.innerWidth * dpr));
    const h = Math.max(1, Math.round(window.innerHeight * dpr));
    if (this.cv.width !== w || this.cv.height !== h) {
      this.cv.width = w;
      this.cv.height = h;
    }
  }

  // the height of the deck at scene x: level, but for the span that is half down, which sags to a gap in the middle
  deck(x) {
    const a = BRIDGE[0] + BROKEN * SPAN;
    const u = (x - a) / SPAN;
    if (u <= 0 || u >= 1) return 0;
    return Math.sin(u * Math.PI) ** 1.5 * 22;
  }

  carX(t) {
    return CAR_FROM + (CAR_TO - CAR_FROM) * ease(clamp((t - DRIVE[0]) / (DRIVE[1] - DRIVE[0]), 0, 1));
  }

  draw() {
    const cv = this.cv;
    const g = cv.getContext('2d');
    const W = cv.width;
    const H = cv.height;
    const t = this.t;
    const s = H / 720; // scene unit -> pixels
    const sw = W / s; // the screen's width in scene units
    const horizon = 405;
    const deckY = 430;
    const cx = this.carX(t);
    const cam = clamp(cx - sw * 0.42, BRIDGE[0] - 120, BRIDGE[1] + 120 - sw);
    g.setTransform(s, 0, 0, s, 0, 0);

    // sky at first light, and the sun coming up over the mainland
    const sky = g.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, '#0b1020');
    sky.addColorStop(0.55, '#2c2b45');
    sky.addColorStop(0.85, '#8a5148');
    sky.addColorStop(1, '#d48a52');
    g.fillStyle = sky;
    g.fillRect(0, 0, sw, horizon + 1);
    const sunX = sw * 0.74 - (cam - BRIDGE[0]) * 0.04;
    const sunY = horizon + 8 - smooth(0, CROSSING_SECONDS, t) * 26;
    const glow = g.createRadialGradient(sunX, sunY, 0, sunX, sunY, 260);
    glow.addColorStop(0, 'rgba(255,214,150,0.85)');
    glow.addColorStop(0.12, 'rgba(255,170,100,0.45)');
    glow.addColorStop(1, 'rgba(255,140,80,0)');
    g.fillStyle = glow;
    g.fillRect(0, 0, sw, horizon + 1);

    // the far shores: the valley's hills behind, the mainland's town and works ahead
    const hills = (par, base, k, color, town) => {
      const off = cam * par;
      g.fillStyle = color;
      g.beginPath();
      g.moveTo(0, horizon + 2);
      for (let x = 0; x <= sw + 8; x += 8) g.lineTo(x, base - ridge(x + off, k));
      g.lineTo(sw, horizon + 2);
      g.closePath();
      g.fill();
      if (!town) return;
      for (let i = 0; i < 26; i++) {
        const x = 1500 + i * 37 - off + (i % 3) * 9;
        if (x < -40 || x > sw + 40) continue;
        const h = 18 + ((i * 53) % 41);
        g.fillRect(x, base - 8 - h, 22 + (i % 4) * 6, h + 10);
      }
      const mx = 1620 - off; // a radio mast with its light
      g.fillRect(mx, base - 120, 3, 112);
      g.fillStyle = (t * 1.2) % 1 < 0.5 ? '#ff3b2b' : '#5a1510';
      g.fillRect(mx - 1.5, base - 124, 6, 5);
    };
    hills(0.12, horizon - 30, 1.3, '#1c2131', false);
    hills(0.26, horizon - 4, 4.1, '#121620', true);

    // the river
    const water = g.createLinearGradient(0, horizon, 0, 720);
    water.addColorStop(0, '#3a2c33');
    water.addColorStop(0.18, '#141a25');
    water.addColorStop(1, '#05070b');
    g.fillStyle = water;
    g.fillRect(0, horizon, sw, 720 - horizon);
    for (let i = 0; i < 46; i++) {
      const y = horizon + 6 + ((i * 37) % 300);
      const x = (((i * 211 + t * (12 + (i % 5) * 6) * 10) % (sw + 200)) + sw + 200) % (sw + 200) - 100;
      const near = Math.abs(x - sunX) < 80 + (y - horizon) * 0.4;
      g.fillStyle = near ? `rgba(255,190,120,${0.55 - (y - horizon) / 700})` : 'rgba(150,160,190,0.07)';
      g.fillRect(x, y, 18 + (i % 7) * 9, 1.4);
    }

    // the bridge: piers, deck and truss, one span half down
    const X = (x) => x - cam;
    g.lineCap = 'round';
    for (let k = 0; k <= Math.round((BRIDGE[1] - BRIDGE[0]) / SPAN); k++) {
      const px = X(BRIDGE[0] + k * SPAN);
      if (px < -60 || px > sw + 60) continue;
      g.fillStyle = '#0d0f14';
      g.fillRect(px - 13, deckY + 6, 26, 720 - deckY);
      g.fillStyle = 'rgba(255,190,120,0.06)';
      g.fillRect(px - 13, deckY + 6, 4, 720 - deckY);
    }
    g.strokeStyle = '#120e0d';
    g.fillStyle = '#120e0d';
    // the deck, with the gap in the broken span
    const gapA = BRIDGE[0] + BROKEN * SPAN + SPAN * 0.47;
    const gapB = gapA + SPAN * 0.07;
    const deckPath = (from, to) => {
      g.beginPath();
      for (let x = from; x <= to; x += 6) g.lineTo(X(x), deckY + this.deck(x));
      for (let x = to; x >= from; x -= 6) g.lineTo(X(x), deckY + this.deck(x) + 9);
      g.closePath();
      g.fill();
    };
    deckPath(BRIDGE[0], gapA);
    deckPath(gapB, BRIDGE[1]);
    // the truss over each span: chords, diagonals, verticals; the broken one with its top chord snapped and drooping
    g.lineWidth = 3.2;
    for (let k = 0; k * SPAN < BRIDGE[1] - BRIDGE[0]; k++) {
      const a = BRIDGE[0] + k * SPAN;
      if (X(a + SPAN) < -20 || X(a) > sw + 20) continue;
      const top = (x) => deckY - 62 + this.deck(x) * (k === BROKEN ? 1.8 : 0);
      const broken = k === BROKEN;
      g.beginPath();
      const n = 7;
      for (let i = 0; i <= n; i++) {
        const x = a + (SPAN * i) / n;
        if (broken && i === 3) {
          g.moveTo(X(x), deckY + this.deck(x));
          g.lineTo(X(x + SPAN / n / 2 - 10), top(x) + 30);
          continue;
        }
        if (broken && i === 4) continue;
        g.moveTo(X(x), deckY + this.deck(x));
        g.lineTo(X(x), top(x));
        if (i < n) g.lineTo(X(x + SPAN / n), deckY + this.deck(x + SPAN / n));
      }
      // top chord (in two drooping halves over the broken span)
      if (broken) {
        g.moveTo(X(a), top(a));
        g.quadraticCurveTo(X(a + SPAN * 0.3), top(a + SPAN * 0.3) - 4, X(a + SPAN * 0.45), top(a + SPAN * 0.45) + 38);
        g.moveTo(X(a + SPAN), top(a + SPAN));
        g.quadraticCurveTo(X(a + SPAN * 0.7), top(a + SPAN * 0.7) - 2, X(a + SPAN * 0.56), top(a + SPAN * 0.56) + 46);
      } else {
        g.moveTo(X(a), top(a));
        g.lineTo(X(a + SPAN), top(a + SPAN));
      }
      g.stroke();
      // a girder hanging off the break, swinging a little
      if (broken) {
        const hx = X(a + SPAN * 0.45);
        const hy = top(a + SPAN * 0.45) + 38;
        const sway = Math.sin(t * 1.7) * 0.08;
        g.beginPath();
        g.moveTo(hx, hy);
        g.lineTo(hx + Math.sin(sway) * 44, hy + Math.cos(sway) * 44);
        g.stroke();
      }
      // railing, bent where the span sags
      g.lineWidth = 1.4;
      g.beginPath();
      for (let x = a; x <= a + SPAN; x += 6) {
        if (broken && x > gapA - 4 && x < gapB + 4) {
          g.stroke();
          g.beginPath();
          continue;
        }
        g.lineTo(X(x), deckY - 14 + this.deck(x) + (broken ? Math.sin(x * 0.11) * 2 : 0));
      }
      g.stroke();
      g.lineWidth = 3.2;
    }

    // the car: up the deck and over the sag, a hop across the gap, lights on
    const cy = deckY + this.deck(cx) - (cx > gapA - 18 && cx < gapB + 18 ? Math.sin(((cx - gapA + 18) / (gapB - gapA + 36)) * Math.PI) * 9 : 0);
    const slope = (this.deck(cx + 12) - this.deck(cx - 12)) / 24;
    const bob = Math.sin(t * 23) * 0.5;
    g.save();
    g.translate(X(cx), cy + bob);
    g.rotate(Math.atan(slope));
    const beam = g.createLinearGradient(22, 0, 230, 0);
    beam.addColorStop(0, 'rgba(255,236,190,0.55)');
    beam.addColorStop(1, 'rgba(255,236,190,0)');
    g.fillStyle = beam;
    g.beginPath();
    g.moveTo(22, -9);
    g.lineTo(230, -34);
    g.lineTo(230, 18);
    g.closePath();
    g.fill();
    g.fillStyle = '#07080a';
    g.beginPath();
    g.moveTo(-24, -2);
    g.lineTo(-24, -10);
    g.lineTo(-13, -11);
    g.lineTo(-6, -19);
    g.lineTo(9, -19);
    g.lineTo(15, -11);
    g.lineTo(24, -9);
    g.lineTo(24, -2);
    g.closePath();
    g.fill();
    for (const wx of [-14, 14]) {
      g.beginPath();
      g.arc(wx, -2, 5, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = '#fff2cf';
    g.fillRect(22, -10, 3, 3);
    g.fillStyle = '#c0261c';
    g.fillRect(-25, -9, 2.5, 3);
    g.restore();

    // gulls over the river
    g.strokeStyle = 'rgba(10,10,14,0.9)';
    g.lineWidth = 1.6;
    for (let i = 0; i < 6; i++) {
      const bx = (((i * 317 + t * (38 + i * 7) - cam * 0.6) % (sw + 300)) + sw + 300) % (sw + 300) - 150;
      const by = 150 + ((i * 71) % 140) + Math.sin(t * 0.9 + i) * 10;
      const f = Math.sin(t * (6 + i) + i * 2) * 5;
      const w = 9 + (i % 3) * 2;
      g.beginPath();
      g.moveTo(bx - w, by - f);
      g.quadraticCurveTo(bx - w * 0.4, by - 4 - f * 0.4, bx, by);
      g.quadraticCurveTo(bx + w * 0.4, by - 4 - f * 0.4, bx + w, by - f);
      g.stroke();
    }

    // morning mist on the water, the letterbox, and the fades
    const mist = g.createLinearGradient(0, deckY - 10, 0, deckY + 90);
    mist.addColorStop(0, 'rgba(180,150,150,0)');
    mist.addColorStop(0.5, 'rgba(180,150,150,0.12)');
    mist.addColorStop(1, 'rgba(180,150,150,0)');
    g.fillStyle = mist;
    g.fillRect(0, deckY - 10, sw, 100);
    g.fillStyle = '#000';
    g.fillRect(0, 0, sw, 68);
    g.fillRect(0, 720 - 68, sw, 68);
    const dark = Math.max(1 - t / FADE_IN, smooth(CROSSING_SECONDS - FADE_OUT, CROSSING_SECONDS, t));
    if (dark > 0) {
      g.fillStyle = `rgba(0,0,0,${dark})`;
      g.fillRect(0, 0, sw, 720);
    }
    this.root.style.opacity = String(1 - smooth(CROSSING_SECONDS - 0.35, CROSSING_SECONDS, t));
    this.card.style.opacity = String(smooth(1.1, 2.0, t) * (1 - smooth(5.8, 6.8, t)));
  }
}
