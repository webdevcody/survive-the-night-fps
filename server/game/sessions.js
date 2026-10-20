// Coming and going: a socket opens (onOpen) and sends its messages (onMessage); a JOIN makes a player of it
// (handleJoin, createPlayer) or puts a held one back in their own body (resume). A dropped player is held for a
// while (onClose, hold), safe until they are back and playing (safe, arrived); one who leaves takes their starting
// kit with them (parkKit) and drops the rest (removePlayer).
import { SERVER_TICK_RATE, HISTORY_TICKS, PHASE, PLAYER_MAX_HP, FLASHLIGHT_MAX, SLOT_PISTOL, SLOT_MELEE, SLOT_BUILD } from '../../shared/constants.js';
import { ITEM, AMMO, NOTIFY } from '../../shared/defs.js';
import { C2S, S2C, ENT, REJECT_REASON, LEFT_CODE, CHATF, WELCOMEF, PROTOCOL_VERSION, Writer, Reader, usePos } from '../../shared/protocol.js';
import { XP_SRC } from '../../shared/progress.js';
import { createPlayerState } from '../../shared/playersim.js';
import { ClientView } from '../snapshot.js';
import { createInventory, removeItem } from '../inventory.js';
import { idKey } from '../stats.js';
import { PLEDGE } from '../../shared/pledge.js';
import { CHARACTER_NONE, characterFor } from '../../shared/characters.js';
import { readLook, canonicalBytes } from '../../shared/appearance.js';
import { STARTER_TOOLS, starterKit } from './survivors.js';

