import { BASE_ITEM as ITEM } from '../items.js';

export default {
  key: 'REVOLVER',
  id: 58, // a sidearm (the pistol's slot): six heavy 9mm rounds, a slow reload
  def: { name: 'Revolver', cat: 'weapon', stack: 1, color: 0x3a3632, desc: 'Six-shot 9mm revolver. Hits much harder than the pistol, but fires slower and takes longer to reload. Takes the pistol\'s place.' },
  // the revolver: the pistol's rounds, six of them, nearly twice as hard and a little tighter. Slower between shots and
  // to reload (a speedloader), so a cylinder does about what a pistol magazine does (330 vs 360) in a longer time;
  // it is the sidearm for picking off heads (110 x 3 kills a walker outright), not for holding off a crowd
  stats: { slot: 1, damage: 55, rate: 0.4, mag: 6, reload: 2.4, ammo: 0, pellets: 1, spread: 0.008, moveSpread: 0.024, recoil: 0.04, range: 140, headMul: 3.0, auto: false, noise: 60, sound: 'pistol' },
  // two gun parts for the lockwork, scrap for the frame and cylinder, wood for the grips
  recipe: { n: 1, cost: { [ITEM.GUNPARTS]: 2, [ITEM.SCRAP]: 3, [ITEM.WOOD]: 1 }, station: 'bench' },
  salvage: { [ITEM.GUNPARTS]: 1, [ITEM.SCRAP]: 1 },
  akimbo: true,
  feat: 'kill_pistol',
  hole: 0.9,
  shotSound: 'PISTOL',
  kick: [1.3, 0.14],
};
