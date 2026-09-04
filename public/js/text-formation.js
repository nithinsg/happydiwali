/**
 * TextFormation
 *
 * Turns real Unicode text into target coordinates so the *lights themselves*
 * spell the greeting.
 *
 * Two details matter more than anything else here:
 *
 *  1. Sampling pitch is a fraction of the font size, not a constant. That
 *     keeps roughly the same number of lights in the words whether the
 *     screen is 360px or 1440px wide, and keeps the spacing proportional to
 *     the stroke weight so strokes stay continuous instead of dotty.
 *
 *  2. A few hundred separate lights can outline a letter but cannot fill one.
 *     So the mask is also kept as a soft, very faint warm glow drawn behind
 *     the swarm — the light the assembled lamps would cast between them. The
 *     lights still draw the letters; the glow just stops them fighting the
 *     sky behind.
 *
 * Devanagari is drawn as a whole run (never per-glyph — that would break
 * conjuncts and matras). Latin is drawn per-glyph so it can be letter-spaced
 * without ctx.letterSpacing, which is not universally supported.
 */

import { shuffle, clamp } from './utils.js';

/** pitch as a fraction of font size — ~2 samples across a typical stem */
const PITCH_RATIO = 0.078;

export class TextFormation {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.glow = document.createElement('canvas');
    this.glowCtx = this.glow.getContext('2d');
    this.points = [];
    this.assigned = [];
    this.rect = { x: 0, y: 0, w: 0, h: 0 };
    this.pitch = 4;
  }

  /**
   * @param lines [{ text, family, weight, spacing, fill, gap }]
   * @param rect  { x, y, w, h } screen-space region the text should fill
   * @param budget hard ceiling on how many lights the sky can spare
   */
  build(lines, rect, budget) {
    const w = Math.max(2, Math.round(rect.w));
    const h = Math.max(2, Math.round(rect.h));
    const c = this.canvas;
    const ctx = this.ctx;
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    this.rect = { ...rect, w, h };

    /* ---- fit each line to the region width ---- */
    const measured = lines.map((ln) => {
      let size = h * 0.5;
      const setFont = (s) => { ctx.font = `${ln.weight || 700} ${s}px ${ln.family}`; };
      const widthAt = (s) => {
        setFont(s);
        if (!ln.spacing) return ctx.measureText(ln.text).width;
        let total = 0;
        for (const ch of ln.text) total += ctx.measureText(ch).width + ln.spacing * s;
        return total - ln.spacing * s;
      };
      // text width is near-linear in font size, so a few passes converge
      for (let i = 0; i < 4; i++) {
        const measuredW = widthAt(size);
        if (measuredW <= 1) break;
        size *= (w * (ln.fill || 0.92)) / measuredW;
      }
      size = clamp(size, 8, h * 0.86);
      return { ...ln, size, width: widthAt(size) };
    });

    /* Fitting each line to the width can make the stack taller than the box —
       on a wide screen, dramatically so. Scale the whole block down until it
       fits, rather than letting the ascenders clip. */
    const blockH = (arr) =>
      arr.reduce((s, m) => s + m.size * (1.06 + (m.gap || 0)), 0);
    let totalH = blockH(measured);
    if (totalH > h * 0.94) {
      const k = (h * 0.94) / totalH;
      for (const m of measured) {
        m.size *= k;
        ctx.font = `${m.weight || 700} ${m.size}px ${m.family}`;
        m.width = m.spacing
          ? [...m.text].reduce((s, ch) => s + ctx.measureText(ch).width + m.spacing * m.size, 0) - m.spacing * m.size
          : ctx.measureText(m.text).width;
      }
      totalH = blockH(measured);
    }

    let cursorY = (h - totalH) / 2;

    /* draw each line, then sample it at its own pitch before drawing the next,
       so a big line and a small line each get spacing suited to their weight */
    const pts = [];
    let pitchSum = 0;

    for (const m of measured) {
      const top = Math.max(0, Math.floor(cursorY - m.size * 0.45));
      const bottom = Math.min(h, Math.ceil(cursorY + m.size * 1.5));

      ctx.font = `${m.weight || 700} ${m.size}px ${m.family}`;
      const baseline = cursorY + m.size * 0.86;
      let x = (w - m.width) / 2;
      if (m.spacing) {
        for (const ch of m.text) {
          ctx.fillText(ch, x, baseline);
          x += ctx.measureText(ch).width + m.spacing * m.size;
        }
      } else {
        ctx.fillText(m.text, x, baseline);
      }

      const step = Math.max(2, Math.round(m.size * (m.pitchRatio || PITCH_RATIO)));
      pitchSum += step;
      const band = ctx.getImageData(0, top, w, Math.max(1, bottom - top)).data;
      const bh = bottom - top;
      const jitter = step * 0.32;
      const linePts = [];
      for (let yy = 0; yy < bh; yy += step) {
        for (let xx = 0; xx < w; xx += step) {
          if (band[(yy * w + xx) * 4 + 3] > 110) {
            linePts.push({
              x: rect.x + xx + (Math.random() - 0.5) * jitter,
              y: rect.y + top + yy + (Math.random() - 0.5) * jitter,
              s: step,
            });
          }
        }
      }
      // a line already drawn is included in the next band read, so clear it
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillRect(0, top, w, bh);
      ctx.restore();
      ctx.fillStyle = '#fff';

      pts.push(...linePts);
      cursorY += m.size * 1.06 + (m.gap || 0) * m.size;
    }

    /* redraw the whole block once more: the sampling pass consumed it, and
       the mask is still needed for the collective glow */
    ctx.clearRect(0, 0, w, h);
    cursorY = (h - totalH) / 2;
    for (const m of measured) {
      ctx.font = `${m.weight || 700} ${m.size}px ${m.family}`;
      const baseline = cursorY + m.size * 0.86;
      let x = (w - m.width) / 2;
      if (m.spacing) {
        for (const ch of m.text) {
          ctx.fillText(ch, x, baseline);
          x += ctx.measureText(ch).width + m.spacing * m.size;
        }
      } else {
        ctx.fillText(m.text, x, baseline);
      }
      cursorY += m.size * 1.06 + (m.gap || 0) * m.size;
    }

    this._buildGlow(w, h);

    /* only ever drop an overshoot, and drop it at random rather than
       truncating, which would lop off whole rows of one line */
    if (pts.length > budget) {
      shuffle(pts);
      pts.length = budget;
    }
    this.points = pts;
    this.pitch = pitchSum / Math.max(1, measured.length);
    return this.points;
  }

  /**
   * The mask, tinted warm and softened, to be drawn very faintly behind the
   * assembled lights. Softening is done by accumulating the tinted mask at a
   * ring of small offsets — one-off work, and it avoids ctx.filter, which is
   * still not safe to rely on everywhere.
   */
  _buildGlow(w, h) {
    const t = this._tint || (this._tint = document.createElement('canvas'));
    if (t.width !== w || t.height !== h) { t.width = w; t.height = h; }
    const tx = t.getContext('2d');
    tx.clearRect(0, 0, w, h);
    tx.globalCompositeOperation = 'source-over';
    tx.drawImage(this.canvas, 0, 0);
    tx.globalCompositeOperation = 'source-in';
    const grad = tx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#FFE9A8');
    grad.addColorStop(0.55, '#FFC468');
    grad.addColorStop(1, '#F3A63B');
    tx.fillStyle = grad;
    tx.fillRect(0, 0, w, h);
    tx.globalCompositeOperation = 'source-over';

    const g = this.glow;
    if (g.width !== w || g.height !== h) { g.width = w; g.height = h; }
    const gx = this.glowCtx;
    gx.clearRect(0, 0, w, h);
    gx.globalCompositeOperation = 'lighter';
    const R = clamp(Math.round(Math.min(w, h) * 0.022), 3, 14);
    const N = 12;
    gx.globalAlpha = 0.85 / N;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      gx.drawImage(t, Math.cos(a) * R, Math.sin(a) * R);
      gx.drawImage(t, Math.cos(a) * R * 0.45, Math.sin(a) * R * 0.45);
    }
    gx.globalAlpha = 1;
    gx.globalCompositeOperation = 'source-over';
  }

  /**
   * Pair points to particles so the swarm converges without obvious
   * criss-crossing: match left-to-right, then relax with cheap swaps.
   */
  assign(particles, points) {
    const n = Math.min(particles.length, points.length);
    const ps = particles.slice().sort((a, b) => a.x - b.x).slice(0, n);
    const ts = points.slice(0, n).sort((a, b) => a.x - b.x);

    const d2 = (p, t) => {
      const dx = p.x - t.x, dy = p.y - t.y;
      return dx * dx + dy * dy;
    };
    for (let pass = 0; pass < 3; pass++) {
      for (let k = 0; k < n; k++) {
        const i = (Math.random() * n) | 0;
        const j = (Math.random() * n) | 0;
        if (i === j) continue;
        if (d2(ps[i], ts[j]) + d2(ps[j], ts[i]) < d2(ps[i], ts[i]) + d2(ps[j], ts[j])) {
          const tmp = ts[i]; ts[i] = ts[j]; ts[j] = tmp;
        }
      }
    }

    for (let i = 0; i < n; i++) {
      const size = ts[i].s * (0.95 + Math.random() * 0.35);
      ps[i].seek(ts[i].x, ts[i].y, size);
      this.assigned.push(ps[i]);
    }
    return n;
  }

  reset() {
    this.assigned = [];
  }

  release() {
    for (const p of this.assigned) p.release();
    this.assigned = [];
  }
}
