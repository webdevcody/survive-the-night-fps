// Client game orchestrator: the Game builds every subsystem of a game in play (constructor) and runs its frame
// (update). Its methods for each responsibility live in game/ (game/index.js lays them onto it).
import * as THREE from 'three';
import { PHASE, SLOT_PISTOL, SLOT_BUILD, INVENTORY_MAX } from '../../shared/constants.js';
import { STRUCT, ZONE, AMMO_ITEMS } from '../../shared/defs.js';
import { ENDED_CODE } from '../../shared/protocol.js';
import { LookWarmer } from './lookwarm.js';
import { HomeSense } from '../audio/home.js';
import { MotifWatch } from '../audio/motifs.js';
import { heldDef } from '../../shared/playersim.js';
import { swimming } from '../../shared/swim.js';
import { Connection } from '../net/connection.js';
import { Prediction } from './prediction.js';
import { InputBuffer } from './inputbuffer.js';
import { Entities } from './entities.js';
import { GunClient } from './mountedgun.js';
import { CatClient } from './catcarry.js';
import { RocketsClient } from './rockets.js';
import { FairClient } from './fair.js';
import { HandcarClient } from './handcar.js';
import { VehicleClient } from './vehicles.js';
import { Highlight } from './highlight.js';
import { Input, LOOK_PER_PX } from './input.js';
import { TouchPad } from '../ui/touchpad.js';
import { DropHold } from './drophold.js';
import { HoldRing } from './holdring.js';
import { SkyFlares } from './skyflares.js';
import { Voice } from './voice.js';
import { Environment } from '../render/environment.js';
import { Crowd } from '../render/crowd.js';
import { getCrowdMaterial, crowdBones } from '../render/models/skinning.js';
import { FixtureUI } from './fixtures.js';
import { RadioClient } from './radio.js';
import { Lights } from '../render/lights.js';
import { Weather } from './weather.js';
import { PowerViews } from './power.js';
import { Onboarding } from './onboarding.js';
import { KeyHints } from '../ui/keyhints.js';
import { KeyGuard } from './keyguard.js';
import { CardsClient } from './cards.js';
import { installParts } from './game/index.js';
import { CRAFT_BURST } from './game/inventory.js';
import { PING_LIFE } from './game/markers.js';

