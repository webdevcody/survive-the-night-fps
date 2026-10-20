// Game: the HUD's state, gathered once a frame for ui/hud.js.
import { SLOT_PRIMARY, SLOT_THROW, SLOT_RADIO } from '../../../shared/constants.js';
import { ITEM, ITEM_DEFS, STRUCT_DEFS, ZOMBIE_DEFS, CONSUMABLES } from '../../../shared/defs.js';
import { ENT } from '../../../shared/protocol.js';
import { trackedRecipe } from '../tracked.js';
import { SUPPLIES, SUPPLY_NEED } from '../act.js';
import { shotSpread, currentWeapon, heldDef } from '../../../shared/playersim.js';
import { crosshairGap } from '../aimview.js';
import { perkMods } from '../../../shared/progress.js';
import { ROLE, GUARD, DRAG } from '../../../shared/roles.js';
import { HEAL_ITEMS } from './inventory.js';
import { updateMeters } from '../hudmeters.js';

export const methods = {
  updateHud(dt, s, aiming, wdef) {
    const self = this.self;
    const g = this.global;
    const rp = this.renderPos;
    const h = this.hud || (this.hud = { crosshair: { spread: 10, visible: true }, weapons: [0, 0, 0, 0, 0, 0] });
    h.hp = self.hp;
    h.maxHp = self.maxHp;
    h.armor = self.armor;
    h.armorMax = self.armorMax;
    h.stamina = s.stamina;
    h.exhausted = !!s.exhausted;
    h.veh = this.vehicles.hud; // (in a vehicle: its speed, its tank, how sound it is)
    h.flashlight = self.battery;
    h.flashlightOn = this.localFlash;
    h.zombie = !!s.zombie;
    h.ability = s.zombie ? Math.max(0, Math.min(1, 1 - s.leapCd / 4.5)) : 1;
    h.slot = s.slot;
    for (let i = 0; i < 5; i++) h.weapons[i] = s.weapons[i];
    h.weapons[SLOT_RADIO] = s.zombie ? 0 : ITEM.WALKIE; // (everyone's)
    h.radioKeyed = this.radio.keyed;
    h.throwItem = s.weapons[SLOT_THROW];
    h.throwCount = s.throwCount;
    // the mash meter: pinned by a leaper or a crawler, or a fire to beat out (hudmeters.js)
    updateMeters(this, s, h);
    const w = currentWeapon(s);
    const def = heldDef(s); // (a pair's numbers for two of the gun: its magazine and reload are both guns')
    h.pair = !!def?.pair;
    if (def && !def.melee) {
      h.mag = s.mags[s.slot === SLOT_PRIMARY ? 0 : 1];
      h.reserve = s.ammo[def.ammo];
      h.reloading = s.reloadT > 0 ? 1 - s.reloadT / (def.reload * perkMods(s.perks).reload) : -1;
    } else if (s.slot === SLOT_THROW) {
      h.mag = s.throwCount;
      h.reserve = null;
      h.reloading = -1;
    } else {
      h.mag = null;
      h.reserve = null;
      h.reloading = -1;
    }
    this.gun.hud(h); // (manning the mounted gun: its belt)
    h.cat = !!s.pet; // (the stray cat in their arms: no weapon, no rounds)
    if (h.cat) {
      h.mag = h.reserve = null;
      h.reloading = -1;
    }
    h.phase = g.phase;
    h.day = g.day;
    h.timeLeft = g.timeLeft;
    h.night = this.env.night;
    h.hordeLeft = g.hordeLeft;
    h.wave = g.wave;
    h.waves = g.waves;
    h.finale = g.finale;
    h.escapeT = g.escapeT;
    h.escapeReady = g.escapeReady;
    h.escapeStalled = g.escapeStalled;
    h.standWarm = g.standWarm; // (the plane's stand: the truck is done, the engines are warming)
    h.runwayBlocked = g.runwayBlocked;
    h.escapeLeaving = g.escapeLeaving;
    h.tonight = this.tonight(g);
    const boss = g.bossId ? this.entities.ents.get(g.bossId) : null;
    h.boss = boss ? { name: ZOMBIE_DEFS[boss.ztype].name, hp: boss.q[5] / 255 } : null;
    h.prompt = h.shove >= 0 ? null : this.prompt; // (pinned: nothing in reach can be used, and the meter is there)
    // dynamic crosshair
    // the ticks stand on the edge of the cone the next round is drawn from (shotSpread, as the server draws it), at
    // this field of view: what is inside them can be struck, what is outside cannot
    let spread = 10;
    if (def && !def.melee) spread = crosshairGap(shotSpread(s, def, false), this.camera.fov, window.innerHeight);
    h.crosshair.spread = spread;
    h.crosshair.visible = !aiming && self.alive && !this.ui.inventoryOpen && !this.ui.mapOpen;
    // progress ring: a held key's (holdring.js: from its press, red for a moment when it is broken off), or an item in use
    const ring = this.holdRing.hud(this.ringOut);
    h.useCancel = ring.cancelled ? ring.cancelFor : 0;
    if (ring.progress >= 0) {
      h.useProgress = ring.progress;
      h.useLabel = ring.label;
    } else {
      // (put away by a click, it is gone at once: the server's word on it is a round trip off)
      h.useProgress = self.useItem && this.prediction.state.using ? self.useProgress : -1;
      const c = CONSUMABLES[self.useItem];
      h.useLabel = self.useItem ? `${c?.food ? 'Eating' : c?.drink ? 'Drinking' : 'Using'} ${ITEM_DEFS[self.useItem]?.name || ''}` : '';
      // ([E] held meanwhile: the hold is next, the moment the hands are free)
      if (self.useItem && this.holdWait?.kind) h.useLabel += ` · then ${this.holdInfo(this.holdWait.kind, this.holdWait.id).label.replace('…', '')}`;
    }
    // context panel
    const counts = this.invCounts();
    h.heals = HEAL_ITEMS.reduce((n, it) => n + (counts[it] || 0), 0);
    h.drinks = counts[ITEM.ENERGY_DRINK] || 0; // what the drink key has left
    // the recipe tracked on the HUD (game/tracked.js), against what we carry and the stations in reach
    const tracked = !s.zombie && self.alive ? trackedRecipe() : null;
    if (tracked && (!this.trackNear || this.frame % 20 === 5)) this.trackNear = this.craftContext();
    h.tracked = tracked ? { r: tracked, counts, near: this.trackNear, unlocked: g.unlocked | 0 } : null;
    if (this.lookTarget && this.lookTarget.kind === ENT.STRUCTURE) h.context = !s.zombie && currentWeapon(s) === ITEM.HAMMER ? { type: 'structure', name: STRUCT_DEFS[this.lookTarget.stype].name, hp: this.lookTarget.q[3] / 255 } : null;
    else h.context = this.fair.hud();
    h.ping = Math.round(this.conn.rtt);
    h.stalled = performance.now() - (this.snapAt || 0) > 1000; // nothing from the server for a second
    h.fps = this.fps || 0;
    h.players = { alive: g.humansAlive, total: g.playersTotal };
    if (!h.team || this.frame % 10 === 3) h.team = this.hudTeam(rp); // (the team over the vitals, a few times a second)
    // objective tracker
    const carried = {};
    let anyCarried = false;
    SUPPLIES.forEach((it, i) => {
      if (counts[it] && g.supplies[i] < SUPPLY_NEED[i]) {
        carried[it] = counts[it];
        anyCarried = true;
      }
    });
    const loose = {};
    for (const p of this.looseParts()) loose[p.item] = (loose[p.item] || 0) + 1;
    h.objective = { supplies: g.supplies, hints: g.hints, found: g.found, carried, loose, anyCarried, phase: g.phase, timeLeft: Math.ceil(g.timeLeft), finale: g.finale, escapeT: Math.ceil(g.escapeT), escapeReady: g.escapeReady, escapeStalled: g.escapeStalled, escapeLeaving: g.escapeLeaving, standWarm: g.standWarm, runwayBlocked: g.runwayBlocked, suppliesDone: g.suppliesDone, wave: g.wave, waves: g.waves };
    // downed overlay
    h.downed = self.alive && s.downed ? { bleed: self.bleed || 0, reviving: !!self.beingRevived, mate: this.closestMate(rp), medic: this.closestMate(rp, ROLE.MEDIC), guard: this.roleNear(rp, ROLE.GUARDIAN, GUARD.range), dragged: s.pulled ? this.roleNear(rp, ROLE.RUNNER, DRAG.slip) : null } : null;
    // compass + world markers
    h.yaw = this.input.yaw;
    this.buildMarkers(h, rp);
    // the minimap: only while it is on screen (the leaderboard, and Friends docked over it, are a side sheet in a
    // game, with the minimap still in view beside them)
    h.minimap = !h.zombie && !this.ui.inventoryOpen && !this.ui.mapOpen && !(this.ui.boardOpen && this.ui.board.lobbyMode) && !this.ui.bestiaryOpen && !this.ui.cardsOpen ? this.mapData(counts) : null;
    h.cards = this.cards.hud(); // (Dead Hand under way with its screen shut, or a teammate's ask)
    this.ui.updateHud(h);
    this.pushInventoryToUI(false);
    if (this.ui.inventoryOpen && this.frame % 20 === 0) this.ui.setCraftContext(this.craftContext());
    if (this.ui.rosterOpen && this.frame % 20 === 10) this.pushRoster(); // health moves between player lists
  },
};
