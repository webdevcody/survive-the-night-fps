// Every weapon, one file each. A weapon's file holds all there is to it on both sides of the wire: its item id, its
// item definition (ITEM_DEFS), its numbers (WEAPONS), its recipe, what it salvages into, the feat a kill with it counts
// for, and for a gun the size of its bullet holes, the shot the others hear and the kick in first person. defs.js,
// achievements.js, surfaces.js and the client's shots (client/game/game/shots.js) build their tables from this list.
//
// To add a weapon: a new file here, and its line in each of the two lists below (kept in file-name order, so two new
// weapons only meet on a line when their names sort next to each other). The client draws it from a file of the same
// name in client/render/models/weapons/ (its model builder, its first-person vm entry, its hand poses and how its
// pickup lies: see that folder's index.js) and its icon from one in client/ui/icons/; each of those folders has an
// index.js list to add it to as well. scripts/test-weapons.js checks that every weapon here has all of that.
//
// The fields of a weapon's file:
//   key        its name in ITEM (ITEM.REVOLVER)
//   id         its item id: part of the wire protocol, never renumbered; unique among all items (checked at load)
//   def        its ITEM_DEFS row
//   stats      its WEAPONS row
//   recipe     its RECIPES row without id and out ({ n, cost, station, schem }), or null if it cannot be made
//   salvage    its SALVAGE row, or null
//   feat       the achievement a kill with it counts for (achievements.js KILL_FEATS), or null
//   akimbo     optional: true for a gun that can be held two at once, a pair (shared/akimbo.js)
//   (melee only)
//   blow       the key in BLOW of how it strikes (surfaces.js blowOf: the marks it leaves)
//   pry        s it takes to force a car's boot open with it (trunk.js PRY.time)
//   (guns only, not melee)
//   hole       its bullet hole's size next to a rifle's (surfaces.js shotScale), or null for 1
//   shotSound  the key in SOUND of the shot the others hear (client/game/game/shots.js), or null for none
//   kick       optional: first-person [muzzle flash scale, camera shake] (client/game/game/shots.js; default [1, 0.06])

import ak47 from './ak47.js';
import atRifle from './at-rifle.js';
import bat from './bat.js';
import crossbow from './crossbow.js';
import dbShotgun from './db-shotgun.js';
import deagle from './deagle.js';
import flamethrower from './flamethrower.js';
import flareGun from './flare-gun.js';
import hammer from './hammer.js';
import huntingRifle from './hunting-rifle.js';
import knife from './knife.js';
import m4a1 from './m4a1.js';
import machete from './machete.js';
import mp5 from './mp5.js';
import nunchaku from './nunchaku.js';
import pistol from './pistol.js';
import revolver from './revolver.js';
import rpg from './rpg.js';
import shotgun from './shotgun.js';
import spikedBat from './spiked-bat.js';

// (in item id order, whatever order the lines are in)
export const WEAPON_LIST = [
  ak47,
  atRifle,
  bat,
  crossbow,
  dbShotgun,
  deagle,
  flamethrower,
  flareGun,
  hammer,
  huntingRifle,
  knife,
  m4a1,
  machete,
  mp5,
  nunchaku,
  pistol,
  revolver,
  rpg,
  shotgun,
  spikedBat,
].sort((a, b) => a.id - b.id);
