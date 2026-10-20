// "Your kit" in the inventory screen (inventory.js): the loadout strip in hotbar order, what is worn, Quick use and the
// ammo pouch. Methods laid onto Inventory.
import { ITEM, ITEM_DEFS, isFirearm, AMMO_NAMES, AMMO_ITEMS, CONSUMABLES } from '../../../shared/defs.js';
import { INVENTORY_SIZE, BACKPACK_SLOTS } from '../../../shared/constants.js';
import { smallestStack } from '../../../shared/stacks.js';
import { el, svgEl, clamp, button } from '../dom.js';
import { itemIcon, glyph } from '../icons.js';
import { bindLabel } from '../../game/binds.js';
import { shortName } from '../iteminfo.js';
import { slotDef, isDual } from '../../../shared/akimbo.js';

const SLOT_LABELS = ['Primary', 'Pistol', 'Melee', 'Throwable', 'Build tool'];
// The order [H] takes heals in (Game.quickHeal in game/game/inventory.js: change the two together): the big ones first when low
const HEAL_ORDER = [ITEM.BANDAGE, ITEM.TUNA, ITEM.VENISON, ITEM.PAINKILLERS, ITEM.MEDKIT];
const HEAL_ORDER_LOW = [ITEM.MEDKIT, ITEM.VENISON, ITEM.BANDAGE, ITEM.TUNA, ITEM.PAINKILLERS];
const HEAL_LOW = 45;

// what a consumable does, in a few words, for its Quick use button
function effectOf(id) {
  const c = CONSUMABLES[id];
  if (!c) return '';
  if (c.heal) return `+${c.heal} HP`;
  if (c.stamina) return 'stamina';
  if (c.flashlight) return 'flashlight';
  return '';
}

