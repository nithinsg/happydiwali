/* Small math / timing helpers. No dependencies. */

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const rand = (a, b) => a + Math.random() * (b - a);
export const randInt = (a, b) => Math.floor(a + Math.random() * (b - a + 1));

export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeOutQuint = (t) => 1 - Math.pow(1 - t, 5);
export const easeInOutCubic = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
export const smoothstep = (edge0, edge1, x) => {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Fisher-Yates, in place. */
export function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
  return arr;
}

/**
 * Minimal promise-based delay that is cancellable as a group.
 * Used by the scene manager so a page-hide or replay can abort a pending beat.
 */
export class Timeline {
  constructor() {
    this._timers = new Set();
    this._cancelled = false;
  }
  wait(ms) {
    return new Promise((resolve) => {
      if (this._cancelled) return; // never resolves; caller chain is abandoned
      const id = setTimeout(() => {
        this._timers.delete(id);
        resolve();
      }, ms);
      this._timers.add(id);
    });
  }
  cancel() {
    this._cancelled = true;
    this._timers.forEach(clearTimeout);
    this._timers.clear();
  }
  reset() {
    this.cancel();
    this._cancelled = false;
  }
}

export const prefersReducedMotion = () => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};
