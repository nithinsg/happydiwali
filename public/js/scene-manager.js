/**
 * SceneManager — the whole story as one linear, awaitable script.
 *
 * The states below are real: `state` is always exactly one of them and every
 * transition happens here. Writing the narrative as an async sequence keeps
 * the beats readable in the order the viewer experiences them, instead of
 * scattering them across a dozen booleans and callbacks.
 */

import { Timeline } from './utils.js';

export const STATES = /** @type {const} */ ({
  INTRO: 'INTRO',
  LIGHT_FIRST_DIYA: 'LIGHT_FIRST_DIYA',
  FIRST_DIYA_RISING: 'FIRST_DIYA_RISING',
  INVITE_MORE: 'INVITE_MORE',
  USER_LIGHTS_DIYAS: 'USER_LIGHTS_DIYAS',
  MAGIC_EXPANSION: 'MAGIC_EXPANSION',
  SKY_FULL: 'SKY_FULL',
  TEXT_FORMATION: 'TEXT_FORMATION',
  FINAL_GREETING: 'FINAL_GREETING',
  SHARE: 'SHARE',
});

/** How many diyas the viewer lights by hand before the sky takes over. */
const MANUAL_DIYAS = 4;

const FORMATION_LINES = [
  {
    text: 'शुभ दीपावली',
    family: '"Noto Serif Devanagari", "Noto Sans Devanagari", serif',
    weight: 700,
    fill: 0.97,
    gap: 0.46,
  },
  {
    text: 'HAPPY DIWALI',
    family: '"Cormorant Garamond", Georgia, serif',
    weight: 600,
    spacing: 0.15,
    fill: 0.80,
    /* Cormorant's strokes are far thinner than the Devanagari's, so this
       line needs a finer pitch to stay continuous at the same size. */
    pitchRatio: 0.052,
  },
];

export class SceneManager {
  constructor({ world, ui, audio, reduced }) {
    this.world = world;
    this.ui = ui;
    this.audio = audio;
    this.reduced = !!reduced;
    this.timeline = new Timeline();
    this.state = STATES.INTRO;
    this.onState = null;
    this._litResolve = null;
    this._litPending = 0;
    this._running = false;

    /* the only sound a firework makes here is a soft distant sparkle */
    this.world.fireworks.onBurst = (size) => this.audio.cueFirework(size);

    this.world.onDiyaLit = (n) => {
      this.audio.cueLight(n - 1);
      if (this._litResolve) {
        const r = this._litResolve;
        this._litResolve = null;
        r(n);
      } else {
        /* Latch it. Someone can light the diya before the narrative has got
           round to waiting on it, and dropping that signal would strand them
           in front of a lit lamp with nothing happening. */
        this._litPending = n;
      }
    };
  }

  setState(s) {
    this.state = s;
    this.ui.setPhase(s);
    if (this.onState) this.onState(s);
  }

  /** Called from the pointer/keyboard handler. */
  touchDiya() {
    if (!this.world.hero || this.world.hero.lit || this.world.hero.lighting) return false;
    const started = this.world.igniteHero();
    if (started) {
      this.audio.cueSpark();
      this.ui.clearHint();
      this.ui.armDiya(false);
      if (this.state === STATES.INTRO) this.setState(STATES.LIGHT_FIRST_DIYA);
    }
    return started;
  }

  waitForLit() {
    if (this._litPending) {
      const n = this._litPending;
      this._litPending = 0;
      return Promise.resolve(n);
    }
    return new Promise((resolve) => { this._litResolve = resolve; });
  }

  wait(ms) {
    return this.timeline.wait(this.reduced ? ms * 0.62 : ms);
  }

  async start() {
    if (this._running) return;
    this._running = true;
    try {
      await this._run();
    } catch (err) {
      // Never strand the viewer: jump straight to the greeting.
      if (window.console && console.warn) console.warn('scene aborted', err);
      await this._safeFinish();
    }
  }

