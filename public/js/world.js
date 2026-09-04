/**
 * World — everything that lives on the canvas.
 *
 * Two layers:
 *   bgCanvas   sky, stars, haze, skyline. Redrawn only on resize; nudged with
 *              a CSS transform when the camera pans, which is free.
 *   canvas     the animated layer: fireworks, rangoli, the sky of diyas, the
 *              rising diya and the hero diya the user actually touches.
 *
 * The SceneManager drives this through a small, explicit API.
 */

import {
  clamp, lerp, rand, easeInOutCubic, easeOutCubic, easeOutQuint,
} from './utils.js';
import {
  buildDiyaAtlas, buildGlowSprite, drawFlame, drawDiyaBody, drawSprite,
} from './flame-renderer.js';
import { ParticleSystem, SparkPool } from './particle-system.js';
import { Fireworks } from './fireworks.js';
import { TextFormation } from './text-formation.js';
import { renderBackground, Rangoli } from './scenery.js';

const HERO_IGNITE_TIME = 1.75;

export class World {
  constructor(canvas, bgCanvas, opts = {}) {
    this.canvas = canvas;
    this.bgCanvas = bgCanvas;
    this.ctx = canvas.getContext('2d', { alpha: true });
    this.bgCtx = bgCanvas.getContext('2d', { alpha: false });

    this.reduced = !!opts.reduced;
    this.quality = opts.quality || 1;      // 1 = full, 0.7 = trimmed, 0.45 = minimal
    this.qualityCap = 1;                   // shrinks if the device can't keep up
    this.dprCap = 2;
    this.dpr = 1;
    this.width = 0;
    this.height = 0;
    this.time = 0;

    this.atlas = buildDiyaAtlas(96);
    this.glow = buildGlowSprite(64);

    const budget = this._budget();
    this.skyPopulation = budget.sky;
    this.particles = new ParticleSystem(budget.capacity);
    this.sparks = new SparkPool(this.reduced ? 180 : 460);
    this.fireworks = new Fireworks(this.sparks);
    this.fireworks.setMotionScale(this.reduced ? 0.2 : 1);
    this.textFormation = new TextFormation();
    this.rangoli = new Rangoli();

    this.cam = { y: 0, target: 0 };
    this._bgShift = null;
    this.warmth = 0;
    this.warmthTarget = 0;
    this.skyAlpha = 1;
    this.rangoliTarget = 0;
    this.rangoliAlpha = 0;
    this.formGlow = 0;

    this.hero = null;
    this.rising = [];
    this.litCount = 0;
    this.forming = false;

    /* the sky grows at a rate rather than in visible batches */
    this.growTarget = 0;
    this.growSpeed = 12;
    this._growAcc = 0;

    this.motionScale = this.reduced ? 0.35 : 1;
    this.onDiyaLit = null;
    this.onDiyaLanded = null;

    this._scratch = [];
  }

  /**
   * Two different numbers, deliberately.
   *
   * `skyPopulation` is how many lamps make a beautiful sky — a density
   * judgement. `capacity` is larger, because spelling two lines of text needs
   * far more points than a sky needs lamps; the extra ones only ever kindle
   * during the formation, and they arrive as tiny points of light.
   */
  _budget() {
    const w = window.innerWidth || 390;
    const h = window.innerHeight || 844;
    const sky = clamp(Math.round((w * h) / 1000), 190, 400);
    return {
      sky: Math.max(150, Math.round(sky * this.quality)),
      capacity: Math.max(470, Math.round((sky + 440) * this.quality)),
    };
  }

