/**
 * ParticleSystem — the sky of diyas, plus a general-purpose pool of
 * short-lived glow particles (wick sparks, rising trails, firework debris).
 *
 * Design notes:
 *  - Every diya slot is allocated once, up front, and its `depth` is fixed
 *    and stratified so the pool is permanently sorted back-to-front. That
 *    removes any per-frame sort while still giving correct layering.
 *  - Population is grown by activating slots in a pre-shuffled random order,
 *    so a bigger sky stays evenly distributed across depths.
 */

import { DiyaParticle } from './diya-particle.js';
import { rand, clamp, lerp, shuffle } from './utils.js';
import { drawSprite, ATLAS_FRAMES } from './flame-renderer.js';

/* ------------------------------------------------------------------ *
 * Short-lived glow particles
 * ------------------------------------------------------------------ */

export class SparkPool {
  constructor(capacity) {
    this.capacity = capacity;
    this.items = new Array(capacity);
    for (let i = 0; i < capacity; i++) {
      this.items[i] = {
        active: false, x: 0, y: 0, vx: 0, vy: 0,
        life: 0, maxLife: 1, size: 2, gravity: 0,
        friction: 0.98, warmth: 1, decay: 1, additive: true,
      };
    }
    this.cursor = 0;
    this.live = 0;
  }

  emit(cfg) {
    // find a free slot; if the pool is saturated we overwrite the oldest
    for (let n = 0; n < this.capacity; n++) {
      const i = (this.cursor + n) % this.capacity;
      const p = this.items[i];
      if (!p.active) {
        this.cursor = (i + 1) % this.capacity;
        this._init(p, cfg);
        this.live++;
        return p;
      }
    }
    const p = this.items[this.cursor];
    this.cursor = (this.cursor + 1) % this.capacity;
    this._init(p, cfg);
    return p;
  }

  _init(p, c) {
    p.active = true;
    p.x = c.x; p.y = c.y;
    p.vx = c.vx || 0; p.vy = c.vy || 0;
    p.life = 0;
    p.maxLife = c.life || 1;
    p.size = c.size || 3;
    p.gravity = c.gravity || 0;
    p.friction = c.friction === undefined ? 0.985 : c.friction;
    p.warmth = c.warmth === undefined ? 1 : c.warmth;
    p.decay = c.decay || 1;
    p.shrink = c.shrink === undefined ? 0.35 : c.shrink;
  }

  update(dt, motionScale = 1) {
    const s = dt * 60;
    let live = 0;
    for (let i = 0; i < this.capacity; i++) {
      const p = this.items[i];
      if (!p.active) continue;
      p.life += dt;
      if (p.life >= p.maxLife) { p.active = false; continue; }
      p.vy += p.gravity * s;
      const f = Math.pow(p.friction, s);
      p.vx *= f; p.vy *= f;
      p.x += p.vx * s * motionScale;
      p.y += p.vy * s * motionScale;
      live++;
    }
    this.live = live;
  }

  render(ctx, sprite, camOffsetY = 0) {
    if (!this.live) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < this.capacity; i++) {
      const p = this.items[i];
      if (!p.active) continue;
      const t = p.life / p.maxLife;
      const a = Math.pow(1 - t, 1.7) * p.warmth;
      const sz = p.size * (1 - t * p.shrink);
      drawSprite(ctx, sprite, p.x, p.y - camOffsetY, sz, a);
    }
    ctx.restore();
  }

  clear() {
    for (let i = 0; i < this.capacity; i++) this.items[i].active = false;
    this.live = 0;
  }
}

/* ------------------------------------------------------------------ *
 * Sky of diyas
 * ------------------------------------------------------------------ */

export class ParticleSystem {
  constructor(capacity) {
    this.capacity = capacity;
    this.pool = new Array(capacity);
    for (let i = 0; i < capacity; i++) {
      const p = new DiyaParticle();
      // stratified depth, ascending with index -> pool is pre-sorted far→near
      p.fixedDepth = clamp((i + 0.5) / capacity + rand(-0.4, 0.4) / capacity, 0.02, 1);
      this.pool[i] = p;
    }
    this.order = shuffle(Array.from({ length: capacity }, (_, i) => i));
    this.count = 0;      // how many slots are currently active
    this.formStrength = 26;
    this.formDamping = 9.2;
  }

  get activeCount() { return this.count; }

