// The moments a run turns on (issue #223): going down, dying, the dawn after a night, and the end of the run.
//   Downed    a ring round the crosshair that runs out with the bleed, and one line: who is closest, the radio key
//   Death     a short card: who got you and what it does, then a bar to the rise (the server's RISE_S), not a 9 s screen
//   DawnLine  two lines under the clock at dawn: how the night went, and the names of what comes tonight. The dusk
//             card (hud2.js Tonight) says what to do about them when it matters. The middle stays the Dawn title's
//   EndScreen one read order: the outcome, what the run earned (a new best biggest, a level-up with its perk point),
//             the team, the poll (optional), and a bar at the bottom that never scrolls away: the countdown to the
//             next run, and what can be done now - spend a perk point, invite, leave.
// Styles: ux-endscreens.css, every rule under one of these roots, sized to hold together at 854 x 480 (150% zoom).
import './ux-endscreens.css';
import { el, svgEl, fmtTime } from './dom.js';
import { glyph } from './icons.js';
import { bindLabel } from '../game/binds.js';
import { accountState } from '../net/account.js';
import { voteDifficulty } from '../net/feedback.js';
import { fetchProgress, lastProgress, onProgress } from '../net/progress.js';
import { xpBar } from './progress.js';
import { XP_SRC_NAMES, levelInfo, picksEarned } from '../../shared/progress.js';
import { ZOMBIE_DEFS } from '../../shared/defs.js';
import { BESTIARY } from '../../shared/bestiary.js';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const num = (n) => (n | 0).toLocaleString('en-US');

// a key cap, as the binds have it now ('6', 'Z'); nothing when it is unbound
function keyCap(parent, action) {
  const k = bindLabel(action);
  if (k === 'unbound') return false;
  el('span', 'kbd sm', parent, k);
  return true;
}

// ---------------------------------------------------------------- downed
// d: { bleed (s left), reviving, mate: { name, d (m) } | null } (Game.updateHud), or null: not down
export class Downed {
  constructor(parent) {
    const root = (this.root = el('div', 'xdn', parent));
    root.hidden = true;
    el('div', 'xdn-vig', root);
    const ring = svgEl(
      'div',
      'xdn-ring',
      root,
      '<svg viewBox="0 0 100 100" aria-hidden="true"><circle class="bg" cx="50" cy="50" r="44"/><circle class="fg" cx="50" cy="50" r="44" pathLength="100" transform="rotate(-90 50 50)"/></svg>',
    );
    this.fg = ring.querySelector('.fg');
    const box = el('div', 'xdn-box', root);
    const head = el('div', 'xdn-head', box);
    this.title = el('span', 'xdn-title', head, "You're down");
    this.time = el('b', 'xdn-time', head, '');
    this.line = el('div', 'xdn-line', box);
    this.max = 0; // the bleed when we went down: the ring's full length (DOWN_TIME, by the difficulty)
    this.key = '';
  }

  update(d) {
    const show = !!d;
    if (this.root.hidden === show) this.root.hidden = !show;
    if (!d) {
      this.max = 0;
      this.key = '';
      return;
    }
    this.max = Math.max(this.max, d.bleed);
    const mate = d.mate || null;
    const key = `${Math.ceil(d.bleed)}|${d.reviving ? 1 : 0}|${mate ? mate.name + Math.round(mate.d) : ''}|${bindLabel('slot6')}|${bindLabel('ping')}`;
    if (key === this.key) return;
    this.key = key;
    const frac = this.max > 0 ? Math.max(0, Math.min(1, d.bleed / this.max)) : 0;
    this.fg.style.strokeDasharray = `${(frac * 100).toFixed(2)} 100`;
    this.root.classList.toggle('reviving', !!d.reviving);
    this.root.classList.toggle('late', !d.reviving && d.bleed <= 10);
    this.title.textContent = d.reviving ? 'Being revived' : "You're down";
    this.time.textContent = d.reviving ? '' : fmtTime(d.bleed);
    const line = this.line;
    line.textContent = '';
    if (d.reviving) {
      // (the one reviving us is the one right beside us)
      el('span', '', line, mate && mate.d < 3 ? `${mate.name} has you. Hold on.` : 'A teammate has you. Hold on.');
      return;
    }
    // only a teammate can lift you: who is closest, and how to call the rest
    if (mate) {
      const who = el('span', 'xdn-mate', line);
      el('b', '', who, mate.name);
      el('span', '', who, ` is closest · ${Math.round(mate.d)} m`);
    } else el('span', 'xdn-mate', line, 'No teammate in sight');
    const keys = el('span', 'xdn-keys', line);
    const radio = el('span', 'xdn-k', keys);
    if (keyCap(radio, 'slot6')) el('span', '', radio, 'Radio');
    else radio.remove();
    const ping = el('span', 'xdn-k', keys);
    if (keyCap(ping, 'ping')) el('span', '', ping, 'Ping');
    else ping.remove();
    el('span', 'xdn-k xdn-crawl', keys, 'Crawl · pistol only');
  }
}

