/**
 * Scenery — the parts of the night that don't move:
 *   · the sky gradient, grain-friendly stars and atmospheric haze
 *   · a distant, deliberately understated rooftop skyline
 *   · a geometric rangoli that emerges from points of light
 *
 * The sky/stars/skyline are baked into a background canvas that is only
 * redrawn on resize; the rangoli lives on the animated layer because it
 * reveals over time.
 */

import { rand, clamp, smoothstep } from './utils.js';

/* A tiny seeded PRNG so the skyline and starfield are stable across redraws. */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------ *
 * Background: sky + stars + haze + skyline
 * ------------------------------------------------------------------ */

export function renderBackground(ctx, w, h, opts = {}) {
  const groundY = opts.groundY ?? h * 0.88;
  const rng = mulberry32(20251020);

  ctx.clearRect(0, 0, w, h);

  /* deep night gradient — cooler at the zenith, a breath warmer at the horizon */
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#04060B');
  sky.addColorStop(0.42, '#05070D');
  sky.addColorStop(0.78, '#080B14');
  sky.addColorStop(1, '#0B0D16');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  /* a very faint cool bloom off-centre so the sky isn't a flat field */
  const bloom = ctx.createRadialGradient(w * 0.68, h * 0.16, 0, w * 0.68, h * 0.16, Math.max(w, h) * 0.75);
  bloom.addColorStop(0, 'rgba(38,52,86,0.30)');
  bloom.addColorStop(0.5, 'rgba(22,30,52,0.12)');
  bloom.addColorStop(1, 'rgba(10,14,24,0)');
  ctx.fillStyle = bloom;
  ctx.fillRect(0, 0, w, h);

  /* stars — barely there. A Diwali sky belongs to the lamps, not the stars,
     so these exist only to keep the darkness from reading as flat paint. */
  const starCount = Math.round(clamp((w * h) / 14000, 24, 130));
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < starCount; i++) {
    const x = rng() * w;
    const y = Math.pow(rng(), 1.7) * groundY;
    const fade = 1 - smoothstep(groundY * 0.40, groundY * 0.86, y);
    const a = (0.05 + rng() * 0.16) * fade;
    if (a <= 0.008) continue;
    const r = rng() < 0.92 ? 0.45 + rng() * 0.35 : 0.7 + rng() * 0.5;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r * 2.8);
    const tint = rng() < 0.3 ? '206,220,255' : '255,246,226';
    g.addColorStop(0, `rgba(${tint},${a})`);
    g.addColorStop(0.32, `rgba(${tint},${a * 0.3})`);
    g.addColorStop(1, `rgba(${tint},0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r * 2.8, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  /* atmospheric haze hugging the horizon, warm and very faint */
  const haze = ctx.createLinearGradient(0, groundY - h * 0.22, 0, groundY + h * 0.02);
  haze.addColorStop(0, 'rgba(70,48,44,0)');
  haze.addColorStop(0.62, 'rgba(80,52,44,0.035)');
  haze.addColorStop(1, 'rgba(104,66,46,0.085)');
  ctx.fillStyle = haze;
  ctx.fillRect(0, groundY - h * 0.22, w, h * 0.24);

  drawSkyline(ctx, w, h, groundY, rng);
}

/**
 * A distant town at night: flat rooftops, parapets, a couple of chhatri-style
 * pavilions and finials. Silhouette only — no denominational iconography.
 */
function drawSkyline(ctx, w, h, groundY, rng) {
  const unit = clamp(w / 26, 12, 34);

  const layer = (yBase, scale, color, glow) => {
    const finials = [];
    ctx.save();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(-10, h);
    ctx.lineTo(-10, yBase);

    let x = -10;
    while (x < w + 20) {
      const bw = unit * (1.1 + rng() * 2.6) * scale;
      const bh = unit * (0.5 + rng() * 1.5) * scale;
      const top = yBase - bh;
      ctx.lineTo(x, top);

      const kind = rng();
      if (kind < 0.16 && bw > unit * 1.4 * scale) {
        /* chhatri: a small dome on a plinth. The spire is filled separately
           so the roofline stays one continuous subpath. */
        const cx = x + bw / 2;
        const dr = Math.min(bw * 0.30, unit * 0.62 * scale);
        ctx.lineTo(cx - dr * 1.5, top);
        ctx.lineTo(cx - dr * 1.5, top - dr * 0.28);
        ctx.lineTo(cx - dr, top - dr * 0.28);
        ctx.arc(cx, top - dr * 0.28, dr, Math.PI, 0, false);
        ctx.lineTo(cx + dr * 1.5, top - dr * 0.28);
        ctx.lineTo(cx + dr * 1.5, top);
        finials.push({ cx, y: top - dr * 1.2, dr });
      } else if (kind < 0.34) {
        /* crenellated parapet */
        const n = Math.max(2, Math.round(bw / (unit * 0.42 * scale)));
        const cw = bw / n;
        for (let i = 0; i < n; i++) {
          ctx.lineTo(x + i * cw, top);
          ctx.lineTo(x + i * cw, top - unit * 0.20 * scale);
          ctx.lineTo(x + (i + 0.6) * cw, top - unit * 0.20 * scale);
          ctx.lineTo(x + (i + 0.6) * cw, top);
        }
      }

      ctx.lineTo(x + bw, top);
      ctx.lineTo(x + bw, yBase);
      x += bw;
    }

    ctx.lineTo(w + 20, h);
    ctx.closePath();
    ctx.fill();

    for (const f of finials) {
      ctx.beginPath();
      ctx.moveTo(f.cx - f.dr * 0.10, f.y);
      ctx.lineTo(f.cx, f.y - f.dr * 0.78);
      ctx.lineTo(f.cx + f.dr * 0.10, f.y);
      ctx.closePath();
      ctx.fill();
    }

    if (glow) {
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createLinearGradient(0, yBase - unit * 2.6, 0, yBase);
      g.addColorStop(0, 'rgba(255,168,88,0)');
      g.addColorStop(1, `rgba(255,168,88,${glow})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, yBase - unit * 2.6, w, unit * 2.6);
    }
    ctx.restore();
  };

  /* far layer, then a nearer, darker one for depth */
  layer(groundY - unit * 0.5, 0.78, 'rgba(9,12,21,0.92)', 0.035);
  layer(groundY + unit * 0.35, 1.0, 'rgba(4,6,11,0.97)', 0.02);
}