  /** Activate one more slot, spawning it wherever `place(depth)` says. */
  activateOne(place, opts = {}) {
    if (this.count >= this.capacity) return null;
    const idx = this.order[this.count++];
    const p = this.pool[idx];
    const d = p.fixedDepth;
    const pos = place(d);
    p.spawn(pos.x, pos.y, d, opts);
    p.fixedDepth = d;
    return p;
  }

  /** Adopt an already-positioned light (a diya the user personally lit). */
  adopt(x, y, depth, opts = {}) {
    if (this.count >= this.capacity) return null;
    // find the free slot whose fixed depth is closest to the requested one
    let bestPos = this.count, bestErr = Infinity;
    for (let i = this.count; i < this.capacity; i++) {
      const err = Math.abs(this.pool[this.order[i]].fixedDepth - depth);
      if (err < bestErr) { bestErr = err; bestPos = i; }
    }
    const tmp = this.order[this.count];
    this.order[this.count] = this.order[bestPos];
    this.order[bestPos] = tmp;

    const idx = this.order[this.count++];
    const p = this.pool[idx];
    p.spawn(x, y, p.fixedDepth, { instant: true, ...opts });
    return p;
  }

  forEachActive(fn) {
    for (let i = 0; i < this.capacity; i++) {
      const p = this.pool[i];
      if (p.active) fn(p);
    }
  }

  activeParticles(out = []) {
    out.length = 0;
    for (let i = 0; i < this.capacity; i++) {
      const p = this.pool[i];
      if (p.active) out.push(p);
    }
    return out;
  }

  update(dt, t, env) {
    env.formStrength = this.formStrength;
    env.formDamping = this.formDamping;
    for (let i = 0; i < this.capacity; i++) {
      const p = this.pool[i];
      if (p.active) p.update(dt, t, env);
    }
  }

  /**
   * Draw every live diya. Far particles are cheap points of light; only the
   * nearest ones pay for a rotation transform.
   */
  render(ctx, atlas, glow, t, camY, globalAlpha = 1) {
    const tile = atlas.tile;
    const src = atlas.canvas;
    const anchor = atlas.anchorY;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    for (let i = 0; i < this.capacity; i++) {
      const p = this.pool[i];
      if (!p.active || p.size <= 0.2) continue;

      const px = p.x;
      const py = p.y - camY * (0.28 + p.depth * 0.72);
      /* lights that are part of a letterform burn a little brighter, so the
         words read against the sky they were drawn from */
      const alpha = Math.min(1, p.opacity * (1 + p.glowBoost * 0.55)) * p.fade * globalAlpha;
      if (alpha <= 0.004) continue;

      // still a seed of light — draw as a soft dot before it becomes a lamp
      if (p.birth < 0.34) {
        const g = p.birth / 0.34;
        drawSprite(ctx, glow, px, py, p.baseSize * (0.30 + g * 0.5), alpha * g * 0.95);
        continue;
      }

      const fl =
        Math.sin(t * 2.4 * p.flickerSpeed + p.flickerPhase) * 0.5 +
        Math.sin(t * 5.1 * p.flickerSpeed + p.flickerPhase * 1.9) * 0.3;
      let frame = ((fl * 0.5 + 0.5) * ATLAS_FRAMES) | 0;
      if (frame < 0) frame = 0;
      else if (frame >= ATLAS_FRAMES) frame = ATLAS_FRAMES - 1;

      const s = p.size * (1 + fl * 0.035);
      const a = alpha * (0.86 + fl * 0.14);

      ctx.globalAlpha = a < 0 ? 0 : a > 1 ? 1 : a;

      if (p.depth > 0.62) {
        // only the nearest lamps pay for a transform; a distant one bobbing
        // by a hundredth of a radian is invisible anyway
        const rot = p.rotation + Math.sin(t * 0.7 + p.seed) * 0.035;
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(rot);
        ctx.drawImage(src, frame * tile, 0, tile, tile, -s / 2, -s * anchor, s, s);
        ctx.restore();
      } else {
        ctx.drawImage(src, frame * tile, 0, tile, tile, px - s / 2, py - s * anchor, s, s);
      }
    }

    ctx.restore();
  }

  reset() {
    for (let i = 0; i < this.capacity; i++) this.pool[i].active = false;
    this.count = 0;
    shuffle(this.order);
  }
}