// ---------------------------------------------------------------- death
// The server raises a dead survivor as one of the dead this long after they fall (server/game.js killPlayer,
// p.respawnT): the card lasts until then and the game takes it down on the rise (Game.updateOverlays)
const RISE_S = 6;

// one line on how the kind that killed you fights: a boss's few words, else the bestiary's tip
function killerTip(t) {
  if (!Number.isInteger(t) || !ZOMBIE_DEFS[t]) return '';
  return ZOMBIE_DEFS[t].tipBrief || BESTIARY.find((e) => e.t === t)?.tip || ZOMBIE_DEFS[t].tip || '';
}

export class Death {
  constructor(ui, parent) {
    this.ui = ui;
    const root = (this.root = el('div', 'xdeath', parent));
    root.hidden = true;
    el('div', 'xdeath-bg', root);
    const m = el('div', 'xdeath-main', root);
    this.title = el('div', 'xdeath-title', m, 'You died');
    this.by = el('div', 'xdeath-by', m, '');
    this.tip = el('div', 'xdeath-tip', m);
    el('b', '', this.tip, 'What got you');
    this.tipT = el('span', '', this.tip, '');
    const rise = el('div', 'xdeath-rise', m);
    this.bar = el('i', '', el('div', 'xdeath-bar', rise));
    this.riseT = el('div', 'xdeath-rise-t', rise, '');
  }

  // info: { killer (a name), ztype (the kind, -1 for none), day, night (died at night), dawn (the sun brings you back),
  // dawnIn (s to sunrise, when it is known: died at night) }
  show(info = {}) {
    this._stop();
    const parts = [];
    if (info.killer) parts.push('Killed by ' + info.killer);
    if (info.day) parts.push((info.night ? 'Night ' : 'Day ') + info.day);
    this.by.textContent = parts.join(' · ');
    const tip = killerTip(info.ztype);
    this.tip.hidden = !tip;
    this.tipT.textContent = tip;
    const t0 = performance.now();
    const dawnAt = info.dawn && info.dawnIn > 0 ? t0 + info.dawnIn * 1000 : 0;
    const tick = () => {
      const now = performance.now();
      const s = Math.ceil(RISE_S - (now - t0) / 1000);
      let back = '';
      if (dawnAt) back = ` · dawn in ${fmtTime((dawnAt - now) / 1000)} brings you back`;
      else if (info.dawn) back = ' · the next dawn brings you back';
      this.riseT.textContent = (s > 0 ? `You rise as one of them in ${s} s` : 'Rising') + back;
    };
    tick();
    this._iv = setInterval(tick, 250);
    this.bar.style.animationDuration = RISE_S + 's';
    this.root.hidden = false;
    this.root.className = 'xdeath';
    this.ui.root.classList.add('death-on');
    void this.root.offsetWidth;
    this.root.classList.add('in');
    // (taken down on the rise; this is for a rise that never comes, e.g. the run ended under us)
    this._t = setTimeout(() => this.hide(), (RISE_S + 3) * 1000);
  }

  _stop() {
    clearInterval(this._iv);
    clearTimeout(this._t);
  }

