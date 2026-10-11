// What the player thinks of the game, sent to the server as a run ends (server/feedback.js): how hard it was, voted
// on the end screen (ui/endscreens.js EndScreen), with the run's best and worst moment. The server files the vote against the run this player has just finished,
// by their account or, for a guest, this browser's id (identity.js), as a JOIN does.
import { playerId } from './identity.js';
import { post } from './lobby.js';

// rating 1 too easy .. 5 too hard -> { mine, counts: [votes for each answer], total }: everyone's, this vote counted.
// Rejects with the server's own words (a 404 when there is no run of ours that just ended)
export const voteDifficulty = (rating) => post('/api/feedback/difficulty', { rating, guestId: playerId() }, 6000);

// The run's best or worst moment. which: 'best' | 'worst'. moment: one of MOMENTS (server/feedback.js), or null to
// take the pick back -> { which, moment }
export const pickMoment = (which, moment) => post('/api/feedback/moment', { which, moment, guestId: playerId() }, 6000);

// "Do you play survival / FPS games?": plays true | false answers it (once: the first answer stays), left off it only
// asks -> { plays: true | false | null (never answered) }
export const genreAnswer = (plays) => post('/api/feedback/genre', { plays, guestId: playerId() }, 6000);
