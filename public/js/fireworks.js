/**
 * Fireworks — a deliberately restrained, atmospheric layer.
 *
 * Rules held here (from the brief): small, distant, warm gold/amber/white,
 * short-lived, low opacity, never more than one large burst at a time, and
 * always drawn *behind* the diyas. They should register as "a Diwali night
 * happening around you", not as a fireworks animation.
 */

import { rand, randInt, clamp } from './utils.js';
import { drawSprite } from './flame-renderer.js';

export class Fireworks {
  /**
   * @param sparks a SparkPool shared with the rest of the scene
   */
  constructor(sparks) {
    this.sparks = sparks;
    this.flashes = [];       // ignition points
    this.enabled = false;
    this.nextCheck = rand(3, 7);
    this.timer = 0;
    this.intensity = 'ambient';   // 'ambient' | 'finale' | 'off'
    this.queue = [];
    this.motionScale = 1;
    this.onBurst = null;
  }

  /**
   * @param scale 0 for reduced-motion (bursts become a soft bloom, no debris)
   */
  setMotionScale(scale) { this.motionScale = scale; }

  /**
   * One burst.
   * @param size 0.5 tiny .. 1.6 large
   */
  burst(x, y, size = 1, opts = {}) {
    const soft = this.motionScale < 0.35;
    const count = soft ? 0 : randInt(15, 35);
    const speed = (soft ? 0 : rand(1.6, 3.1)) * size;
    const life = rand(0.5, 0.9) * (opts.slow ? 1.9 : 1);
    const warmth = opts.warmth === undefined ? rand(0.35, 0.6) : opts.warmth;

    if (this.onBurst) this.onBurst(size);

    this.flashes.push({
      x, y,
      r: 0,
      maxR: 34 * size * (opts.slow ? 1.7 : 1),
      life: 0,
      maxLife: life * (opts.slow ? 1.4 : 0.85),
      warmth: warmth * 1.35,
    });

    for (let i = 0; i < count; i++) {
      // slight radial jitter keeps the ring from looking like a stamped circle
      const a = (i / count) * Math.PI * 2 + rand(-0.14, 0.14);
      const v = speed * (0.45 + Math.random() * 0.75);
      this.sparks.emit({
        x, y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        life: life * rand(0.7, 1.25),
        size: rand(3, 7.5) * size,
        gravity: 0.022,
        friction: 0.955,
        warmth,
        shrink: 0.55,
      });
    }
  }

  /** Schedule a staggered sequence of edge bursts (the sky-full moment). */
  finale(width, height, reduced) {
    this.queue.length = 0;
    const edgeX = (side) =>
      side === 0 ? rand(width * 0.06, width * 0.26) : rand(width * 0.74, width * 0.94);
    const plan = reduced
      ? [[0.0, 0, 0.7], [1.2, 1, 0.8]]
      : [[0.0, 0, 0.7], [0.9, 1, 1.05], [2.0, 0, 0.5], [3.1, 1, 0.85]];
    for (const [delay, side, size] of plan) {
      this.queue.push({
        at: this.timer + delay,
        x: edgeX(side),
        y: rand(height * 0.10, height * 0.34),
        size,
      });
    }
  }

  /** One large, slow, soft bloom far behind the finished greeting. */
  closing(x, y) {
    this.burst(x, y, 1.5, { slow: true, warmth: 0.30 });
  }

  update(dt, width, height) {
    this.timer += dt;

    for (let i = this.queue.length - 1; i >= 0; i--) {
      if (this.timer >= this.queue[i].at) {
        const q = this.queue[i];
        this.burst(q.x, q.y, q.size);
        this.queue.splice(i, 1);
      }
    }

    if (this.enabled && this.intensity === 'ambient') {
      this.nextCheck -= dt;
      if (this.nextCheck <= 0) {
        this.nextCheck = rand(3, 7);
        if (Math.random() < 0.26) {
          this.burst(
            rand(width * 0.08, width * 0.92),
            rand(height * 0.06, height * 0.36),
            rand(0.42, 0.72),
            { warmth: rand(0.22, 0.38) }
          );
        }
      }
    }

    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.life += dt;
      if (f.life >= f.maxLife) { this.flashes.splice(i, 1); continue; }
      f.r = f.maxR * Math.pow(f.life / f.maxLife, 0.42);
    }
  }

  /** Ignition blooms only — the debris lives in the shared SparkPool. */
  render(ctx, glow) {
    if (!this.flashes.length) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const f of this.flashes) {
      const t = f.life / f.maxLife;
      const a = Math.pow(1 - t, 2.2) * f.warmth;
      drawSprite(ctx, glow, f.x, f.y, f.r * 2 + 8, clamp(a, 0, 1));
    }
    ctx.restore();
  }

  clear() {
    this.flashes.length = 0;
    this.queue.length = 0;
  }
}