export const kitMethods = {
  // ---- "Your kit": the loadout and what is worn as one strip, Quick use and the ammo reserve, the backpack, the card
  _buildKit(wrap) {
    const kit = (this.kitCol = el('section', 'inv-col ux-kit paper', wrap));
    const kh = this._h(kit, 'Your kit', 'loadout matches the hotbar');
    const khr = el('span', 'inv-h-right', kh);
    const capBar = (this.capBar = el('i', 'inv-capbar', khr));
    this.capFill = el('i', '', capBar);
    this.capEl = el('span', 'inv-cap', khr, '0 / ' + INVENTORY_SIZE);

    // (ux-load: where a weapon, throwable or vest dragged out of the backpack is let go of to equip it - _dropMark)
    const strip = el('div', 'ux-load', kit);
    const eqs = el('div', 'eq-list', strip);
    this.eqEls = SLOT_LABELS.map((lab, i) => {
      const r = el('div', 'eq empty', eqs);
      r.dataset.slot = i;
      r.dataset.lab = lab;
      el('span', 'eq-key', r, String(i + 1));
      const ico = el('i', 'eq-ico', r);
      const txt = el('div', 'eq-txt', r);
      el('span', 'eq-lab', txt, lab);
      const name = el('span', 'eq-name', txt, 'Empty');
      // a gun's own ammunition: calibre, the magazine and what is carried for it besides
      const ammo = el('span', 'eq-ammo', txt);
      ammo.hidden = true;
      const cal = el('span', 'eq-cal', ammo);
      const mag = el('span', 'eq-mag', ammo);
      const bar = el('i', 'eq-bar', ammo);
      const fill = el('i', '', bar);
      const spare = el('span', 'eq-spare', ammo);
      const cnt = el('span', 'eq-cnt', r, '');
      return { r, ico, name, ammo, cal, mag, fill, spare, cnt, item: -1, akey: '' };
    });
    // the other throwables to switch to, on the throwable's row
    this.throwAlt = el('div', 'eq-throws', this.eqEls[3].r.querySelector('.eq-txt'));

    // what is worn: the armor, and beside it the backpack (its pockets are the grid's last BACKPACK_SLOTS cells)
    const worn = el('div', 'worn', strip);
    const arm = (this.armEl = el('div', 'armor empty', worn));
    this.armIco = el('i', 'arm-ico', arm);
    const at = el('div', 'arm-txt', arm);
    this.armName = el('span', 'arm-name', at, 'No armor');
    this.armSub = el('span', 'arm-sub', at, '');
    const ab = el('div', 'arm-bar', at);
    this.armFill = el('i', '', ab);
    const pk = (this.packEl = el('div', 'armor pack empty', worn));
    this.packIco = el('i', 'arm-ico', pk);
    const pt = el('div', 'arm-txt', pk);
    this.packName = el('span', 'arm-name', pt, 'No backpack');
    this.packSub = el('span', 'arm-sub', pt, '');

    // Quick use: every heal and drink in the backpack, one click each (the stack [H] / [B] would take from)
    const row = el('div', 'ux-row', kit);
    const qu = el('div', 'ux-quick', row);
    const qh = el('div', 'ux-sub', qu);
    el('span', 'ux-sub-t', qh, 'Quick use');
    el('span', 'ux-sub-a', qh, 'one click');
    this.quickEl = el('div', 'ux-qlist', qu);
    this.quickNone = el('div', 'ux-qnone', qu, 'No heals or drinks carried');
    this.quickSig = '';
    this.quickEl.addEventListener('click', (e) => {
      const b = e.target.closest('.ux-q');
      if (!b) return;
      const i = smallestStack(this.inv.slots.slice(0, this.inv.cap), +b.dataset.item);
      if (i >= 0) this._useSlot(i);
    });

    // Ammunition is carried apart from the backpack, a reserve per calibre: the pouch lists the ones carried, each with
    // the gun that fires it. A click opens the amount popover (drop some for a teammate, craft more)
    const am = el('div', 'ux-ammo', row);
    const ah = el('div', 'ux-sub', am);
    el('span', 'ux-sub-t', ah, 'Ammo');
    el('span', 'ux-sub-a', ah, 'click to share');
    const pouch = (this.pouchEl = el('div', 'pouch', am));
    this.calEls = AMMO_ITEMS.map((id, cal) => {
      const b = button('pouch-cal', pouch);
      b.dataset.cal = cal;
      svgEl('i', 'pc-ico', b, itemIcon(id));
      el('span', 'pc-name', b, AMMO_NAMES[cal]);
      const n = el('span', 'pc-n', b, '0');
      const who = el('span', 'pc-who', b, '');
      return { b, who, n, key: '' };
    });
    const foot = (this.pouchFoot = el('div', 'pouch-foot', am));
    this.pouchHidden = el('span', 'pf-t', foot, '');
    const more = (this.pouchMore = button('pf-more', foot, 'show all'));
    more.addEventListener('click', () => {
      this.ui.sound('ui_click');
      this.showAllAmmo = !this.showAllAmmo;
      this._renderPouch(true);
    });

    this._buildMid(kit);
  },

  // Quick use: each heal or drink carried once, with how many, what it does, and the key that takes it outside the
  // screen ([H] on the heal it would take now, [B] on the drink). Heals first in the order [H] takes them
  _renderQuick() {
    const inv = this.inv;
    const hp = this.vit.hp;
    const low = hp >= 0 && hp < HEAL_LOW;
    const order = low ? HEAL_ORDER_LOW : HEAL_ORDER;
    const have = new Map();
    for (let i = 0; i < inv.cap; i++) {
      const s = inv.slots[i];
      if (s && CONSUMABLES[s.item] && ITEM_DEFS[s.item]?.cat === 'cons') have.set(s.item, (have.get(s.item) || 0) + s.count);
    }
    const rank = (id) => {
      const k = order.indexOf(id);
      if (k >= 0) return k;
      const c = CONSUMABLES[id];
      return c.heal ? 10 : c.drink ? 20 : 30;
    };
    const items = [...have.keys()].sort((a, b) => rank(a) - rank(b));
    const hKey = items.find((id) => order.includes(id)) || 0;
    const full = hp >= this.vit.maxHp;
    const key = items.map((id) => id + 'x' + have.get(id)).join(',') + '|' + hKey + '|' + full + '|' + bindLabel('heal') + bindLabel('drink');
    this.paneKit.n.textContent = `${inv.slots.filter((x, i) => x && i < inv.cap).length}/${inv.cap}`;
    if (key === this.quickSig) return;
    this.quickSig = key;
    this.quickEl.textContent = '';
    this.quickNone.hidden = items.length > 0;
    for (const id of items) {
      const c = CONSUMABLES[id];
      const b = button('ux-q c-cons' + (c.heal ? ' heal' : c.drink || c.stamina ? ' drink' : '') + (c.heal && !c.stamina && full ? ' full' : ''), this.quickEl);
      b.dataset.item = id;
      svgEl('i', 'ux-q-ico', b, itemIcon(id));
      const t = el('span', 'ux-q-txt', b);
      el('span', 'ux-q-name', t, shortName(id));
      el('span', 'ux-q-fx', t, effectOf(id));
      const k = id === hKey ? bindLabel('heal') : c.drink ? bindLabel('drink') : '';
      if (k) el('span', 'kbd sm', b, k);
      el('b', 'ux-q-n', b, String(have.get(id)));
      b.title = `${ITEM_DEFS[id].name}: ${ITEM_DEFS[id].desc || ''}${k ? ` · [${k}] outside this screen` : ''}`;
    }
  },

  _renderLoadout() {
    const inv = this.inv;
    const w = inv.weapons;
    const tc = inv.throwCounts || {};
    this.eqEls.forEach((q, i) => {
      const id = w[i] | 0;
      const pair = !!id && isDual(inv, i); // (two of the gun, one in each hand: shared/akimbo.js)
      if (q.item !== id || q.pair !== pair) {
        q.item = id;
        q.pair = pair;
        q.r.classList.toggle('empty', !id);
        q.ico.innerHTML = id ? itemIcon(id) : '';
        q.name.textContent = id ? (ITEM_DEFS[id]?.name || '?') + (pair ? ' ×2' : '') : SLOT_LABELS[i];
        q.r.title = id ? `${SLOT_LABELS[i]} · ${bindLabel('slot' + (i + 1)) || i + 1}` : `${SLOT_LABELS[i]}: empty`;
      }
      const cnt = i === 3 && id && tc[id] > 0 ? '×' + tc[id] : '';
      if (q.cntTxt !== cnt) q.cnt.textContent = q.cntTxt = cnt;
      // a gun: its calibre, what is in the magazine, and what is carried for it - low (red) under one magazine
      const gun = (i === 0 || i === 1) && isFirearm(id) ? slotDef(inv, i) : null;
      const mag = gun ? inv.mags[i] | 0 : 0;
      const spare = gun ? inv.ammo[gun.ammo] | 0 : 0;
      const akey = gun ? `${id}:${pair}:${mag}:${spare}` : '';
      if (q.akey === akey) return;
      q.akey = akey;
      q.ammo.hidden = !gun;
      if (!gun) return;
      q.cal.textContent = AMMO_NAMES[gun.ammo];
      q.mag.textContent = gun.mag > 1 ? `${mag}/${gun.mag}` : mag ? 'loaded' : 'empty';
      q.fill.style.transform = `scaleX(${clamp(mag / gun.mag, 0, 1)})`;
      q.spare.textContent = `· ${spare}`;
      q.ammo.classList.toggle('low', spare < gun.mag);
      q.ammo.title = `${mag} in the ${gun.mag > 1 ? 'magazine' : 'chamber'} · ${spare} ${AMMO_NAMES[gun.ammo]} spare` + (spare < gun.mag ? ': less than one magazine left to reload with' : '');
    });
    // other throwables to switch to
    const throws = Object.entries(tc).filter(([, n]) => n > 0);
    const twKey = (w[3] | 0) + ':' + throws.map((t) => t.join('x')).join(',');
    if (this._twKey !== twKey) {
      this._twKey = twKey;
      this.throwAlt.textContent = '';
      if (throws.length > 1 || (throws.length === 1 && +throws[0][0] !== (w[3] | 0))) {
        for (const [id, n] of throws) {
          const b = button('tw' + (+id === (w[3] | 0) ? ' on' : ''), this.throwAlt);
          b.dataset.item = id;
          b.title = 'Select ' + ITEM_DEFS[id]?.name;
          svgEl('i', 'tw-ico', b, itemIcon(+id));
          el('span', 'tw-n', b, '×' + n);
        }
      }
    }
  },

  _renderWorn() {
    const a = this.inv.armor;
    const armKey = a ? a.item + ':' + Math.ceil(a.points) + ':' + a.max : '';
    if (this._armKey !== armKey) {
      this._armKey = armKey;
      this.armEl.classList.toggle('empty', !a);
      if (a) {
        this.armIco.innerHTML = itemIcon(a.item);
        this.armName.textContent = ITEM_DEFS[a.item]?.name || 'Armor';
        this.armSub.textContent = `${Math.ceil(a.points)} / ${a.max} armor`;
        this.armFill.style.transform = `scaleX(${clamp(a.points / (a.max || 1), 0, 1)})`;
      } else {
        this.armIco.innerHTML = glyph('shield');
        this.armName.textContent = 'No armor';
        this.armSub.textContent = 'wear a vest or jacket';
        this.armFill.style.transform = 'scaleX(0)';
      }
    }
    const pack = this.inv.backpack;
    const pocket = this._pocketsUsed();
    const packKey = pack + ':' + pocket;
    if (this._packKey !== packKey) {
      this._packKey = packKey;
      this.packEl.classList.toggle('empty', !pack);
      this.packIco.innerHTML = itemIcon(ITEM.BACKPACK);
      this.packName.textContent = pack ? ITEM_DEFS[pack]?.name || 'Backpack' : 'No backpack';
      this.packSub.textContent = pack ? `+${BACKPACK_SLOTS} slots · ${pocket}/${BACKPACK_SLOTS} used` : `+${BACKPACK_SLOTS} slots · craft at a workbench`;
    }
  },

  // The pouch: the calibres carried, each with the gun that fires it ("no gun for it": the rounds to hand a teammate),
  // the empty ones behind "show all"
  _renderPouch(force) {
    const inv = this.inv;
    let empty = 0;
    this.calEls.forEach((q, cal) => {
      const v = inv.ammo[cal] | 0;
      if (!v) empty++;
      const { held, packed } = this._gunsFor(cal);
      const who = held.length ? held.map((id) => ITEM_DEFS[id].name).join(', ') : packed.length ? `${ITEM_DEFS[packed[0]].name} · in pack` : 'no gun for it';
      const key = `${v}|${who}|${this.showAllAmmo}`;
      if (!force && q.key === key) return;
      q.key = key;
      q.b.hidden = !v && !this.showAllAmmo;
      q.b.classList.toggle('zero', !v);
      q.n.textContent = String(v);
      q.who.textContent = who;
      q.b.classList.toggle('orphan', !!v && !held.length && !packed.length);
    });
    this.pouchHidden.textContent = this.showAllAmmo ? `${AMMO_ITEMS.length} calibres` : empty ? `+ ${empty} empty calibre${empty === 1 ? '' : 's'} hidden` : '';
    this.pouchMore.textContent = this.showAllAmmo ? 'hide empty ▴' : 'show all ▾';
    this.pouchMore.hidden = !empty;
  },
};
