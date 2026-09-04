/**
 * FlameRenderer
 *
 * Two jobs:
 *  1. Draw one high-quality procedural flame (the hero diya the user touches).
 *  2. Pre-bake a sprite atlas of small diyas so the sky can hold hundreds of
 *     lights with a single drawImage each instead of dozens of path fills.
 *
 * Everything is drawn from curves + gradients. No image assets.
 */

import { clamp, lerp } from './utils.js';

export const PALETTE = {
  night: '#05070D',
  warm: '#FFD76A',
  core: '#FFF4C2',
  amber: '#F3A63B',
  ember: '#FF8C3B',
  clay: '#5B3520',
  clayLit: '#A5613A',
  text: '#F6EEDF',
};

/* ------------------------------------------------------------------ *
 * Organic flicker
 * ------------------------------------------------------------------ */

/** Sum of incommensurate sines -> irregular, non-repeating-looking wobble. */
export function flicker(t, phase, speed) {
  return (
    Math.sin(t * 2.1 * speed + phase) * 0.55 +
    Math.sin(t * 3.7 * speed + phase * 1.7) * 0.28 +
    Math.sin(t * 6.9 * speed + phase * 2.9) * 0.17
  );
}

/* ------------------------------------------------------------------ *
 * Flame path
 * ------------------------------------------------------------------ */

function flamePath(ctx, x, y, h, w, sway, pinch) {
  const tipX = x + sway;
  const tipY = y - h;
  ctx.beginPath();
  ctx.moveTo(x - w * 0.5, y);
  ctx.bezierCurveTo(
    x - w * (0.66 - pinch * 0.2), y - h * 0.40,
    tipX - w * 0.30, y - h * 0.78,
    tipX, tipY
  );
  ctx.bezierCurveTo(
    tipX + w * 0.30, y - h * 0.78,
    x + w * (0.66 - pinch * 0.2), y - h * 0.40,
    x + w * 0.5, y
  );
  ctx.quadraticCurveTo(x, y + h * 0.10, x - w * 0.5, y);
  ctx.closePath();
}

/**
 * Draw a full-quality flame.
 * @param h flame height in CSS px (0 = nothing)
 * @param t seconds
 * @param intensity 0..1 master alpha / glow scale
 */
