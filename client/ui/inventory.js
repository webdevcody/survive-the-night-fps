// Inventory / crafting screen (I). The game does not pause while it is open (the survivor stands still while the world
// goes on), so everything here is one click or one key away. Laid out to fit any window (issue #224, ux-inventory.css):
// - a header across the top: the tabs of the kit screens (screentabs.js: Inventory, Perks [P], Achievements [U]), the
//   HUD's clock while the screen is open, the close
// - "Your kit": the loadout as a strip of tiles in hotbar order (each gun with its own ammunition), what is worn beside
//   it; Quick use (every heal and drink carried, one click each, the one [H] takes marked) and the ammo reserve (only
//   the calibres carried, each with the gun that fires it); then the backpack, in labelled sections with names under
//   the icons (no search: players never used it). A click selects (the item card at the foot says what it is, compares
//   a gun or a vest with the one you hold, and has the buttons), a double-click does the main thing, a right click
//   opens a menu of drop amounts. The same keys work on whatever is under the pointer or selected:
//   F use / equip · S split · G drop one (Shift+G all) · X salvage. A drop can be taken back for a few seconds (Z).
// - crafting (crafting.js), "For what you carry" first
// A small or zoomed window (COMPACT) shows one of the two panels at a time, with tabs that Q / E switch.
// The grid always has INVENTORY_MAX cells: the last BACKPACK_SLOTS of them only exist while a backpack is worn. (The car
// supplies are on the HUD's objective tracker and the map, not in here.)
import './ux-inventory.css';
import { ITEM_DEFS, WEAPONS, SALVAGE, isFirearm, AMMO_NAMES, AMMO_ITEMS, SCHEM_BIT } from '../../shared/defs.js';
import { INVENTORY_SIZE, INVENTORY_MAX, inventoryCap } from '../../shared/constants.js';
import { SALVAGE_FROM, WORN, WORN_DO } from '../../shared/protocol.js';
import { canPair, isDual } from '../../shared/akimbo.js';
import { el, svgEl, button, clamp, replay } from './dom.js';
import { itemIcon, glyph } from './icons.js';
import { actionsOf } from '../game/binds.js';
import { CAT_LABEL } from './iteminfo.js';
import { Crafting } from './crafting.js';
import { ScreenTabs, screenCame } from './screentabs.js';
import { addMethods } from './mixin.js';
import { Tooltip } from './inventory/tooltip.js';
import { kitMethods } from './inventory/kit.js';
import { backpackMethods } from './inventory/backpack.js';
import { cardMethods } from './inventory/card.js';
import { menuMethods } from './inventory/menu.js';
import { dragMethods } from './inventory/drag.js';
import { popoverMethods } from './inventory/popovers.js';

const UNDO_TIME = 5; // s the undo toast offers to take a drop back (the server allows a little more: UNDO_DROP_TIME)
// One panel at a time, with tabs, below this (CSS px, so it follows the browser's zoom): the two side by side need
// about 1,100 px across, and the backpack a few rows of height (1280 x 720 at 125% zoom is 1024 x 576: one at a
// time). ux-inventory.css keys off the class it sets
const COMPACT = '(max-width: 1099px), (max-height: 619px)';

// what a double-click (or F) does with a backpack stack, by category
const MAIN_OF = { cons: 'Use', weapon: 'Equip', throw: 'Equip', armor: 'Wear', pack: 'Wear' };

// keys that open or shut a screen are the game's even here (passesMenus in game/input.js)
const MENU_KEYS = new Set(['inventory', 'perks', 'achievements', 'map', 'board', 'players', 'chat']);
const menuKey = (code) => actionsOf(code).some((a) => MENU_KEYS.has(a));