/* ------------------------------------------------------------------ *
 * Rangoli
 * ------------------------------------------------------------------ */

export class Rangoli {
  constructor() {
    this.dots = [];
    this.arcs = [];
    this.lamps = [];
    this.reveal = 0;
    this.cx = 0;
    this.cy = 0;
    this.radius = 0;
  }

  build(cx, cy, radius) {
    this.cx = cx; this.cy = cy; this.radius = radius;
    this.dots.length = 0;
    this.arcs.length = 0;
    this.lamps.length = 0;

    const S = 12;              // 12-fold symmetry
    const rng = mulberry32(77);

    /* centre bindu + inner ring of dots */
    this.dots.push({ x: cx, y: cy, r: 2.6, o: 0 });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      this.dots.push({
        x: cx + Math.cos(a) * radius * 0.16,
        y: cy + Math.sin(a) * radius * 0.16 * 0.42,
        r: 1.8, o: 0.04,
      });
    }

    /* petals: two mirrored arcs per sector, drawn in a squashed ellipse space */
    for (let i = 0; i < S; i++) {
      const a = (i / S) * Math.PI * 2;
      const o = 0.10 + (i / S) * 0.30;
      this.arcs.push({ a, r0: radius * 0.20, r1: radius * 0.56, bend: 0.30, o });
      this.arcs.push({ a, r0: radius * 0.20, r1: radius * 0.56, bend: -0.30, o });
      /* dot at each petal tip */
      this.dots.push({
        x: cx + Math.cos(a) * radius * 0.62,
        y: cy + Math.sin(a) * radius * 0.62 * 0.42,
        r: 2.0, o: o + 0.10,
      });
    }

