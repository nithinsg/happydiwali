/**
 * Bootstrap: canvas + loop + input + graceful degradation.
 *
 * Everything here is defensive. If the canvas, Web Audio, the Web Share API,
 * the clipboard or even the whole animation fails, the viewer still gets the
 * complete greeting — it is real HTML that was in the document all along.
 */

import { World } from './world.js';
import { SceneManager } from './scene-manager.js';
import { AudioManager } from './audio-manager.js';
import { ShareManager } from './share-manager.js';
import { UI } from './ui.js';
import { prefersReducedMotion } from './utils.js';

const root = document.documentElement;

/* ------------------------------------------------------------------ *
 * Device budget
 * ------------------------------------------------------------------ */

function initialQuality() {
  const cores = navigator.hardwareConcurrency || 4;
  const mem = navigator.deviceMemory || 4;
  const px = (window.innerWidth || 390) * (window.innerHeight || 844) *
    Math.min(window.devicePixelRatio || 1, 2) ** 2;
  /* Start optimistic and let the measured frame rate walk it back — the
     static hints are only good enough to catch genuinely weak hardware. */
  let q = 1;
  if (cores <= 3 || mem <= 2) q = 0.62;
  if (cores <= 1) q = 0.45;
  if (px > 3.6e6) q = Math.min(q, 0.82);   // large, dense screens cost fill rate
  return q;
}

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */

function boot() {
  const canvas = document.getElementById('sky');
  const bgCanvas = document.getElementById('bg');
  const ui = new UI(root);
  const audio = new AudioManager();
  const share = new ShareManager();
  const reduced = prefersReducedMotion();

  if (reduced) ui.speed = 1.55;

  let ctxOk = false;
  try {
    ctxOk = !!(canvas && canvas.getContext && canvas.getContext('2d'));
  } catch { ctxOk = false; }

  if (!ctxOk) return staticFallback(ui, audio, share);

  const world = new World(canvas, bgCanvas, { reduced, quality: initialQuality() });
  const scene = new SceneManager({ world, ui, audio, reduced });

  /* ?debug exposes the scene for inspection; nothing is attached otherwise */
  if (location.search.includes('debug')) {
    window.__diwali = { world, scene, ui, audio, share };
  }

  /* ------------------------------------------------------- layout */

  let resizeRaf = 0;
  const applySize = () => {
    resizeRaf = 0;
    world.resize();
    ui.setHeroMetrics(world.width * 0.5, world.heroY, world.heroW);
  };
  const queueResize = () => {
    if (resizeRaf) return;
    resizeRaf = requestAnimationFrame(applySize);
  };

  applySize();
  window.addEventListener('resize', queueResize, { passive: true });
  window.addEventListener('orientationchange', () => setTimeout(applySize, 220), { passive: true });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', queueResize, { passive: true });
  }

  /* -------------------------------------------------------- input */

  const diyaBtn = ui.el.diya;
  let holding = false;

  const press = (e) => {
    if (diyaBtn.disabled) return;
    if (e.pointerId !== undefined && diyaBtn.setPointerCapture) {
      try { diyaBtn.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    }
    holding = true;
    scene.touchDiya();
  };
  const releaseHold = () => { holding = false; };

  diyaBtn.addEventListener('pointerdown', press);
  diyaBtn.addEventListener('pointerup', releaseHold);
  diyaBtn.addEventListener('pointercancel', releaseHold);
  diyaBtn.addEventListener('pointerleave', releaseHold);
  window.addEventListener('blur', releaseHold);
  /* keyboard: a real <button> raises click for Enter/Space */
  diyaBtn.addEventListener('click', (e) => {
    e.preventDefault();
    scene.touchDiya();
  });

  /* Tapping near the diya (but not exactly on it) should still work. */
  canvas.addEventListener('pointerdown', (e) => {
    if (diyaBtn.disabled || diyaBtn.hidden) return;
    if (world.hitTestHero(e.clientX, e.clientY)) {
      holding = true;
      scene.touchDiya();
    }
  });
  canvas.addEventListener('pointerup', releaseHold);
  canvas.addEventListener('pointercancel', releaseHold);

  /* --------------------------------------------------------- loop */

  let last = performance.now();
  let paused = false;
  let fpsAccum = 0;
  let fpsFrames = 0;
  let degradeCooldown = 4;
  let slowWindows = 0;
  let lastWarmth = -1;

  function frame(now) {
    requestAnimationFrame(frame);
    if (paused) { last = now; return; }

    let dt = (now - last) / 1000;
    last = now;
    if (!(dt > 0)) dt = 0.016;
    dt = Math.min(dt, 0.05);          // a backgrounded tab must not fast-forward

    if (holding) world.feedHold(dt);

    world.update(dt, now);
    world.render();

    if (Math.abs(world.warmth - lastWarmth) > 0.004) {
      lastWarmth = world.warmth;
      ui.setWarmth(world.warmth);
    }

    /* Adaptive quality. Two slow windows in a row before stepping down: one
       slow window is usually a one-off cost like building the text mask, and
       thinning the sky for that would be a worse trade than the stall. */
    fpsAccum += dt;
    fpsFrames++;
    if (fpsAccum >= 1.6) {
      const fps = fpsFrames / fpsAccum;
      fpsAccum = 0;
      fpsFrames = 0;
      degradeCooldown -= 1;
      slowWindows = fps < 40 ? slowWindows + 1 : 0;
      if (slowWindows >= 2 && degradeCooldown <= 0 && world.qualityCap > 0.6) {
        world.degrade();
        applySize();
        degradeCooldown = 6;
        slowWindows = 0;
      }
    }
  }
  requestAnimationFrame(frame);

  document.addEventListener('visibilitychange', () => {
    paused = document.hidden;
    audio.setPaused(document.hidden);
  });

  /* ----------------------------------------------------------- UI */

  ui.el.sound.addEventListener('click', async () => {
    const on = await audio.toggle();
    ui.setSoundState(on);
    if (!audio.supported) {
      ui.el.sound.hidden = true;
      ui.toast('Sound is not available on this device.');
    }
  });

  const shareBtn = document.getElementById('share-button');
  shareBtn.addEventListener('click', async () => {
    shareBtn.disabled = true;
    try {
      const result = await share.share();
      if (result === 'copied') ui.toast('Link copied. Share the light. 🪔');
      else if (result === 'shared') ui.toast('Thank you for passing the light. 🪔');
      else if (result === 'unavailable') ui.toast('Copy the link from your browser bar to share. 🪔');
    } finally {
      shareBtn.disabled = false;
    }
  });

  const waBtn = document.getElementById('whatsapp-link');
  if (waBtn) waBtn.href = share.whatsappHref();

  const replayBtn = document.getElementById('replay-button');
  replayBtn.addEventListener('click', () => {
    scene.replay();
  });

  /* ------------------------------------------------------ fonts */

  /* The faces are subset, so each load() must name text inside its own
     unicode-range — the default probe string would match nothing. */
  const needed = [
    ['700 48px "Noto Serif Devanagari"', 'शुभ दीपावली'],
    ['600 48px "Cormorant Garamond"', 'HAPPY DIWALI'],
    ['300 24px "Cormorant Garamond"', 'Some lights'],
    ['500 24px "Noto Sans Telugu"', 'శుభ దీపావళి'],
    ['400 16px "Inter"', 'Light the first diya'],
  ];
  const fontsReady = (document.fonts && document.fonts.load)
    ? Promise.all(needed.map(([f, text]) => document.fonts.load(f, text).catch(() => null)))
    : Promise.resolve();

  Promise.race([fontsReady, new Promise((r) => setTimeout(r, 2600))]).then(() => {
    ui.hideLoader();
    scene.start();
  });

  window.addEventListener('pagehide', () => audio.disable());
}

/* ------------------------------------------------------------------ *
 * No canvas? Show the greeting anyway.
 * ------------------------------------------------------------------ */

function staticFallback(ui, audio, share) {
  root.dataset.phase = 'SHARE';
  root.dataset.fallback = 'true';
  ui.hideLoader();
  ui.reset();
  ui.el.scrim.dataset.visible = 'true';
  ui.el.greeting.hidden = false;
  ui.el.greeting.dataset.visible = 'true';
  ui.el.share.hidden = false;
  ui.el.share.dataset.visible = 'true';
  const shareBtn = document.getElementById('share-button');
  shareBtn.addEventListener('click', async () => {
    const r = await share.share();
    if (r === 'copied') ui.toast('Link copied. Share the light. 🪔');
  });
  const waBtn = document.getElementById('whatsapp-link');
  if (waBtn) waBtn.href = share.whatsappHref();
  const replayBtn = document.getElementById('replay-button');
  if (replayBtn) replayBtn.hidden = true;
}

/* ------------------------------------------------------------------ */

try {
  boot();
} catch (err) {
  if (window.console && console.error) console.error(err);
  try {
    staticFallback(new UI(root), new AudioManager(), new ShareManager());
  } catch { /* the greeting is still in the document */ }
}