// ---------------------------------------------------------------- inventory screen
export class Inventory {
  constructor(ui, parent, tipParent) {
    this.ui = ui;
    this.open = false;
    this.inv = { slots: new Array(INVENTORY_MAX).fill(null), armor: null, backpack: 0, cap: INVENTORY_SIZE, ammo: AMMO_ITEMS.map(() => 0), weapons: [0, 0, 0, 0, 0], mags: [0, 0], dual: 0, throwCounts: {} };
    this.counts = {};
    this.near = { fire: false, bench: false };
    this.unlocked = 0;
    this.tip = new Tooltip(tipParent);
    // What the item card is about: { kind: 'slot', i, item } a backpack stack, { kind: 'eq', slot, item } a weapon in
    // its slot, { kind: 'worn', which, item } the armor or backpack worn. null: nothing. The keys act on what is under
    // the pointer (hoverEl) before it
    this.sel = null;
    this.hoverEl = null;
    this.showAllAmmo = false;
    // what the split popover is open on and how much of it is picked: { i, from, item, n, count, anchor }. i: the
    // backpack index, or -1 for a weapon slot or the armor worn; from: the same as ACT.SALVAGE names it (SALVAGE_FROM)
    this.split = null;
    this.splitShut = -1; // `from` of the popover the press now going on has just put away
    this.apop = null; // the ammo popover: { cal, n, anchor }
    this.menu = null; // the right-click menu: { ref }
    this.undoAt = 0; // when the undo toast went up (0: it is down)

    this.vit = { hp: -1, maxHp: 100, stamina: 100, exhausted: false }; // as the HUD last had it (setVitals)
    this.pane = 'kit'; // the panel shown while COMPACT: 'kit' or 'craft'

    const root = (this.root = el('div', 'inv ux-inv', parent));
    root.hidden = true;
    const bg = el('div', 'inv-bg', root);
    const wrap = (this.wrap = el('div', 'inv-wrap', root));

    this._buildHead(wrap);
    this._buildKit(wrap);
    const right = (this.craftCol = el('section', 'inv-col inv-right paper ux-craft', wrap));
    this.craft = new Crafting(this, right);
    this._buildPopovers(root);

    this._bind(root, wrap, bg);
    // small or zoomed in: one panel at a time
    this.mq = matchMedia(COMPACT);
    const fit = () => {
      this.compact = this.mq.matches;
      root.classList.toggle('compact', this.compact);
    };
    this.mq.addEventListener?.('change', fit);
    fit();
    this._setPane('kit');
    this._renderAll();
  }

  // ---- the header: the kit screens' tabs, the HUD's clock and the close (screentabs.js). Nothing else: the screen is
  //      for the kit (health is the HUD's, the level the Perks tab's). Small, the two panels' tabs go in a row under it
  _buildHead(wrap) {
    const head = (this.headEl = el('header', 'ux-head', wrap));
    this.tabs = new ScreenTabs(this.ui, head, 'inventory', () => this.ui.cb.onCloseInventory());
    const panes = (this.paneBar = el('div', 'ux-panes', wrap));
    const pane = (id, label, key) => {
      const b = button('ux-pane', panes);
      b.dataset.pane = id;
      if (key === 'Q') el('span', 'kbd sm', b, key);
      el('span', 'ux-pane-t', b, label);
      const n = el('b', 'ux-pane-n', b, '');
      if (key === 'E') el('span', 'kbd sm', b, key);
      b.addEventListener('click', () => {
        this.ui.sound('ui_click');
        this._setPane(id);
      });
      return { b, n };
    };
    this.paneKit = pane('kit', 'Your kit', 'Q');
    this.paneCraft = pane('craft', 'Crafting', 'E');
  }

  // which panel shows while the window is small (both show otherwise)
  _setPane(id) {
    this.pane = id === 'craft' ? 'craft' : 'kit';
    this.root.classList.toggle('pane-craft', this.pane === 'craft');
    this.paneKit.b.classList.toggle('on', this.pane === 'kit');
    this.paneCraft.b.classList.toggle('on', this.pane === 'craft');
  }

  _h(parent, title, aside) {
    const h = el('h3', 'inv-h', parent);
    el('span', 'inv-h-t', h, title);
    if (aside) el('span', 'inv-h-aside', h, aside);
    return h;
  }

