// A teammate going down, as the rest of the team hears and sees it (NOTIFY.DOWNED for someone else; our own is the
// downed ring, ui/endscreens.js). It is the top of the night's order (client/ui/hud2.js), so it is told every way at
// once: the red toast with the key that revives them, and an alarm on the ui bus that a full horde does not drown out.
// Their plate, compass chip and map marker already turn red and pulse while they stay down (hud2.js, minimap.js).
import { bindTag } from './binds.js';

// g: the Game (ui, audio, name(id)); id: who went down
export function mateDown(g, id) {
  g.ui.notify(`${g.name(id)} is down! Hold ${bindTag('interact')} on them to revive.`, 'danger', 5);
  g.audio.playLocal('mate_down');
}
