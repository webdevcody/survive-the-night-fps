import { BASE_ITEM as ITEM } from '../items.js';

export default {
  key: 'DB_SHOTGUN',
  id: 65,
  def: { name: 'Double-Barrel', cat: 'weapon', stack: 1, color: 0x5c4028, desc: 'Two barrels of buckshot back to back. Slow to reload.' },
  stats: { slot: 0, damage: 16, rate: 0.22, mag: 2, reload: 1.6, ammo: 1, pellets: 12, spread: 0.1, moveSpread: 0.02, recoil: 0.09, range: 38, headMul: 2.0, auto: false, noise: 90, sound: 'dbshotgun' },
  recipe: { n: 1, cost: { [ITEM.GUNPARTS]: 1, [ITEM.SCRAP]: 2, [ITEM.WOOD]: 2, [ITEM.TAPE]: 1 }, station: 'bench', schem: ITEM.SCHEM_SHOTGUN },
  salvage: { [ITEM.GUNPARTS]: 1, [ITEM.SCRAP]: 1 },
  akimbo: true,
  feat: 'kill_shotgun',
  hole: 0.6,
  shotSound: 'DB_SHOTGUN',
  kick: [1.6, 0.3],
};