  hide() {
    this._stop();
    this.root.hidden = true;
    this.root.className = 'xdeath';
    this.ui.root.classList.remove('death-on');
  }
}

// ---------------------------------------------------------------- dawn lines
const DAWN_LINE_S = 24; // how long the lines stay under the clock

// Under the clock at sunrise. It tells the HUD's root how tall it is (--dawnline-h): the killfeed and the achievement
// banner under the clock step down out of its way (ux-endscreens.css), as they do for the dusk card
export class DawnLine {
  constructor(parent, uiRoot) {
    this.uiRoot = uiRoot;
    const root = (this.root = el('div', 'xdawn scrap', parent));
    root.hidden = true;
    this.head = el('div', 'xdawn-head', root, '');
    this.stats = el('div', 'xdawn-stats', root);
    this.next = el('div', 'xdawn-next', root);
    this.h = -1;
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => this._room()).observe(root);
  }

  // s: the night's tally (S2C summary); rows: what tonight brings (hud2.js tonightBrief): its theme, its new kinds, its boss
  show(s, rows = []) {
    this.head.textContent = `Night ${s.night} held`;
    this.stats.textContent = '';
    const stat = (v, label, cls = '') => {
      const d = el('span', 'xdawn-stat ' + (v ? cls : ''), this.stats);
      el('b', '', d, String(v | 0));
      el('span', '', d, label);
    };
    // the team's night first - what it held, who it got back up - and the kills last (issue #302)
    stat(s.structLost, 'walls lost', 'warn');
    stat(s.revives, 'revived', 'good');
    stat(s.downs, 'down', 'warn');
    stat(s.deaths, 'lost', 'bad');
    stat(s.kills, 'kills');
    // names only, the boss first: the dusk card has the advice
    this.next.textContent = '';
    const order = { boss: 0, new: 1, theme: 2 };
    const names = [...rows].sort((a, b) => (order[a.kind] ?? 3) - (order[b.kind] ?? 3));
    this.next.hidden = !names.length;
    if (names.length) {
      el('span', 'xdawn-next-l', this.next, 'Tonight');
      names.forEach((r, i) => {
        if (i) el('span', 'xdawn-dot', this.next, '·');
        el('b', 'xdawn-' + r.kind, this.next, r.name);
      });
    }
    clearTimeout(this._t);
    clearTimeout(this._t2);
    this.root.classList.remove('out');
    this.root.hidden = false;
    this.root.getAnimations().forEach((a) => a.cancel());
    this._t = setTimeout(() => {
      this.root.classList.add('out');
      this._t2 = setTimeout(() => this.hide(), 700);
    }, DAWN_LINE_S * 1000);
  }

  hide() {
    clearTimeout(this._t);
    clearTimeout(this._t2);
    this.root.hidden = true;
    this.root.classList.remove('out');
  }

  _room() {
    const h = this.root.offsetHeight;
    if (h === this.h) return;
    this.h = h;
    this.uiRoot.style.setProperty('--dawnline-h', h + 'px');
    this.uiRoot.classList.toggle('dawnline-on', h > 0);
  }
}

// ---------------------------------------------------------------- the end of a run
// the answers to "how hard was it?", 1..5 as the server counts them (server/feedback.js)
const DIFFICULTY = ['Too easy', 'Easy', 'Just right', 'Hard', 'Too hard'];

// whole percents of counts that add up to 100 (the largest remainders get the leftover points)
function percents(counts) {
  const total = counts.reduce((a, b) => a + b, 0);
  if (!total) return counts.map(() => 0);
  const exact = counts.map((n) => (n * 100) / total);
  const out = exact.map(Math.floor);
  let left = 100 - out.reduce((a, b) => a + b, 0);
  const order = exact.map((v, i) => [v - out[i], i]).sort((a, b) => b[0] - a[0]);
  for (let k = 0; left > 0; k++, left--) out[order[k % order.length][1]]++;
  return out;
}