    /* outer beaded ring */
    const N = S * 4;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      this.dots.push({
        x: cx + Math.cos(a) * radius * 0.88,
        y: cy + Math.sin(a) * radius * 0.88 * 0.42,
        r: i % 4 === 0 ? 2.2 : 1.3,
        o: 0.52 + (i / N) * 0.28,
      });
    }

    /* a few real lamps set around the far edge of the rangoli, where they
       stay on screen — the near edge falls below the bottom of the frame */
    const L = 7;
    for (let i = 0; i < L; i++) {
      const a = Math.PI * 1.06 + (i / (L - 1)) * Math.PI * 0.88;
      this.lamps.push({
        x: cx + Math.cos(a) * radius * 1.06,
        y: cy + Math.sin(a) * radius * 1.06 * 0.42,
        s: 22 + rng() * 12,
        phase: rng() * 6.28,
        o: 0.62 + i * 0.04,
      });
    }
  }

  /** @param sparks emits a little bloom as each element ignites */
  update(dt, target, sparks) {
    const prev = this.reveal;
    this.reveal += (target - this.reveal) * clamp(dt * 1.1, 0, 1);
    if (sparks && this.reveal > prev) {
      for (const d of this.dots) {
        if (d.o > prev && d.o <= this.reveal && Math.random() < 0.5) {
          sparks.emit({
            x: d.x, y: d.y,
            vx: rand(-0.25, 0.25), vy: rand(-0.7, -0.2),
            life: rand(0.5, 1.0), size: rand(4, 9),
            gravity: 0.004, friction: 0.96, warmth: 0.5,
          });
        }
      }
    }
  }

  render(ctx, glow, atlas, t, alpha) {
    if (alpha <= 0.01 || this.reveal <= 0.001) return;
    const R = this.reveal;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    /* petal arcs, drawn in a vertically-squashed space to sit on the ground */
    ctx.save();
    ctx.translate(this.cx, this.cy);
    ctx.scale(1, 0.42);
    ctx.lineCap = 'round';
    for (const arc of this.arcs) {
      const p = smoothstep(arc.o, arc.o + 0.22, R);
      if (p <= 0.01) continue;
      const cos = Math.cos(arc.a), sin = Math.sin(arc.a);
      const x0 = cos * arc.r0, y0 = sin * arc.r0;
      const x1 = cos * arc.r1, y1 = sin * arc.r1;
      const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
      const nx = -sin * arc.bend * arc.r1, ny = cos * arc.bend * arc.r1;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.quadraticCurveTo(mx + nx, my + ny, x1, y1);
      ctx.strokeStyle = `rgba(255,190,104,${0.20 * p * alpha})`;
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.strokeStyle = `rgba(255,236,190,${0.10 * p * alpha})`;
      ctx.lineWidth = 0.7;
      ctx.stroke();
    }
    ctx.restore();

    /* beads */
    for (const d of this.dots) {
      const p = smoothstep(d.o, d.o + 0.14, R);
      if (p <= 0.01) continue;
      const tw = 0.82 + Math.sin(t * 1.7 + d.x * 0.05) * 0.18;
      ctx.globalAlpha = 1;
      const size = d.r * 7.5 * p;
      ctx.globalAlpha = clamp(0.55 * p * alpha * tw, 0, 1);
      ctx.drawImage(glow, d.x - size / 2, d.y - size / 2, size, size);
    }

    /* lamps on the rangoli */
    if (atlas) {
      const tile = atlas.tile;
      for (const l of this.lamps) {
        const p = smoothstep(l.o, l.o + 0.16, R);
        if (p <= 0.01) continue;
        const fl = Math.sin(t * 2.6 + l.phase) * 0.5 + Math.sin(t * 4.3 + l.phase * 1.7) * 0.3;
        let frame = ((fl * 0.5 + 0.5) * atlas.frames) | 0;
        frame = clamp(frame, 0, atlas.frames - 1);
        const s = l.s * p;
        ctx.globalAlpha = clamp(alpha * p, 0, 1);
        ctx.drawImage(atlas.canvas, frame * tile, 0, tile, tile,
                      l.x - s / 2, l.y - s * atlas.anchorY, s, s);
      }
    }

    ctx.restore();
  }
}
