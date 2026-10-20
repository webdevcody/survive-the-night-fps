import { BASE_ITEM as ITEM } from '../items.js';

export default {
  key: 'PISTOL',
  id: 55,
  def: { name: 'Pistol', cat: 'weapon', stack: 1, color: 0x333333, desc: 'Reliable 9mm sidearm.' },
  stats: { slot: 1, damage: 30, rate: 0.16, mag: 12, reload: 1.35, ammo: 0, pellets: 1, spread: 0.012, moveSpread: 0.02, recoil: 0.018, range: 120, headMul: 3.0, auto: false, noise: 45, sound: 'pistol' },
  // what everyone starts with, made again cheaply when lost
  recipe: { n: 1, cost: { [ITEM.GUNPARTS]: 1, [ITEM.SCRAP]: 3, [ITEM.TAPE]: 1 }, station: 'bench' },
  salvage: { [ITEM.GUNPARTS]: 1, [ITEM.SCRAP]: 1 },
  akimbo: true,
  feat: 'kill_pistol',
  hole: 0.75,
  shotSound: 'PISTOL',
};