// a card's heading, with a figure on its right
function cardHead(card, title) {
  const h = el('div', 'xend-ch', card);
  el('h3', '', h, title);
  return el('span', 'xend-ch-r', h, '');
}

export class EndScreen {
  constructor(ui, parent) {
    this.ui = ui;
    const root = (this.root = el('div', 'xend', parent));
    root.hidden = true;
    el('div', 'xend-bg', root);
    el('div', 'grain', root);
    const page = el('div', 'xend-page', root);

    // 1. the outcome, and the run in three figures
    const head = el('header', 'xend-head', page);
    const out = el('div', 'xend-out', head);
    this.kicker = el('div', 'xend-kicker', out, '');
    this.title = el('h1', 'xend-title', out, '');
    this.reason = el('p', 'xend-reason', out, '');
    this.nums = el('div', 'xend-nums', head);

    // 2. what the run earned, then the team
    const cards = el('div', 'xend-cards', page);
    this.run = el('section', 'xend-card xend-run', cards);
    this.xp = el('section', 'xend-card xend-xp', cards);
    this.xpTotal = cardHead(this.xp, 'Experience');
    this.xpBar = xpBar(this.xp, 'xend-xpb');
    this.xpUp = el('div', 'xend-up', this.xp, '');
    this.xpPerk = el('div', 'xend-perk', this.xp, '');
    this.xpList = el('ul', 'xend-src', this.xp);
    this.xpFoot = el('div', 'xend-foot', this.xp, '');
    this.xp.hidden = true;
    this.team = el('section', 'xend-card xend-team', cards);
    this.teamTotal = cardHead(this.team, 'Body count');
    this.teamList = el('ol', 'xend-list', this.team);

    // 3. how hard was it: one strip, optional
    this.poll = el('div', 'xend-poll', page);
    const ph = el('div', 'xend-poll-h', this.poll);
    el('b', '', ph, 'How hard was it?');
    this.pollFoot = el('span', 'xend-poll-f', ph, '');
    const opts = el('div', 'xend-poll-o', this.poll);
    this.pollOpts = DIFFICULTY.map((label, i) => {
      const b = el('button', 'xend-opt', opts);
      b.type = 'button';
      const fill = el('i', 'xend-opt-fill', b);
      el('span', 'kbd sm', b, String(i + 1));
      el('span', 'xend-opt-l', b, label);
      const pct = el('b', 'xend-opt-p', b, '');
      b.addEventListener('click', () => this._vote(i + 1));
      return { b, pct, fill };
    });
    // 1-5 vote as well as a click (the keys of the answers)
    window.addEventListener('keydown', (e) => {
      if (this.root.hidden || !this.vote || e.repeat || e.ctrlKey || e.metaKey || e.altKey || this.ui.isTyping()) return;
      const n = /^(?:Digit|Numpad)([1-5])$/.exec(e.code);
      if (n) this._vote(+n[1]);
    });
    this.vote = null;
    this.voteSeq = 0;

    // 4. what comes next: always on screen, whatever the size of the rest
    const bar = el('footer', 'xend-bar', root);
    const next = (this.next = el('div', 'xend-next', bar));
    const ring = svgEl(
      'div',
      'xend-ring',
      next,
      '<svg viewBox="0 0 100 100" aria-hidden="true"><circle class="bg" cx="50" cy="50" r="44"/><circle class="fg" cx="50" cy="50" r="44" pathLength="100" transform="rotate(-90 50 50)"/></svg>',
    );
    this.ringFg = ring.querySelector('.fg');
    this.ringN = el('b', 'xend-ring-n', ring, '');
    const nt = el('div', 'xend-next-t', next);
    this.nextT = el('b', '', nt, '');
    this.nextSub = el('span', '', nt, 'Same game · starts on its own');
    const acts = el('div', 'xend-acts', bar);
    const btn = (cls, icon, label, run) => {
      const b = el('button', 'xend-btn ' + cls, acts);
      b.type = 'button';
      svgEl('i', 'xend-btn-i', b, glyph(icon));
      const t = el('span', '', b, label);
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.ui.sound?.('ui_click');
        run();
      });
      return { b, t };
    };
    this.perkBtn = btn('xend-btn-perk', 'arrowUp', 'Spend perk point', () => this.ui.progress.show());
    this.inviteBtn = btn('', 'personPlus', 'Invite', () => this.ui.invitePanel.show());
    this.leaveBtn = btn('xend-btn-leave', 'exit', 'Leave', () => this.ui.cb.onLeave());
    this.setPending(0);
    onProgress((v) => this.setPending(v?.pending | 0));
  }

  // perk points not spent yet (the Perks panel's count): the button is there while there is one
  setPending(n) {
    this.pending = n | 0;
    this.perkBtn.b.hidden = !this.pending;
    this.perkBtn.t.textContent = this.pending > 1 ? `Spend ${this.pending} perk points` : 'Spend perk point';
  }

  // the server's count of our perk points, after the XP this run brought (at most every few seconds)
  _askPoints() {
    const now = performance.now();
    if (now - (this._asked || -1e9) < 3000) return;
    this._asked = now;
    fetchProgress().catch(() => {}); // (no answer: the button stays as it was)
  }

  // A fresh poll for this run. vote: rating 1..5 -> a promise of { mine, counts, total } (net/feedback.js), or
  // nothing for no poll
  _poll(vote) {
    this.vote = vote || null;
    this.voteSeq++; // (an answer still on its way is for the run before)
    this.poll.hidden = !this.vote;
    this.poll.className = 'xend-poll';
    for (const o of this.pollOpts) {
      o.b.classList.remove('mine');
      o.pct.textContent = '';
      o.fill.style.transform = 'scaleX(0)';
    }
    this.pollFoot.className = 'xend-poll-f';
    this.pollFoot.textContent = 'Optional · keys 1-5';
  }

  async _vote(rating) {
    if (!this.vote) return;
    const seq = ++this.voteSeq;
    this.poll.classList.add('sending');
    this.pollOpts.forEach((o, i) => o.b.classList.toggle('mine', i === rating - 1));
    this.pollFoot.className = 'xend-poll-f';
    if (!this.poll.classList.contains('voted')) this.pollFoot.textContent = 'Counting your vote...';
    let res;
    try {
      res = await this.vote(rating);
    } catch (err) {
      if (seq !== this.voteSeq) return;
      this.poll.classList.remove('sending');
      this.pollFoot.className = 'xend-poll-f bad';
      this.pollFoot.textContent = err?.message || 'Your vote did not get through';
      return;
    }
    if (seq !== this.voteSeq) return;
    // everyone's votes, this one counted: each answer's share as a bar behind it (the most picked one full), ours lit
    const counts = DIFFICULTY.map((_, i) => Math.max(0, res?.counts?.[i] | 0));
    const total = counts.reduce((a, b) => a + b, 0);
    const most = Math.max(...counts);
    const pcts = percents(counts);
    this.poll.classList.remove('sending');
    this.poll.classList.add('voted');
    this.pollOpts.forEach((o, i) => {
      o.pct.textContent = pcts[i] + '%';
      o.fill.style.transform = `scaleX(${most ? counts[i] / most : 0})`;
    });
    this.pollFoot.textContent = `${plural(total, 'vote')} so far · click another to change yours`;
  }

  // What this run did to the player's own record. rep: recordRun's report (records.js), { late: true } for a run
  // joined too late to count, or nothing when the run was not followed at all
  _record(rep) {
    const box = this.run;
    box.textContent = '';
    box.hidden = !rep;
    if (!rep) return;
    const right = cardHead(box, 'Your run');
    if (rep.late) {
      el('p', 'xend-note', box, 'You joined this run after its first minute, so it is not on your record.');
      return;
    }
    const { run, news, record: rec } = rep;
    const t = rec.total;
    right.textContent = `Run ${num(t.runs)}`;
    const isNew = (k) => news.some((n) => n.k === k);
    // the headline: the first best this run set, biggest; a run that set none leads with its kills
    const top = news[0] || null;
    const hl = el('div', 'xend-hl' + (top ? ' new' : ''), box);
    // (an escape time leads with the time: 'escaped in 12:30' is the record's own wording)
    const text = !top ? plural(run.kills, 'kill') : top.k === 'secs' ? `${fmtTime(run.secs)} to escape` : top.text;
    const m = /^(\d[\d:,]*)\s+(.*)$/.exec(text);
    el('b', 'xend-hl-n', hl, m ? m[1] : text);
    const hr = el('div', 'xend-hl-r', hl);
    if (m) el('span', 'xend-hl-t', hr, m[2]);
    el('small', '', hr, top ? (top.was ? `was ${top.was}` : 'your first') : `your best ${rec.best.kills}`);
    if (top) el('span', 'xend-stamp', hl, top.label);
    // the rest of the bests this run set, a line each
    for (const n of news.slice(1)) {
      const row = el('div', 'xend-new', box);
      el('b', '', row, n.label);
      el('span', '', row, n.text);
      if (n.was) el('small', '', row, 'was ' + n.was);
    }
    // the figures the headline did not take
    const tiles = el('div', 'xend-tiles', box);
    const tile = (k, label, value, sub) => {
      if (top ? top.k === k : k === 'kills') return;
      const d = el('div', 'xend-tile' + (isNew(k) ? ' new' : ''), tiles);
      el('span', '', d, label);
      el('b', '', d, value);
      el('small', '', d, sub);
    };
    tile('kills', 'Kills', String(run.kills), run.kills >= rec.best.kills ? '= your best' : `best ${rec.best.kills}`);
    tile('nights', 'Nights', String(run.nights), isNew('nights') ? 'new best' : run.nights >= rec.best.nights ? '= your best' : `best ${rec.best.nights}`);
    tile('secs', 'Time', fmtTime(run.secs), rec.best.secs ? `fastest escape ${fmtTime(rec.best.secs)}` : 'no escape yet');
    // nights survived, run by run: this one lit
    const runs = rec.runs.slice(-10);
    if (runs.length > 1) {
      const spark = el('div', 'xend-spark', box);
      const bars = el('div', 'xend-spark-b', spark);
      const most = Math.max(1, ...runs.map((r) => r.nights));
      runs.forEach((r, i) => {
        const b = el('i', i === runs.length - 1 ? 'now' : '', bars);
        b.style.height = Math.max(6, (r.nights / most) * 100) + '%';
        b.title = `${plural(r.nights, 'night')}${r.result === 'escaped' ? ' · escaped' : ''}`;
      });
      const lab = el('div', 'xend-spark-l', spark);
      el('span', '', lab, `Nights, your last ${runs.length} runs`);
      el('span', '', lab, 'This one');
    }
    if (t.escapes) el('div', 'xend-foot', box, `${plural(t.escapes, 'escape')} in all` + (t.streak > 1 ? ` · ${t.streak} in a row` : ''));
  }

  // p: { xp (on record, this run's in it), run: [XP by source, as XP_SRC], loaded, kept } or null (not heard yet).
  // Called again while the screen is up when the server's last word on the run comes after it
  setXp(p) {
    this.xp.hidden = !p;
    if (!p) return;
    const got = p.run.reduce((a, b) => a + b, 0);
    const now = this.xpBar.set(p.xp);
    const was = levelInfo(p.xp - got).level;
    const up = !!p.loaded && now.level > was;
    this.xp.classList.toggle('up', up);
    this.xpTotal.textContent = got ? `+${num(got)} XP` : '';
    this.xpUp.hidden = !up;
    this.xpUp.textContent = up ? `Level up · level ${now.level}` : '';
    // a level with a perk point on it (shared/progress.js PICK_LEVELS)
    const points = up ? picksEarned(now.level) - picksEarned(was) : 0;
    this.xpPerk.hidden = !points;
    this.xpPerk.textContent = points ? `+${plural(points, 'perk point')} to spend` : '';
    this.xpList.textContent = '';
    p.run.forEach((v, i) => {
      if (!v) return;
      const li = el('li', '', this.xpList);
      el('span', '', li, XP_SRC_NAMES[i]);
      el('b', '', li, `+${num(v)}`);
    });
    if (!got) el('li', 'none', this.xpList, 'Nothing this run');
    this.xpFoot.textContent = !p.kept ? 'Not kept: this player has no record' : !p.loaded ? 'Your record could not be read, so the level counts this run only' : '';
    this.xpFoot.hidden = !this.xpFoot.textContent;
    if (p.kept && p.loaded) this._askPoints();
  }

  // the team's kills, most first, ours marked
  _team(kills) {
    const list = this.teamList;
    list.textContent = '';
    const sorted = [...kills].sort((a, b) => (b.kills | 0) - (a.kills | 0));
    this.team.hidden = !sorted.length;
    const total = sorted.reduce((a, k) => a + (k.kills | 0), 0);
    this.teamTotal.textContent = sorted.length ? num(total) : '';
    sorted.forEach((k, i) => {
      const li = el('li', (i === 0 && (k.kills | 0) > 0 ? 'top' : '') + (k.me ? ' me' : ''), list);
      el('span', 'xend-rank', li, String(i + 1));
      const nm = el('span', 'xend-name', li);
      el('span', '', nm, k.name || '???');
      if (k.me) el('small', '', nm, 'you');
      el('b', 'xend-kills', li, String(k.kills | 0));
    });
    return total;
  }

  show(kind, stats = {}) {
    const victory = kind === 'victory';
    this.root.hidden = false;
    this.root.className = 'xend ' + (victory ? 'victory' : 'gameover');
    void this.root.offsetWidth;
    this.root.classList.add('in');
    // stats.days is the day the run ended on. Night N closes day N, so a run that ends on day N - in its
    // daylight or in its night - got through N - 1 nights (a wipe during the first night survived none)
    const days = stats.days | 0;
    const n = Math.max(0, days - 1);
    this.kicker.textContent = victory ? (stats.plane ? 'Wheels up' : 'The engine turns over') : days ? `Game over · day ${days}` : 'Game over';
    this.title.textContent = stats.title || (victory ? 'You escaped' : 'Everyone died');
    this.reason.textContent = stats.reason || (victory ? 'Headlights cut through the trees. The valley shrinks in the mirror.' : 'The valley is quiet again. The car never started.');

    const kills = Array.isArray(stats.kills) ? stats.kills : [];
    const teamKills = this._team(kills);
    this._record(stats.record);
    this.setXp(stats.progress || null);
    // (no poll on a server that keeps no votes: one without a database has no accounts either)
    this._poll(stats.vote || (accountState().accounts ? voteDifficulty : null));

    // the run in three figures, top right
    this.nums.textContent = '';
    const fig = (v, label) => {
      const d = el('div', 'xend-num', this.nums);
      el('b', '', d, v);
      el('span', '', d, label);
    };
    fig(String(n), n === 1 ? 'Night survived' : 'Nights survived');
    if (kills.length) fig(num(teamKills), 'Team kills');
    const secs = stats.record && !stats.record.late ? stats.record.run?.secs : 0;
    if (secs) fig(fmtTime(secs), 'Run time');

    this.inviteBtn.b.hidden = !this.ui.pause?.room;
    this.setPending(lastProgress()?.pending | 0);
    this._askPoints();

    clearInterval(this._iv);
    const total = stats.restartIn > 0 ? stats.restartIn : 0;
    this.next.hidden = !total;
    if (total) {
      const end = performance.now() + total * 1000;
      const tick = () => {
        const left = Math.max(0, (end - performance.now()) / 1000);
        const s = Math.ceil(left);
        this.ringN.textContent = s > 0 ? String(s) : '';
        this.ringFg.style.strokeDasharray = `${((left / total) * 100).toFixed(2)} 100`;
        this.nextT.textContent = s > 0 ? `Next run in ${s} s` : 'Starting the next run';
        if (s <= 0) clearInterval(this._iv);
      };
      tick();
      this._iv = setInterval(tick, 250);
    }
  }

  hide() {
    clearInterval(this._iv);
    this.root.hidden = true;
  }
}