  async _run() {
    const { world, ui, audio } = this;

    /* ---------------------------------------------------------- INTRO */
    this.setState(STATES.INTRO);
    await this.wait(420);
    world.placeHero({ igniteTime: 1.75 });
    ui.armDiya(true, 'Light the diya');

    /* The opening copy plays alongside the invitation rather than gating it.
       Someone who reaches for the diya in the first second should not have to
       wait for a sentence to finish before the story moves. */
    void (async () => {
      await ui.caption('Some lights are meant to be shared.');
      await this.wait(1700);
      if (this.state === STATES.INTRO) ui.hint('Light the first diya.');
    })();

    /* ------------------------------------------- the first little light */
    await this.waitForLit();
    /* offered only after the first touch, and only if this device can
       actually make a sound */
    ui.showSound(audio.supported);
    await ui.clearCaption();
    await this.wait(460);

    this.setState(STATES.FIRST_DIYA_RISING);
    world.warmthTarget = 0.18;
    world.cam.target = this.reduced ? 0 : 44;
    world.fireworks.enabled = true;
    world.launchHero({ duration: this.reduced ? 1.5 : 3.0 });
    await this.wait(420);
    await ui.caption('One little light can brighten the darkness.');
    await this.wait(2500);

    /* --------------------------------------------- three more, by hand */
    for (let n = 2; n <= MANUAL_DIYAS; n++) {
      this.setState(n === 2 ? STATES.INVITE_MORE : STATES.USER_LIGHTS_DIYAS);

      if (n === 2) await ui.caption('Now, light one more.');
      else if (n === 3) await ui.caption('Every light makes the sky brighter.');
      else await ui.clearCaption();

      world.placeHero({ igniteTime: 1.05 });
      ui.armDiya(true, 'Light another diya');

      await this.waitForLit();
      await this.wait(400);
      world.launchHero({ duration: this.reduced ? 1.2 : 2.2 });
      world.warmthTarget = 0.18 + n * 0.05;
      world.cam.target = this.reduced ? 0 : 44 + n * 5;
      if (n < MANUAL_DIYAS) await this.wait(950);
    }

    /* ------------------------------------------------ the magic moment */
    this.setState(STATES.MAGIC_EXPANSION);
    await this.wait(900);
    await ui.caption('And when we share our light…');
    audio.cueShimmer(6);

    const waves = [[5, 3], [10, 8], [20, 18], [40, 42]];
    for (const [n, speed] of waves) {
      world.growTo(n, speed);
      world.warmthTarget = Math.min(0.55, world.warmthTarget + 0.06);
      await this.wait(1100);
    }

    await ui.caption('something beautiful happens.');
    world.growTo(80, 95);
    await this.wait(1350);
    world.growTo(world.skyCapacity, 210);

    /* ------------------------------------------------------- sky full */
    this.setState(STATES.SKY_FULL);
    world.warmthTarget = 0.72;
    world.cam.target = this.reduced ? 0 : 30;
    world.rangoliTarget = 1;
    world.fireworks.finale(world.width, world.height, this.reduced);
    await this.wait(1500);
    await ui.clearCaption();
    await this.wait(1900);

    /* --------------------------------------- the lights become the words */
    this.setState(STATES.TEXT_FORMATION);
    world.fireworks.intensity = 'off';
    world.formText(FORMATION_LINES);
    audio.cueShimmer(3);
    await this.wait(2700);

    /* ------------------------------------------------------- greeting */
    this.setState(STATES.FINAL_GREETING);
    await ui.caption([
      'May your life always have a little more light,',
      'a little more warmth,',
      'and many more reasons to smile.',
    ]);
    await this.wait(3700);
    await ui.caption([
      'Wishing you and your loved ones',
      'a beautiful and prosperous Diwali.',
    ]);
    await this.wait(3200);
    await ui.clearCaption();

    audio.cueResolve();
    /* one last soft bloom, well off to the side of the words */
    world.fireworks.closing(
      world.width * (Math.random() < 0.5 ? 0.18 : 0.82),
      world.height * 0.13
    );
    world.fireworks.intensity = 'ambient';
    /* On a short screen the card and the constellation cannot both have the
       frame, so the lights drop back to being atmosphere. */
    world.skyAlpha = world.height < 560 ? 0.42 : 0.9;

    await this.wait(700);
    await ui.revealGreeting();
    await this.wait(2200);

    /* ---------------------------------------------------------- share */
    this.setState(STATES.SHARE);
    await ui.revealShare();
  }

  /** Last-resort path so a viewer always reaches the greeting. */
  async _safeFinish() {
    const { world, ui } = this;
    try {
      world.growTo(world.skyCapacity, 400);
      world.warmthTarget = 0.72;
      world.rangoliTarget = 1;
      world.formText(FORMATION_LINES);
      this.setState(STATES.FINAL_GREETING);
      await new Promise((r) => setTimeout(r, 600));
      await ui.clearCaption();
      await ui.revealGreeting();
      this.setState(STATES.SHARE);
      await ui.revealShare();
    } catch { /* nothing further we can do, and the text is already in the DOM */ }
  }

  /** Start the whole story over without a page reload. */
  async replay() {
    this.timeline.reset();
    this._litResolve = null;
    this._litPending = 0;
    this._litPending = 0;
    this._running = false;
    this.world.reset();
    this.ui.reset();
    this.ui.setWarmth(0);
    await new Promise((r) => setTimeout(r, 240));
    this.start();
  }

  destroy() {
    this.timeline.cancel();
  }
}
