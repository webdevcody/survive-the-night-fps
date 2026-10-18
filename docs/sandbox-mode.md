# Sandbox mode: a plan

Issue #131 asks for a **Sandbox** game: the normal game, where everyone in it may use the admin chat commands and nothing
anyone does there counts towards their progress. The issue is labelled **IDEA - DO NOT BUILD**, so this is the plan for
it, not the feature: what it would change, where, the answers proposed for the open questions, and the pieces it would
be built in. Nothing here is in the game yet.

## The short version

The server already has almost all of it. A game made with `devAdmin` (development only, `DEV_ADMIN=1`,
`server/index.js`) gives every player in it the admin commands (`p.admin = ... || this.devAdmin`, `server/game.js`
`handleJoin` / the rejoin path, `server/gameadmin.js` `role`). And every way a game records progress already goes
through a hook that is a no-op when it is not given one: the match tracker (`opts.analytics`), the account's
achievements (`opts.achieve`), the account's bestiary (`opts.bestiary`), all three wired in `server/room-worker.js` from
the room's options (`server/rooms.js`, `Room` constructor). The leaderboard, XP and the furthest day go through
`this.records` (`RemoteRecords` in the worker).

So a sandbox game is: one more option on the game, fixed when it is made, which turns the admin commands on for
everyone in it and gives it records that remember nothing.

## What a sandbox game is

