// Leaderboard overlay [L]: what the server has on record for every player over all the games they have played
// (server/stats.js) - the dead they put down, the nights they saw through, the runs they won, the teammates they
// revived - with your own row picked out. Two lists: the best of everyone on record, and the players in this
// game. A click on a column sorts by it. The game asks the server for the board while this is open and hands
// each answer to set(). On the splash, an HTTP request supplies the all-time list instead.
// It leads with you (issue #219): your place in the stat picked, how far the next place is, and your places in the
// others. The columns go nights, revives, wins, kills, and it opens sorted by nights (issue #302: a co-op board
// leads with what the team did, not with kills). In a game it is the side sheet (sheet.js): down the right-hand side, a row shows only the stat picked,
// and tabs on its edge go to the player list and Friends; on the splash it stays the card in the middle.
import { BOARD_STATS, BOARD_ORDER, BOARD_TOP, boardSort } from '../../shared/protocol.js';
import { el, svgEl, lsGet, lsSet } from './dom.js';
import { glyph } from './icons.js';
import { bindLabel, liveText } from '../game/binds.js';
import { SheetTabs, undock, sheetLeft, sheetCame } from './sheet.js';

const STORE = 'stn.board'; // 'all:nights': the list and the column last looked at
// per stat: column head, its glyph, what it counts
const COLS = {
  nights: ['Nights', 'moon', 'Nights you were still alive at the end of'],
  revives: ['Revives', 'cross', 'Teammates you got back on their feet'],
  wins: ['Wins', 'car', 'Runs your team escaped from'],
  kills: ['Kills', 'skull', 'The dead you put down: zombies and turned players'],
};
const LISTS = [
  ['all', 'All time'],
  ['here', 'This game'],
];
const num = (n) => n.toLocaleString('en-US');

