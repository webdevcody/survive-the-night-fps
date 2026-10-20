// The inventory screen's item card (inventory.js): what the selected thing is, how it stands against the one held, a
// button for each thing it can do, and what it is for. Methods laid onto Inventory.
import { usedIn, foundIn, sourcesOf } from '../../game/itemguide.js';
import { ITEM_DEFS, WEAPONS, SALVAGE, isFirearm, AMMO_NAMES, CONSUMABLES } from '../../../shared/defs.js';
import { BACKPACK_SLOTS } from '../../../shared/constants.js';
import { WORN } from '../../../shared/protocol.js';
import { el, button } from '../dom.js';
import { itemIcon } from '../icons.js';
import { bindLabel } from '../../game/binds.js';
import { CAT_LABEL, statLines, costLine, shortName } from '../iteminfo.js';
import { canPair, isDual, slotDef } from '../../../shared/akimbo.js';

// the key of the game that uses an item without opening the inventory, said on its card
function quickKey(id) {
  const c = CONSUMABLES[id];
  if (c?.drink) return ['Drink', 'drink'];
  if (c?.heal && c.meat !== 1) return ['Quick heal', 'heal'];
  return null;
}

// A gun or melee weapon from the backpack against the one held in its slot, or a vest against the one worn: rows of
// { label, a: its value, b: the held one's, d: 1 it is better, -1 worse, 0 neither }. Only the numbers both have.
// worn: the armor worn ({ item, points, max }), whose points left are what a fresh vest is up against. null: nothing
function compareRows(id, held, worn = null) {
  const a = WEAPONS[id];
  const b = WEAPONS[held];
  if (a && b) {
    if (a.nunchaku || b.nunchaku) return null;
    const rows = [];
    const row = (label, x, y, dir, fmt = String) => {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      rows.push({ label, a: fmt(x), b: fmt(y), d: x === y || !dir ? 0 : (x > y) === dir > 0 ? 1 : -1 });
    };
    if (a.melee && b.melee) {
      row('Damage', a.damage, b.damage, 1);
      row('Heavy', a.altDamage, b.altDamage, 1);
      row('Swing', a.rate, b.rate, -1, (v) => v.toFixed(2) + ' s');
      row('Reach', a.range, b.range, 1, (v) => v + ' m');
      return rows;
    }
    if (a.melee || b.melee) return null;
    rows.push({ label: 'Damage', a: a.damage + (a.pellets > 1 ? ' × ' + a.pellets : ''), b: b.damage + (b.pellets > 1 ? ' × ' + b.pellets : ''), d: Math.sign(a.damage * a.pellets - b.damage * b.pellets) });
    row('Shots / s', 1 / a.rate, 1 / b.rate, 1, (v) => (v >= 10 ? Math.round(v) : v.toFixed(1)));
    row('Magazine', a.mag, b.mag, 1);
    row('Reload', a.reload, b.reload, -1, (v) => v + ' s');
    if (a.range && b.range) row('Range', a.range, b.range, 1, (v) => v + ' m');
    return rows;
  }
  const da = ITEM_DEFS[id];
  const db = ITEM_DEFS[held];
  if (da?.cat === 'armor' && db?.cat === 'armor') {
    const left = worn ? Math.ceil(worn.points) : db.armor;
    return [
      { label: 'Armor', a: String(da.armor), b: worn ? `${left} / ${worn.max}` : String(left), d: Math.sign(da.armor - left) },
      { label: 'Absorbs', a: Math.round(da.absorb * 100) + '%', b: Math.round(db.absorb * 100) + '%', d: Math.sign(da.absorb - db.absorb) },
    ];
  }
  return null;
}