export class Game {
  constructor({ renderer, ui, audio, settings }) {
    this.renderer = renderer;
    this.ui = ui;
    this.audio = audio;
    this.settings = settings;
    this.scene = renderer.scene;
    this.camera = renderer.camera;
    this.world = null;
    this.seed = null;
    this.state = 'menu'; // menu | playing
    this.frame = 0;
    this.time = 0;
    this.myId = 0;
    this.perksUp = false; // the Perks panel opened with [P] mid-run (togglePerks)
    this.achUp = false; // the Achievements panel opened with [U] mid-run (toggleAchievements)
    this.pledgeShown = false; // this run's pledge window has opened its panel by itself once (onPledge)
    this.admin = false; // the server lets us run the admin commands (WELCOMEF.ADMIN): the spawn menu [`] is ours
    this.global = { phase: PHASE.WAITING, day: 0, timeLeft: 0, hordeLeft: -1, bossId: 0, supplies: [0, 0, 0, 0, 0], hints: [255, 255, 255, 255, 255, 255, 255], found: 0, spots: [0xffff, 0xffff, 0xffff, 0xffff, 0xffff, 0xffff, 0xffff], help: 0, scouted: 0, unlocked: 0, schemHints: [255, 255, 255, 255, 255], wave: 0, waves: 3, escapeT: 0, flags: 0, finale: false, suppliesDone: false, escapeReady: false, humansAlive: 0, playersTotal: 0, restartT: 0, benches: [], parts: [] };
    this.self = { alive: 1, hp: 100, maxHp: 100, armor: 0, armorMax: 0, battery: 100, weapons: [0, 0, 0, 0, 0], mags: [0, 0], ammo: AMMO_ITEMS.map(() => 0) };
    this.inventory = { slots: new Array(INVENTORY_MAX).fill(null), armor: null, backpack: 0 };
    this.craftQueue = []; // recipe ids of bulk crafts waiting to be sent (sendCrafts)
    this.craftBudget = CRAFT_BURST;
    this.craftSoundT = -1; // when a craft was last heard (eventHandler.sound)
    this.players = new Map(); // id -> {name, status, walkie, kills, ping, way: their waypoint {x, z, zone} | null}
    this.looks = new Map(); // id -> a custom survivor's model key (S2C.LOOKS: onLooks; drawn once built: lookOf)
    this.lookWarmer = new LookWarmer();
    this.renderPos = new THREE.Vector3();
    this.clientTick = 0;
    this.clockInit = false;
    this.clockAdj = 0; // pending clock correction, eased in over a few frames
    this.net = { tick: 0, ack: 0 }; // running snapshot header state (tick / acked command of the last one)
    this.latestTick = 0; // newest snapshot received
    this.jitter2 = 0; // mean squared snapshot arrival error (ticks^2)
    this.lateRun = 0; // consecutive snapshots far behind the clock
    this.interpExtra = 0; // extra interpolation delay (ticks) on a jittery connection
    this.renderTick = 0;
    this.damageFx = 0;
    this.hitFx = 0;
    this.viewClimb = 0; // the gun's climb as the view has it (rad): eased onto shotClimb of the predicted state
    this.punch = 0; // the last round's punch (rad at its top), punchT s ago, over punchLen s
    this.punchT = 0;
    this.punchLen = 0.1;
    this.camBob = 0;
    this.landDip = 0; // how far a landing has pushed the view down, a spring (landVel) kicked on touchdown
    this.landVel = 0;
    this.quake = 0; // the ground shaking under something heavy, 0..1: a tank's footfalls each add to it (Entities)
    this.fallV = 0; // downward speed in the last frame in the air
    this.eyeH = 1.62;
    this.fovCur = settings.fov || 75;
    this.aimT = 0; // 0 hip .. 1 aimed, eased with the zoom (look sensitivity)
    this.buildType = STRUCT.BARRICADE;
    this.buildPicked = false; // a structure picked from the ring since the hammer came out: its ghost is up to place
    this.buildMenu = null; // { hover }: the ring of structures is open (the mouse points in it: Input.cursor)
    this.buildRot = 0;
    this.ghosts = {};
    this.lastSlot = SLOT_PISTOL;
    this.dropHold = new DropHold(); // the drop key held, on its way to dropping the weapon in the hands (drophold.js)
    this.localFlash = false;
    this.localFlashT = 0;
    this.openness = 0;
    this.indoor = 0;
    this.motifs = new MotifWatch(); // the specials' approach motifs (audio/motifs.js)
    this.homeSense = new HomeSense(); // inside the team's walls (the night's home bed: audio/home.js)
    this._homeStructs = [];
    this.under = 0; // how far down the mine the eye is (0..1)
    this._envOver = { under: 0, smoke: 0 };
    this.smoke = 0; // how deep in a smoker's cloud the eye is, eased (Environment's smoke override)
    this._wxDown = {};
    this.stepAcc = 0;
    this.swimming = false; // afloat in the lake or a pond (shared/swim.js), as of the last frame
    this.swimK = 0; // ...eased 0..1: the view riding the water
    this.treadT = 0; // till the next paddle treading water
    this.swimTired = false; // told this time in the water that stamina is running low
    this.swimTold = false; // told what swimming is, this page load
    this.deathShown = false;
    this.overlay = null;
    this.runOn = false; // a run is under way, as far as this client has seen (trackRun)
    this.run = null; // ...and we have been in it from the start: { tick, kills0, day }
    this.sawRunEnd = false; // the last run ended under us, so the next one starts under us whatever day it is on
    this.runReport = null; // what the run that just ended did to the personal record, for the end screen
    this.prevPhase = -1;
    this.lastHudInvKey = '';
    this.talkPeers = [];
    this.talkKey = '';
    this.pttHeld = false; // [V] held down (push-to-talk): the microphone is open
    this.lookTarget = null;
    this.menuAngle = 0;
    this.lowHpBeat = 0;
    this.holding = 0; // hold-to-interact target we told the server about
    this.holdWait = null; // { id, kind, o }: [E] held for that while the hands were on an item, asked for once they are free
    this.holdRing = new HoldRing((kind) => this.holdInfo(kind)); // the ring every held key shows from its press (holdring.js)
    this.ringOut = { progress: -1, label: '', cancelled: false };
    this.flames = new Map(); // flamethrowers spraying right now: shooter id (-1 = ours) -> { loop, t, glow, at, light }
    this.flameLights = []; // their fire lights this frame, for the light pool
    this.pings = [];
    // your own waypoint, set on the field map; the server lists it for the team (shareWaypoint):
    // { x, y, z, zone (id of the place it sits on, or -1), r (arrival radius), visited, away }
    this.waypoint = null;
    ui.map.onWaypoint = (at) => this.setWaypoint(at);
    ui.map.onClose = () => this.toggleMap(false);
    ui.board.onClose = () => this.toggleBoard(false);
    ui.bestiary.onClose = () => this.toggleBestiary(false);
    ui.cards.onClose = () => this.toggleCards(false);
    ui.progress.onHide = () => this.togglePerks(false);
    ui.pledge.onSend = (data) => this.conn.pledge(data);
    ui.pledge.onClose = () => this.togglePledge(false);
    ui.pledge.names = () => new Map([...this.players].map(([id, p]) => [id, p.name]));
    // the kit screens' tabs (ui/screentabs.js): in a run they are the game's; outside one, the UI swaps the two it has
    const tabGo = ui.screenGo.bind(ui);
    ui.screenGo = (id) => (this.screenRun() ? this.screenGo(id) : tabGo(id));
    ui.screenRun = () => this.screenRun();
    // (after the click that hid it is done: its Sign in hides it and opens the account panel in the same handler)
    ui.achPanel.onHide = () => queueMicrotask(() => this.toggleAchievements(false));
    ui.fieldNotes.ctx = () => (this.state === 'playing' && this.global && !this.global.finale ? { seed: this.seed, act: this.act, day: this.global.day, phase: this.global.phase } : null);
    ui.spawn.onClose = () => this.toggleSpawn(false);
    ui.spawn.onSpawn = (cmd) => this.conn.chat(cmd);
    ui.roster.onClose = () => this.pinRoster(false);
    ui.sheetGo = (where) => this.sheetGo(where); // (the side sheet's tabs: ui/sheet.js)
    this.boardT = 0; // when the leaderboard is next asked for, while it is open (performance.now)
    this.discovered = new Set([ZONE.CAMP]);
    this.stripped = new Set(); // the trees and wrecks with nothing left to give today (harvest.js strippedKey)
    this.discoverT = 0;
    this.debugCam = null;
    this.selfBody = null; // our own survivor, shown to a debug camera that asks for it (updateSelfBody)
    this.nkVx = this.nkVz = 0; // (nunchucks: the eye's velocity last frame, and what their sounds remember)
    this.nkBtn = 0;
    this.nkSt = {};
    this.nkSt2 = {};
    this.warm = null; // shader warm-up in progress (prewarm)
    this.warmKey = ''; // quality + map the programs were last warmed for

    this.input = new Input(renderer.canvas);
    this.input.sensitivity = settings.sensitivity || 1;
    this.input.invertY = !!settings.invertY;
    this.input.rawInput = settings.rawMouse !== false;
    // Ctrl+W (crouch + forward) must not close the tab: fullscreen with the keys locked, else a "Leave site?" prompt
    // (not between two servers on a deploy: the place is kept there, and a new build reloads the page itself: moveBack)
    this.keyGuard = new KeyGuard(() => this.state === 'playing' && !this.moving);
    this.keyGuard.fullscreen = settings.fullscreen !== false;
    this.joinHold = false; // the mouse and the screen were asked for on the click on Join, and the join is not done (holdForJoin)
    this.input.onRequestLock = () => this.keyGuard.engage(this.joinHold);
    this.keyHints = new KeyHints(this); // names the key on the HUD at the moment it would help
    this.onboarding = new Onboarding(this); // a new player's walkthrough, and the first-time tips (onboarding.js)
    this.conn = new Connection({
      snapshot: (r) => this.onSnapshot(r),
      world: (seed, act) => this.onWorld(seed, act),
      inventory: (r) => this.onInventory(r),
      chat: (id, flags, text) => this.onChat(id, flags, text),
      players: (r) => this.onPlayers(r),
      looks: (ids) => this.onLooks(ids),
      progress: (r) => this.onProgress(r),
      board: (b) => this.ui.setBoard(b),
      cards: (m) => this.cards.onMessage(m), // (Dead Hand: game/cards.js)
      pledge: (m) => this.onPledge(m), // the pledge window as a run begins (server/pledge.js)
      voice: (from, payload) => this.voice.onSignal(from, payload),
      // (ENDED_CODE: an admin closed the game or removed this player - the reason is said, and nothing rejoins)
      close: (code, reason) => this.onDisconnect(code, code === ENDED_CODE ? reason || 'This game was ended by an admin.' : ''),
    });
    this.voice = new Voice(this.conn, audio);
    this.cards = new CardsClient(this); // Dead Hand, the card game: the collection, decks, asks, a match or a trade
    this.voice.onState = (s) => this.ui.setVoiceState({ ...s, speakers: this.speakers() });
    this.env = new Environment(this.scene);
    this.weather = new Weather();
    this.weather.onStrike = (s) => this.onLightning(s);
    this.lights = new Lights(this.scene, this.camera, renderer.q);
    this.vm = null; // built with the first world (ensureViewModel), not here: the splash has to paint first
    this.vmItem = -1;
    // the dead are drawn as a crowd: one draw call for all of a kind, one texture for all their bones (render/crowd.js)
    this.crowd = new Crowd(this.scene, getCrowdMaterial(), crowdBones, () => (this.renderer.q.shadowDist || 60) + 15);
    this.entities = new Entities(this);
    this.fixtures = new FixtureUI(this); // the chapel bell and the Relay Station's radio: prompts and notices
    this.radio = new RadioClient(this); // the walkie-talkie in slot 6: keyed, on the air, its static
    this.gun = new GunClient(this); // the mounted gun at the Army Checkpoint
    this.cat = new CatClient(this); // the stray cat, in somebody's arms
    this.rockets = new RocketsClient(this); // our own RPG grenades in flight
    this.fair = new FairClient(this); // the Tri-County Fair: its rides, its lights, who sits where
    this.handcar = new HandcarClient(this); // the handcars on the railway: where they are drawn, who rides them
    this.vehicles = new VehicleClient(this); // the mopeds, cars and bicycles of the mainland: drawn, ridden, driven
    this.skidT = 0;
    this.highlight = new Highlight(this); // the faint outline on what [E] would act on
    this.power = new PowerViews(this); // the generator and its floodlights: their lights, sound and [E]
    this.skyflares = new SkyFlares(this); // flare gun flares: drawn, flown (our own), and their light on the world
    this.prediction = new Prediction(null);
    this.inputBuffer = new InputBuffer(); // holds a fire / reload / jump pressed a moment early until it can act
    this.setupInputHandlers();
    this.touchpad = new TouchPad(this); // a phone's stick and buttons (touch mode: game/touchmode.js)
    // a click on the canvas takes the pointer back when the lock was lost or refused
    renderer.canvas.addEventListener('click', () => {
      if (this.state === 'playing' && !this.input.locked && !this.ui.inventoryOpen && !this.ui.isTyping()) this.input.requestLock();
    });
  }