| | Normal game | Sandbox game |
|---|---|---|
| Admin chat commands (`/give`, `/spawn`, `/night`, `/tp`, ...) | admin accounts only | everyone, signed in or not, except the few below |
| Spawn menu (`` ` ``, `WELCOMEF.ADMIN`) | admin accounts only | everyone |
| XP, levels, perk points | earned | not earned (the run's XP may still be shown, marked "not saved") |
| Perks already owned | in force | in force, read only (see the open questions) |
| Leaderboard (kills, nights, ...), lifetime stats | counted | not counted |
| Achievements (accounts and guests) | counted | not counted |
| Bestiary | filled in | not filled in (a play-tester can spawn every kind) |
| Match records (`matches`, analytics, `/stats`) | written | not written |
| Difficulty vote on the end screen | counted | not shown (there is no match to vote on) |
| In the game list | listed if public | listed with a **Sandbox** badge, or invite-only (open question) |
| Quick join | can put you in it | never puts you in one |

## Where it changes

### 1. The option, fixed at creation

- `POST /api/games` (`server/index.js`) takes `sandbox: true` next to `name`, `host`, `inviteOnly`, `maxPlayers` and
  `difficulty`; `Lobby.create` (`server/rooms.js`) keeps it on the `Room`. The `difficulty` option is the model to
  copy: it is chosen in the same form, carried the same way and already survives a deploy.
- `Lobby.quick` skips sandbox games, and a quick join never makes one.
- There is no message or route that changes it afterwards. That is the whole of "a normal game can't be flipped into a
  sandbox mid-round": the flag has no setter.
- `GET /api/games` / `GET /api/games/:code` and `Room.info()` say `sandbox: true`, for the badge and the invite card.
- The admin panel's game list (`/admin`, `server/adminpanel.js`) shows it too.

### 2. Carried over a deploy

A deploy hands every game to the next server (docs/deploys.md). The room's own fields go in its saved record
(`Room` `save`, `rooms.js` around `{ name, host, maker, first, inviteOnly, quick, maxPlayers, difficulty, ... }`) and
come back in the restore (`rooms.js` around `inviteOnly: !!m.inviteOnly, maxPlayers: ...`). `sandbox` is added beside
`difficulty` in both, read as `m.sandbox === true` so a game saved by the build before reads as a normal game. The
game's own state (`server/gamestate.js`) does not need it: the worker is given it in its options on every start.
`STATE_VERSION` does not change (the field is optional and additive).

### 3. Admin commands for everyone

- The worker is given `sandbox` in its options (`rooms.js`, the `opts` passed to the worker), and `Game` keeps it.
- The three places that set `p.admin` become `... || this.devAdmin || this.sandbox`.
- `handleChat` already sends every `/` line from an admin to `debugCommand` and notes it as an `admin` event in the
  match records. In a sandbox there are no match records, so nothing to change there.
- A few commands stay admin-account-only even in a sandbox (proposed): `/step` (holds the game's clock for
  everyone, a tool for filming), `/xp` (writes to the account's record, the one thing a sandbox must never do; the
  records below would make it a no-op anyway, but it should say no rather than seem to work). `debugCommand` gets a
  short deny-list checked when the player's own account is not an admin.
- There is no kick or ban chat command today; those are the admin panel's, which stays admin-only.
- Normal games are unchanged: `p.admin` is what it was whenever `sandbox` is false.

### 4. Nothing recorded

All in the worker, decided once when the `Game` is built:

- **Match records**: no `analytics` hook (`room-worker.js`), so `MatchTracker` is the no-op it already is without a
  database. No `match`, no stints, so `DbStats.addStint` never sees one and `/stats` never counts it.
- **Difficulty votes**: `server/feedback.js` only takes a vote for a match it can find that the voter just finished.
  With no match written, a vote is a 404 already. The end screen should not ask: it hides the poll when the game is
  a sandbox.
- **Leaderboard, XP, furthest day**: `stats` is a records object whose `enter` / `bump` / `best` keep nothing (one
  small class beside `RemoteRecords`). `Game.award` and the board bumps go through it, so nothing reaches
  `player_stats` or the stats file. It should still answer `progress` with what the player has on record, so their
  level and perks are shown and in force (read only).
- **Achievements**: no `achieve` hook covers accounts, but a guest's counts go to their browser as `EVT.ACHIEVE` from
  `AchievementTracker` whatever the hook is (`server/achievements.js`), and the browser keeps them. So the tracker
  needs an "off" that sends nothing at all: one check where it flushes.
- **Bestiary**: the same: no `bestiary` hook for accounts, and `BestiaryTracker` told not to send `EVT.BESTIARY` either,
  or a guest's browser would fill its book.
- **Achievement merge on sign-in** (`POST /api/achievements/merge`) is the browser's own record, which a sandbox has
  not touched, so it needs nothing.

### 5. The client

- **Create game** (`client/ui/games.js`): a third row under Difficulty and Who can join: *Normal* / *Sandbox*, with a
  hint: "everyone can use admin commands; nothing is saved".
- **Browse games** and the invite card: a **Sandbox** badge on the game's row (`gb-meta` line).
- **In the game**: the client hears it in `S2C.ROOM`. `ROOMF` has a spare bit (`ROOMF = { INVITE_ONLY: 1 }` in
  `shared/protocol.js`), so `ROOMF.SANDBOX: 2` needs no new field. An old client ignores a bit it does not know, but a
  `PROTOCOL_VERSION` bump is still the honest thing, since an old client would not show the badge or the "not saved"
  line. A small **SANDBOX** tag on the HUD and in the Esc menu's header.
- **The end screen** (`EndScreen` in `client/ui/menus.js`): instead of the XP bar and the poll, one line: "Sandbox:
  progress was not saved."
- The spawn menu already opens for anyone the server says is admin (`WELCOMEF.ADMIN`), so it follows on its own.

## The open questions, with proposed answers

- **Public or invite-only?** Either, chosen like any game, but **never in quick join**, and listed under Browse games
  only with the badge. A public sandbox is how community play-testers find each other; a player who joins one by
  mistake loses nothing but a run that would not have counted.
- **Existing perks and levels?** **In force, read only.** Testing balance is mostly testing what real players will
  have; a tester who wants a bare survivor can respec for free outside the game. Nothing they do in the sandbox can
  change them (picks made from the menu during a sandbox game still go to the account, as they do from the splash:
  that is not progress, it is spending points already earned).
- **Every admin command for everyone?** Yes, except `/step` and `/xp` (above). `/wipe`, `/map1`, `/mainland` and
  `/cutscene` change the run for everyone in it, which is the point of a test game, but also what a griefer would use:
  that is the reason to keep sandboxes out of quick join.
- **A cap on sandbox games?** They already count towards the per-player limit (one game you made at a time), the
  per-address limit (3, then one a minute) and `max_total_games`. Proposed: a separate `server_settings`
  `max_sandbox_games` (read every 5 s, changeable without a deploy, like `max_total_games`), default 10, so testers
  cannot crowd out real games. `/give` and `/spawn` can already push a game's tick hard; the zombie cap (120) still holds.

## The pieces, each its own PR

1. **Server: the flag and nothing recorded.** `sandbox` through `POST /api/games`, `Lobby`, `Room`, the worker, the
   deploy record; the no-op records; achievements and bestiary off; quick join skips it; `max_sandbox_games`. A test
   (beside `scripts/test-progress.js` / `test-achievements.js`) that plays a sandbox round through a real server's
   worker and checks `player_stats`, `user_achievements`, `user_bestiary` and `matches` are unchanged, and that a
   normal game beside it still records. Risk: Medium (rooms and the deploy record; no migration).
2. **Server: admin commands in a sandbox.** `p.admin` from `sandbox`, the `/step` / `/xp` deny-list. A test that a
   guest's `/give` works in a sandbox and is ignored (sent as chat) in a normal game.
3. **Client: create, browse, badge, end screen.** `ROOMF.SANDBOX`, the protocol bump, the form row, the badges, the HUD
   tag, the end screen line, `/sandbox/ui-test.html` screens for each.

No database migration is needed: nothing new is stored. The flag lives in memory and in the deploy record.

## Acceptance (from the issue)

- Make a sandbox game, join it as a guest and as an ordinary account, and use `/give`, `/spawn`, `/night`: they work.
- Play a full sandbox round (to the escape or a wipe): the account's XP, level, board stats, achievements, bestiary
  and match history are the same before and after; a guest's browser records too.
- A normal game made at the same time records exactly as before, and its non-admin players' `/give` is chat.
