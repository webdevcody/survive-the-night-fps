// The coach card (#270): the walkthrough step a new player is on, or a first-time tip, under the compass. A tag line
// (where in the guide they are), a title, and a line where [action] is drawn as the key it is bound to now
// (game/binds.js). game/onboarding.js says what is on it; only a change touches the DOM.
import { el, replay } from './dom.js';
import { bindLabel, onBindsChange } from '../game/binds.js';
import './ux-coach.css';

export class Coach {
  constructor(parent) {
    this.root = el('div', 'coach', parent);
    this.root.hidden = true;
    this.tag = el('div', 'coach-tag', this.root);
    this.title = el('div', 'coach-title', this.root);
    this.text = el('div', 'coach-text', this.root);
    this.cur = null;
    this.key = '';
    onBindsChange(() => (this.key = '')); // (redrawn with the new keys)
  }

  get visible() {
    return !this.root.hidden;
  }

  // card: { tag, title, text, urgent, good } or null
  show(card) {
    const key = card ? `${card.tag}|${card.title}|${card.text}|${card.urgent ? 1 : 0}${card.good ? 1 : 0}` : '';
    if (key === this.key) return;
    const fresh = !this.key || (card && this.cur?.title !== card.title);
    this.key = key;
    this.cur = card;
    this.root.hidden = !card;
    if (!card) return;
    this.root.className = 'coach' + (card.urgent ? ' urgent' : '') + (card.good ? ' good' : '');
    this.tag.textContent = card.tag || '';
    this.title.textContent = card.title;
    this.text.textContent = '';
    this.text.hidden = !card.text;
    // "[fire]" -> the key it is on, as a key cap; everything else as text
    for (const part of (card.text || '').split(/(\[\w+\])/)) {
      const m = /^\[(\w+)\]$/.exec(part);
      if (m) el('span', 'kbd', this.text, bindLabel(m[1]));
      else if (part) this.text.appendChild(document.createTextNode(part));
    }
    if (fresh) replay(this.root, 'in');
  }
}