  // ---------------------------------------------------------------- frame
  update(dt) {
    if (this.building) return; // (a world half built: nothing of it is updated, nor drawn - main.js)
    this.frame++;
    this.time += dt;
    const time = this.time;
    this.lookWarmer.tick(dt);
    // a warm-up ends here, ahead of this frame's draw: when its programs are built, or now if play has begun
    if (this.warm && (this.warm.ready || this.state === 'playing')) this.finishPrewarm();
    const menu = this.state === 'menu' || !this.world;
    this.touchpad.update();
    this.renderer.setCenter(menu ? this.ui.splash.sceneX : 0.5); // (beside the splash's menu, the scene is off-centre)
    if (menu) {
      this.endCine();
      return this.updateMenu(dt);
    }
    const cine = this.updateCine();
    const s = this.prediction.state;
    const self = this.self;
    const inp = this.input;

    // the mouse wheel: the structures with the hammer out, or the weapons carried
    const wheel = inp.consumeWheel();
    if (wheel) this.onWheel(wheel, s);
    // The pointer held with nothing up is play, and a screen up has the pointer (onLockChange keeps both). Should any
    // path still leave the input off under a held pointer, the trigger would be dead with Esc ignored: not past a frame.
    // (Not on the way to the end screen or between two servers on a deploy: the input is off there on purpose.)
    if (inp.locked && !this.moving && !this.overlay && !this.ui.pauseOpen && !this.ui.isTyping()) {
      if (this.screenUp()) inp.exitLock();
      else if (!inp.enabled) inp.enabled = true;
    }
    inp.buildMode = s.slot === SLOT_BUILD && !s.zombie;
    // prediction
    const buttons = cine ? 0 : this.vehicles.shape(this.gun.shape(self.alive ? inp.sample() | this.fair.press | this.handcar.press : 0)); // (manning the mounted gun: its trigger, not the weapon's. fair.press, handcar.press: [E] getting out of a seat, off a handcar)
    if (!self.alive || !inp.enabled) this.inputBuffer.clear(); // an early press must not outlive a death or a menu
    let attacked = false;
    const onEvents = (evs, st) => {
      for (const ev of evs) if (ev.type === 'fire' || ev.type === 'melee') attacked = true;
      this.onLocalEvents(evs, st);
    };
    const ran = this.prediction.step(dt, buttons, inp.yaw, inp.pitch, onEvents, this.inputBuffer);
    if (ran > 0) inp.clearLatch();
    if (this.gun.commands(ran)) attacked = true; // the mounted gun is fired by the same commands, outside the simulation
    // a packet carries one render time, the one of the frame it leaves in, and the server rewinds its targets to
    // that for every command in the packet: a shot or a swing goes out in its own frame instead of waiting for
    // the batch to fill, or it would be judged against where things stood a frame or two after it was aimed
    this.sendCommands(dt, attacked);
    this.sendCrafts(dt);
    this.advanceClock(dt);
    this.fair.update(dt, time); // (the ride clock of this frame: riders, ourselves included, are placed by it)
    this.handcar.update(dt); // (where each handcar is drawn this frame: their riders are placed on them)

    // camera
    this.prediction.renderPos(dt, this.renderPos);
    const rp = this.renderPos;
    this.fair.carry(rp);
    this.vehicles.update(dt, rp); // (each vehicle where it is drawn this frame; in one, the eye is its seat's)
    const hspeed = Math.hypot(s.vx, s.vz);
    // afloat (shared/swim.js): the hands are swimming, the view rides the water, the stride is a stroke
    const swim = !!self.alive && swimming(this.world, s);
    if (swim !== this.swimming) this.onSwim(swim);
    this.updateCamera(dt, time, s, buttons, cine, hspeed, swim);
    const cam = this.camera;
    const wdef = heldDef(s); // (a pair's numbers for two of the gun: shared/akimbo.js)
    const aiming = this.updateZoom(dt, s, buttons, cine, wdef, swim);
    this.updateReloadSound(s, wdef);

    // viewmodel
    const [ldx, ldy] = inp.consumeLook();
    const lk = this.settings.weaponSway === false ? 0 : LOOK_PER_PX * inp.sensitivity; // (the look of this frame, in radians)
    this.updateViewModel(dt, time, s, buttons, cine, hspeed, swim, aiming, ldx * lk, ldy * lk);
    this.updateSelfBody(dt, s, rp, time, hspeed);
    this.updateFlames(dt);
    this.updateFootsteps(dt, s, rp, hspeed, swim);

    // flashlight: local prediction, server authoritative after a moment
    if (this.localFlashT > 0) this.localFlashT -= dt;
    else this.localFlash = !!self.flashlight;

    // entities
    this.entities.update(dt, this.renderTick, time, cine ? cam.position : rp);
    if (cine) this.entities.hidePlayers(); // (they are in the car, or the plane: the cutscene draws them there)
    this.live?.update(dt, this.global, !!cine);
    this.rockets.update(dt);
    this.skyflares.update(dt, cam); // (after the entities: their fires are gathered; before the environment and the lights)
    this.gun.update(dt, ldx * lk, ldy * lk);

    // interaction target, and the places reached
    this.updateLookTarget();
    this.highlight.update(dt);
    this.updateBuildGhost(s);
    this.updatePlaces(dt, s, rp, cine);
    this.pings = this.pings.filter((p) => time - p.t < PING_LIFE);

    // environment, and what it sounds like
    this.updateSurroundings(dt, time, s, rp, cine);

    // overlays by phase
    this.updateOverlays();
    this.radio.update(s);
    this.cards.update(dt); // (Dead Hand: the practice table's clock and the computer's moves, the screen shut on a fall)
    // the drop key held long enough, and the ring every held key shows
    this.updateDropHold(dt, s);
    this.updateHoldRing(dt);
    // HUD
    this.updateHud(dt, s, aiming, wdef);
    this.onboarding.update(dt);
    this.keyHints.update(dt);
    if (this.faceCar > 0) this.turnToCar(dt);
    if (this.ui.mapOpen) this.updateMap();
    this.updateBoard();
    this.updateTalking();
    this.updatePost(dt, time, s);
  }
}

installParts(Game);
