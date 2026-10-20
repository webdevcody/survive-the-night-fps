import { BASE_ITEM as ITEM } from '../items.js';

export default {
  key: 'SHOTGUN',
  id: 60,
  def: { name: 'Shotgun', cat: 'weapon', stack: 1, color: 0x4a3a2a, desc: 'Devastating up close.' },
  stats: { slot: 0, damage: 17, rate: 0.85, mag: 6, reload: 0.55, reloadEach: true, ammo: 1, pellets: 9, spread: 0.075, moveSpread: 0.02, recoil: 0.07, range: 45, headMul: 2.0, auto: false, noise: 80, sound: 'shotgun' },
  recipe: { n: 1, cost: { [ITEM.GUNPARTS]: 2, [ITEM.SCRAP]: 3, [ITEM.WOOD]: 2 }, station: 'bench', schem: ITEM.SCHEM_SHOTGUN },
  salvage: { [ITEM.GUNPARTS]: 1, [ITEM.SCRAP]: 1, [ITEM.WOOD]: 1 },
  akimbo: true,
  feat: 'kill_shotgun',
  hole: 0.55,
  shotSound: 'SHOTGUN',
  kick: [1.4, 0.25],
};
