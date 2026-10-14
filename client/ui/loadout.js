// The loadout panel: the permanent items an account (or a guest's browser) owns, and the three slots that take them
// into a run. The items' words are in loadoutinfo.js; the service is client/net/loadout.js.
// Left: the three slots and the chosen item (what it does, where it drops, equip). Right: the collection, owned items
// first, then the ones still to find grouped by where they drop. Pressing an empty slot arms it: the next owned item
// pressed goes into it.
import { LOADOUT_CATALOG, LOADOUT_RARITY, LOADOUT_RARITY_NAMES, LOADOUT_SLOTS, LOADOUT_TYPES, loadoutDef, loadoutTypeName } from '../../shared/loadout.js';
import { SKULLS } from '../../shared/economy.js';
import { el, svgEl, button, iconButton, lsGet, lsSet } from './dom.js';
import { glyph } from './icons.js';
import { Panel } from './panel.js';
import { fetchLoadout, saveLoadout } from '../net/loadout.js';
import { accountState } from '../net/account.js';
import { bestiaryView } from '../net/bestiary.js';
import { loadoutCounts, loadoutTally, silhouette, sourceText, tallyText } from '../../shared/collections.js';
import { fmtGrant, fmtMods, fmtEffects, typeIcon, cleanData, priceText } from './loadoutinfo.js';

const MISSING_KEY = 'stn.loadout.missing'; // '0': the "still to find" list folded away

