import { playerId } from './identity.js';
import { call, post } from './lobby.js';

// (a read has no body: the guest's id goes in a header, never in the URL - identity.js)
const asGuest = () => ({ headers: { 'X-STN-Guest': playerId() } });

export const fetchLoadout = () => call('/api/loadout', asGuest(), 6000);
export const saveLoadout = (slots) => post('/api/loadout', { guestId: playerId(), slots }, 6000);
export const fetchAuction = () => call('/api/loadout/auction', asGuest(), 6000);
export const listAuctionItem = (itemId, price) => post('/api/loadout/auction/list', { itemId, price }, 6000);
export const buyAuctionListing = (listingId) => post('/api/loadout/auction/buy', { listingId }, 6000);
export const cancelAuctionListing = (listingId) => post('/api/loadout/auction/cancel', { listingId }, 6000);

// the Skull shop (shared/skullshop.js): -> { shop, owned: [id], balance }
export const fetchShop = () => call('/api/loadout/shop', asGuest(), 6000);
export const buyCosmetic = (cosmetic) => post('/api/loadout/shop/buy', { guestId: playerId(), cosmetic }, 6000);
