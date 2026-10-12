// A player's first playthrough, played out (#270): each frame it looks at what is going on, picks the walkthrough step
// that fits (ui/firstrun.js CORE) and shows it on the coach card (ui/coach.js), with a marker over what the step is
// about - the zombie coming for them, the tree or rock to hit. And, walkthrough or not, the first-time tips: the
// perks key on the first level up, the achievements key on the first unlock, the bestiary key on the first kind of
// zombie that is not a plain walker or runner. Settings -> Tutorial tips turns all of it off.
import { ENT, HOLD, qpos } from '../../shared/protocol.js';
import { ITEM, ZOMBIE_DEFS, ZTYPE } from '../../shared/defs.js';
import { COL } from '../../shared/collision.js';
import { PHASE, DUSK_WARNING } from '../../shared/constants.js';
import { CORE, TIPS, pickStep, loadOnboarding, markStep, markTip, tipSeen, finishOnboarding, ZOMBIE_NEAR, HARVEST_NEAR } from '../ui/firstrun.js';
import { Coach } from '../ui/coach.js';
import { glyph } from '../ui/icons.js';
import { strippedKey } from './harvest.js';
import { SUPPLIES, SUPPLY_NEED } from './act.js';
import { onUnlock } from '../net/achievements.js';
import { onSeen } from '../net/bestiary.js';

const EVERY = 0.2; // seconds between looks
const GATHERED = new Set([ITEM.STICK, ITEM.WOOD, ITEM.STONE]);
const NICE_FOR = 3.5; // seconds a step's "well done" stays up
const TIP_FOR = 9; // ...and a first-time tip
const _near = [];
const _sc = { x: 0, y: 0 };

export class Onboarding {
  constructor(game) {
    this.game = game;
    this.coach = new Coach(game.ui.hud.root);
    this.active = null; // the CORE step on the card
    this.mem = {}; // ...its own memory (start / done)
    this.age = 0; // seconds it has been up
    this.wait = 0;
    this.tips = []; // first-time tips waiting their turn: [{ title, text }]
    this.tip = null; // ...the one on the card, and how long it has been up
    this.tipAge = 0;
    this.nice = null; // a step's "well done", and how long it has been up
    this.niceAge = 0;
    this.seenZombies = new Set(); // the dead in view at the last look
    this.flags = { gathered: false, picked: false };
    this.marks = []; // world markers for the HUD: Game.buildMarkers adds them
    onUnlock(() => this.achievement());
    onSeen((list) => this.newKinds(list));
  }

  // a run starts under us
  reset() {
    this.active = null;
    this.mem = {};
    this.seenZombies.clear();
    this.flags.gathered = this.flags.picked = false;
  }

  get on() {
    return this.game.settings.tutorial !== false;
  }

  // a material came into the pack (EVT pickup)
  pickup(item) {
    if (GATHERED.has(item)) this.flags.gathered = true;
    this.flags.picked = true;
  }

  // ---- the first-time tips
  levelUp() {
    this.queueTip('perks');
  }
  achievement() {
    this.queueTip('achievements');
  }
  // kinds of zombie seen for the first time (net/bestiary.js onSeen: [{ t, name }])
  newKinds(list) {
    const k = list.find((e) => e.t !== ZTYPE.WALKER && e.t !== ZTYPE.RUNNER);
    if (k) this.queueTip('bestiary', { name: k.name });
  }
  queueTip(id, vars = {}) {
    if (!this.on || tipSeen(id) || this.tips.some((t) => t.id === id) || this.tip?.id === id) return;
    markTip(id);
    const t = TIPS[id];
    this.tips.push({ id, title: fill(t.title, vars), text: fill(t.text, vars) });
  }

  // ---- every frame while playing
  update(dt) {
    const g = this.game;
    this.marks.length = 0;
    if (this.tip) this.tipAge += dt;
    if (this.nice) this.niceAge += dt;
    if (this.active) this.age += dt;
    this.wait += dt;
    const c = this.wait >= EVERY ? this.moment() : null;
    if (c) this.wait = 0;
    const self = g.self;
    const playing = self.alive && !g.prediction.state.zombie;
    const walk = this.on && playing && !loadOnboarding().done;

    if (walk && c) this.step(c);
    else if (!walk && this.active) this.active = null;
    if (walk && this.active) this.mark(); // (every frame: the marker follows what it is on)

    // what the card shows: a first-time tip first (it is short), then the walkthrough, then a step's "well done"
    if (this.tip && this.tipAge > TIP_FOR) this.tip = null;
    if (!this.tip && this.tips.length && playing) {
      this.tip = this.tips.shift();
      this.tipAge = 0;
      g.audio.playLocal('notify', { volume: 0.6 });
    }
    if (this.nice && this.niceAge > NICE_FOR) this.nice = null;
    const shown = !this.on || !playing ? null : this.tip ? { ...this.tip, tag: 'New' } : this.active ? this.card(this.active) : this.nice ? { title: this.nice, text: '', tag: 'Well done', good: true } : null;
    this.coach.show(shown);
  }

  get showing() {
    return this.coach.visible;
  }

