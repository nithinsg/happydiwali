/**
 * AudioManager — a fully procedural Diwali soundscape.
 *
 * Nothing is downloaded: every layer is synthesised with Web Audio, so there
 * are no assets, no licensing questions and no payload cost. It is created
 * lazily on the first user gesture and never autoplays.
 *
 * Layers: a soft tanpura-like drone, an occasional distant bell, a barely
 * audible flame crackle, a chime as each diya lights, a rising shimmer during
 * the expansion, and one quiet resolution under the final greeting.
 */

const SA = 138.59;           // C#3 — a comfortable tonic for the drone

export class AudioManager {
  constructor() {
    this.ctx = null;
    this.enabled = false;
    this.supported = typeof window !== 'undefined' &&
      !!(window.AudioContext || window.webkitAudioContext);
    this.master = null;
    this.nodes = [];
    this.noiseBuf = null;
    this._bellTimer = null;
    this._crackleTimer = null;
  }

  /* -------------------------------------------------- setup */

  _ensure() {
    if (this.ctx || !this.supported) return this.ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    try {
      this.ctx = new AC();
    } catch {
      this.supported = false;
      return null;
    }
    const c = this.ctx;

    this.master = c.createGain();
    this.master.gain.value = 0;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(c.destination);

    /* shared noise source buffer */
    const len = Math.floor(c.sampleRate * 2);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;

    this._buildDrone();
    return c;
  }

  _buildDrone() {
    const c = this.ctx;
    const bus = c.createGain();
    bus.gain.value = 0.0;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 520;
    lp.Q.value = 0.6;
    bus.connect(lp).connect(this.master);

    /* Sa (two octaves) + Pa, gently detuned so the drone breathes */
    const partials = [
      { f: SA / 2, g: 0.34, det: 0 },
      { f: SA, g: 0.22, det: 3 },
      { f: SA * 1.5, g: 0.15, det: -4 },
      { f: SA * 2, g: 0.07, det: 6 },
    ];
    for (const p of partials) {
      const o = c.createOscillator();
      o.type = 'triangle';
      o.frequency.value = p.f;
      o.detune.value = p.det;
      const g = c.createGain();
      g.gain.value = p.g;

      /* slow amplitude shimmer, different rate per partial */
      const lfo = c.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = 0.045 + Math.random() * 0.06;
      const lfoGain = c.createGain();
      lfoGain.gain.value = p.g * 0.42;
      lfo.connect(lfoGain).connect(g.gain);

      o.connect(g).connect(bus);
      o.start();
      lfo.start();
      this.nodes.push(o, lfo);
    }

    /* a slow filter sweep keeps it from sitting still */
    const fLfo = c.createOscillator();
    fLfo.type = 'sine';
    fLfo.frequency.value = 0.035;
    const fAmt = c.createGain();
    fAmt.gain.value = 150;
    fLfo.connect(fAmt).connect(lp.frequency);
    fLfo.start();
    this.nodes.push(fLfo);

    this.droneBus = bus;
  }

  /* -------------------------------------------------- voices */

  _noise(dur, { gain = 0.05, type = 'bandpass', freq = 2200, q = 1, sweepTo = null } = {}) {
    const c = this.ctx;
    if (!c) return;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = c.createGain();
    const now = c.currentTime;
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(gain, now + Math.min(0.08, dur * 0.3));
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    if (sweepTo) {
      f.frequency.setValueAtTime(freq, now);
      f.frequency.exponentialRampToValueAtTime(sweepTo, now + dur);
    }
    src.connect(f).connect(g).connect(this.master);
    src.start(now);
    src.stop(now + dur + 0.05);
  }

  /** Inharmonic partial stack — reads as a small temple bell. */
  _bell(freq, { gain = 0.12, dur = 3.2, delay = 0 } = {}) {
    const c = this.ctx;
    if (!c) return;
    const t0 = c.currentTime + delay;
    const ratios = [1, 2.0, 2.97, 4.16, 5.43, 6.8];
    const decays = [1, 0.72, 0.55, 0.36, 0.26, 0.18];
    const out = c.createGain();
    out.gain.value = gain;
    out.connect(this.master);
    ratios.forEach((r, i) => {
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.value = freq * r;
      const g = c.createGain();
      const peak = 0.9 / (i + 1.6);
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(peak, t0 + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur * decays[i]);
      o.connect(g).connect(out);
      o.start(t0);
      o.stop(t0 + dur * decays[i] + 0.1);
    });
  }

