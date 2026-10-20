// The HUD's hands (hud.js), bottom right: the weapon slots and the one in hand with its rounds, or the infected's
// ability panel. Methods laid onto Hud.
import { ITEM_DEFS, WEAPONS, AMMO_NAMES } from '../../../shared/defs.js';
import { GUN, MOUNTED_GUN } from '../../../shared/mountedgun.js';
import { pairDef } from '../../../shared/akimbo.js';
import { el, svgEl, clamp } from '../dom.js';
import { itemIcon, glyph } from '../icons.js';

const SLOT_LABELS = ['Primary', 'Pistol', 'Melee', 'Throw', 'Build', 'Radio'];
const RADIO = 5; // the walkie-talkie's slot (SLOT_RADIO)
const HUD_CAT = -1; // (the weapon block's id while the stray cat is in their arms: no item has it)

export const weaponsMethods = {
  _buildWeapons(layer) {
    // ---- bottom-right weapons
    const wp = (this.weap = el('div', 'weap', layer));
    const slots = el('div', 'slots', wp);
    this.slotEls = SLOT_LABELS.map((lab, i) => {
      const row = el('div', 'slot empty', slots);
      const ico = el('i', 'slot-ico', row);
      const name = el('span', 'slot-name', row, '');
      const cnt = el('span', 'slot-cnt', row, '');
      const key = el('span', 'slot-key', row, '');
      return { row, ico, name, cnt, key, item: -1 };
    });
    const am = (this.ammo = el('div', 'ammo', wp));
    const wn = el('div', 'w-head', am);
    this.wIco = el('i', 'w-ico', wn);
    this.wName = el('span', 'w-name', wn, '');
    const ar2 = (this.ammoRow = el('div', 'ammo-row', am));
    this.aMag = el('span', 'a-mag', ar2, '0');
    this.aSep = el('span', 'a-sep', ar2, '/');
    this.aRes = el('span', 'a-res', ar2, '0');
    // the magazine, one pip per round (--n rounds, --m of them lit); it fills back up while reloading
    this.aPips = el('div', 'a-pips', am);
    el('i', '', this.aPips);
    this.aPips.hidden = true;
    this.aType = el('div', 'a-type', am, '');
  },

  _buildZombie(layer) {
    // ---- zombie ability panel
    const zp = (this.zpanel = el('div', 'zpanel', layer));
    svgEl('i', 'z-ico', zp, glyph('claw'));
    const zt = el('div', 'z-txt', zp);
    el('div', 'z-title', zt, 'Infected');
    el('div', 'z-sub', zt, 'Hunt the survivors');
    const zl = el('div', 'z-leap', zp);
    el('span', 'z-leap-l', zl, 'Leap');
    const zlb = el('div', 'z-leap-bar', zl);
    this.zLeapFill = el('i', '', zlb);
    this.zLeapTxt = el('span', 'z-leap-t', zl, 'Ready');
  },

  _weapons(h) {
    const c = this.c;
    const weapons = h.weapons || [];
    const slot = h.slot | 0;
    if (c.slot !== slot) {
      if (c.slot !== undefined) {
        this.weap.classList.add('recent');
        clearTimeout(this._recentT);
        this._recentT = setTimeout(() => this.weap.classList.remove('recent'), 2200);
      }
      c.slot = slot;
      this.slotEls.forEach((s, i) => s.row.classList.toggle('active', i === slot));
    }
    for (let i = 0; i < SLOT_LABELS.length; i++) {
      const s = this.slotEls[i];
      const id = i === 3 ? h.throwItem || weapons[3] || 0 : weapons[i] || 0;
      if (s.item !== id) {
        s.item = id;
        s.row.classList.toggle('empty', !id);
        s.ico.innerHTML = id ? itemIcon(id) : '';
        s.name.textContent = id ? ITEM_DEFS[id]?.name || '' : SLOT_LABELS[i];
      }
      if (i === 3) {
        const tc = id ? h.throwCount | 0 : 0;
        if (c.tc !== tc) {
          c.tc = tc;
          s.cnt.textContent = tc > 1 ? '×' + tc : '';
        }
      }
    }

    // active weapon block
    // (manning the mounted gun: it stands in for the weapon in the hands, its belt for the magazine; the stray cat in
    // their arms stands in for it with no rounds at all)
    const id = h.mounted ? MOUNTED_GUN : h.cat ? HUD_CAT : slot === 3 ? h.throwItem || weapons[3] || 0 : weapons[slot] || 0;
    const pair = !h.mounted && !h.cat && !!h.pair; // (two of the gun: a pair's magazine, shared/akimbo.js)
    if (c.wId !== id || c.wPair !== pair) {
      const wasId = c.wId;
      c.wId = id;
      c.wPair = pair;
      this.wName.textContent = h.mounted ? GUN.name : h.cat ? 'Stray Cat' : id ? (ITEM_DEFS[id]?.name || '') + (pair ? ' ×2' : '') : 'Unarmed';
      this.wIco.innerHTML = h.cat ? glyph('paw') : id ? itemIcon(id) : '';
      const w = h.mounted ? GUN : h.cat ? null : pair ? pairDef(id) : WEAPONS[id];
      c.aTypeStr = w && !w.melee ? AMMO_NAMES[w.ammo] : '';
      c.magMax = w && w.mag ? w.mag : 0;
      c.magEach = !!(w && w.reloadEach);
      c.mag = c.res = c.ammoMode = c.pipM = undefined;
      if (wasId !== undefined) this.ammo.animate([{ opacity: 0.3, transform: 'translateX(8px)' }, { opacity: 1, transform: 'none' }], { duration: 200, easing: 'ease-out' });
    }
    let mode;
    if (slot === 3 && id && !h.mounted && !h.cat) mode = 'throw';
    else if (slot === RADIO && id && !h.mounted && !h.cat) mode = 'radio'; // (no rounds: how to use it, under its name)
    else if (h.mag == null) mode = 'none';
    else mode = 'gun';
    if (c.ammoMode !== mode) {
      c.ammoMode = mode;
      this.ammoRow.hidden = mode === 'none' || mode === 'radio';
      this.aSep.hidden = this.aRes.hidden = mode === 'throw';
      this.aType.hidden = mode !== 'gun' && mode !== 'radio';
      const pips = mode === 'gun' && c.magMax > 0;
      this.aPips.hidden = !pips;
      if (pips) {
        this.aPips.style.setProperty('--n', c.magMax);
        this.aPips.classList.toggle('dense', c.magMax > 60); // too many rounds to tell apart: a plain gauge
      }
      c.mag = c.res = c.pipM = undefined;
    }
    if (mode === 'throw') {
      const tc = h.throwCount | 0;
      if (c.mag !== 'x' + tc) {
        c.mag = 'x' + tc;
        this.aMag.textContent = '×' + tc;
        this.aMag.classList.remove('low', 'out');
      }
    } else if (mode === 'gun') {
      const mag = h.mag | 0;
      const res = h.reserve == null ? -1 : h.reserve | 0;
      if (c.mag !== mag) {
        c.mag = mag;
        this.aMag.textContent = String(mag);
        const lowT = Math.max(1, Math.ceil(c.magMax * 0.25));
        const low = mag > 0 && mag <= lowT && mag < c.magMax; // a full single-shot is not low
        this.aMag.classList.toggle('low', low);
        this.aMag.classList.toggle('out', mag === 0);
        this.aPips.classList.toggle('low', low);
      }
      if (c.res !== res) {
        c.res = res;
        this.aRes.textContent = res < 0 ? '∞' : String(res);
        this.aRes.classList.toggle('out', res === 0);
      }
    }
    const rl = mode === 'gun' && h.reloading >= 0 ? Math.round(clamp(h.reloading, 0, 1) * 200) / 200 : -1;
    if (c.rl !== rl) {
      if ((rl >= 0) !== (c.rl >= 0)) this.ammo.classList.toggle('reloading', rl >= 0);
      c.rl = rl;
    }
    const lab = rl >= 0 ? 'Reloading' : mode === 'radio' ? (h.radioKeyed ? 'On the air' : 'Hold fire to talk') : c.aTypeStr;
    if (c.aLab !== lab) this.aType.textContent = c.aLab = lab;
    const air = mode === 'radio' && !!h.radioKeyed;
    if (c.air !== air) this.ammo.classList.toggle('on-air', (c.air = air));
    if (mode === 'gun') {
      // lit pips: the rounds in the magazine, plus the ones sliding in as a reload runs (one shell at a
      // time for a shotgun, never more than the reserve holds)
      let m = c.mag;
      if (rl >= 0) m += rl * (c.magEach ? 1 : Math.max(0, Math.min(c.magMax, c.mag + (c.res < 0 ? c.magMax : c.res)) - c.mag));
      m = Math.round(Math.min(c.magMax, m) * 20) / 20;
      if (c.pipM !== m) this.aPips.style.setProperty('--m', (c.pipM = m));
    }
  },

  _zombie(h) {
    const c = this.c;
    const a = Math.round(clamp(h.ability == null ? 1 : h.ability, 0, 1) * 200) / 200;
    if (c.zAb !== a) {
      c.zAb = a;
      this.zLeapFill.style.transform = `scaleX(${a})`;
      const ready = a >= 1;
      if (c.zReady !== ready) {
        c.zReady = ready;
        this.zpanel.classList.toggle('ready', ready);
        this.zLeapTxt.textContent = ready ? 'Ready' : '';
      }
    }
  },
};
