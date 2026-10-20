// The two acts (shared/acts.js): the island, then the mainland across the bridge. Driving off the island crosses
// (cross: the cutscene, while the mainland is built - buildMainland), the team lands at the bridgehead with a cache
// that makes up what they are short of (checkpointAt, landOn, bridgehead), and that checkpoint is what a wipe on
// the mainland starts again from (atBridge; restartFromBridge is in game.js). A game made to start on the mainland
// begins at the bridgehead with gun crates (startCrates, openGunCrate).
import { PHASE, SLOT_PRIMARY, SLOT_PISTOL, SLOT_MELEE, SLOT_BUILD, REVIVE_HP } from '../../shared/constants.js';
import { ITEM, WEAPONS, suppliesOf, CACHE_GAVE, AMMO_MAX, AMMO_ITEMS, SOUND, NOTIFY, isFirearm } from '../../shared/defs.js';
import { ENT } from '../../shared/protocol.js';
import { WORLD, CROSSING, BRIDGEHEAD, MAINLAND_START } from '../../shared/acts.js';
import { groundAt } from '../../shared/collision.js';
import { countItem } from '../inventory.js';

export const methods = {
  // What this act's escape takes: the car's supplies on the island, the plane's parts on the mainland.
  get sup() {
    return suppliesOf(this.act);
  },

  // The car is away with the team in it: the island is done. The crossing begins - every client plays the cutscene
  // off this phase's clock - and the mainland is built in the next tick (buildMainland), so that what tells the
  // clients has left this thread before a world is generated on it. by: who drove.
  // night: it left in the night. paid: the escape's XP is given (not for an admin's /map2: nobody escaped)
  cross(by, night = false, paid = true) {
    if (this.act !== WORLD.ISLAND || this.phase === PHASE.CROSSING) return;
    this.log('crossing to the mainland');
    this.track.crossed(by, night); // (before the world is cleared: it reads who is alive, and at the car)
    // the escape from the island is paid as it always was: more to whoever was in the car than to those it left
    const car = this.world.car;
    if (paid) this.payEscape('cross');
    // the stray cat goes too, if somebody has it in their arms (buildMainland sets it down beside them)
    const cat = this.cats.find((c) => c.holder && this.players.get(c.holder)?.state.pet);
    this.cards.crossing(); // (trades being haggled over are called off; a match waits out the cutscene)
    this.clearWorld();
    this.phase = PHASE.CROSSING;
    this.timeLeft = CROSSING.TIME;
    this.crossing = { pending: 2, skip: [], night, back: 0, cat: cat ? { variant: cat.variant, by: cat.holder } : null };
    this.waves = [];
    this.wave = 0;
    for (const p of this.players.values()) {
      p.hold = null;
      this.endUse(p);
      this.releaseHolds(p);
      p.state.pet = 0; // (the cat they had in their arms is in the car with them)
      p.cmdQueue.length = 0;
      p.waypoint = null; // (it pointed into the island)
    }
    this.notify(NOTIFY.CROSSING, by ? by.id : 0);
    this.sound(SOUND.CAR_START, car.x, car.y + 0.8, car.z, 0);
    this.globalDirty = true;
    this.playersDirty = true;
  },

  // The mainland, CROSSING.SWAP seconds into the crossing - the moment the cutscene cuts to black, which is when the
  // clients take the island down. In two ticks: the first tells the clients which world to build (and everything a
  // tick sends leaves the thread when the tick is done), the second builds ours, which holds this thread for a
  // moment: nobody is acting. Then it is populated and the team is put down on it; they stand at the bridgehead
  // from then on, behind the cutscene. now: both steps at once (a join that cannot wait, a skip, a save).
  buildMainland(now = false) {
    const c = this.crossing;
    if (!c?.pending || (!now && CROSSING.TIME - this.timeLeft < CROSSING.SWAP)) return;
    if (c.pending === 2) {
      c.pending = 1;
      this.act = WORLD.MAINLAND;
      this.tellWorld();
      if (!now) return;
    }
    c.pending = 0;
    this.setWorld(this.seed, WORLD.MAINLAND);
    this.worldPlayed = true; // (the run is on it: the next one gets an island of its own)
    // the morning after: whatever the hour was when the car left, the team comes off the bridge at the start of a
    // day - the next one, if it left in the night
    if (c.night) this.day++;
    this.populate();
    c.back = this.checkpointAt();
    // the cat that crossed in somebody's arms, beside them at the bridgehead (whoever is there, if they have gone)
    if (c.cat) {
      const by = this.players.get(c.cat.by) || this.players.values().next().value;
      if (by) this.cm.spawnBeside(by.state, c.cat.variant);
      c.cat = null;
    }
    this.globalDirty = true;
    this.playersDirty = true;
  },

  // The checkpoint at the bridge. Everybody is alive on the mainland - whoever was dead or turned at the end of the
  // island comes back - with what they carried over and, at the least, the bridgehead cache's floor (bridgehead).
  // What each of them has now is kept: every wipe on the mainland starts the run again from it (restartFromBridge).
  // Returns how many it brought back from the dead.
  checkpointAt() {
    let back = 0;
    for (const p of this.players.values()) {
      if (!p.alive || p.zombie) {
        // they dropped what they had where they fell, on the island: they cross with nothing but the floor
        this.spawnHuman(p, { mag: 0, ammo: 0, items: [], tools: [] });
        this.track.returned(p);
        back++;
      } else this.landOn(p);
      this.bridgehead(p);
    }
    this.checkpoint = { day: this.day, unlocked: this.unlocked, kits: this.kitsNow() };
    return back;
  },

  // what each survivor carries right now, as plain data (the checkpoint's kits): [leaverKey, kit]
  kitsNow() {
    const kits = [];
    for (const p of this.players.values()) kits.push([this.leaverKey(p), this.kitOf(p)]);
    return kits;
  },
  kitOf(p) {
    const s = p.state;
    return { weapons: s.weapons.slice(), mags: s.mags.slice(), dual: s.dual | 0, ammo: s.ammo.slice(), inv: p.inv.map((it) => (it ? { ...it } : null)), armor: p.armor, armorMax: p.armorMax, armorItem: p.armorItem, backpackItem: p.backpackItem, kit: p.kit };
  },
  // ...and back on them
  wear(p, k) {
    const s = p.state;
    s.weapons = k.weapons.slice();
    s.mags = k.mags.slice();
    s.dual = k.dual | 0; // (a pair crossed as a pair: shared/akimbo.js)
    s.ammo = k.ammo.slice();
    p.inv = k.inv.map((it) => (it ? { ...it } : null));
    p.armor = k.armor;
    p.armorMax = k.armorMax;
    p.armorItem = k.armorItem;
    p.backpackItem = k.backpackItem;
    p.kit = k.kit;
    p.invDirty = true;
    p.selfSync = true;
    this.syncThrow(p);
  },

  // Whether a wipe now starts the run again at the bridge: on the mainland of a run that crossed to it, with a
  // checkpoint to start from. (A game made to start on the mainland starts a new run there instead: startGame.)
  atBridge() {
    return this.act === WORLD.MAINLAND && this.startAct === WORLD.ISLAND && !!this.checkpoint?.kits;
  },

  // The gun crates of a game that starts on the mainland (acts.js MAINLAND_START), on the ground at the bridgehead
  // (world.startCrates), shut: one for each survivor there, CRATES at the least. [E] breaks one open (interact).
  startCrates() {
    const spots = this.world.startCrates || [];
    const n = Math.min(spots.length, MAINLAND_START.CRATES_MAX, Math.max(MAINLAND_START.CRATES, this.humanCount()));
    for (let i = 0; i < n; i++) {
      const sp = spots[i];
      const e = { kind: ENT.CRATE, x: sp.x, y: 0, z: sp.z, gy: 0, state: 1, despawnAt: this.time + 1e9, gun: MAINLAND_START.GUNS[i % MAINLAND_START.GUNS.length] };
      e.y = e.gy = groundAt(this.world, sp.x, sp.z, 200, 0.6);
      if (this.spawnEntity(e)) this.crates.push(e);
    }
  },
  // what a gun crate holds, out on the ground as it breaks open: its gun, loaded, its rounds and the stock
  openGunCrate(e) {
    const def = WEAPONS[e.gun];
    this.dropItem(e.gun, 1, e.x, e.y, e.z, { spread: 0.8, life: 900, mag: def.mag });
    const ammo = AMMO_ITEMS[def.ammo];
    if (ammo) this.dropItem(ammo, Math.min(AMMO_MAX[def.ammo], def.mag * MAINLAND_START.MAGS), e.x, e.y, e.z, { spread: 1.2, life: 900 });
    for (const [item, count] of MAINLAND_START.STOCK) this.dropItem(item, count, e.x, e.y, e.z, { spread: 1.2 + this.rng() * 0.8, life: 900 });
  },

  // a survivor who crossed in the car, put down at the bridgehead as they are: on their feet, off whatever the
  // island had them on, with everything they carried
  landOn(p) {
    const s = p.state;
    if (p.downed) {
      p.downed = false;
      s.downed = 0;
      p.bleed = 0;
      p.revivedBy = 0;
      p.hp = Math.max(p.hp, REVIVE_HP);
    }
    s.ride = s.cart = s.hmg = s.pet = s.drag = 0;
    s.drive = s.driveK = s.pass = s.passN = 0;
    s.pinned = s.pulled = 0;
    s.vx = s.vy = s.vz = 0;
    this.putAtStart(s);
    p.selfSync = true;
    this.fillHistory(p);
  },

  // The bridgehead cache (acts.js BRIDGEHEAD): what a survivor is short of the floor is made up, and nothing else. A
  // team that crossed with empty guns can fight its way to the first building; one that crossed well stocked gets
  // nothing. The difficulty moves the floor's rounds and bandages as it does the starting kit's (starterKit):
  // Nightfall's are the numbers in acts.js. Returns what it gave (CACHE_GAVE), which the survivor is told.
  // tell: say what it gave (NOTIFY.CACHE); not at the start of a game begun on the mainland, which has its own words
  bridgehead(p, tell = true) {
    const s = p.state;
    let gave = 0;
    const gun = (it) => isFirearm(it) && it !== ITEM.FLARE_GUN;
    const guns = [s.weapons[SLOT_PRIMARY], s.weapons[SLOT_PISTOL]];
    if (!guns.some(gun) && this.giveItem(p, BRIDGEHEAD.PISTOL, 1, WEAPONS[BRIDGEHEAD.PISTOL].mag)) {
      gave |= CACHE_GAVE.PISTOL;
      guns.push(BRIDGEHEAD.PISTOL); // (in the pistol's slot, or in the backpack if a flare gun has that)
    }
    for (const it of guns) {
      if (!gun(it)) continue;
      const def = WEAPONS[it];
      const want = Math.min(Math.round(BRIDGEHEAD.ROUNDS * this.diff.ammo), Math.round(def.mag * BRIDGEHEAD.MAGS * this.diff.ammo), AMMO_MAX[def.ammo]);
      if (s.ammo[def.ammo] >= want) continue;
      s.ammo[def.ammo] = want;
      gave |= CACHE_GAVE.AMMO;
    }
    const heals = countItem(p.inv, ITEM.BANDAGE) + countItem(p.inv, ITEM.MEDKIT);
    const bandages = Math.max(1, Math.round(BRIDGEHEAD.BANDAGES * this.diff.bandages));
    if (heals < bandages && this.giveItem(p, ITEM.BANDAGE, bandages - heals)) gave |= CACHE_GAVE.BANDAGE;
    if (!s.weapons[SLOT_MELEE]) {
      s.weapons[SLOT_MELEE] = BRIDGEHEAD.MELEE;
      gave |= CACHE_GAVE.MELEE;
    }
    if (!s.weapons[SLOT_BUILD]) {
      s.weapons[SLOT_BUILD] = BRIDGEHEAD.BUILD;
      gave |= CACHE_GAVE.BUILD;
    }
    if (gave) {
      p.invDirty = true;
      p.selfSync = true;
      if (tell) this.notify(NOTIFY.CACHE, gave, p.id);
    }
    return gave;
  },

  // The crossing is over (its clock ran out, or everybody asked to skip it): the first day on the mainland begins.
  arrive() {
    this.buildMainland(true); // (a crossing cut short before its mainland was up)
    const back = this.crossing?.back || 0;
    this.crossing = null;
    this.phase = PHASE.DAY;
    this.track.arrived(back);
    this.timeLeft = this.dayLen;
    this.notify(NOTIFY.ARRIVED, back);
    this.newWorldForAll(); // (a page still building the mainland - a skip, a slow machine, /map2 - is nobody's prey)
    this.sound(SOUND.DAWN, 0, 0, 0, 0);
    this.globalDirty = true;
    this.playersDirty = true;
    this.log(`arrived on the mainland: day ${this.day}, ${back} back from the dead`);
  },

  // A player asks for the crossing to be skipped (ACT.SKIP). It is, once everybody who is connected has asked, and
  // not before the clients have their mainland up (CROSSING.SKIP_AFTER).
  skipCrossing(p) {
    const c = this.crossing;
    if (this.phase !== PHASE.CROSSING || !c || c.skip.includes(p.id)) return;
    c.skip.push(p.id);
    this.globalDirty = true;
  },
  skipVotes() {
    const c = this.crossing;
    let need = 0;
    let got = 0;
    for (const p of this.players.values()) {
      if (p.away) continue;
      need++;
      if (c && c.skip.includes(p.id)) got++;
    }
    return [got, need];
  },
};