  _scheduleAmbience() {
    const bell = () => {
      if (!this.enabled) return;
      this._bell(SA * (Math.random() < 0.5 ? 2 : 3), { gain: 0.035, dur: 5.5 });
      this._bellTimer = setTimeout(bell, 17000 + Math.random() * 26000);
    };
    this._bellTimer = setTimeout(bell, 9000 + Math.random() * 9000);

    const crackle = () => {
      if (!this.enabled) return;
      const n = 1 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) {
        setTimeout(() => {
          if (this.enabled) {
            this._noise(0.05 + Math.random() * 0.07, {
              gain: 0.012 + Math.random() * 0.012,
              freq: 1400 + Math.random() * 2600,
              q: 2.2,
            });
          }
        }, i * (60 + Math.random() * 180));
      }
      this._crackleTimer = setTimeout(crackle, 1400 + Math.random() * 3600);
    };
    this._crackleTimer = setTimeout(crackle, 2200);
  }

  /* -------------------------------------------------- public cues */

  /** A diya catches light. `n` walks up a pentatonic scale as more are lit. */
  cueLight(n = 0) {
    if (!this.enabled || !this.ctx) return;
    const scale = [0, 2, 4, 7, 9, 12, 14, 16];
    const semis = scale[Math.min(n, scale.length - 1)];
    this._bell(SA * 4 * Math.pow(2, semis / 12), { gain: 0.075, dur: 2.6 });
    this._noise(0.16, { gain: 0.022, freq: 3200, q: 1.4, sweepTo: 6400 });
  }

  cueSpark() {
    if (!this.enabled || !this.ctx) return;
    this._noise(0.22, { gain: 0.012, freq: 5200, q: 0.9, sweepTo: 9000 });
  }

  /** Rising shimmer under the multiplication. */
  cueShimmer(duration = 4) {
    if (!this.enabled || !this.ctx) return;
    this._noise(duration, { gain: 0.028, type: 'bandpass', freq: 700, q: 1.1, sweepTo: 7200 });
    const scale = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21];
    scale.forEach((s, i) => {
      this._bell(SA * 4 * Math.pow(2, s / 12), {
        gain: 0.03,
        dur: 2.2,
        delay: i * (duration / (scale.length + 2)),
      });
    });
  }

  /** Distant firework: a soft sparkle, never a crack. */
  cueFirework(size = 1) {
    if (!this.enabled || !this.ctx) return;
    this._noise(0.45 * size, { gain: 0.010 * size, freq: 2600, q: 0.7, sweepTo: 900 });
    setTimeout(() => {
      if (!this.enabled) return;
      for (let i = 0; i < 4; i++) {
        setTimeout(() => this.enabled && this._noise(0.09, {
          gain: 0.006, freq: 5000 + Math.random() * 4000, q: 3,
        }), i * 70 + Math.random() * 60);
      }
    }, 90);
  }

  /** A quiet, warm resolution under the greeting. */
  cueResolve() {
    if (!this.enabled || !this.ctx) return;
    [0, 4, 7, 12].forEach((s, i) =>
      this._bell(SA * 2 * Math.pow(2, s / 12), { gain: 0.045, dur: 6.5, delay: i * 0.34 })
    );
  }

  /* -------------------------------------------------- lifecycle */

  async toggle() {
    if (!this.supported) return false;
    if (this.enabled) { this.disable(); return false; }
    await this.enable();
    return this.enabled;
  }

  async enable() {
    const c = this._ensure();
    if (!c) return false;
    try {
      if (c.state === 'suspended') await c.resume();
    } catch { /* iOS may reject outside a gesture; the toggle is a gesture */ }
    this.enabled = true;
    const now = c.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    this.master.gain.linearRampToValueAtTime(0.9, now + 1.4);
    this.droneBus.gain.cancelScheduledValues(now);
    this.droneBus.gain.setValueAtTime(this.droneBus.gain.value, now);
    this.droneBus.gain.linearRampToValueAtTime(0.10, now + 4.0);
    this._scheduleAmbience();
    return true;
  }

  disable() {
    this.enabled = false;
    clearTimeout(this._bellTimer);
    clearTimeout(this._crackleTimer);
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    this.master.gain.linearRampToValueAtTime(0, now + 0.6);
  }

  setPaused(paused) {
    if (!this.ctx || !this.enabled) return;
    try {
      if (paused) this.ctx.suspend();
      else this.ctx.resume();
    } catch { /* not fatal */ }
  }
}
