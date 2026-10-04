// A run is played on two maps. Act 1 is the valley: the car broke down on Route 9, and once it is fixed and the final
// stand survived, driving off takes the team over the old bridge to act 2, the mainland, where a wrecked plane on
// Kessler Airfield is the way out. A world is still made from its seed alone: the mainland's seed is the valley's with
// MAINLAND set, so WELCOME, WORLD_RESET and a deploy's save all carry the act in the seed they already send.
// (Valley seeds never have that bit: Game's randomSeed stays under 2^31.)
export const MAINLAND = 0x80000000;

export const isMainland = (seed) => seed >>> 31 === 1;
export const mainlandOf = (seed) => (seed | MAINLAND) >>> 0;
export const valleyOf = (seed) => (seed & 0x7fffffff) >>> 0;
export const actOf = (seed) => (isMainland(seed) ? 2 : 1);

// The way out of each map: what it is called in the HUD, the notices and the prompts, its glyph (client/ui/icons.js)
// and the prop it is drawn as (world.car is where it stands on either map).
//   parts     what it needs, as the HUD lists them        partsOf  ...said of the vehicle ("3 of 7 car supplies")
//   allIn     the card once the last is in                go       what getting in does ("drive away")
//   getIn     the hold's prompt                           board    the card once the engine is warm
//   heard     who hears the engine start                  map      the field map's title
//   where     where the search goes on                    away     the end screen, for whoever was aboard
//   gone      ...for whoever was not (alive)              dead     ...for the dead and the turned
export const VEHICLES = {
  1: {
    name: 'car', Name: 'Car', glyph: 'car', prop: 'car', mine: 'Your car',
    parts: 'supplies', Parts: 'Car supplies', partsOf: 'car supplies', part: 'supply', allIn: 'EVERY SUPPLY IS IN',
    go: 'drive away', getIn: 'get in and drive away', board: 'GET IN THE CAR!', getting: 'Someone is getting in',
    heard: 'Every corpse in the valley heard it', map: 'Harlan Valley', where: 'the valley',
    away: 'The engine roars. You tear down Route 9 and leave the valley behind.',
    gone: 'The car tears down Route 9 without you. The others made it out of the valley.',
    dead: 'The engine roars and the car is gone down Route 9. You stay in the valley with the rest of the dead.',
  },
  2: {
    name: 'plane', Name: 'Plane', glyph: 'plane', prop: 'plane', mine: 'The plane',
    parts: 'parts', Parts: 'Plane parts', partsOf: 'plane parts', part: 'part', allIn: 'EVERY PART IS IN',
    go: 'take off', getIn: 'climb aboard and take off', board: 'GET ABOARD!', getting: 'Someone is climbing aboard',
    heard: 'Every corpse for miles heard it', map: 'The Mainland', where: 'the mainland',
    away: 'The engine catches, the wheels leave the runway, and the dead shrink to specks below.',
    gone: 'The plane climbs away over the treeline without you. The others made it off the mainland.',
    dead: 'The plane climbs away over the treeline. You stay on the mainland with the rest of the dead.',
  },
};
export const vehicleOf = (seed) => VEHICLES[actOf(seed)];