export function drawFlame(ctx, x, y, h, t, phase = 0, intensity = 1, speed = 1) {
  if (h <= 0.4 || intensity <= 0.001) return;

  const f = flicker(t, phase, speed);
  const sway = f * h * 0.085;
  const hh = h * (1 + f * 0.07);
  const w = h * (0.56 - f * 0.03);
  const pinch = 0.5 + f * 0.1;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  /* --- outer atmospheric glow --- */
  const gR = hh * 3.1;
  const g1 = ctx.createRadialGradient(x, y - hh * 0.38, 0, x, y - hh * 0.38, gR);
  g1.addColorStop(0, `rgba(255,196,96,${0.30 * intensity})`);
  g1.addColorStop(0.28, `rgba(255,158,60,${0.13 * intensity})`);
  g1.addColorStop(0.62, `rgba(210,110,40,${0.045 * intensity})`);
  g1.addColorStop(1, 'rgba(180,80,20,0)');
  ctx.fillStyle = g1;
  ctx.beginPath();
  ctx.arc(x, y - hh * 0.38, gR, 0, Math.PI * 2);
  ctx.fill();

  /* --- secondary tight glow --- */
  const gR2 = hh * 1.25;
  const g2 = ctx.createRadialGradient(x, y - hh * 0.42, 0, x, y - hh * 0.42, gR2);
  g2.addColorStop(0, `rgba(255,232,168,${0.55 * intensity})`);
  g2.addColorStop(0.5, `rgba(255,170,70,${0.20 * intensity})`);
  g2.addColorStop(1, 'rgba(255,140,50,0)');
  ctx.fillStyle = g2;
  ctx.beginPath();
  ctx.arc(x, y - hh * 0.42, gR2, 0, Math.PI * 2);
  ctx.fill();

  /* --- flame body --- */
  ctx.globalAlpha = intensity;
  const body = ctx.createLinearGradient(x, y + hh * 0.1, x + sway, y - hh);
  body.addColorStop(0, 'rgba(255,110,30,0.85)');
  body.addColorStop(0.22, 'rgba(255,150,45,0.95)');
  body.addColorStop(0.55, 'rgba(255,196,90,0.95)');
  body.addColorStop(0.86, 'rgba(255,228,150,0.7)');
  body.addColorStop(1, 'rgba(255,240,190,0.05)');
  ctx.fillStyle = body;
  flamePath(ctx, x, y, hh, w, sway, pinch);
  ctx.fill();

  /* --- yellow-white core --- */
  const ch = hh * (0.60 + f * 0.04);
  const cw = w * 0.46;
  const core = ctx.createLinearGradient(x, y, x + sway * 0.6, y - ch);
  core.addColorStop(0, 'rgba(255,220,140,0.55)');
  core.addColorStop(0.35, 'rgba(255,244,194,0.96)');
  core.addColorStop(1, 'rgba(255,255,240,0.10)');
  ctx.fillStyle = core;
  flamePath(ctx, x, y - hh * 0.02, ch, cw, sway * 0.55, pinch);
  ctx.fill();

  /* --- hot base spot --- */
  const hot = ctx.createRadialGradient(x, y - hh * 0.14, 0, x, y - hh * 0.14, w * 0.5);
  hot.addColorStop(0, 'rgba(255,255,246,0.9)');
  hot.addColorStop(1, 'rgba(255,220,140,0)');
  ctx.fillStyle = hot;
  ctx.beginPath();
  ctx.arc(x, y - hh * 0.14, w * 0.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

/* ------------------------------------------------------------------ *
 * Clay diya body
 * ------------------------------------------------------------------ */

const rgb = (a, b, t) =>
  `rgb(${lerp(a[0], b[0], t) | 0},${lerp(a[1], b[1], t) | 0},${lerp(a[2], b[2], t) | 0})`;

/**
 * A traditional shallow clay lamp seen slightly from above: a wide elliptical
 * opening, a shallow bowl beneath it, a pinched spout at the front holding
 * the wick. Unlit it is nearly as dark as the night; the flame is what
 * reveals the clay.
 *
 * @param w total width in CSS px
 * @param litness 0..1 — how much warm bounce light sits in the bowl
 */
export function drawDiyaBody(ctx, x, y, w, litness = 0) {
  const rx = w * 0.5;
  const ry = w * 0.105;          // how open the ellipse reads — the "tilt"
  const depth = w * 0.30;        // bowl below the rim line

  ctx.save();

  /* ---- bowl ---- */
  ctx.beginPath();
  ctx.moveTo(x - rx, y);
  ctx.bezierCurveTo(x - rx * 0.99, y + depth * 0.66, x - rx * 0.46, y + depth, x, y + depth);
  ctx.bezierCurveTo(x + rx * 0.46, y + depth, x + rx * 0.99, y + depth * 0.66, x + rx, y);
  ctx.closePath();
  const clay = ctx.createLinearGradient(x - rx, y, x + rx * 0.7, y + depth);
  clay.addColorStop(0, rgb([19, 13, 10], [74, 44, 28], litness));
  clay.addColorStop(0.34, rgb([36, 23, 16], [128, 76, 44], litness));
  clay.addColorStop(0.72, rgb([24, 15, 11], [92, 53, 31], litness));
  clay.addColorStop(1, rgb([13, 9, 7], [44, 25, 16], litness));
  ctx.fillStyle = clay;
  ctx.fill();

  /* ---- spout: a small pinch at the front where the wick rests ---- */
  ctx.beginPath();
  ctx.moveTo(x - w * 0.13, y + ry * 0.55);
  ctx.quadraticCurveTo(x, y + ry * 2.05, x + w * 0.13, y + ry * 0.55);
  ctx.closePath();
  ctx.fillStyle = rgb([30, 19, 14], [104, 61, 36], litness);
  ctx.fill();

  /* ---- rim: the opening ---- */
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  const rim = ctx.createLinearGradient(x, y - ry, x, y + ry);
  rim.addColorStop(0, rgb([31, 20, 14], [116, 69, 40], litness));
  rim.addColorStop(1, rgb([16, 10, 8], [68, 39, 23], litness));
  ctx.fillStyle = rim;
  ctx.fill();

  /* the inner cavity, a touch darker than the lip */
  ctx.beginPath();
  ctx.ellipse(x, y + ry * 0.16, rx * 0.86, ry * 0.72, 0, 0, Math.PI * 2);
  ctx.fillStyle = rgb([11, 7, 6], [58, 31, 18], litness);
  ctx.fill();

  /* a thin highlight along the back lip so the shape reads in the dark */
  ctx.beginPath();
  ctx.ellipse(x, y, rx * 0.985, ry * 0.985, 0, Math.PI * 1.06, Math.PI * 1.94);
  ctx.strokeStyle = `rgba(${lerp(120, 255, litness) | 0},${lerp(88, 196, litness) | 0},${lerp(62, 120, litness) | 0},${0.17 + litness * 0.47})`;
  ctx.lineWidth = Math.max(0.6, w * 0.012);
  ctx.stroke();

  /* ---- ghee pool ---- */
  if (litness > 0.01) {
    ctx.globalCompositeOperation = 'lighter';
    const pool = ctx.createRadialGradient(x, y + ry * 0.2, 0, x, y + ry * 0.2, rx * 0.92);
    pool.addColorStop(0, `rgba(255,204,124,${0.50 * litness})`);
    pool.addColorStop(0.42, `rgba(255,152,66,${0.16 * litness})`);
    pool.addColorStop(1, 'rgba(255,130,50,0)');
    ctx.fillStyle = pool;
    ctx.beginPath();
    ctx.ellipse(x, y + ry * 0.2, rx * 0.92, ry * 1.3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }

  /* ---- wick: barely proud of the ghee, so the flame swallows it ---- */
  ctx.beginPath();
  ctx.moveTo(x - w * 0.024, y + ry * 0.55);
  ctx.quadraticCurveTo(x - w * 0.010, y - w * 0.005, x, y - w * 0.032);
  ctx.quadraticCurveTo(x + w * 0.014, y - w * 0.005, x + w * 0.024, y + ry * 0.55);
  ctx.closePath();
  ctx.fillStyle = litness > 0.25 ? 'rgba(64,36,20,0.9)' : 'rgba(32,21,15,0.95)';
  ctx.fill();

  ctx.restore();
}

/* ------------------------------------------------------------------ *
 * Sky-diya sprite atlas
 * ------------------------------------------------------------------ */

export const ATLAS_FRAMES = 12;

/**
 * Bakes ATLAS_FRAMES flicker frames of a complete miniature diya
 * (glow + clay body + flame) into one offscreen canvas.
 * Each sky light then costs exactly one drawImage per frame.
 */
export function buildDiyaAtlas(tile = 96) {
  const c = document.createElement('canvas');
  c.width = tile * ATLAS_FRAMES;
  c.height = tile;
  const ctx = c.getContext('2d');

  const cx = tile / 2;
  const baseY = tile * 0.74;   // rim of the lamp inside the tile
  const bodyW = tile * 0.34;
  const wickY = baseY - bodyW * 0.032;
  const flameH = tile * 0.28;

  for (let i = 0; i < ATLAS_FRAMES; i++) {
    const t = (i / ATLAS_FRAMES) * Math.PI * 2;
    ctx.save();
    ctx.translate(i * tile, 0);
    ctx.beginPath();
    ctx.rect(0, 0, tile, tile);
    ctx.clip();

    /* halo */
    ctx.globalCompositeOperation = 'lighter';
    const halo = ctx.createRadialGradient(cx, baseY - flameH * 0.5, 0, cx, baseY - flameH * 0.5, tile * 0.46);
    halo.addColorStop(0, 'rgba(255,205,120,0.42)');
    halo.addColorStop(0.30, 'rgba(255,166,70,0.16)');
    halo.addColorStop(0.66, 'rgba(214,116,40,0.05)');
    halo.addColorStop(1, 'rgba(180,88,24,0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(cx, baseY - flameH * 0.5, tile * 0.46, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';

    drawDiyaBody(ctx, cx, baseY, bodyW, 1);

    const wob = Math.sin(t) * 0.55 + Math.sin(t * 2.3 + 1.1) * 0.3;
    const h = flameH * (1 + wob * 0.14);
    const w = h * 0.5;
    const sway = wob * h * 0.09;

    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(cx, wickY - h * 0.4, 0, cx, wickY - h * 0.4, h * 1.5);
    g.addColorStop(0, 'rgba(255,236,180,0.72)');
    g.addColorStop(0.5, 'rgba(255,172,72,0.24)');
    g.addColorStop(1, 'rgba(255,140,50,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, wickY - h * 0.4, h * 1.5, 0, Math.PI * 2);
    ctx.fill();

    const body = ctx.createLinearGradient(cx, wickY, cx + sway, wickY - h);
    body.addColorStop(0, 'rgba(255,120,36,0.9)');
    body.addColorStop(0.4, 'rgba(255,178,66,0.96)');
    body.addColorStop(0.8, 'rgba(255,232,158,0.8)');
    body.addColorStop(1, 'rgba(255,244,200,0.06)');
    ctx.fillStyle = body;
    flamePath(ctx, cx, wickY, h, w, sway, 0.5);
    ctx.fill();

    ctx.fillStyle = 'rgba(255,248,214,0.92)';
    flamePath(ctx, cx, wickY, h * 0.55, w * 0.42, sway * 0.5, 0.5);
    ctx.fill();

    ctx.restore();
  }

  return { canvas: c, tile, frames: ATLAS_FRAMES, anchorY: baseY / tile };
}

/**
 * A soft round light used for trails, sparks, firework particles and the
 * far-distance "points of light" that have not grown into diyas yet.
 */
export function buildGlowSprite(size = 64) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const r = size / 2;
  const g = ctx.createRadialGradient(r, r, 0, r, r, r);
  g.addColorStop(0, 'rgba(255,252,236,1)');
  g.addColorStop(0.12, 'rgba(255,232,168,0.92)');
  g.addColorStop(0.34, 'rgba(255,178,80,0.38)');
  g.addColorStop(0.66, 'rgba(236,132,44,0.10)');
  g.addColorStop(1, 'rgba(200,100,30,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return c;
}

export function drawSprite(ctx, sprite, x, y, size, alpha) {
  if (alpha <= 0.002) return;
  ctx.globalAlpha = clamp(alpha, 0, 1);
  const h = size / 2;
  ctx.drawImage(sprite, x - h, y - h, size, size);
}