  _buildPopovers(root) {
    this._buildSplitPop(root);
    this._buildAmmoPop(root);

    // ---- the right-click menu
    this.menuEl = el('div', 'ctx', root);
    this.menuEl.hidden = true;

    // ---- while something is dragged: where to let go of it to put it on the ground
    const dz = (this.dropZone = el('div', 'dropzone', root));
    svgEl('i', 'dz-ico', dz, glyph('arrowRight'));
    el('span', 'dz-t', dz, 'Release to drop on the ground');
    this.dzWhat = el('span', 'dz-what', dz, '');

    // ---- after a drop: what went down, and the key that takes it back. Over the compass, which says nothing while the
    // screen is up (the tooltips' layer is the one above the HUD's top strip)
    const u = (this.undoEl = el('div', 'undo ux-inv-undo', this.tip.root.parentElement));
    u.hidden = true;
    this.undoIco = el('i', 'undo-ico', u);
    this.undoTxt = el('span', 'undo-t', u, '');
    const ub = (this.undoBtn = button('undo-b', u));
    el('span', 'kbd sm', ub, 'Z');
    el('span', '', ub, 'Undo');
    this.undoBar = el('i', 'undo-bar', u);
  }

  // ------------------------------------------------------------ input
  _bind(root, wrap, bg) {
    const cb = this.ui.cb;
    root.addEventListener('contextmenu', (e) => e.preventDefault());
    // a button pressed with the mouse does not keep the focus: Space (craft, or a jump once the screen is shut) must not
    // press it again
    root.addEventListener(
      'mousedown',
      (e) => {
        if (e.target.closest('button')) e.preventDefault();
      },
      true,
    );

    // A press on a stack, a weapon in its slot or something worn: the left button selects it (or drags it), the right
    // one opens its menu. A press on an empty cell lets go of the selection
    wrap.addEventListener('pointerdown', (e) => {
      const t = e.target.closest('.cell, .eq, .armor, .pouch-cal');
      if (!t) return;
      const ref = this._refOf(t);
      if (e.button === 2) {
        e.preventDefault();
        if (ref) this._openMenu(ref, e.clientX, e.clientY);
        return;
      }
      if (e.button !== 0 || t.classList.contains('pouch-cal')) return;
      if (!ref) {
        if (t.classList.contains('cell')) this._select(null);
        return;
      }
      e.preventDefault();
      // (a stack, or a weapon in its slot: those can be dragged. Worn gear and the throwable slot only select)
      const drag = ref.kind === 'slot' || ref.kind === 'eq';
      this.drag = { ref, i: ref.kind === 'slot' ? ref.i : -1, eq: ref.kind === 'eq' ? ref.slot : -1, x: e.clientX, y: e.clientY, started: false, can: drag };
    });
    wrap.addEventListener('dblclick', (e) => {
      const t = e.target.closest('.cell, .eq, .armor');
      const ref = t && this._refOf(t);
      if (ref) this._do('main', ref, false);
    });
    this.pouchEl.addEventListener('click', (e) => {
      const b = e.target.closest('.pouch-cal');
      if (!b) return;
      const cal = +b.dataset.cal;
      if (this.apop?.cal === cal) return this._closeAmmo();
      this.ui.sound('ui_click');
      this._openAmmo(cal, b);
    });

    this._move = (e) => {
      const d = this.drag;
      if (d) {
        if (d.can && !d.started && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5) this._startDrag(d);
        if (d.started) this._dragOver(d, e);
      } else if (!this.tip.root.hidden) this.tip.move(e.clientX, e.clientY);
    };
    this._up = (e) => {
      const d = this.drag;
      if (!d || e.button !== 0) return;
      this.drag = null;
      if (!d.started) {
        // (a click on what is selected lets go of it - but not the second click of a double-click)
        const now = performance.now();
        const again = this._sameRef(d.ref, this.lastClick?.ref) && now - this.lastClick.t < 450;
        this.lastClick = { ref: d.ref, t: now };
        return this._select(d.ref, !again);
      }
      // (what is under it before the drag ends: that takes the drop zone away)
      const t = document.elementFromPoint(e.clientX, e.clientY);
      this._endDrag(d);
      this._drop(d, t);
    };
    window.addEventListener('pointermove', this._move);
    window.addEventListener('pointerup', this._up);

    // what is under the pointer: the hotkeys act on it, and a slim tooltip names it
    wrap.addEventListener('pointerover', (e) => {
      const t = e.target.closest('.cell, .eq, .armor, .pouch-cal');
      if (t === this.hoverEl) return;
      this.hoverEl = t;
      this._showTip(t, e.clientX, e.clientY);
    });
    wrap.addEventListener('pointerleave', () => {
      this.hoverEl = null;
      this.tip.hide();
    });

    // The popovers and the menu. A press anywhere else puts them away, and goes on to do whatever it does there
    // (captured: the grid's own handler comes after, and must find them closed)
    root.addEventListener(
      'pointerdown',
      (e) => {
        this.splitShut = -1;
        if (this.menu && !this.menuEl.contains(e.target)) {
          this._closeMenu();
          this.splitShut = 0x100; // (only closes it)
        }
        if (this.apop && !this.apEl.contains(e.target) && !e.target.closest('.pouch-cal')) this._closeAmmo();
        if (!this.split || this.splitEl.contains(e.target)) return;
        this.splitShut = this.split.from;
        this._closeSplit();
      },
      true,
    );
    // a left press on the backdrop (around the panels, or in the gaps between them) closes the screen. Not the press
    // that has just put a popover or the menu away: that one only closes it
    root.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || this.splitShut >= 0) return;
      if (e.target === bg || e.target === wrap || e.target === root) this.ui.cb.onCloseInventory();
    });

    this._bindPopovers();

    this.menuEl.addEventListener('click', (e) => {
      const b = e.target.closest('.ctx-item');
      if (!b || b.disabled) return;
      const it = this.menu?.items[+b.dataset.k];
      const ref = this.menu?.ref;
      this._closeMenu();
      if (it && ref) it.run();
    });

    this.throwAlt.addEventListener('click', (e) => {
      const b = e.target.closest('.tw');
      if (b) {
        this.ui.sound('ui_click');
        cb.onSelectThrowable(+b.dataset.item);
      }
    });
    this.throwAlt.addEventListener('pointerdown', (e) => e.target.closest('.tw') && e.stopPropagation());
    this.throwAlt.addEventListener('dblclick', (e) => e.stopPropagation());
    this.undoBtn.addEventListener('click', () => this._undo());

    // The screen's keys, on what is under the pointer or else what is selected. Never from a text field (they keep
    // their keydowns, and isTyping() counts them too), never a key that opens or shuts a screen
    this._key = (e) => {
      if (!this.open || this.ui.isTyping() || e.ctrlKey || e.metaKey || e.altKey || menuKey(e.code)) return;
      if (e.code === 'Escape') {
        if (this.menu) this._closeMenu();
        else this.ui.cb.onCloseInventory(); // (a selection is no reason to stay: Esc puts the inventory away)
        return;
      }
      if (e.repeat) return;
      if (e.code === 'KeyZ' && this.undoAt) {
        e.preventDefault();
        return this._undo();
      }
      // (small: Q / E switch between the two panels instead of the crafting tabs)
      if (this.compact && (e.code === 'KeyQ' || e.code === 'KeyE')) {
        e.preventDefault();
        const to = e.code === 'KeyQ' ? 'kit' : 'craft';
        if (to !== this.pane) this.ui.sound('ui_click');
        return this._setPane(to);
      }
      if (this.craft.key(e)) return void e.preventDefault();
      const act = { KeyF: 'main', KeyS: 'split', KeyG: e.shiftKey ? 'dropAll' : 'drop', KeyX: 'salvage' }[e.code];
      if (!act) return;
      const ref = (this.hoverEl && this._refOf(this.hoverEl)) || this.sel;
      if (!ref) return;
      e.preventDefault();
      this._closeMenu();
      this._do(act, ref, true);
    };
    window.addEventListener('keydown', this._key);
  }

  // ------------------------------------------------------------ what an element stands for, and what it can do
  _refOf(t) {
    const inv = this.inv;
    if (t.classList.contains('cell')) {
      const i = +t.dataset.i;
      const s = inv.slots[i];
      return s && i < inv.cap ? { kind: 'slot', i, item: s.item } : null;
    }
    if (t.classList.contains('eq')) {
      const slot = +t.dataset.slot;
      const item = inv.weapons[slot] | 0;
      if (!item) return null;
      // (the throwable slot only points at a stack in the backpack: that is what it stands for)
      if (slot === 3) {
        const i = inv.slots.findIndex((s, k) => s && s.item === item && k < inv.cap);
        return i >= 0 ? { kind: 'slot', i, item } : null;
      }
      return { kind: 'eq', slot, item };
    }
    if (t === this.armEl) return inv.armor ? { kind: 'worn', which: WORN.ARMOR, item: inv.armor.item } : null;
    if (t === this.packEl) return inv.backpack ? { kind: 'worn', which: WORN.BACKPACK, item: inv.backpack } : null;
    if (t.classList.contains('pouch-cal')) {
      const cal = +t.dataset.cal;
      return inv.ammo[cal] > 0 ? { kind: 'ammo', cal, item: AMMO_ITEMS[cal] } : null;
    }
    return null;
  }

  _sameRef(a, b) {
    return !!a && !!b && a.kind === b.kind && a.item === b.item && a.i === b.i && a.slot === b.slot && a.which === b.which && a.cal === b.cal;
  }

  // the backpack's extra pockets hold something: the backpack does not come off
  _pocketsUsed() {
    return this.inv.slots.filter((x, i) => x && i >= INVENTORY_SIZE).length;
  }

  // What each action is for a ref: { label, ok } (ok: it can be done now), or null where it does not apply
  _acts(ref) {
    const inv = this.inv;
    const s = ref.kind === 'slot' ? inv.slots[ref.i] : null;
    const cat = ITEM_DEFS[ref.item]?.cat;
    const salv = !!SALVAGE[ref.item];
    if (ref.kind === 'slot') {
      let main = MAIN_OF[cat];
      let ok = !!main;
      // a second one of the gun in its slot is put on beside it as a pair (shared/akimbo.js): one more than two, no
      const slot = WEAPONS[ref.item]?.slot;
      if (canPair(ref.item) && inv.weapons[slot] === ref.item) {
        ok = !isDual(inv, slot);
        main = ok ? 'Dual wield' : 'Equip';
      }
      return {
        main: { label: main || 'Use', ok },
        split: { label: 'Split', ok: s.count > 1 },
        drop: { label: s.count > 1 ? 'Drop 1' : 'Drop', ok: true },
        dropAll: { label: `Drop all ${s.count}`, ok: s.count > 1 },
        salvage: { label: 'Salvage', ok: salv },
      };
    }
    if (ref.kind === 'eq') {
      const one = isDual(inv, ref.slot) ? ' one' : ''; // (out of a pair one gun goes, and the other stays in the hand)
      return { main: { label: `Put${one} in pack`, ok: true }, split: null, drop: { label: `Drop${one}`, ok: true }, dropAll: null, salvage: { label: one ? 'Salvage one' : 'Salvage', ok: salv } };
    }
    if (ref.kind === 'worn') {
      const pack = ref.which === WORN.BACKPACK;
      const ok = !pack || !this._pocketsUsed();
      return { main: { label: 'Take off', ok }, split: null, drop: { label: 'Drop', ok }, dropAll: null, salvage: { label: 'Salvage', ok: ok && salv } };
    }
    const v = inv.ammo[ref.cal] | 0;
    return { main: { label: 'Amount…', ok: v > 0 }, split: null, drop: { label: 'Drop 1', ok: v > 0 }, dropAll: { label: `Drop all ${v}`, ok: v > 1 }, salvage: null };
  }

  // Do `act` (main / split / drop / dropAll / salvage) to ref. key: from a key (a refusal says nothing then)
  _do(act, ref, key) {
    const a = this._acts(ref)[act];
    const cb = this.ui.cb;
    if (!a || !a.ok) {
      if (!key) this._nudge(ref);
      return;
    }
    if (act === 'main') {
      if (ref.kind === 'slot') return this._useSlot(ref.i);
      this.ui.sound('ui_click');
      if (ref.kind === 'eq') return cb.onUnequip(ref.slot, 255);
      if (ref.kind === 'worn') return cb.onWorn(ref.which, WORN_DO.OFF);
      return this._openAmmo(ref.cal, this.calEls[ref.cal].b);
    }
    if (act === 'split') return this._openSplit(ref.i);
    if (act === 'drop' || act === 'dropAll') return this._dropRef(ref, act === 'dropAll' ? 0 : 1);
    if (act === 'salvage') {
      if (ref.kind === 'slot') return this._openSplit(ref.i, true);
      if (ref.kind === 'eq') return this._openSalvage(SALVAGE_FROM.WEAPON + ref.slot, ref.item, this.eqEls[ref.slot].r);
      if (ref.which === WORN.ARMOR) return this._openSalvage(SALVAGE_FROM.ARMOR, ref.item, this.armEl);
      this.ui.sound('ui_click');
      return cb.onWorn(WORN.BACKPACK, WORN_DO.SALVAGE);
    }
  }

  // n of ref on the ground (0: all of it), and the undo toast up for it
  _dropRef(ref, n) {
    const inv = this.inv;
    const cb = this.ui.cb;
    this.ui.sound('ui_click');
    if (ref.kind === 'slot') {
      const s = inv.slots[ref.i];
      if (!s) return;
      cb.onDropItem(ref.i, n);
      this._dropped(s.item, n === 0 ? s.count : Math.min(n, s.count));
    } else if (ref.kind === 'eq') {
      cb.onDropWeapon(ref.slot);
      this._dropped(ref.item, 1);
    } else if (ref.kind === 'worn') {
      cb.onWorn(ref.which, WORN_DO.DROP);
      this._dropped(ref.item, 1);
    } else {
      const v = inv.ammo[ref.cal] | 0;
      if (v <= 0) return;
      cb.onDropAmmo(ref.cal, n === 0 ? 0 : Math.min(n, v));
      this._dropped(ref.item, n === 0 ? v : Math.min(n, v));
    }
  }

  // what cannot be done to it: the thing it is shakes
  _nudge(ref) {
    const e = ref.kind === 'slot' ? this.cells[ref.i]?.c : ref.kind === 'eq' ? this.eqEls[ref.slot].r : ref.kind === 'worn' ? (ref.which === WORN.ARMOR ? this.armEl : this.packEl) : this.calEls[ref.cal]?.b;
    if (!e) return;
    e.getAnimations().forEach((a) => a.cancel());
    e.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-3px)' }, { transform: 'translateX(3px)' }, { transform: 'translateX(0)' }], { duration: 200 });
  }

  _useSlot(i) {
    const s = this.inv.slots[i];
    if (!s) return;
    const cat = ITEM_DEFS[s.item]?.cat;
    const cb = this.ui.cb;
    if (cat === 'armor' || cat === 'pack') {
      this.ui.sound('ui_click');
      cb.onEquipArmor(i);
    } else if (cat === 'cons' || cat === 'weapon' || cat === 'throw') {
      this.ui.sound('ui_click');
      cb.onUseItem(i);
    } else this._nudge({ kind: 'slot', i });
  }

  // ------------------------------------------------------------ selection and the item card
  // ref: what to select (null: nothing). toggle: a click on what is selected already lets go of it
  _select(ref, toggle = false) {
    if (toggle && this._sameRef(ref, this.sel)) ref = null;
    if (ref?.kind === 'ammo') ref = null;
    if (this._sameRef(ref, this.sel) || (!ref && !this.sel)) return;
    this.sel = ref;
    this.craft.setItemFocus(ref?.item || 0);
    this._renderMarks();
    this._renderCard();
    // (small: the card slides up over the foot of the backpack - the grid scrolls clear of it, the stack kept in view)
    if (this.compact && ref) {
      this.kitCol.style.setProperty('--sheet', this.cardEl.offsetHeight + 12 + 'px');
      if (ref.kind === 'slot') this.cells[ref.i].c.scrollIntoView({ block: 'nearest' });
    }
  }

  // the selection against the inventory as the server last left it: a stack that moved is followed (a sort, a swap), one
  // that is gone is let go of
  _syncSel() {
    const r = this.sel;
    if (!r) return;
    const inv = this.inv;
    let next = r;
    if (r.kind === 'slot') {
      if (inv.slots[r.i]?.item !== r.item) {
        const i = inv.slots.findIndex((s, k) => s && s.item === r.item && k < inv.cap);
        next = i >= 0 ? { ...r, i } : null;
      }
    } else if (r.kind === 'eq') {
      if ((inv.weapons[r.slot] | 0) !== r.item) next = null;
    } else if (r.kind === 'worn') {
      if ((r.which === WORN.ARMOR ? inv.armor?.item : inv.backpack) !== r.item) next = null;
    }
    if (next !== r) {
      this.sel = next;
      this.craft.setItemFocus(next?.item || 0);
    }
  }

  // ------------------------------------------------------------ tooltip
  _showTip(t, x, y) {
    if (!t || this.drag?.started || this.split || this.apop || this.menu) return this.tip.hide();
    const ref = this._refOf(t);
    if (!ref) return this.tip.hide();
    const d = ITEM_DEFS[ref.item];
    let hint = '';
    if (ref.kind === 'ammo') hint = `${this.inv.ammo[ref.cal]} carried · click for an amount`;
    else if (ref.kind === 'slot') hint = MAIN_OF[d.cat] ? `Double-click to ${MAIN_OF[d.cat].toLowerCase()} · right-click for more` : 'Right-click for more';
    else if (ref.kind === 'eq') hint = 'Double-click or drag into the pack · right-click for more';
    else hint = 'Double-click to take off · right-click for more';
    this.tip.show({ name: d.name, cat: CAT_LABEL[d.cat], catCls: 'c-' + d.cat, hint }, x, y);
  }

  // can a recipe be made right now (the crafting column's word for it)
  _craftable(rec) {
    const c = this.craft.byId.get(rec.id);
    return !!c && c.group === 'ready' && c.max > 0;
  }

  // the guns that fire a calibre: the ones in their slots (held), and the ones in the backpack
  _gunsFor(cal) {
    const inv = this.inv;
    const fires = (id) => isFirearm(id) && WEAPONS[id].ammo === cal;
    const held = [inv.weapons[0], inv.weapons[1]].filter((id) => id && fires(id));
    const packed = [...new Set(inv.slots.filter((s, i) => s && i < inv.cap && fires(s.item)).map((s) => s.item))];
    return { held, packed };
  }

  // ------------------------------------------------------------ undo
  // A drop has just gone down: say what, and offer to take it back for UNDO_TIME
  _dropped(item, n) {
    if (!item || n <= 0) return;
    this.undoIco.innerHTML = itemIcon(item);
    const d = ITEM_DEFS[item];
    this.undoTxt.textContent = `Dropped ${d.cat === 'ammo' ? `${n} ${AMMO_NAMES[d.ammo]} rounds` : d.name + (n > 1 ? ' ×' + n : '')} at your feet`;
    this.undoEl.hidden = false;
    this.undoAt = performance.now();
    const bar = this.undoBar;
    bar.getAnimations().forEach((a) => a.cancel());
    bar.animate([{ transform: 'scaleX(1)' }, { transform: 'scaleX(0)' }], { duration: UNDO_TIME * 1000, easing: 'linear' });
    clearTimeout(this.undoT);
    this.undoT = setTimeout(() => this._hideUndo(), UNDO_TIME * 1000);
  }

  _undo() {
    if (!this.undoAt) return;
    this.ui.sound('ui_click');
    this.ui.cb.onUndoDrop();
    this._hideUndo();
  }

  _hideUndo() {
    clearTimeout(this.undoT);
    this.undoAt = 0;
    this.undoEl.hidden = true;
  }

  // ------------------------------------------------------------ data
  set(inv) {
    if (!inv) return;
    const slots = inv.slots || [];
    this.inv = {
      slots: Array.from({ length: INVENTORY_MAX }, (_, i) => (slots[i] && slots[i].item ? { item: slots[i].item, count: slots[i].count | 0 } : null)),
      armor: inv.armor && inv.armor.item ? inv.armor : null,
      backpack: inv.backpack | 0,
      cap: inventoryCap(inv.backpack),
      ammo: inv.ammo || AMMO_ITEMS.map(() => 0),
      weapons: inv.weapons || [0, 0, 0, 0, 0],
      mags: inv.mags || [0, 0],
      dual: inv.dual | 0,
      throwCounts: inv.throwCounts || {},
    };
    this.counts = {};
    for (const s of this.inv.slots) if (s) this.counts[s.item] = (this.counts[s.item] || 0) + s.count;
    this._syncSel();
    this._renderAll();
    this._syncSplit();
    this._syncAmmo();
    if (this.menu && !this._refStill(this.menu.ref)) this._closeMenu();
  }

  _refStill(ref) {
    const inv = this.inv;
    if (ref.kind === 'slot') return inv.slots[ref.i]?.item === ref.item;
    if (ref.kind === 'eq') return (inv.weapons[ref.slot] | 0) === ref.item;
    if (ref.kind === 'ammo') return inv.ammo[ref.cal] > 0;
    return (ref.which === WORN.ARMOR ? inv.armor?.item : inv.backpack) === ref.item;
  }

  _renderAll() {
    this._renderGrid();
    this._renderLoadout();
    this._renderWorn();
    this._renderPouch(false);
    this._renderQuick();
    this._renderCard();
    this.craft.render();
    this.renderUses();
  }

  // Health and stamina as the HUD has them ({ hp, maxHp, stamina, exhausted }: ui.updateHud, every frame): not drawn
  // here, but Quick use marks the heal [H] takes and crafting names a heal while hurt
  setVitals(h) {
    if (!h || h.hp == null) return;
    // (kept for when the screen opens: nothing is drawn behind a closed one)
    if (!this.open) {
      const l = (this.vitLast ||= {});
      l.hp = h.hp;
      l.maxHp = h.maxHp;
      l.stamina = h.stamina;
      l.exhausted = h.exhausted;
      return;
    }
    const hp = Math.max(0, Math.ceil(h.hp));
    const maxHp = h.maxHp || 100;
    const st = Math.round(clamp((h.stamina ?? 100) / 100, 0, 1) * 100);
    const v = this.vit;
    if (v.hp === hp && v.maxHp === maxHp && v.stamina === st && v.exhausted === !!h.exhausted) return;
    const hpMoved = v.hp !== hp || v.maxHp !== maxHp;
    Object.assign(v, { hp, maxHp, stamina: st, exhausted: !!h.exhausted });
    if (!hpMoved) return;
    this._renderQuick();
    this.craft.render(); // ("For what you carry" names a heal while hurt)
  }

  schemOk(item) {
    return !!(this.unlocked & (1 << SCHEM_BIT[item]));
  }

  // ctx = { fire, bench, unlocked }
  setCraftContext(ctx) {
    const near = { fire: !!ctx?.fire, bench: !!ctx?.bench };
    const unlocked = ctx?.unlocked ?? this.unlocked;
    if (near.fire === this.near.fire && near.bench === this.near.bench && unlocked === this.unlocked) return;
    this.near = near;
    this.unlocked = unlocked;
    this.craft.render();
    this._renderCard();
    this._syncAmmo();
  }

  setOpen(open) {
    open = !!open;
    if (open === this.open) return;
    this.open = open;
    this.root.hidden = !open;
    if (open) {
      replay(this.root, 'in');
      screenCame(this.root); // (from another tab: no animation in)
      this.tabs.sync();
      this.tabs.holdClock(true);
      if (this.vitLast) this.setVitals(this.vitLast);
      this.craft.render();
    } else {
      this.tabs.holdClock(false);
      // a focused field would keep ui.isTyping() true and swallow gameplay keys
      const a = document.activeElement;
      if (a && this.root.contains(a)) a.blur();
      this.craft.dropBulk();
      this._closeSplit();
      this._closeAmmo();
      this._closeMenu();
      this._hideUndo();
      this.tip.hide();
      this.hoverEl = null;
      if (this.drag) {
        this._endDrag(this.drag);
        this.drag = null;
      }
    }
  }
}

for (const methods of [kitMethods, backpackMethods, cardMethods, menuMethods, dragMethods, popoverMethods]) addMethods(Inventory, methods);