const LEFT_KITS_MAX = 64; // kits remembered for players who left this run (parkKit)
// Coming and going. An address may join twice the lobby in one go, then once every JOIN_EVERY seconds: more than
// a household reloading its browsers gets near (admitJoin). The join / leave chat lines of everybody together
// get two lobbies' worth, then one every GREET_EVERY seconds; past that, players come and go unannounced.
const JOIN_EVERY = 4;
const GREET_EVERY = 10;
// A dropped player (connection lost, browser crashed or closed) keeps their place this long (onClose / hold / resume).
// The client closes with LEFT_CODE when "Leave game" is pressed: that one goes at once. REJOIN_GRACE_SECONDS: tests.
export const REJOIN_GRACE = +(process.env.REJOIN_GRACE_SECONDS || 60);
const DEAD_CONN = { send() {}, close() {}, closed: true, slot: -1, user: null, ip: '' };
// Back is not playing yet. A JOIN gives a held player their body back at once, but their browser then builds the
// valley and its shaders before it draws a frame or sends a command (seconds; after a deploy's reload, up to half a
// minute), and all that time the body stood there for the dead. So a player who is back stays as safe as a held one
// (Game.safe) until their client is plainly running - commands in ARRIVE_TICKS ticks (a quarter of a second of frames:
// a page still building its valley or its shaders sends none, as its frame loop is held; the client finishes its
// shader warm-up before the first command of a game it joins, Game.update), or anything they do - or ARRIVE_MAX seconds
// have passed; after a drop, never longer than what was left of the grace they had anyway, so coming back is no more
// of a shelter than staying away was. ARRIVE_SECONDS: tests (0: none of this).
const ARRIVE_MAX = +(process.env.ARRIVE_SECONDS ?? 45);
const ARRIVE_TICKS = Math.ceil(SERVER_TICK_RATE / 4);
// A game brought over from the last server does not run until one of its players is playing again (or somebody new
// is), or this many seconds of the clock on the wall have passed: the day does not burn down and the dead do not
// close in on a game whose every player is still on their way back. HANDOFF_FREEZE_SECONDS: tests (0: it runs on).
export const HANDOFF_FREEZE = +(process.env.HANDOFF_FREEZE_SECONDS ?? 45);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const methods = {
  onOpen(conn) {
    const session = { conn, player: null, ip: conn.ip || '', msgCount: 0, msgWindow: 0 };
    this.sessions.add(session);
    return session;
  },
  // code: the socket's close code. A player whose connection dropped (or whose browser crashed or closed) is held for
  // REJOIN_GRACE seconds rather than removed: they stay where they were, safe - the dead don't go for them, nothing hurts
  // them, a downed one doesn't bleed - and a JOIN from the same account or browser in that time puts them back in their
  // own body with everything they had (handleJoin -> resume). Only "Leave game" (LEFT_CODE), or a player nobody could
  // know again (no account, no browser id), leaves at once; the held are removed when their time is up (update).
  onClose(session, code = 0) {
    this.sessions.delete(session);
    const p = session.player;
    if (!p) return;
    if (code !== LEFT_CODE && p.rejoinKey && (this.phase === PHASE.DAY || this.phase === PHASE.NIGHT || this.phase === PHASE.CROSSING)) this.hold(p);
    else this.removePlayer(p);
  },

  // grace: seconds they have to come back. handoff: they were brought over from the last server (gamestate.js), and
  // quiet: nobody is told (everybody was moved).
  hold(p, { grace = REJOIN_GRACE, quiet = false, handoff = false } = {}) {
    p.away = { since: this.time, grace, handoff };
    p.session = { conn: DEAD_CONN, player: p, ip: '', msgCount: 0, msgWindow: 0 }; // (whatever the game still sends them goes nowhere)
    p.cmdQueue.length = 0;
    p.hold = null;
    this.endUse(p);
    this.releaseHolds(p); // (a leaper or a roper on them lets go)
    this.cards.hold(p); // (their trade and their asks are called off; a match waits for them, its clock stopped)
    this.playersDirty = true;
    if (!quiet) this.systemChat(`${p.name} lost connection - holding their place for ${grace} seconds.`);
    this.log(`hold ${p.name}: ${handoff ? 'from the last server' : 'dropped'}, ${grace} s to come back`);
  },

  // A player's account or browser has joined again while their old socket is still open here: that socket is let go -
  // closed, as one a newer join replaced, and nothing it still sends counts - and they are held for resume to take over.
  takeOver(p) {
    const old = p.session;
    this.sessions.delete(old);
    old.player = null;
    old.conn.replace?.('You joined this game again from another page.');
    this.hold(p, { quiet: true });
    this.log(`take over ${p.name}: joined again while their old socket was still open`);
  },

  // a held player is back (a JOIN from the same account or browser): this session takes over their body
  resume(session, p) {
    const moved = p.away?.handoff;
    const left = p.away ? Math.max(0, p.away.grace - (this.time - p.away.since)) : 0;
    p.away = null;
    p.arriving = ARRIVE_MAX > 0 ? { until: this.time + (moved ? ARRIVE_MAX : Math.min(ARRIVE_MAX, left)), n: 0, tick: -1 } : null;
    p.session = session;
    session.player = p;
    p.admin = !!session.conn.user?.isAdmin || this.devAdmin;
    // a new client: it knows nothing yet - everything is sent again as to a newcomer, and its commands count from 0
    p.cmdQueue.length = 0;
    p.lastSeq = 0;
    p.hasSeq = false;
    p.recvSeq = 0;
    p.view = new ClientView();
    p.selfSync = true;
    // (what the old client was sent: writeSelf, writeGlobalFor and the player list only send what differs from it, and
    // the new one starts from its defaults - a held zombie would come back to a survivor's HUD)
    p.selfCache = null;
    p.globalCache = null;
    p.listVer = -1;
    p.snapTick = -2;
    p.ackSent = 0;
    p.invDirty = true;
    p.progDirty = true; // (their XP too)
    p.progT = -99;
    this.sendWelcome(session, p);
    this.tellUsedUp(p.id);
    this.tellFriendCodes(p);
    this.tellLooks(p);
    this.bestiary.join(p);
    this.cards.join(p); // (their collection, decks, asks and a match or trade of theirs: sent again)
    this.loadouts.join(p);
    this.sendChat(p, 0, CHATF.SYSTEM, moved ? 'The server was updated while you played: you are back where you were, with what you had.' : 'Reconnected: you are back where you were, with what you had.');
    if (!moved) this.systemChat(`${p.name} reconnected.`);
    this.playersDirty = true;
    this.globalDirty = true;
    this.log(`resume ${p.name}`);
  },
  // Held, or back and not playing yet (ARRIVE_MAX): nothing hurts them, the dead do not go for them, a downed one does
  // not bleed.
  safe(p) {
    if (p.away) return true;
    if (!p.arriving) return false;
    if (this.time < p.arriving.until) return true;
    p.arriving = null;
    return false;
  },
  // Everybody here has a new world to build - the mainland, a new run's island - and their page holds for as long as
  // that takes (seconds; more on a slow machine), nothing on their screen, while the game runs on. They are arriving
  // again: as safe as one back from a drop (safe) until their page is running - ARRIVE_TICKS ticks of commands, or
  // anything they do (arrived) - or ARRIVE_MAX at most. A page that builds it quickly is playing a few ticks later.
  // (Only a page that was sending commands - hasSeq: what has none to stop sending, a test's or a bot's that never
  // sends any, is as it was)
  newWorldForAll() {
    if (ARRIVE_MAX <= 0) return;
    for (const p of this.players.values()) if (p.session && !p.away && p.hasSeq) p.arriving = { until: this.time + ARRIVE_MAX, n: 0, tick: -1 };
  },
  // a command packet from one who is back: their client is running. ARRIVE_TICKS ticks with one, and they are playing
  arrived(p) {
    const a = p.arriving;
    if (!a || a.tick === this.tick) return;
    a.tick = this.tick;
    if (++a.n >= ARRIVE_TICKS) p.arriving = null;
  },
  // A game brought over from the last server, with nobody playing in it yet (load, HANDOFF_FREEZE)
  frozen() {
    if (!this.thawAt) return false;
    let playing = false;
    for (const p of this.players.values()) if (!p.away && !p.arriving) playing = true;
    if (!playing && this.players.size && Date.now() < this.thawAt) return true;
    this.thawAt = 0;
    this.log(`${playing ? 'the game runs on: a player is back' : 'the game runs on: nobody came back in time'} (runs again: stood still ${Date.now() - this.frozenAt} ms)`);
    return false;
  },

  onMessage(session, data) {
    usePos(this.world); // (positions in what this message says are in this world's units: protocol.js)
    // basic flood protection
    const now = this.time;
    if (now - session.msgWindow > 1) {
      session.msgWindow = now;
      session.msgCount = 0;
    }
    if (++session.msgCount > 200) return;
    let r;
    try {
      r = new Reader(data);
      const type = r.u8();
      const p = session.player;
      if (type === C2S.JOIN) return this.handleJoin(session, r);
      if (type === C2S.PING) {
        const t = r.f64();
        const w = new Writer(16);
        w.u8(S2C.PONG);
        w.f64(t);
        session.conn.send(w.bytes());
        return;
      }
      if (!p) return;
      switch (type) {
        case C2S.INPUT:
          return this.handleInput(p, r);
        case C2S.ACTION:
          return this.handleAction(p, r);
        case C2S.CHAT:
          return this.handleChat(p, r.str());
        case C2S.BOARD:
          return this.sendBoard(p);
        case C2S.CARDS:
          return this.cards.onMessage(p, r);
        case C2S.PLEDGE: {
          if (r.view.getUint16(r.o, true) > PLEDGE.MSG_MAX) return;
          let data = null;
          try {
            data = JSON.parse(r.str());
          } catch {
            return;
          }
          return this.pledges.onMessage(p, data);
        }
        case C2S.VOICE: {
          const target = r.u16();
          const payload = r.str();
          const tp = this.players.get(target);
          if (tp && payload.length < 20000) {
            const w = new Writer(payload.length * 3 + 16);
            w.u8(S2C.VOICE);
            w.u16(p.id);
            w.str(payload);
            tp.session.conn.send(w.bytes());
          }
          return;
        }
      }
    } catch (err) {
      this.log('bad message', err.message);
    }
  },

  // A rate allowance: a.n is how much of it was used lately, wearing off by one every `every` seconds (a.t: when
  // that was last worked out). Uses one more unless that would take it past `burst`.
  allow(a, burst, every) {
    a.n = Math.max(0, a.n - (this.time - a.t) / every);
    a.t = this.time;
    if (a.n + 1 > burst) return false;
    a.n++;
    return true;
  },
  // May this session's address join now? (JOIN_EVERY; an allowance that has worn off is forgotten in update)
  admitJoin(session) {
    let a = this.joins.get(session.ip);
    if (!a) this.joins.set(session.ip, (a = { n: 0, t: this.time, refused: false }));
    const ok = this.allow(a, 2 * this.maxPlayers, JOIN_EVERY);
    if (!ok && !a.refused) this.log(`join refused: too many in a row from ${session.ip || 'one address'}`);
    a.refused = !ok;
    return ok;
  },

  // S2C.WELCOME: who they are in this game, and the world and clock it is on (a newcomer, and one back in their body)
  sendWelcome(session, p) {
    const w = new Writer(64);
    w.u8(S2C.WELCOME);
    w.u16(p.id);
    w.u32(this.seed >>> 0);
    w.u32(this.tick);
    w.u8(SERVER_TICK_RATE);
    w.u8(this.maxPlayers);
    w.u8(p.admin ? WELCOMEF.ADMIN : 0);
    w.u8(this.act); // which of the run's two maps that seed is to be built as (shared/acts.js)
    session.conn.send(w.bytes());
  },

  handleJoin(session, r) {
    if (session.player) return;
    const version = r.u8();
    let name = r.str().replace(/[^\p{L}\p{N} _\-.]/gu, '').trim().slice(0, 16) || 'Survivor';
    // who they are to the leaderboard: for PlayerStats.enter alone, never logged and never sent on. (A client that
    // sends none - the test bots - plays like anyone else, and nothing is kept for it.)
    const pid = r.left > 0 ? r.str() : '';
    // the survivor they chose to be (shared/characters.js): a trailing byte an older client leaves off, which gets the
    // look picked from their id as before; a value out of range is treated the same (characterFor)
    const choice = r.left > 0 ? r.u8() : CHARACTER_NONE;
    // ...and a custom survivor's look after it (the character creator: shared/appearance.js), kept as its canonical
    // bytes, a plain array (it goes into the saved game on a deploy). Anything that is not a look: none, the character
    let look = null;
    if (r.left > 0) {
      try {
        const b = readLook(r);
        look = b ? canonicalBytes(b) : null;
      } catch {
        look = null;
      }
    }
    // signed in to an account (server/auth.js: the network thread knew them by their session cookie, and says so
    // on the socket: room-worker.js), they play under its name whatever the JOIN says
    const account = session.conn.user || null;
    if (account) name = account.name;
    const reject = (reason) => {
      const w = new Writer(4);
      w.u8(S2C.REJECT);
      w.u8(reason);
      session.conn.send(w.bytes());
    };
    if (version !== PROTOCOL_VERSION) return reject(REJECT_REASON.VERSION);
    // back from a drop inside the grace minute, or from a deploy: their own body (onClose / hold). (A guest by the
    // hash of their browser id, never the id: it is the key to their leaderboard record, and a deploy saves this.)
    const key = account ? `a:${account.id}` : UUID_RE.test(pid) ? `g:${idKey(pid)}` : '';
    // ...or back before the game has even seen them go: their old link is dead but its socket has not closed here yet
    // (the page notices a lost connection long before the server does: up to the socket's idle timeout). This one
    // takes the body over, and the old socket is let go (takeOver). That is a page coming back into the game it was
    // playing (conn.back: main.js rejoin), or anyone of theirs at a full game, where the old socket still fills their
    // seat (Room.mayComeBack let it in). Otherwise the same browser in another tab is a player of its own, as ever.
    // (Without conn.back a drop with a seat free made a second, new player with a starting kit beside the old body.)
    if (key) {
      const full = this.players.size >= this.maxPlayers;
      const back = full || session.conn.back === true;
      // (theirs in two tabs: a held one first, else the one heard from longest ago - its socket is the dead one)
      let q = null;
      for (const c of this.players.values()) {
        if (c.rejoinKey !== key || (!c.away && !back)) continue;
        if (!q || (c.away && !q.away) || (!c.away === !q.away && c.session.msgWindow < q.session.msgWindow)) q = c;
      }
      if (q) {
        if (!q.away) this.takeOver(q);
        q.rec ||= this.records.enter(pid, q.name, account); // (one brought over from the last server has none here yet)
        return this.resume(session, q);
      }
    }
    if (this.players.size >= this.maxPlayers) return reject(REJECT_REASON.FULL);
    if (!this.admitJoin(session)) return reject(REJECT_REASON.FULL); // (the one "try again later" the client knows)
    // unique names
    const names = new Set([...this.players.values()].map((p) => p.name));
    let base = name;
    let k = 2;
    while (names.has(name)) name = `${base.slice(0, 13)}#${k++}`;
    // an emptied server rolls its next valley on the tick after (resetToWaiting): a join that beats that tick
    // rolls it here, so the seed in WELCOME is the one this run is played on
    if (this.phase === PHASE.WAITING) this.rollWorld();
    this.buildMainland(true); // (a join during the crossing: the mainland it is put down on has to stand)

    const p = this.createPlayer(session, name);
    // no entity id left for them: turned away like from a full server, to try again once ids have come back
    if (!p) return reject(REJECT_REASON.FULL);
    session.player = p;
    p.admin = !!account?.isAdmin || this.devAdmin;
    p.character = characterFor(choice, p.id);
    p.look = look;
    p.rejoinKey = key; // who can take this body back after a drop ('' : nobody - no account and no browser id)
    p.rec = this.records.enter(pid, base, account);
    p.account = account ? account.id : ''; // their account's id, '' for a guest
    p.guestKey = account ? '' : idKey(pid); // a guest's browser id as stats.js files it ('' without one): never the id itself
    p.friend = account ? account.name : ''; // the account a friend request goes to (S2C.FRIENDS); '' for a guest
    this.loadProgress(p);
    this.sendWelcome(session, p);
    if (this.phase === PHASE.WAITING) this.startGame();
    else if (this.fallen.delete(this.leaverKey(p)) && (this.phase === PHASE.DAY || this.phase === PHASE.NIGHT)) {
      // died in this run and came back in before sunrise: they are what they were, and wait for dawn with the rest
      // of the dead - a reload is no way round a death, and nor is another name (leaverKey). The kit parked for them
      // stays where it is: the dead carry nothing, and returnFallen replaces it at sunrise.
      this.spawnPlayerZombie(p);
      this.sendChat(p, 0, CHATF.SYSTEM, `You died in this run: you are one of them ${this.escape.active ? 'to the end of it' : 'until dawn'}.`);
    } else {
      // a run in progress: beside the team, with a kit for the day - or, back in the run they left, with what they
      // left with (parkKit)
      const left = this.leftKits.get(this.leaverKey(p));
      this.leftKits.delete(this.leaverKey(p));
      this.spawnHuman(p, left || starterKit(this.day, this.diff), true);
      if (left) this.sendChat(p, 0, CHATF.SYSTEM, 'Back in the same run: you have what you left with.');
    }
    this.vehicles.provide(); // (a seat for them too: the next of the bridgehead's vehicles, if the team has outgrown the rest)
    this.pledges.joined(p); // (a run that has just begun: they are in its pledge window too)
    this.track.join(p);
    this.ach.join(p);
    this.bestiary.join(p);
    this.cards.join(p);
    this.loadouts.join(p);
    // what the team has used up before they came (a run this join started has cleared it: NEW_GAME says so)
    this.tellUsedUp(p.id);
    this.notify(NOTIFY.PLAYER_JOINED, p.id);
    this.tellFriendCodes(p);
    this.tellLooks(p);
    p.greeted =this.allow(this.greets, 2 * this.maxPlayers, GREET_EVERY);
    if (p.greeted) this.systemChat(p.zombie ? `${p.name} is back among the dead.` : `${p.name} joined the survivors.`);
    this.playersDirty = true;
    this.globalDirty = true;
    this.log(`join ${p.name} (${this.players.size}/${this.maxPlayers})`);
  },

  // Once a tick (Game.update): the join allowances that have worn off are forgotten (see allow), and the held whose
  // minute is up are gone (hold)
  sessionUpkeep() {
    if (this.tick % 600 === 0) for (const [ip, a] of this.joins) if (this.time - a.t >= a.n * JOIN_EVERY) this.joins.delete(ip);
    if (this.tick % SERVER_TICK_RATE === 0)
      for (const p of [...this.players.values()])
        if (p.away && this.time - p.away.since >= p.away.grace) {
          this.log(`hold ${p.name}: did not come back`);
          this.removePlayer(p);
        }
  },

  // id: the one they had on the last server (gamestate.js), else the next free one
  createPlayer(session, name, id = 0) {
    const p = {
      kind: ENT.PLAYER,
      session,
      name,
      state: createPlayerState(),
      hp: PLAYER_MAX_HP,
      maxHp: PLAYER_MAX_HP,
      armor: 0,
      armorMax: 0,
      armorItem: 0,
      backpackItem: 0, // the backpack worn (ITEM.BACKPACK), 0: none. Worn, it opens BACKPACK_SLOTS more slots (invCap)
      alive: true,
      zombie: false,
      downed: false,
      bleed: 0,
      lastSrc: null,
      revivedBy: 0,
      respawnT: 0,
      inv: createInventory(),
      invDirty: true,
      invSort: false, // something picked up or dropped: the grid is sorted before it goes out (sendTick)
      splitKeep: new Map(), // item -> its count when last split (ACT.SPLIT_INV): kept apart while it stays that (tidyStacks)
      lastDrop: null, // { e, t }: the item entity they last put down from the inventory, and when (ACT.UNDO_DROP)
      kit: null, // the starting kit they were issued (spawnHuman)
      flashlight: false,
      battery: FLASHLIGHT_MAX,
      lastDamageT: -99,
      intensity: 0, // how hard tonight is landing on them, 0..PACE.MAX (server/director.js)
      useItem: null,
      hold: null,
      kills: 0,
      zkills: 0,
      deaths: 0,
      rec: null, // their record on the leaderboard (stats.js); null for a player who joined without an id
      loadoutEntered: false,
      loadoutApplied: false,
      loadoutItems: [],
      loadoutMods: null,
      loadoutEffects: null,
      loadoutWeaponEffects: {},
      loadoutNight: {},
      loadoutWeapons: [null, null, null, null, null],
      loadoutArmor: null,
      loadoutBackpack: null,
      // experience and perks (shared/progress.js, setProgress). Their XP is xpBase + this run's, by source
      xpBase: 0, // on their record before this run, once the stats have said (xpLoaded)
      xpRun: new Array(XP_SRC.length).fill(0),
      xpLoaded: false,
      best: 0, // the furthest day they have ever seen dawn on (from the record)
      perks: 0, // the perks in force (a bitmask of ids; s.perks carries it into the simulation)
      perksNext: -1, // picked during a night: in force from dawn (-1: nothing waiting)
      nightKills: 0, // kills this night (or day): the first XP.killsFull carry the fresh-night bonus
      nightRevives: 0,
      lastChance: false, // Second Chance spent this night
      progDirty: true, // S2C.PROGRESS is out of date (sendProgress)
      progT: -99,
      admin: false, // may run admin chat commands: set from the signed-in account in handleJoin/resume
      boardT: -99, // when they were last sent the leaderboard
      cmdQueue: [],
      cmdBudget: 6,
      lastSeq: 0,
      hasSeq: false,
      recvSeq: 0, // the newest command that has come in, run or not (useItem)
      renderTick: 0,
      renderFrac: 0,
      view: new ClientView(),
      shadow: createPlayerState(), // the state right after the last command: what the client's prediction holds
      selfSync: true, // the client has to rebase its prediction on our state (see writeSelf)
      snapTick: -2, // tick and acked command of the last snapshot it was sent
      ackSent: 0,
      pingAt: 0, // when its latest IN_PING arrived (0 = none waiting)
      hx: new Float32Array(HISTORY_TICKS),
      hy: new Float32Array(HISTORY_TICKS),
      hz: new Float32Array(HISTORY_TICKS),
      chatT: 0,
      chatCount: 0,
      onAir: false, // keying the walkie-talkie, as last sent in the player list
      interactT: 0,
      actionT: 0,
      pingT: 0,
      waypoint: null, // their field-map waypoint { x, z, zone } (zone 255: none), shown to the team in the player list
      fullT: -99, // when they were last told their backpack had no room for something lying there (updateItems)...
      partFullT: -99, // ...and when that something was a car supply
      pinnedBy: 0,
      ropedBy: 0,
      burning: false, // set alight by a flammer (PLAYER_FIRE, updateFire): until it is put out
      douse: 0, // ...how far it has been put out (0-1)
      firePresses: 0, // presses of [Space] since the last tick (each beats a fire down: theirs or a teammate's)
      ping: 0,
      ts: null, // the stint analytics.js is counting for them (null: none)
      rejoinKey: '', // 'a:<account id>' or 'g:<sha-256 of the browser id>': whose JOIN may take this player back after a drop (resume)
      away: null, // dropped and held: { since, grace, handoff } (hold), until they come back or their grace runs out
      arriving: null, // back, and not playing yet: { until, n, tick } (resume, safe), until their client is running
      get x() {
        return this.state.x;
      },
      get y() {
        return this.state.y;
      },
      get z() {
        return this.state.z;
      },
    };
    // (a player without an id must never get into `players`: it would sit there under the key `undefined`)
    if (!(id ? this.spawnEntityAt(p, id) : this.spawnEntity(p))) return null;
    this.players.set(p.id, p);
    return p;
  },

  // Who a leaver is to this run if they come back (fallen, leftKits): their account or browser (rejoinKey), so coming
  // back under another name gets round neither a death nor a used-up kit. Only a player with neither - the test bots -
  // is known by their name. (A key has a ':' in it and a name never does: the two cannot collide.)
  leaverKey(p) {
    return p.rejoinKey || p.name;
  },

  // A leaver takes what is left of their starting kit with them - never more of anything than they were issued - and
  // gets exactly that back if they rejoin this run (leaverKey). Only what they found on top of it is dropped for the
  // team. Dropping the kit and issuing a fresh one on the way back in would let a reconnect loop pile rounds and
  // bandages up at the team's feet, and refill anyone who had used theirs up (or lost them by dying).
  parkKit(p) {
    const kit = p.kit;
    if (!kit) return;
    const s = p.state;
    const left = { mag: 0, ammo: 0, items: [] };
    const gone = p.zombie || !p.alive; // the dead dropped theirs where they fell
    if (!gone) {
      // (a pair of the starting pistol: the second one is theirs to leave behind like the rest of the backpack)
      this.splitPairOff(p, SLOT_PISTOL);
      left.ammo = Math.min(s.ammo[AMMO.P9], kit.ammo);
      s.ammo[AMMO.P9] -= left.ammo;
      if (s.weapons[SLOT_PISTOL] === ITEM.PISTOL) left.mag = Math.min(s.mags[1], kit.mag);
      // The pistol, knife and hammer everyone starts with go along from the slots they are in, and a rejoin brings
      // back those and no others: one dropped for the team or torn down for parts (salvage) stays gone, or a
      // reconnect loop would pile pistols - or the gun parts in them - up at the team's feet
      left.tools = [];
      for (const slot of [SLOT_PISTOL, SLOT_MELEE, SLOT_BUILD]) {
        if (s.weapons[slot] !== STARTER_TOOLS[slot]) continue;
        s.weapons[slot] = 0;
        left.tools.push(slot);
      }
    }
    for (const [item, n] of kit.items) left.items.push([item, gone ? 0 : removeItem(p.inv, item, n)]);
    this.leftKits.delete(this.leaverKey(p));
    this.leftKits.set(this.leaverKey(p), left);
    if (this.leftKits.size > LEFT_KITS_MAX) this.leftKits.delete(this.leftKits.keys().next().value); // (the oldest)
  },

  removePlayer(p) {
    this.track.leave(p); // (before anything of theirs is touched)
    this.ach.leave(p);
    this.releaseHolds(p);
    this.cards.leave(p); // (a match they were playing is lost, asks and a trade being haggled over called off)
    this.loadouts.leave(p);
    this.pledges.leave(p);
    this.parkKit(p); // (they take their starting kit along: only what they found beyond it is dropped)
    this.dropAll(p);
    this.players.delete(p.id);
    this.records.leave(p.rec);
    this.nav.removeField(p.id);
    if (this.dawnReturn && (p.zombie || !p.alive)) this.fallen.add(this.leaverKey(p)); // left dead: dead if they rejoin before sunrise (handleJoin)
    this.removeEntity(p);
    this.notify(NOTIFY.PLAYER_LEFT, 0);
    // (whoever arrived unannounced leaves unannounced; an announced one always gets their line, and it counts)
    if (p.greeted && this.allow(this.greets, Infinity, GREET_EVERY)) this.systemChat(`${p.name} left.`);
    this.playersDirty = true;
    this.log(`leave ${p.name} (${this.players.size}/${this.maxPlayers})`);
    if (this.players.size === 0) this.resetToWaiting();
    else this.checkAllDead();
  },
};
