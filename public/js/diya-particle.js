/**
 * DiyaParticle — one floating light in the sky.
 *
 * Pooled: never constructed during the animation, only reset(). Two modes:
 *   'drift'  gentle upward float with parallax + organic flicker
 *   'seek'   spring toward (targetX, targetY) for the text constellation,
 *            keeping a small residual wander so the letters stay alive
 */

import { rand, lerp, clamp } from './utils.js';

export class DiyaParticle {
  constructor() {
    this.reset();
  }

  reset() {
    this.x = 0;
    this.y = 0;
    this.targetX = 0;
    this.targetY = 0;
    this.vx = 0;
    this.vy = 0;
    this.size = 0;
    this.opacity = 0;
    this.flickerPhase = 0;
    this.flickerSpeed = 1;
    this.depth = 0.5;
    this.rotation = 0;
    this.active = false;

    this.mode = 'drift';
    this.birth = 0;          // 0..1 — point of light growing into a diya
    this.birthRate = 1;
    this.seed = 0;
    this.driftAmp = 0;
    this.driftFreq = 0;
    this.baseSize = 0;
    this.fade = 1;           // extra multiplier used when recycling
    this.sizeMul = 1;        // eased toward sizeMulTarget
    this.sizeMulTarget = 1;
    this.glowBoost = 0;
  }

  /**
   * @param depth 0 = far/tiny/dim, 1 = near/large/bright
   */
  spawn(x, y, depth, opts = {}) {
    this.reset();
    this.active = true;
    this.x = x;
    this.y = y;
    this.depth = depth;
    this.seed = rand(0, 1000);
    this.flickerPhase = rand(0, Math.PI * 2);
    this.flickerSpeed = rand(0.75, 1.5);
    this.baseSize = lerp(13, 46, depth * depth) * (opts.sizeScale || 1);
    this.size = 0;
    this.opacity = lerp(0.42, 1, depth);
    this.rotation = rand(-0.05, 0.05);
    this.vy = -lerp(3, 13, depth) / 60;
    this.vx = 0;
    this.driftAmp = rand(4, 16) * lerp(0.4, 1, depth);
    this.driftFreq = rand(0.09, 0.26);
    this.birth = opts.instant ? 1 : 0;
    this.birthRate = opts.birthRate || rand(0.8, 1.6);
    this.mode = 'drift';
    this.fade = 1;
    return this;
  }

  /**
   * Head for a letterform.
   * @param formSize the size this light should shrink (or grow) to once it
   *   is part of the text. Letters only read if every light in them is small
   *   and evenly sized — a 46px lamp and a 14px lamp side by side is a smear,
   *   not a glyph.
   */
  seek(tx, ty, formSize) {
    this.mode = 'seek';
    this.targetX = tx;
    this.targetY = ty;
    if (formSize) this.sizeMulTarget = clamp(formSize / this.baseSize, 0.14, 1.4);
    this.glowBoost = 1;
  }

  release() {
    if (this.mode !== 'seek') return;
    this.mode = 'drift';
    this.sizeMulTarget = 1;
    this.glowBoost = 0;
    this.vx *= 0.2;
    this.vy = -lerp(3, 13, this.depth) / 60;
  }

  update(dt, t, env) {
    if (!this.active) return;

    if (this.birth < 1) {
      this.birth = clamp(this.birth + dt * this.birthRate, 0, 1);
    }
    const b = this.birth;
    this.sizeMul += (this.sizeMulTarget - this.sizeMul) * clamp(dt * 2.4, 0, 1);
    // ease-out bloom without overshooting past the sprite bounds
    this.size = this.baseSize * this.sizeMul * (b < 1 ? 1 - Math.pow(1 - b, 3) : 1);

    if (this.mode === 'seek') {
      /* Spring in real units: k is rad²/s², damping is 1/s. Slightly under
         critical (ζ≈0.9) so the swarm arrives with a hint of settle rather
         than sliding to a dead stop. */
      const k = env.formStrength;
      const damp = env.formDamping;
      this.vx += (this.targetX - this.x) * k * dt;
      this.vy += (this.targetY - this.y) * k * dt;
      const decay = Math.exp(-damp * dt);
      this.vx *= decay;
      this.vy *= decay;
      this.x += this.vx * dt;
      this.y += this.vy * dt;

      // residual life so the constellation never looks frozen
      const w = t * 0.6 + this.seed;
      this.x += Math.sin(w) * 0.10;
      this.y += Math.cos(w * 0.83 + 1.7) * 0.10;
    } else {
      const speed = env.motionScale;
      this.y += this.vy * dt * 60 * speed;
      this.x +=
        Math.sin(t * this.driftFreq * Math.PI * 2 + this.seed) *
        this.driftAmp *
        dt *
        speed;

      /* A big near lamp parked on a glyph reads as a mistake. Rather than
         shoving it aside — which just makes lamps queue along the edge of
         the band — let it dim as it passes behind the writing. The sky keeps
         moving, and the words keep their shape. */
      const a = env.avoid;
      let want = 1;
      if (a) {
        const m = 34;
        const inside =
          Math.min(this.x - (a.x - m), (a.x + a.w + m) - this.x,
                   this.y - (a.y - m), (a.y + a.h + m) - this.y);
        if (inside > 0) want = lerp(1, 0.14, clamp(inside / m, 0, 1));
      }
      this.fade += (want - this.fade) * clamp(dt * 1.6, 0, 1);

      // recycle from below so the sky keeps breathing
      const top = -this.size * 1.2 - 40;
      if (this.y < top) {
        this.y = env.height + this.size + rand(10, 120);
        this.x = rand(-40, env.width + 40);
        this.birth = 0;
        this.birthRate = rand(0.6, 1.1);
      }
    }
  }
}