export const cardMethods = {
  // the item card: what the selected thing is, what it is for, and a button (with its key) for everything it can do
  _buildCard(parent) {
    const card = (this.cardEl = el('div', 'card', parent));
    this.cardEmpty = el('div', 'card-empty', card);
    el('span', '', this.cardEmpty, 'Click an item to see it here · double-click uses it · right-click to drop');
    const body = (this.cardBody = el('div', 'card-body', card));
    const head = el('div', 'card-head', body);
    this.cardIco = el('i', 'card-ico', head);
    const t = el('div', 'card-titles', head);
    const nl = el('div', 'card-nameline', t);
    this.cardName = el('span', 'card-name', nl);
    this.cardCat = el('span', 'card-cat', nl);
    this.cardKey = el('span', 'card-key', nl);
    this.cardDesc = el('div', 'card-desc', t);
    // a gun, a melee weapon or a vest from the backpack against the one held in its slot (or worn)
    this.cardCmp = el('div', 'card-cmp', body);
    this.cardCmp.hidden = true;
    const btns = el('div', 'card-btns', body);
    const btn = (label, key, act) => {
      const b = button('card-b', btns);
      const t = el('span', 'card-bt', b, label);
      el('span', 'kbd sm', b, key);
      b.addEventListener('click', () => this.sel && this._do(act, this.sel, false));
      return { b, t };
    };
    this.cbMain = btn('Use', 'F', 'main');
    this.cbSplit = btn('Split', 'S', 'split');
    this.cbDrop = btn('Drop', 'G', 'drop');
    this.cbAll = btn('Drop all', 'Shift+G', 'dropAll');
    this.cbSalv = btn('Salvage', 'X', 'salvage');
    this.cardFoot = el('div', 'card-foot', body);
  },

  _renderCard() {
    const r = this.sel;
    this.cardEmpty.hidden = !!r;
    this.cardBody.hidden = !r;
    if (!r) return (this._cardSig = '');
    const inv = this.inv;
    const id = r.item;
    const d = ITEM_DEFS[id];
    const s = r.kind === 'slot' ? inv.slots[r.i] : null;
    const acts = this._acts(r);
    const key = JSON.stringify([r, s?.count, inv.armor, inv.weapons, inv.mags, inv.dual, this._pocketsUsed(), this.unlocked]);
    if (key === this._cardSig) return;
    this._cardSig = key;
    this.cardIco.innerHTML = itemIcon(id);
    this.cardName.textContent = d.name + (s && s.count > 1 ? ` ×${s.count}` : '');
    this.cardCat.textContent = (CAT_LABEL[d.cat] || '') + (r.kind === 'eq' ? ' · in your hands' : r.kind === 'worn' ? ' · worn' : '');
    this.cardCat.className = 'card-cat c-' + d.cat;
    const q = r.kind === 'slot' && quickKey(id);
    this.cardKey.textContent = q ? `${q[0]}: ${bindLabel(q[1])}` : '';
    // what it does, in a line: its description, then its numbers, then (worn or in its slot) how it stands
    const extra = [];
    if (r.kind === 'worn' && r.which === WORN.ARMOR && inv.armor) extra.push(`${Math.ceil(inv.armor.points)} / ${inv.armor.max} armor left`);
    if (r.kind === 'worn' && r.which === WORN.BACKPACK) extra.push(this._pocketsUsed() ? `${this._pocketsUsed()} / ${BACKPACK_SLOTS} of its slots in use: empty them to take it off` : `${BACKPACK_SLOTS} extra slots, all empty`);
    if (r.kind === 'eq' && isFirearm(id)) {
      const w = slotDef(inv, r.slot);
      if (w.pair) extra.push('A pair: one in each hand, no sights');
      extra.push(`${inv.mags[r.slot === 0 ? 0 : 1] | 0} / ${w.mag} loaded · ${inv.ammo[w.ammo] | 0} ${AMMO_NAMES[w.ammo]} carried`);
    }
    // a second one of the gun in its slot: the two can be held together
    if (r.kind === 'slot' && canPair(id) && inv.weapons[WEAPONS[id].slot] === id && !isDual(inv, WEAPONS[id].slot)) extra.push('Dual wield it with the one you hold: twice the rounds, faster shots, no sights');
    // (a description that already gives a number - "Heals 80 HP." - is not told it again)
    const desc = (d.desc || '').toLowerCase();
    const stats = statLines(id).filter((x) => !desc.includes(x.toLowerCase()));
    this.cardDesc.textContent = [d.desc, [...stats.slice(0, 2), ...extra].join(' · ')].filter(Boolean).join(' ');

    // against what is held: a weapon for a slot that has another in it, a vest while another is worn
    const held = r.kind === 'slot' ? (d.cat === 'weapon' && WEAPONS[id] ? inv.weapons[WEAPONS[id].slot] | 0 : d.cat === 'armor' ? inv.armor?.item | 0 : 0) : 0;
    const rows = held && held !== id ? compareRows(id, held, d.cat === 'armor' ? inv.armor : null) : null;
    const cmp = this.cardCmp;
    cmp.textContent = '';
    cmp.hidden = !rows?.length;
    if (rows?.length) {
      const hn = ITEM_DEFS[held].name;
      const top = el('div', 'cc-h', cmp);
      el('span', 'cc-l', top, `Against ${d.cat === 'armor' ? 'your' : 'the'} `);
      el('b', '', top, hn);
      el('span', 'cc-l', top, d.cat === 'armor' ? ' worn' : ' in your hands');
      const tb = el('div', 'cc-t', cmp);
      el('span', 'cc-c cc-k', tb, '');
      el('span', 'cc-c cc-k', tb, shortName(id));
      el('span', 'cc-c cc-k', tb, shortName(held));
      el('span', 'cc-c cc-k', tb, '');
      for (const x of rows) {
        el('span', 'cc-c cc-lab', tb, x.label);
        el('b', 'cc-c cc-a' + (x.d > 0 ? ' up' : x.d < 0 ? ' down' : ''), tb, x.a);
        el('span', 'cc-c cc-b', tb, x.b);
        el('span', 'cc-c cc-d' + (x.d > 0 ? ' up' : x.d < 0 ? ' down' : ''), tb, x.d > 0 ? '▲' : x.d < 0 ? '▼' : '=');
      }
    }
    // (equipping or wearing it when its place is taken swaps the two: said so)
    if (held && held !== id && acts.main?.ok) acts.main = { ...acts.main, label: `Swap with ${shortName(held)}` };

    const set = (btn, a, primary) => {
      btn.b.hidden = !a;
      if (!a) return;
      btn.t.textContent = a.label;
      btn.b.disabled = !a.ok;
      btn.b.classList.toggle('primary', !!primary && a.ok);
    };
    set(this.cbMain, acts.main, true);
    set(this.cbSplit, acts.split || { label: 'Split', ok: false });
    set(this.cbDrop, acts.drop);
    set(this.cbAll, acts.dropAll && acts.dropAll.ok ? acts.dropAll : null);
    set(this.cbSalv, acts.salvage || { label: 'Salvage', ok: false });
    this.cbAll.b.classList.add('danger');

    // what it is for: what it goes into, where more of it is found, what it comes apart into
    const foot = this.cardFoot;
    foot.textContent = '';
    const part = (label, text) => {
      if (!text) return;
      if (foot.childNodes.length) el('span', 'cf-sep', foot, ' · ');
      el('span', 'cf-l', foot, label + ' ');
      el('b', '', foot, text);
    };
    const used = usedIn(id, this.unlocked);
    part('Used in', used ? used.list.map((u) => u.name).join(', ') + (used.more ? ` +${used.more}` : '') : r.kind === 'slot' && d.cat === 'res' ? 'nothing' : '');
    if (sourcesOf(id).length) part('Found in', foundIn(id, this.unlocked, 2).toLowerCase());
    if (SALVAGE[id]) part('Salvages into', costLine(SALVAGE[id]));
    foot.hidden = !foot.childNodes.length;
  },
};