export class LoadoutPanel extends Panel {
  constructor(ui, parent) {
    super(ui, parent, 'lo-panel', 'Loadout');
    this.data = null;
    this.selected = ''; // an owned item's id, or `cat:<catalog id>` for one not found yet
    this.target = -1; // the empty slot pressed: the next owned item pressed goes into it
    this.typeFilter = 'all';
    this.rarityFilter = 0;
    this.sort = 'rarity';
    this.showMissing = lsGet(MISSING_KEY, '1') !== '0'; // the items not found yet, after the owned ones (issue #286)
    this.busy = false;
    this.err = '';
    this.root.classList.add('loadout-panel');
    this.sub.textContent = 'Equipped items join you at the start of every run';
    this.balance = el('span', 'lo-balance', null);
    this.balance.title = `${SKULLS.NAME}: spent and earned at the auction house`;
    this.sub.after(this.balance);
    this.foot.remove(); // (the cross, Esc and a press outside close it; a failed load offers its own retry)

    // the left column: what goes into the next run, and the item in hand
    const side = el('div', 'lo-side', this.body);
    const slotHead = el('div', 'lo-head', side);
    el('h3', 'lo-h', slotHead, 'Your loadout');
    this.slotCount = el('span', 'lo-hcount', slotHead);
    this.slotBox = el('div', 'lo-slots', side);
    // a guest with something to lose (where there are accounts to keep it on): their browser's id is the only key to
    // it, and goes with the browser's data (client/net/identity.js)
    this.guest = el('div', 'ach-note lo-guest', side);
    this.guest.hidden = true;
    el('span', '', this.guest, 'Kept in this browser only. Sign in to move your items and Skulls onto your account.');
    const signIn = button('btn btn-ghost', this.guest);
    svgEl('i', 'btn-ico', signIn, glyph('person'));
    el('span', '', signIn, 'Sign in');
    signIn.addEventListener('click', () => {
      this.hide();
      this.ui.accountPanel.show({ after: this });
    });
    this.detail = el('div', 'lo-detail', side);

    // the right column: the collection
    const coll = el('div', 'lo-coll', this.body);
    const collHead = el('div', 'lo-head', coll);
    el('h3', 'lo-h', collHead, 'Collection');
    this.count = el('span', 'lo-hcount', collHead);
    this.controls = el('div', 'lo-controls', coll);
    this.makeControls();
    this.grid = el('div', 'lo-grid', coll);
  }
  show() {
    super.show();
    this.target = -1;
    this.render();
    this.refresh();
  }
  async refresh() {
    if (this.busy) return;
    this.busy = true;
    this.err = '';
    this.render();
    try {
      this.data = cleanData(await fetchLoadout());
      if (!this.selected || (!this.selected.startsWith('cat:') && !this.data.items.some((it) => it.id === this.selected))) this.selected = this.data.slots.find(Boolean) || this.visibleItems()[0]?.id || '';
    } catch (err) {
      this.err = err.message || 'Could not load your collection';
    }
    this.busy = false;
    this.render();
  }
  async save(slots) {
    if (this.busy) return;
    this.busy = true;
    this.err = '';
    this.target = -1;
    this.render();
    try {
      this.data = cleanData(await saveLoadout(slots));
    } catch (err) {
      const msg = err.message || 'That did not save';
      this.busy = false;
      await this.refresh(); // (what the service holds now)
      this.err ||= msg;
    }
    this.busy = false;
    this.render();
  }
  byId() {
    return new Map((this.data?.items || []).map((it) => [it.id, it]));
  }
  slots() {
    return this.data?.slots || Array(LOADOUT_SLOTS).fill(null);
  }
  // put an owned item in slot i (taking it out of any other slot first)
  equip(id, i) {
    const next = this.slots().map((s) => (s === id ? null : s));
    next[i] = id;
    this.selected = id;
    this.save(next);
  }
  unequip(i) {
    const next = this.slots().slice();
    next[i] = null;
    this.save(next);
  }
  makeControls() {
    // the types as a row of chips: one press, and what is there is plain to see
    this.typeRow = el('div', 'lo-types', this.controls);
    this.typeRow.setAttribute('role', 'group');
    this.typeRow.setAttribute('aria-label', 'Type');
    this.typeChips = new Map();
    for (const t of ['all', ...Object.values(LOADOUT_TYPES)]) {
      const b = button('lo-chip', this.typeRow);
      if (t !== 'all') svgEl('i', 'lo-chip-ico', b, glyph(typeIcon({ type: t })));
      el('span', '', b, t === 'all' ? 'All' : loadoutTypeName(t));
      b.addEventListener('click', () => {
        this.typeFilter = t;
        this.render();
      });
      this.typeChips.set(t, b);
    }
    const selects = el('div', 'lo-selects', this.controls);
    const field = (label, select) => {
      const wrap = el('label', 'lo-filter', selects);
      el('span', '', wrap, label);
      wrap.appendChild(select);
    };
    this.raritySel = el('select', '', null);
    for (const [value, label] of [[0, 'Any'], [LOADOUT_RARITY.COMMON, 'Common+'], [LOADOUT_RARITY.RARE, 'Rare+'], [LOADOUT_RARITY.EPIC, 'Epic+'], [LOADOUT_RARITY.LEGENDARY, 'Legendary']]) {
      const o = el('option', '', this.raritySel, label);
      o.value = value;
    }
    this.raritySel.addEventListener('change', () => {
      this.rarityFilter = +this.raritySel.value || 0;
      this.render();
    });
    field('Rarity', this.raritySel);
    this.sortSel = el('select', '', null);
    for (const [value, label] of [['rarity', 'Rarity'], ['type', 'Type'], ['newest', 'Newest']]) {
      const o = el('option', '', this.sortSel, label);
      o.value = value;
    }
    this.sortSel.addEventListener('change', () => {
      this.sort = this.sortSel.value;
      this.render();
    });
    field('Sort', this.sortSel);
  }
  passes(def) {
    return def && (this.typeFilter === 'all' || def.type === this.typeFilter) && (!this.rarityFilter || def.rarity >= this.rarityFilter);
  }
  visibleItems() {
    const items = (this.data?.items || []).filter((owned) => this.passes(loadoutDef(owned.catalog)));
    const cmp = {
      rarity: (a, b) => loadoutDef(b.catalog).rarity - loadoutDef(a.catalog).rarity || loadoutDef(a.catalog).type.localeCompare(loadoutDef(b.catalog).type) || loadoutDef(a.catalog).name.localeCompare(loadoutDef(b.catalog).name) || a.id.localeCompare(b.id),
      type: (a, b) => loadoutDef(a.catalog).type.localeCompare(loadoutDef(b.catalog).type) || loadoutDef(b.catalog).rarity - loadoutDef(a.catalog).rarity || loadoutDef(a.catalog).name.localeCompare(loadoutDef(b.catalog).name) || a.id.localeCompare(b.id),
      newest: (a, b) => (b.acquiredAt || 0) - (a.acquiredAt || 0) || b.id.localeCompare(a.id),
    }[this.sort];
    return items.sort(cmp);
  }
  // the catalog's items not owned yet that the filters let through, rarest first: [def]
  missingDefs() {
    if (!this.data) return [];
    const have = loadoutCounts(this.data.items);
    return LOADOUT_CATALOG.filter((def) => !have.has(def.id) && this.passes(def)).sort((a, b) => b.rarity - a.rarity || a.type.localeCompare(b.type) || a.id - b.id);
  }
  renderSlots(byId = this.byId()) {
    this.slotBox.textContent = '';
    const slots = this.slots();
    this.slotCount.textContent = `${slots.filter((id) => byId.has(id)).length} / ${LOADOUT_SLOTS} equipped`;
    for (let i = 0; i < LOADOUT_SLOTS; i++) {
      const owned = byId.get(slots[i]);
      const def = owned && loadoutDef(owned.catalog);
      const armed = !def && this.target === i;
      const cls = ['lo-slot', def ? `r${def.rarity}` : 'empty', def && slots[i] === this.selected ? 'on' : '', armed ? 'armed' : ''].filter(Boolean).join(' ');
      const b = button(cls, this.slotBox);
      b.disabled = this.busy || (!def && !this.data);
      el('span', 'lo-slot-n', b, String(i + 1));
      svgEl('i', 'lo-slot-ico', b, glyph(def ? typeIcon(def) : 'plus'));
      const t = el('span', 'lo-slot-t', b);
      el('b', '', t, def ? def.name : armed ? 'Pick an item' : 'Empty slot');
      el('small', '', t, def ? `${LOADOUT_RARITY_NAMES[def.rarity]} ${loadoutTypeName(def.type).toLowerCase()} · ${fmtGrant(def)}` : armed ? 'Press an item in your collection' : this.data?.items?.length ? 'Press to fill' : 'Find items to fill it');
      b.addEventListener('click', () => {
        if (def) {
          this.selected = slots[i];
          this.target = -1;
        } else this.target = this.target === i ? -1 : i;
        this.render();
      });
      if (def) {
        const x = iconButton('btn-icon lo-slot-x', b, glyph('xmark'));
        x.title = 'Unequip';
        x.setAttribute('aria-label', `Unequip ${def.name}`);
        x.disabled = this.busy;
        x.addEventListener('click', (e) => {
          e.stopPropagation();
          this.unequip(i);
        });
      }
    }
  }
  renderGrid(byId = this.byId()) {
    this.grid.textContent = '';
    for (const [t, b] of this.typeChips) b.classList.toggle('on', t === this.typeFilter);
    const all = this.data?.items || [];
    const items = this.visibleItems();
    const missing = this.missingDefs();
    const slots = this.slots();
    this.count.textContent = this.data ? `${tallyText(loadoutTally(all))} found` : '';
    if (!this.data) {
      const p = el('div', 'gb-empty lo-empty', this.grid);
      el('p', '', p, this.busy ? 'Loading your collection...' : this.err || 'Could not load your collection');
      if (!this.busy) {
        const again = button('btn btn-ghost', p, 'Try again');
        again.addEventListener('click', () => this.refresh());
      }
      return;
    }
    const owned = el('section', 'lo-sec', this.grid);
    el('h4', 'lo-sec-h', owned, `Yours · ${items.length}`);
    if (!all.length) el('p', 'lo-empty', owned, 'Nothing yet. Help kill a boss or be first into a strongbox: either can drop a loadout item, and the odds rise every time one does not.');
    else if (!items.length) el('p', 'lo-empty', owned, 'None of yours match these filters.');
    const ownedGrid = el('div', 'lo-cards', owned);
    for (const it of items) {
      const def = loadoutDef(it.catalog);
      if (!def) continue;
      const inSlot = slots.indexOf(it.id);
      const b = button(`lo-card r${def.rarity}${it.id === this.selected ? ' on' : ''}${inSlot >= 0 ? ' eq' : ''}`, ownedGrid);
      b.disabled = this.busy;
      b.title = inSlot >= 0 ? `In slot ${inSlot + 1}` : this.target >= 0 ? `Equip to slot ${this.target + 1}` : 'Double-press to equip';
      const top = el('span', 'lo-card-top', b);
      svgEl('i', 'lo-card-ico', top, glyph(typeIcon(def)));
      el('span', 'lo-card-r', top, LOADOUT_RARITY_NAMES[def.rarity]);
      if (inSlot >= 0) el('span', 'lo-card-eq', top, `Slot ${inSlot + 1}`);
      el('b', '', b, def.name);
      el('small', '', b, `${loadoutTypeName(def.type)} · ${fmtGrant(def)}`);
      b.addEventListener('click', () => {
        if (this.target >= 0 && inSlot < 0) return this.equip(it.id, this.target);
        this.selected = it.id;
        this.target = -1;
        this.render();
      });
      // a double press: straight into the first free slot (or out of the one it is in)
      b.addEventListener('dblclick', () => {
        if (this.busy) return;
        if (inSlot >= 0) return this.unequip(inSlot);
        const free = slots.findIndex((s) => !byId.has(s));
        if (free >= 0) this.equip(it.id, free);
      });
    }
    if (!missing.length) return;
    // the rest of the catalog, folded under where it drops: what to go and look for
    const rest = el('section', 'lo-sec lo-rest', this.grid);
    const fold = button(`lo-sec-h lo-fold${this.showMissing ? ' open' : ''}`, rest);
    fold.setAttribute('aria-expanded', String(this.showMissing));
    el('span', '', fold, `Still to find · ${missing.length}`);
    svgEl('i', 'lo-fold-ico', fold, glyph('arrowRight'));
    fold.addEventListener('click', () => {
      this.showMissing = !this.showMissing;
      lsSet(MISSING_KEY, this.showMissing ? '1' : '0');
      this.render();
    });
    if (!this.showMissing) return;
    const seen = bestiaryView().mask;
    const groups = new Map();
    for (const def of missing) {
      const where = sourceText(def, seen);
      if (!groups.has(where)) groups.set(where, []);
      groups.get(where).push(def);
    }
    for (const [where, defs] of [...groups].sort((a, b) => b[1].length - a[1].length)) {
      const g = el('div', 'lo-group', rest);
      const h = el('div', 'lo-group-h', g);
      svgEl('i', 'lo-group-ico', h, glyph('compass'));
      el('span', '', h, where);
      el('small', '', h, String(defs.length));
      const tiles = el('div', 'lo-ghosts', g);
      for (const def of defs) {
        const s = silhouette(def, seen);
        const key = `cat:${def.id}`;
        const b = button(`lo-ghost r${s.rarity}${key === this.selected ? ' on' : ''}`, tiles);
        b.title = `${LOADOUT_RARITY_NAMES[s.rarity]} ${loadoutTypeName(s.type).toLowerCase()} · not found yet`;
        svgEl('i', 'lo-ghost-ico', b, glyph(typeIcon(def)));
        el('span', '', b, LOADOUT_RARITY_NAMES[s.rarity]);
        b.addEventListener('click', () => {
          this.selected = key;
          this.target = -1;
          this.render();
        });
      }
    }
  }
  renderDetail(byId = this.byId()) {
    this.detail.textContent = '';
    this.balance.textContent = this.data ? priceText(this.data.balance) : '';
    this.balance.hidden = !this.data;
    if (this.err && this.data) el('p', 'ac-note bad', this.detail, this.err);
    const where = (text) => {
      const w = el('div', 'lo-where', this.detail);
      svgEl('i', 'lo-where-ico', w, glyph('compass'));
      const t = el('span', '', w);
      el('small', '', t, 'Where it drops');
      el('b', '', t, text);
    };
    if (this.target >= 0) {
      el('p', 'lo-hint', this.detail, `Choose an item from your collection for slot ${this.target + 1}.`);
      return;
    }
    if (this.selected.startsWith('cat:')) {
      const def = loadoutDef(+this.selected.slice(4));
      if (!def) return;
      const g = silhouette(def, bestiaryView().mask);
      el('p', `lo-meta r${g.rarity}`, this.detail, `${LOADOUT_RARITY_NAMES[g.rarity]} ${loadoutTypeName(g.type).toLowerCase()} · not found yet`);
      el('h3', 'lo-name', this.detail, g.name);
      where(g.source);
      el('p', 'lo-hint', this.detail, 'What it does stays hidden until you find one.');
      return;
    }
    const owned = byId.get(this.selected);
    const def = owned && loadoutDef(owned.catalog);
    if (!def) {
      if (this.data) el('p', 'lo-hint', this.detail, this.data.items.length ? 'Press an item to see what it does.' : 'Loadout items are yours for good. Equip up to three and they join you at the start of every run.');
      return;
    }
    el('p', `lo-meta r${def.rarity}`, this.detail, `${LOADOUT_RARITY_NAMES[def.rarity]} ${loadoutTypeName(def.type).toLowerCase()}`);
    el('h3', 'lo-name', this.detail, def.name);
    el('p', 'lo-flavor', this.detail, def.flavor);
    const stats = el('dl', 'lo-stats', this.detail);
    const stat = (k, v, cls = '') => {
      if (!v) return;
      el('dt', '', stats, k);
      el('dd', cls, stats, v);
    };
    stat('Run start', fmtGrant(def));
    stat('Bonus', fmtMods(def.mods), 'good');
    stat('Effects', fmtEffects(def), 'good');
    where(sourceText(def, bestiaryView().mask));
    const slots = this.slots();
    const equipped = slots.indexOf(owned.id);
    const row = el('div', 'lo-actions', this.detail);
    if (equipped >= 0) {
      const b = button('btn btn-ghost', row, `Unequip from slot ${equipped + 1}`);
      b.disabled = this.busy;
      b.addEventListener('click', () => this.unequip(equipped));
      return;
    }
    const free = slots.findIndex((s) => !byId.has(s));
    if (free >= 0) {
      const b = button('btn lo-equip', row, `Equip to slot ${free + 1}`);
      b.disabled = this.busy;
      b.addEventListener('click', () => this.equip(owned.id, free));
      return;
    }
    // every slot taken: say what it would replace
    el('small', 'lo-swap-h', row, 'All three slots are full. Swap it for:');
    for (let i = 0; i < LOADOUT_SLOTS; i++) {
      const other = loadoutDef(byId.get(slots[i])?.catalog);
      const b = button('btn btn-ghost lo-swap', row, `${i + 1} · ${other?.name || 'Empty'}`);
      b.disabled = this.busy;
      b.addEventListener('click', () => this.equip(owned.id, i));
    }
  }
  render() {
    const byId = this.byId();
    if (this.target >= 0 && byId.has(this.slots()[this.target])) this.target = -1;
    // (a pick stays picked when the filters hide it; a silhouette goes once that item is found)
    if (this.selected.startsWith('cat:')) {
      const id = +this.selected.slice(4);
      if (!loadoutDef(id) || loadoutCounts(this.data?.items).has(id)) this.selected = '';
    } else if (this.selected && !byId.has(this.selected)) this.selected = '';
    this.root.classList.toggle('busy', this.busy);
    const a = accountState();
    this.guest.hidden = !a.ready || !a.accounts || a.offline || !!a.user || !(this.data?.items?.length || this.data?.balance);
    this.renderSlots(byId);
    this.renderGrid(byId);
    this.renderDetail(byId);
  }
}
