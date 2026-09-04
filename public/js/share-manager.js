/**
 * ShareManager — Web Share API with graceful, WhatsApp-friendly fallbacks.
 *
 * Order of preference:
 *   1. navigator.share()            (Android Chrome, iOS Safari, most PWAs)
 *   2. clipboard copy               (desktop browsers)
 *   3. wa.me deep link              (anything where neither is available)
 *
 * No personal data is collected or transmitted anywhere.
 */

const PAYLOAD = {
  title: 'Happy Diwali 🪔',
  text: 'I lit a little light for you this Diwali. May your year ahead be filled with happiness, peace and prosperity. 🪔✨',
};

export class ShareManager {
  constructor() {
    this.canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  }

  get url() {
    try {
      const u = new URL(window.location.href);
      u.hash = '';
      return u.toString();
    } catch {
      return window.location.href;
    }
  }

  whatsappHref() {
    return `https://wa.me/?text=${encodeURIComponent(`${PAYLOAD.text}\n${this.url}`)}`;
  }

  /**
   * @returns {'shared'|'copied'|'whatsapp'|'cancelled'|'unavailable'}
   */
  async share() {
    const data = { ...PAYLOAD, url: this.url };

    if (this.canShare) {
      try {
        if (navigator.canShare && !navigator.canShare(data)) throw new Error('unsupported payload');
        await navigator.share(data);
        return 'shared';
      } catch (err) {
        // AbortError means the user closed the sheet — that is not a failure.
        if (err && (err.name === 'AbortError' || err.code === 20)) return 'cancelled';
        // anything else: fall through to the copy path
      }
    }

    if (await this._copy(`${PAYLOAD.text}\n${this.url}`)) return 'copied';

    try {
      window.open(this.whatsappHref(), '_blank', 'noopener');
      return 'whatsapp';
    } catch {
      return 'unavailable';
    }
  }

  async _copy(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch { /* fall through to the legacy path */ }

    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none;';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, text.length);
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}