  /* ------------------------------------------------------------ layout */

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    const maxDpr = Math.min(
      this.dprCap,
      this.quality < 0.6 ? 1.25 : this.quality < 0.9 ? 1.6 : 2
    );
    const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);

    this.width = w;
    this.height = h;
    this.dpr = dpr;

    for (const [cv, cx] of [[this.canvas, this.ctx], [this.bgCanvas, this.bgCtx]]) {
      cv.width = Math.max(1, Math.round(w * dpr));
      cv.height = Math.max(1, Math.round(h * dpr));
      cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    this.groundY = h * 0.90;
    this.heroY = Math.round(clamp(h * 0.71, h - 320, h - 130));
    this.heroW = Math.round(clamp(w * 0.30, 96, 148));

    renderBackground(this.bgCtx, w, h, { groundY: this.groundY });
    this.rangoli.build(w * 0.5, h * 0.955, Math.min(w * 0.46, 250));
    this._buildDrifts();

    if (this.hero) { this.hero.x = w * 0.5; this.hero.y = this.heroY; this.hero.w = this.heroW; }
    if (this.forming) this.formText(this._formLines, { rebuild: true });
  }

  /* ------------------------------------------------------------ hero diya */

  placeHero(opts = {}) {
    this.hero = {
      x: this.width * 0.5,
      y: this.heroY,
      w: this.heroW,
      ignition: 0,
      igniteTime: opts.igniteTime || HERO_IGNITE_TIME,
      lighting: false,
      lit: false,
      breathe: rand(0, 6.28),
      holdCharge: 0,
      appear: 0,
    };
    return this.hero;
  }

  hitTestHero(px, py) {
    if (!this.hero) return false;
    const dx = px - this.hero.x;
    const dy = py - (this.hero.y - this.hero.w * 0.2);
    const r = Math.max(this.hero.w * 0.95, 78);
    return dx * dx + dy * dy <= r * r;
  }

  /** Begin the ignition. Idempotent — repeated taps are harmless. */
  igniteHero() {
    const hero = this.hero;
    if (!hero || hero.lighting || hero.lit) return false;
    hero.lighting = true;
    hero.ignition = 0;

    const n = this.reduced ? 6 : 16;
    for (let i = 0; i < n; i++) {
      this.sparks.emit({
        x: hero.x + rand(-hero.w * 0.10, hero.w * 0.10),
        y: hero.y - hero.w * 0.08,
        vx: rand(-0.9, 0.9),
        vy: rand(-2.4, -0.7),
        life: rand(0.45, 1.0),
        size: rand(4, 11),
        gravity: 0.012,
        friction: 0.95,
        warmth: 0.85,
      });
    }
    return true;
  }

  /** Extra sparks while the user keeps holding — pure feedback. */
  feedHold(dt) {
    const hero = this.hero;
    if (!hero || hero.lit) return;
    hero.holdCharge = Math.min(1, hero.holdCharge + dt);
    if (Math.random() < dt * 14) {
      this.sparks.emit({
        x: hero.x + rand(-hero.w * 0.16, hero.w * 0.16),
        y: hero.y - hero.w * 0.10,
        vx: rand(-0.5, 0.5),
        vy: rand(-1.8, -0.5),
        life: rand(0.4, 0.85),
        size: rand(3, 8),
        gravity: 0.01,
        friction: 0.955,
        warmth: 0.7,
      });
    }
  }

  /** Detach the hero diya and send it up into the sky. */
  launchHero(opts = {}) {
    const hero = this.hero;
    if (!hero || !hero.lit) return null;
    this.hero = null;

    const w = this.width, h = this.height;
    const slot = this.litCount;
    /* fan the first few lights out so they don't stack in a column */
    const spread = [0, -0.22, 0.24, -0.13, 0.16, -0.28, 0.30];
    const tx = w * (0.5 + (spread[slot % spread.length] || rand(-0.3, 0.3))) + rand(-18, 18);
    const ty = h * (0.16 + (slot % 3) * 0.05) + rand(-14, 14);

    const r = {
      x0: hero.x, y0: hero.y, x: hero.x, y: hero.y,
      x1: clamp(tx, w * 0.10, w * 0.90),
      y1: ty,
      t: 0,
      dur: opts.duration || (this.reduced ? 1.5 : 3.1),
      seed: rand(0, 100),
      w0: hero.w,
      w1: hero.w * 0.30,
      wCur: hero.w,
      trail: 0,
    };
    this.rising.push(r);
    return r;
  }

  /* ------------------------------------------------------------ sky */

  /**
   * Loose drifts of lamps rather than an even scatter — an even scatter is
   * what makes a light field read as fairy lights instead of a night sky.
   */
  _buildDrifts() {
    const w = this.width, h = this.height;
    const n = clamp(Math.round(w / 110), 3, 8);
    this._drifts = [];
    for (let i = 0; i < n; i++) {
      this._drifts.push({
        x: w * ((i + rand(0.15, 0.85)) / n),
        spread: rand(w * 0.07, w * 0.17),
        weight: rand(0.5, 1),
      });
    }
  }

  _placeNew(depth) {
    const h = this.height, w = this.width;
    let x;
    if (this._drifts && Math.random() < 0.62) {
      const d = this._drifts[(Math.random() * this._drifts.length) | 0];
      // sum of two uniforms ≈ a soft bell, cheaper than a real gaussian
      x = d.x + (Math.random() + Math.random() - 1) * d.spread;
    } else {
      x = rand(-30, w + 30);
    }
    /* nearer lamps sit lower in frame, as they would if they were closer */
    const yBias = 1 - depth * 0.35;
    return {
      x: clamp(x, -30, w + 30),
      y: rand(-h * 0.05, h * 1.06) * yBias + h * (1 - yBias) * 0.45,
      depth,
    };
  }

  /**
   * Ask the sky to reach `n` lights, arriving over time.
   * @param speed lights per second
   */
  growTo(n, speed = 12) {
    this.growTarget = Math.min(n, this.skyCapacity);
    this.growSpeed = speed;
  }

  get skyCount() { return this.particles.activeCount; }
  /** the density the sky should reach — not the size of the pool */
  get skyCapacity() { return Math.round(this.skyPopulation * this.qualityCap); }

  /**
   * Step the budget down once. Called when measured frame rate is poor.
   * Resolution is the cheapest thing to give up, so it goes first; the sky
   * only stops growing, it never loses lights the viewer has already seen.
   */
  degrade() {
    this.qualityCap = Math.max(0.6, this.qualityCap - 0.2);
    this.dprCap = Math.max(1, this.dprCap - 0.5);
    this.motionScale = this.reduced ? 0.35 : 0.92;
    if (this.growTarget > this.skyCapacity) this.growTarget = this.skyCapacity;
  }

  /* ------------------------------------------------------------ text */

  formText(lines, opts = {}) {
    this._formLines = lines;
    const w = this.width, h = this.height;
    const landscape = w > h * 1.25;
    /* a tight box: the glyphs should fill it, not float inside it */
    const rect = landscape
      ? { x: w * 0.11, y: h * 0.04, w: w * 0.78, h: h * 0.34 }
      : { x: w * 0.02, y: h * 0.07, w: w * 0.96, h: h * 0.225 };

    const active = this.particles.activeParticles(this._scratch);
    const ceiling = this.particles.capacity - 24;
    const pts = this.textFormation.build(lines, rect, ceiling);

    this.textFormation.reset();

    /* Mid and far lights spell the words first — they are small and even,
       which is what letterforms need. The nearest few lamps stay loose in
       front, so the composition keeps its depth instead of flattening. */
    const near = [], rest = [];
    for (const p of active) (p.depth > 0.86 ? near : rest).push(p);
    const fromSky = Math.min(rest.length, Math.floor(pts.length * 0.58));
    const used = this.textFormation.assign(rest.slice(0, fromSky), pts);

    /* Any target the sky could not reach kindles a new point of light right
       where it belongs — the words drawing more light in, rather than the
       sky being emptied to pay for them. */
    for (let i = used; i < pts.length; i++) {
      const p = this.particles.activateOne(() => ({
        x: pts[i].x + rand(-26, 26),
        y: pts[i].y + rand(-26, 26),
      }), { birthRate: rand(1.2, 2.6) });
      if (!p) break;
      p.baseSize = pts[i].s * 2.0;
      p.opacity = lerp(0.66, 1, p.depth);
      p.seek(pts[i].x, pts[i].y, pts[i].s * (0.95 + Math.random() * 0.35));
      this.textFormation.assigned.push(p);
    }

    this.forming = true;
    if (!opts.rebuild) {
      this.formGlow = 0;
      this.particles.formStrength = this.reduced ? 90 : 26;
      this.particles.formDamping = this.reduced ? 20 : 9.2;
    }
  }

  releaseText() {
    this.textFormation.release();
    this.forming = false;
    this.formGlow = 0;
  }

  /* ------------------------------------------------------------ update */

  update(dt, now) {
    this.time += dt;
    const t = this.time;

    /* camera */
    this.cam.y += (this.cam.target - this.cam.y) * clamp(dt * 1.6, 0, 1);
    const bgShift = Math.round(this.cam.y * 0.26 * 10) / 10;
    if (bgShift !== this._bgShift) {
      this._bgShift = bgShift;
      this.bgCanvas.style.transform = `translate3d(0, ${bgShift}px, 0)`;
    }

    /* warmth of the night */
    this.warmth += (this.warmthTarget - this.warmth) * clamp(dt * 0.8, 0, 1);

    /* hero */
    const hero = this.hero;
    if (hero) {
      hero.breathe += dt;
      hero.appear = clamp(hero.appear + dt * 1.7, 0, 1);
      if (hero.lighting && !hero.lit) {
        hero.ignition = clamp(hero.ignition + dt / hero.igniteTime, 0, 1);
        if (Math.random() < dt * 10 * (1 - hero.ignition)) {
          this.sparks.emit({
            x: hero.x + rand(-hero.w * 0.08, hero.w * 0.08),
            y: hero.y - hero.w * 0.12,
            vx: rand(-0.4, 0.4), vy: rand(-1.6, -0.4),
            life: rand(0.3, 0.7), size: rand(3, 7),
            gravity: 0.008, friction: 0.96, warmth: 0.9,
          });
        }
        if (hero.ignition >= 1) {
          hero.lit = true;
          hero.lighting = false;
          this.litCount++;
          if (this.onDiyaLit) this.onDiyaLit(this.litCount);
        }
      }
      if (hero.lit && Math.random() < dt * 2.2 && !this.reduced) {
        /* the odd ember lifting off a settled flame */
        this.sparks.emit({
          x: hero.x + rand(-4, 4),
          y: hero.y - hero.w * 0.42,
          vx: rand(-0.25, 0.25), vy: rand(-1.1, -0.45),
          life: rand(0.6, 1.3), size: rand(3, 6),
          gravity: -0.002, friction: 0.985, warmth: 0.55,
        });
      }
    }

    /* rising diyas */
    for (let i = this.rising.length - 1; i >= 0; i--) {
      const r = this.rising[i];
      r.t = clamp(r.t + dt / r.dur, 0, 1);
      const e = easeInOutCubic(r.t);
      const arc = Math.sin(r.t * Math.PI) * 0.5;
      r.x = lerp(r.x0, r.x1, e) + Math.sin(r.t * 4.1 + r.seed) * 12 * arc * this.motionScale;
      r.y = lerp(r.y0, r.y1, easeOutCubic(r.t));
      r.wCur = lerp(r.w0, r.w1, easeOutQuint(r.t));

      r.trail += dt;
      const rate = this.reduced ? 0.09 : 0.035;
      while (r.trail > rate && r.t < 0.97) {
        r.trail -= rate;
        this.sparks.emit({
          x: r.x + rand(-r.wCur * 0.12, r.wCur * 0.12),
          y: r.y + rand(-2, 6),
          vx: rand(-0.18, 0.18),
          vy: rand(0.05, 0.5),
          life: rand(0.7, 1.6),
          size: rand(4, 10) * (0.5 + r.wCur / r.w0),
          gravity: 0.002,
          friction: 0.985,
          warmth: 0.5,
        });
      }

      if (r.t >= 1) {
        this.particles.adopt(r.x, r.y, 0.88 - i * 0.04);
        this.rising.splice(i, 1);
        if (this.onDiyaLanded) this.onDiyaLanded();
      }
    }

    /* the sky spreads at a rate, so multiplication reads as contagion
       rather than as objects appearing in batches */
    if (this.particles.activeCount < this.growTarget) {
      this._growAcc += dt * this.growSpeed;
      let guard = 0;
      while (this._growAcc >= 1 && this.particles.activeCount < this.growTarget && guard++ < 200) {
        this._growAcc -= 1;
        this.particles.activateOne((d) => this._placeNew(d), { birthRate: rand(0.7, 1.7) });
      }
    } else {
      this._growAcc = 0;
    }

    /* systems */
    this.sparks.update(dt, this.motionScale);
    this.fireworks.update(dt, this.width, this.height);
    this.particles.update(dt, t, {
      width: this.width,
      height: this.height,
      motionScale: this.motionScale,
      formStrength: this.particles.formStrength,
      formDamping: this.particles.formDamping,
      avoid: this.forming ? this.textFormation.rect : null,
    });
    this.formGlow = clamp(
      this.formGlow + (this.forming ? dt / 2.2 : -dt / 0.8), 0, 1);

    this.rangoli.update(dt, this.rangoliTarget, this.reduced ? null : this.sparks);
    this.rangoliAlpha = lerp(this.rangoliAlpha, this.rangoliTarget > 0 ? 1 : 0, clamp(dt * 1.5, 0, 1));
  }

  /* ------------------------------------------------------------ render */

  render() {
    const ctx = this.ctx;
    const t = this.time;
    ctx.clearRect(0, 0, this.width, this.height);

    /* fireworks sit furthest back, softened so they read as distance */
    this.fireworks.render(ctx, this.glow);

    /* the rangoli on the ground */
    this.rangoli.render(ctx, this.glow, this.atlas, t, this.rangoliAlpha);

    /* short-lived glow particles behind the lamps */
    this.sparks.render(ctx, this.glow, 0);

    /* the light the assembled lamps cast between themselves — this is what
       lets a few hundred separate points read as writing rather than as a
       smear. It never appears without the lights that produce it. */
    if (this.formGlow > 0.01) {
      const r = this.textFormation.rect;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.21 * this.formGlow * this.skyAlpha;
      ctx.drawImage(this.textFormation.glow, r.x, r.y - this.cam.y * 0.64);
      ctx.restore();
    }

    /* the sky */
    this.particles.render(ctx, this.atlas, this.glow, t, this.cam.y, this.skyAlpha);

    /* rising diyas — still the protagonist, so drawn at full quality */
    for (const r of this.rising) {
      const y = r.y - this.cam.y * 0.6;
      ctx.save();
      ctx.globalAlpha = 1;
      drawDiyaBody(ctx, r.x, y, r.wCur, 1);
      drawFlame(ctx, r.x, y - r.wCur * 0.032, r.wCur * 0.38, t, r.seed, 1, 1.1);
      ctx.restore();
    }

    /* the hero */
    const hero = this.hero;
    if (hero) {
      const y = hero.y - this.cam.y;
      const breathe = Math.sin(hero.breathe * 0.9) * (this.reduced ? 0.6 : 2.2);
      const ig = hero.lit ? 1 : easeOutCubic(hero.ignition);
      const app = easeOutCubic(hero.appear);
      ctx.save();
      ctx.globalAlpha = app;

      /* the pool of warm light the diya casts on the darkness around it */
      if (ig > 0.01) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const R = hero.w * (2.6 + ig * 2.2);
        const g = ctx.createRadialGradient(hero.x, y + breathe, 0, hero.x, y + breathe, R);
        g.addColorStop(0, `rgba(255,182,96,${0.16 * ig})`);
        g.addColorStop(0.35, `rgba(240,142,60,${0.07 * ig})`);
        g.addColorStop(1, 'rgba(200,100,30,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(hero.x, y + breathe, R, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      drawDiyaBody(ctx, hero.x, y + breathe, hero.w, ig);

      if (ig <= 0.02) {
        /* the ember: almost nothing, but enough to say "this is alive" */
        const pulse = 0.35 + Math.sin(hero.breathe * 1.9) * 0.18;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        drawSprite(ctx, this.glow, hero.x, y + breathe - hero.w * 0.035, hero.w * 0.19, pulse * 0.6);
        ctx.restore();
      } else {
        const h = hero.w * 0.39 * (0.26 + ig * 0.74);
        drawFlame(ctx, hero.x, y + breathe - hero.w * 0.032, h, t, hero.breathe, Math.min(1, ig * 1.2), 1);
      }

      ctx.restore();
    }
  }

  /* ------------------------------------------------------------ misc */

  reset() {
    this.particles.reset();
    this.sparks.clear();
    this.fireworks.clear();
    this.fireworks.enabled = false;
    this.releaseText();
    this.rangoli.reveal = 0;
    this.rangoliTarget = 0;
    this.formGlow = 0;
    this.rangoliAlpha = 0;
    this.formGlow = 0;
    this.rising.length = 0;
    this.hero = null;
    this.litCount = 0;
    this.cam.y = 0;
    this.cam.target = 0;
    this.warmth = 0;
    this.warmthTarget = 0;
    this.skyAlpha = 1;
    this.growTarget = 0;
    this._growAcc = 0;
    this.time = 0;
  }
}