  step(c) {
    const o = loadOnboarding();
    // been through it: the first night survived (or a run played out: Game.trackRun)
    if (c.dayN >= 2 && c.day) {
      finishOnboarding();
      this.active = null;
      this.nice = 'You survived your first night. Now fix that car.';
      this.niceAge = 0;
      return;
    }
    const a = this.active;
    if (a) {
      // done (and up long enough to be read), or it has had its time
      const done = !!a.done?.(c, this.mem);
      if ((done && this.age >= Math.min(a.min || 0, 2)) || this.age >= (a.max || 60)) {
        markStep(a.id);
        if (done && a.nice) {
          this.nice = a.nice;
          this.niceAge = 0;
        }
        this.active = null;
      }
    }
    const next = pickStep(c, this.active, o.steps);
    if (next !== this.active) {
      this.active = next;
      this.mem = {};
      this.age = 0;
      next.start?.(c, this.mem);
      this.game.audio.playLocal('notify', { volume: next.urgent ? 0.8 : 0.5 });
    }
    this.flags.gathered = this.flags.picked = false;
  }

  card(s) {
    const n = CORE.indexOf(s) + 1;
    const o = loadOnboarding();
    const left = CORE.filter((x) => !o.steps[x.id]).length;
    return { title: s.title, text: fill(s.text, { need: SUPPLY_NEED.reduce((a, b) => a + b, 0) }), tag: `Survivor's guide · ${CORE.length - left + 1} of ${CORE.length}`, urgent: !!s.urgent, n };
  }

  // the moment the steps look at (ui/firstrun.js, above CORE)
  moment() {
    const g = this.game;
    const gl = g.global;
    const s = g.prediction.state;
    const rp = g.renderPos;
    const day = gl.phase === PHASE.DAY && !gl.finale;
    // the nearest of the dead, and which of those seen last time are gone (dead, or out of reach)
    let zombie = null;
    const now = new Set();
    for (const e of g.entities.ents.values()) {
      if (e.kind !== ENT.ZOMBIE || e.dead) continue;
      const d = Math.hypot(e.rx - rp.x, e.rz - rp.z);
      if (d > ZOMBIE_NEAR * 1.6) continue;
      now.add(e.id);
      if (d < ZOMBIE_NEAR && (!zombie || d < zombie.d)) zombie = { id: e.id, d };
    }
    const gone = new Set();
    for (const id of this.seenZombies) if (!now.has(id)) gone.add(id);
    this.seenZombies = now;
    const counts = g.invCounts();
    let carrying = false;
    gl.supplies.forEach((n, i) => {
      if (n < SUPPLY_NEED[i] && counts[SUPPLIES[i]]) carrying = true;
    });
    return {
      t: gl.phaseLen - gl.timeLeft,
      x: rp.x,
      z: rp.z,
      dayN: gl.day,
      day,
      dusk: day && gl.timeLeft <= DUSK_WARNING,
      night: gl.phase === PHASE.NIGHT || !!gl.finale,
      zombie,
      gone,
      harvest: day ? this.harvestNear(rp) : null,
      gathered: this.flags.gathered,
      searchable: typeof g.prompt === 'string' && g.prompt.includes('Hold to search'),
      searching: g.self.holdKind === HOLD.SEARCH,
      picked: this.flags.picked,
      inv: !!g.ui.inventoryOpen,
      carrying,
      installed: gl.supplies.reduce((a, n, i) => a + Math.min(n, SUPPLY_NEED[i]), 0),
      danger: g.danger || 0,
    };
  }

  // the nearest tree or boulder that still gives today, within HARVEST_NEAR m
  harvestNear(rp) {
    const g = this.game;
    const near = g.world.staticGrid.query(rp.x, rp.z, HARVEST_NEAR, _near);
    let best = null;
    for (const col of near) {
      const tree = col.flags & COL.TREE;
      if (!tree && !(col.flags & COL.ROCK)) continue;
      if (g.stripped.has(strippedKey(qpos(col.x), qpos(col.y0), qpos(col.z)))) continue;
      const d = Math.hypot(col.x - rp.x, col.z - rp.z);
      if (d > HARVEST_NEAR || (best && d >= best.d)) continue;
      best = { kind: tree ? 'tree' : 'rock', d, col };
    }
    this.harvestCol = best?.col || null;
    return best;
  }

  // the marker over what the step on the card is about
  mark() {
    const g = this.game;
    const a = this.active;
    if (a.id === 'zombie') {
      const e = g.entities.ents.get(this.mem.target);
      if (!e || e.dead) return;
      const def = ZOMBIE_DEFS[e.ztype];
      const d = Math.hypot(e.rx - g.renderPos.x, e.rz - g.renderPos.z);
      if (g.project(e.rx, e.ry + (def?.height || 1.8) + 0.45, e.rz, _sc)) this.marks.push({ kind: 'threat', x: _sc.x, y: _sc.y, icon: glyph('claw'), name: 'Zombie · attack it!', sub: `${Math.round(d)}m`, cls: 'urgent', scale: 1.1 });
    } else if (a.id === 'harvest' && this.harvestCol) {
      const col = this.harvestCol;
      const tree = col.flags & COL.TREE;
      const top = tree ? Math.min(col.y1, col.y0 + 3.2) : col.y1 + 0.4;
      if (g.project(col.x, top, col.z, _sc)) this.marks.push({ kind: 'gather', x: _sc.x, y: _sc.y, icon: glyph('axe'), name: tree ? 'Chop: sticks & planks' : 'Mine: stone', sub: '', scale: 1 });
    }
  }
}

// '{need}' and the like
const fill = (text, vars) => text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
