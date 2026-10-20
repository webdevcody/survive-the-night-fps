import { BASE_ITEM as ITEM } from '../items.js';

export default {
  key: 'DEAGLE',
  id: 59, // a sidearm (the pistol's slot) that hits like a rifle, on the hunting rifle's .308
  def: { name: 'Desert Eagle', cat: 'weapon', stack: 1, color: 0x9a9ca0, desc: 'A steel hand cannon. Seven rounds of .308 that hit like a rifle and kick like one. Takes the pistol\'s place.' },
  // the Desert Eagle: the pistol's slot, the hunting rifle's rounds. Over twice the pistol's hit for half its rate and
  // magazine, a wide first shot and a hard climb: one at a time, aimed, for the heads that matter. Loud as a rifle
  stats: { slot: 1, damage: 72, rate: 0.3, mag: 7, reload: 1.8, ammo: 3, pellets: 1, spread: 0.014, moveSpread: 0.03, recoil: 0.05, range: 140, headMul: 2.8, auto: false, noise: 70, sound: 'deagle' },
  // the Desert Eagle: more gun parts than a pistol is made of and a lot more steel; no schematic
  recipe: { n: 1, cost: { [ITEM.GUNPARTS]: 2, [ITEM.SCRAP]: 4, [ITEM.TAPE]: 1 }, station: 'bench' },
  salvage: { [ITEM.GUNPARTS]: 1, [ITEM.SCRAP]: 2 },
  akimbo: true,
  feat: 'kill_pistol',
  hole: 1.15,
  shotSound: 'DEAGLE',
  kick: [1.4, 0.22],
};