export class Leaderboard {
  constructor(ui, parent) {
    this.ui = ui;
    this.open = false;
    this.data = null; // { total, rows } as last sent (shared/protocol.js readBoard)
    const [list, sort] = lsGet(STORE, '').split(':');
    this.list = LISTS.some(([id]) => id === list) ? list : 'all';
    this.sort = boardSort(sort);
    this.key = '';
    this.error = '';
    this.lobbyMode = false;
    this.savedList = this.list;

    this.root = el('div', 'lbscr lb-sheet', parent);
    this.root.hidden = true;
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-label', 'Leaderboard');
    const bg = el('div', 'map-bg', this.root);
    const frame = el('div', 'lb-frame paper', this.root);
    this.tabs = new SheetTabs(ui, frame, 'board');
    const head = el('div', 'map-head', frame);
    el('span', 'map-title', head, 'Leaderboard');
    this.count = el('span', 'map-coords', head, '');
    // the cross, or a left press outside the frame, closes it: the game sets onClose
    this.onClose = null;
    const close = (this.close = svgEl('button', 'set-close btn-icon map-close', head, glyph('xmark')));
    close.type = 'button';
    close.title = 'Close (L)';
    close.setAttribute('aria-label', 'Close leaderboard');
    close.addEventListener('click', () => this.onClose?.());
    this.root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation(); // (and no further: past here it would be the Esc menu's under it, back to the game)
        this.onClose?.();
      } else if (e.key === 'Tab') {
        const focusable = [...this.root.querySelectorAll('button:not(:disabled):not([hidden])')].filter((b) => b.offsetParent !== null);
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    });
    this.root.addEventListener('pointerdown', (e) => {
      if (e.button === 0 && (e.target === bg || e.target === this.root)) this.onClose?.();
    });

    const seg = el('div', 'set-seg lb-lists', frame);
    this.listBtns = LISTS.map(([id, label]) => {
      const b = el('button', 'seg-btn', seg, label);
      b.type = 'button';
      b.addEventListener('click', () => this._choose(id, this.sort));
      return b;
    });

    const table = el('div', 'lb-table', frame);
    const hd = el('div', 'lb-row lb-hd', table);
    el('span', 'lb-rank', hd, '#');
    el('span', 'lb-name', hd, 'Player');
    this.sortBtns = BOARD_ORDER.map((k) => {
      const [label, ico, what] = COLS[k];
      const b = el('button', 'lb-col', hd);
      b.type = 'button';
      b.title = what;
      svgEl('i', 'lb-ico', b, glyph(ico));
      el('span', '', b, label);
      b.addEventListener('click', () => this._choose(this.list, k));
      return b;
    });
    // you: your place, the gap to the next one, your places in the other stats
    const you = (this.you = el('div', 'lb-you', table));
    const top = el('div', 'lb-you-top', you);
    this.youRank = el('b', 'lb-you-rank', top, '');
    this.youWhat = el('span', 'lb-you-what', top, '');
    this.youVal = el('b', 'lb-you-val', top, '');
    this.youGap = el('div', 'lb-you-gap', you);
    this.youGapText = el('span', '', this.youGap, '');
    this.youBar = el('i', 'lb-you-bar', this.youGap);
    this.youFill = el('i', '', this.youBar);
    this.youNext = el('span', 'lb-you-next', this.youGap, '');
    this.youOthers = el('div', 'lb-you-others', you);
    this.body = el('div', 'lb-body', table);
    this.note = el('div', 'lb-note', table, '');
    // your own row, under the list, when the list does not reach down to it
    this.mine = el('div', 'lb-mine', table);

    const keys = el('div', 'map-keys', frame);
    for (const [k, t, lobbyOnly = false] of [
      [() => bindLabel('board'), 'close'], // (its keybind: game/binds.js)
      ['Esc', 'close', true],
      ['LMB', 'sort by a column'],
    ]) {
      const s = el('span', 'gh', keys);
      if (lobbyOnly) this.lobbyCloseHint = s;
      else if (typeof k === 'function') this.gameCloseHint = s;
      if (typeof k === 'function') liveText(el('span', 'kbd sm', s), k);
      else el('span', 'kbd sm', s, k);
      el('span', '', s, t);
    }
    this.lobbyCloseHint.hidden = true;
    this._render();
  }

  setOpen(open) {
    open = !!open;
    if (open === this.open) return;
    this.open = open;
    if (open) sheetCame(this.root);
    else sheetLeft();
    this.root.hidden = !open;
    // (the card in the middle hides the HUD behind it; the side sheet leaves the fight in view)
    this.ui.root.classList.toggle('board-open', open && this.lobbyMode);
    if (!open) undock(this.ui);
    if (open) {
      this.returnFocus = document.activeElement;
      this.close.focus({ preventScroll: true, focusVisible: false }); // (no ring on it: it was opened, not tabbed to)
    } else if (this.returnFocus?.isConnected && !this.returnFocus.closest?.('[hidden]')) {
      this.returnFocus.focus({ preventScroll: true });
      this.returnFocus = null;
    }
  }

  // data: { total, rows: [{ name, me, here, kills, nights, wins, revives, ranks | null }] }, null: none yet
  set(data) {
    this.data = data || null;
    this.error = '';
    this._render();
  }

  setError(text) {
    this.data = null;
    this.error = text || 'Could not load the leaderboard.';
    this._render();
  }

  // On the splash there is no current game, so only the all-time list applies. The in-game choice is restored when
  // the modal closes and the regular socket-backed board takes over again.
  setLobbyMode(on) {
    on = !!on;
    if (on === this.lobbyMode) return;
    this.lobbyMode = on;
    if (on) {
      this.savedList = this.list;
      this.list = 'all';
    } else this.list = this.savedList;
    this.listBtns[1].hidden = on;
    this.root.classList.toggle('lb-sheet', !on);
    this.tabs.root.hidden = on;
    this.gameCloseHint.hidden = on;
    this.lobbyCloseHint.hidden = !on;
    this.close.title = on ? 'Close (Esc)' : `Close (${bindLabel('board')})`;
    this.key = '';
    this._render();
  }

  _choose(list, sort) {
    this.list = list;
    this.sort = sort;
    lsSet(STORE, `${list}:${sort}`);
    this._render();
  }

  _row(parent, rank, row) {
    const r = el('div', 'lb-row' + (row.me ? ' me' : ''), parent);
    el('span', 'lb-rank', r, rank ? String(rank) : '–');
    const name = el('span', 'lb-name', r);
    el('span', 'lb-lv', name, String(row.level || 1)).title = `Level ${row.level || 1}`;
    el('span', 'lb-nm', name, row.name);
    if (row.me) el('span', 'lb-tag', name, 'you');
    else if (row.here && this.list === 'all') el('span', 'lb-tag here', name, 'in this game');
    for (const k of BOARD_ORDER) el('span', 'lb-val' + (k === this.sort ? ' on' : ''), r, num(row[k]));
  }

  // The "you" block, from what the server sends: your row with your place in every stat (its ranks: how many are
  // ahead of you, plus one), and the best BOARD_TOP in every stat. So the next place up is known for certain while
  // everyone ahead of you is on the list; further down, the gap is to the last place on the board.
  _you(d) {
    const me = d?.rows.find((r) => r.me);
    this.you.hidden = !me;
    if (!me) return;
    const k = this.sort;
    const i = BOARD_STATS.indexOf(k);
    const what = COLS[k][0].toLowerCase();
    const mine = me[k] | 0;
    const rank = me.ranks?.[i] | 0;
    this.youRank.textContent = rank ? `#${num(rank)}` : '#–';
    this.youWhat.textContent = rank ? `your place in ${what}` : `no ${what} on record yet`;
    this.youVal.textContent = num(mine);
    const ahead = d.rows.filter((r) => !r.me && r[k] > mine).sort((a, b) => a[k] - b[k] || a.name.localeCompare(b.name));
    let text = '';
    let next = '';
    let fill = -1;
    if (rank === 1) {
      const second = d.rows.filter((r) => !r.me && r[k] > 0 && r[k] <= mine).sort((a, b) => b[k] - a[k])[0];
      text = second ? (second[k] === mine ? `Level with ${second.name} at the top` : `Top of the board, ${num(mine - second[k])} ahead of ${second.name}`) : 'Top of the board';
    } else if (rank && ahead.length === rank - 1 && ahead.length) {
      const t = ahead[0];
      text = `${num(t[k] - mine + 1)} more to pass ${t.name}`;
      next = `#${num(rank - 1)}`;
      fill = mine / t[k];
    } else if (rank > BOARD_TOP) {
      const board = d.rows.filter((r) => r[k] > 0).sort((a, b) => b[k] - a[k]);
      const last = board[BOARD_TOP - 1];
      if (last && last[k] > mine) {
        text = `${num(last[k] - mine + 1)} more to make the top ${BOARD_TOP}`;
        next = `#${BOARD_TOP}`;
        fill = mine / last[k];
      }
    } else if (!rank) text = `Your first ${what.replace(/s$/, '')} puts you on the board`;
    this.youGap.hidden = !text;
    this.youGapText.textContent = text;
    this.youGap.classList.toggle('solo', fill < 0);
    this.youBar.hidden = fill < 0;
    if (fill >= 0) this.youFill.style.transform = `scaleX(${Math.max(0.02, Math.min(1, fill)).toFixed(3)})`;
    this.youNext.textContent = next;
    this.youNext.hidden = !next;
    // your places in the other stats: a click picks that stat
    this.youOthers.textContent = '';
    BOARD_ORDER.forEach((s) => {
      if (s === k) return;
      const j = BOARD_STATS.indexOf(s); // (ranks come in the wire's order)
      const b = el('button', 'lb-you-other', this.youOthers);
      b.type = 'button';
      b.title = `Sort by ${COLS[s][0].toLowerCase()}`;
      el('span', '', b, COLS[s][0]);
      el('b', '', b, me.ranks?.[j] ? `#${num(me.ranks[j])}` : '–');
      b.addEventListener('click', () => this._choose(this.list, s));
    });
  }

  _render() {
    const d = this.data;
    const k = this.sort;
    // (set() comes every few seconds while the board is open: the rows are only rebuilt when something on them moved)
    const key = JSON.stringify([this.list, k, d, this.error]);
    if (key === this.key) return;
    this.key = key;
    this.listBtns.forEach((b, i) => b.classList.toggle('on', LISTS[i][0] === this.list));
    this.sortBtns.forEach((b, i) => b.classList.toggle('on', BOARD_ORDER[i] === k));
    this.body.textContent = '';
    this.mine.textContent = '';
    this.mine.hidden = true;
    this._you(d);
    this.count.textContent = d ? `${num(d.total)} ${d.total === 1 ? 'player' : 'players'} on record` : '';
    if (!d) {
      this.note.textContent = this.error || 'Asking the server…';
      this.note.hidden = false;
      return;
    }
    const all = this.list === 'all';
    const me = d.rows.find((r) => r.me) || null;
    // everyone on record: the best BOARD_TOP with anything in this column. This game: whoever is in it
    const rows = d.rows
      .filter((r) => (all ? r[k] > 0 : r.here))
      .sort((a, b) => b[k] - a[k] || a.name.localeCompare(b.name))
      .slice(0, all ? BOARD_TOP : undefined);
    // equal scores share a place, as in the place the server gives us for our own row
    let rank = 0;
    rows.forEach((row, i) => {
      if (!i || row[k] !== rows[i - 1][k]) rank = i + 1;
      this._row(this.body, rank, row);
    });
    this.note.hidden = rows.length > 0;
    if (!rows.length) this.note.textContent = all ? `Nobody has any ${COLS[k][0].toLowerCase()} on record yet.` : 'Nobody in this game is on the board.';
    if (all && me && !rows.includes(me)) {
      this.mine.hidden = false;
      this._row(this.mine, me.ranks[BOARD_STATS.indexOf(k)], me);
    }
  }
}
