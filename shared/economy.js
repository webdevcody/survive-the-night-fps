export const SKULLS = Object.freeze({
  NAME: 'Zombie Skulls',
  SHORT: 'Skulls',
  ICON: 'skull',
});

// First-pass endgame economy tuning. The hourly cap follows Dead Hand's pack cap pattern:
// normal play reaches it only by stacking several high-value events, while farm loops stop paying.
export const SKULL_EARN = Object.freeze({
  NIGHT_BASE: 10,
  NIGHT_STEP: 5,
  NIGHT_MAX: 35,
  BOSS_KILL: 25,
  ESCAPE_ABOARD: 75,
  ESCAPE_TEAM: 35,
  HOURLY_CAP: 300,
});

export const AUCTION = Object.freeze({
  FEE_RATE: 0.05,
  FEE_MIN: 1,
  PRICE_MIN: 1,
  PRICE_MAX: 100000,
  LISTING_DAYS: 3,
  PAGE_SIZE: 80,
});

export const auctionFee = (price) => Math.max(AUCTION.FEE_MIN, Math.ceil(Math.max(0, price | 0) * AUCTION.FEE_RATE));
export const sellerProceeds = (price) => Math.max(0, (price | 0) - auctionFee(price));
export const nightSkulls = (night) => Math.min(SKULL_EARN.NIGHT_MAX, SKULL_EARN.NIGHT_BASE + Math.max(0, (night | 0) - 1) * SKULL_EARN.NIGHT_STEP);

// The Skull shop (shared/skullshop.js): cosmetic unlocks, each bought once for good with Zombie Skulls. They change
// how a survivor looks to everyone in the game and nothing else. First-guess prices, before anyone has played with
// them: the cheapest about one good night's Skulls, the dearest an hour at the earning cap. id: the swatch's `shop` in
// shared/wardrobe.js (kept in the database: never reuse one).
//   id  swatch        price
//    1  blood           100
//    2  bile            100
//    3  bruise          100
//    4  toxic           150
//    5  ultraviolet     150
//    6  hotpink         150
//    7  arctic          150
//    8  electric        200
//    9  copper          200
//   10  gold            250
//   11  silver          300
//   12  void            300
export const SKULL_SHOP = Object.freeze([
  { id: 1, swatch: 'blood', price: 100 },
  { id: 2, swatch: 'bile', price: 100 },
  { id: 3, swatch: 'bruise', price: 100 },
  { id: 4, swatch: 'toxic', price: 150 },
  { id: 5, swatch: 'ultraviolet', price: 150 },
  { id: 6, swatch: 'hotpink', price: 150 },
  { id: 7, swatch: 'arctic', price: 150 },
  { id: 8, swatch: 'electric', price: 200 },
  { id: 9, swatch: 'copper', price: 200 },
  { id: 10, swatch: 'gold', price: 250 },
  { id: 11, swatch: 'silver', price: 300 },
  { id: 12, swatch: 'void', price: 300 },
]);
