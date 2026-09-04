/**
 * UI — every piece of real DOM the experience touches.
 *
 * The canvas is decorative; all meaningful language lives here as real text
 * so it is selectable, translatable and available to screen readers.
 */

import { Timeline } from './utils.js';

export class UI {
  constructor(root) {
    this.root = root;
    /* Timed UI beats go through a cancellable timeline so a replay kills any
       continuation still parked inside a cross-fade, rather than letting a
       stale one wake up and write over the new run. */
    this.timeline = new Timeline();
    this.el = {
      caption: document.getElementById('caption'),
      hint: document.getElementById('hint'),
      diya: document.getElementById('diya-hit'),
      greeting: document.getElementById('greeting'),
      share: document.getElementById('share-block'),
      sound: document.getElementById('sound-toggle'),
      toast: document.getElementById('toast'),
      loader: document.getElementById('loader'),
      scrim: document.getElementById('scrim'),
    };
    this._toastTimer = null;
    this._captionToken = 0;
    this.speed = 1;   // >1 = everything shortened (reduced motion)
  }

  setPhase(name) {
    this.root.dataset.phase = name;
  }

  _wait(ms) {
    return this.timeline.wait(ms / this.speed);
  }

  /**
   * Cross-fade the emotional caption.
   * @param lines string | string[] — one element per rendered line
   */
  async caption(lines) {
    const token = ++this._captionToken;
    const el = this.el.caption;
    const arr = Array.isArray(lines) ? lines : [lines];

    if (el.dataset.visible === 'true') {
      el.dataset.visible = 'false';
      await this._wait(420);
      if (token !== this._captionToken) return;
    }

    el.textContent = '';
    el.dataset.lines = String(arr.length);
    arr.forEach((line, i) => {
      const span = document.createElement('span');
      span.className = 'caption__line';
      span.textContent = line;
      span.style.setProperty('--i', String(i));
      el.appendChild(span);
    });
    // force a style flush so the entrance transition actually runs
    void el.offsetHeight;
    el.dataset.visible = 'true';
    await this._wait(560 + arr.length * 90);
  }

  async clearCaption() {
    ++this._captionToken;
    const el = this.el.caption;
    if (el.dataset.visible !== 'true') return;
    el.dataset.visible = 'false';
    await this._wait(420);
  }

  hint(text) {
    const el = this.el.hint;
    el.textContent = text;
    el.dataset.visible = 'true';
  }

  clearHint() {
    this.el.hint.dataset.visible = 'false';
  }

  /** Show/hide the invisible touch target sitting over the hero diya. */
  armDiya(on, label) {
    const b = this.el.diya;
    b.hidden = !on;
    b.disabled = !on;
    b.dataset.visible = on ? 'true' : 'false';
    if (label) b.setAttribute('aria-label', label);
  }

  setHeroMetrics(x, y, w) {
    this.root.style.setProperty('--hero-x', `${x}px`);
    this.root.style.setProperty('--hero-y', `${y}px`);
    this.root.style.setProperty('--hero-w', `${w}px`);
  }

  setWarmth(v) {
    this.root.style.setProperty('--warmth', v.toFixed(3));
  }

  showSound(on) {
    this.el.sound.hidden = !on;
  }

  setSoundState(enabled) {
    const b = this.el.sound;
    b.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    b.setAttribute('aria-label', enabled ? 'Turn ambient sound off' : 'Turn ambient sound on');
    b.dataset.on = enabled ? 'true' : 'false';
  }

  async revealGreeting() {
    this.el.scrim.dataset.visible = 'true';
    this.el.greeting.hidden = false;
    /* the share block is measured with the rest: it appears moments later and
       must not be what finally pushes the card into a scroll */
    this.el.share.hidden = false;
    this.fitGreeting();
    void this.el.greeting.offsetHeight;
    this.el.greeting.dataset.visible = 'true';
    await this._wait(900);
    /* measure again once the Telugu face has actually painted — a fallback
       font can measure short and let the card overflow after it swaps */
    this.fitGreeting();
  }

  async revealShare() {
    this.el.share.hidden = false;
    void this.el.share.offsetHeight;
    this.el.share.dataset.visible = 'true';
    this.fitGreeting();
    await this._wait(600);
  }

  /**
   * Shrink the greeting until it fits its box.
   *
   * Everything in the card is sized in em from one root value, so a single
   * variable scales the whole thing. A greeting nobody can read without
   * scrolling isn't a greeting, and no fixed type scale survives every phone,
   * browser chrome and font fallback — so measure, then fit.
   */
  fitGreeting() {
    const el = this.el.greeting;
    if (!el || el.hidden) return;
    let scale = 1;
    el.style.setProperty('--g-scale', '1');
    // reflow-bounded loop: at most 14 steps, never below 62% of the base size
    for (let i = 0; i < 14; i++) {
      // equality means it fits exactly; any excess at all is a scroll
      if (el.scrollHeight <= el.clientHeight) break;
      scale -= 0.035;
      if (scale < 0.62) { scale = 0.62; el.style.setProperty('--g-scale', '0.62'); break; }
      el.style.setProperty('--g-scale', scale.toFixed(3));
    }
  }

  toast(message) {
    const el = this.el.toast;
    el.textContent = message;
    el.dataset.visible = 'true';
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => { el.dataset.visible = 'false'; }, 3400);
  }

  hideLoader() {
    const l = this.el.loader;
    if (!l) return;
    l.dataset.visible = 'false';
    setTimeout(() => l.remove(), 900);
  }

  reset() {
    this.timeline.reset();
    this.el.greeting.hidden = true;
    this.el.greeting.dataset.visible = 'false';
    this.el.share.hidden = true;
    this.el.share.dataset.visible = 'false';
    this.el.scrim.dataset.visible = 'false';
    this.clearHint();
    this.el.caption.dataset.visible = 'false';
    this.el.caption.removeAttribute('data-lines');
    this.el.caption.textContent = '';
    this.armDiya(false);
  }
}
