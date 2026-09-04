/**
 * Drives the whole experience in a real browser and reports what happened.
 *
 *   node tools/check.mjs                      # default 390x844
 *   node tools/check.mjs --w=1440 --h=900     # desktop
 *   node tools/check.mjs --reduced            # prefers-reduced-motion
 *   node tools/check.mjs --shots              # write screenshots to tools/out
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';

const EXE = '/opt/pw-browsers/chromium';
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v === undefined ? true : v];
  })
);

const W = Number(args.w || 390);
const H = Number(args.h || 844);
const PORT = Number(args.port || 4173 + Math.floor(Math.random() * 400));
const SHOTS = !!args.shots;
const OUT = 'tools/out';
const label = args.label || `${W}x${H}${args.reduced ? '-reduced' : ''}`;

const server = spawn(process.execPath, ['tools/serve.mjs', 'public'], {
  stdio: 'ignore',
  env: { ...process.env, PORT: String(PORT) },
});
process.on('exit', () => server.kill());
await sleep(500);

if (SHOTS) await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: EXE });
const context = await browser.newContext({
  viewport: { width: W, height: H },
  deviceScaleFactor: args.dpr ? Number(args.dpr) : (W < 700 ? 3 : 2),
  isMobile: W < 700,
  hasTouch: W < 700,
  reducedMotion: args.reduced ? 'reduce' : 'no-preference',
  userAgent: W < 700
    ? 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36'
    : undefined,
});

const page = await context.newPage();
const problems = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') problems.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}`));
page.on('requestfailed', (r) => {
  const u = r.url();
  if (u.startsWith('data:')) return;
  problems.push(`[requestfailed] ${u} — ${r.failure()?.errorText}`);
});

const shot = async (name) => {
  if (!SHOTS) return;
  await page.screenshot({ path: `${OUT}/${label}-${name}.png` });
};

const phase = () => page.evaluate(() => document.documentElement.dataset.phase);
const waitPhase = async (target, timeout = 60000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if ((await phase()) === target) return true;
    await sleep(120);
  }
  throw new Error(`timed out waiting for phase ${target} (stuck at ${await phase()})`);
};

/* frame-rate probe running for the whole session */
await page.addInitScript(() => {
  window.__frames = [];
  const tick = (t) => { window.__frames.push(t); requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
});

const t0 = Date.now();
await page.goto(`http://127.0.0.1:${PORT}/diwali?debug`, { waitUntil: 'load' });

await page.waitForSelector('#diya-hit:not([hidden])', { timeout: 15000 });
await sleep(2400);
await shot('01-intro');

const lightOne = async (n) => {
  await page.waitForSelector('#diya-hit:not([hidden])', { timeout: 30000 });
  const box = await page.locator('#diya-hit').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await sleep(420);                       // press-and-hold path
  await page.mouse.up();
  if (n === 1) { await sleep(1500); await shot('02-first-flame'); }
};

await lightOne(1);
await waitPhase('FIRST_DIYA_RISING', 20000);
await sleep(1600);
await shot('03-rising');

for (let n = 2; n <= 4; n++) await lightOne(n);

await waitPhase('MAGIC_EXPANSION', 40000);
await sleep(2600);
await shot('04-expansion');

await waitPhase('SKY_FULL', 40000);
await sleep(1800);
await shot('05-sky-full');

await waitPhase('TEXT_FORMATION', 40000);
await sleep(2400);
await shot('06-formation');

/* dump the offscreen text mask so glyph shaping can be checked directly */
if (SHOTS) {
  const mask = await page.evaluate(() => {
    const tf = window.__diwali?.world?.textFormation;
    if (!tf) return null;
    const c = document.createElement('canvas');
    c.width = tf.canvas.width; c.height = tf.canvas.height;
    const x = c.getContext('2d');
    x.fillStyle = '#000'; x.fillRect(0, 0, c.width, c.height);
    x.drawImage(tf.canvas, 0, 0);
    return c.toDataURL('image/png');
  });
  if (mask) {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(`${OUT}/${label}-06b-textmask.png`, Buffer.from(mask.split(',')[1], 'base64'));
  }
}

await waitPhase('FINAL_GREETING', 40000);
await sleep(2600);
await shot('07-greeting-line-1');
await sleep(4200);
await shot('08-greeting-line-2');

await waitPhase('SHARE', 60000);
await sleep(1800);
await shot('09-share');

const seconds = ((Date.now() - t0) / 1000).toFixed(1);

const stats = await page.evaluate(() => {
  const f = window.__frames;
  const gaps = [];
  for (let i = 1; i < f.length; i++) gaps.push(f[i] - f[i - 1]);
  gaps.sort((a, b) => a - b);
  const pct = (p) => gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * p))] || 0;
  const doc = document.documentElement;
  return {
    frames: f.length,
    span: ((f[f.length - 1] - f[0]) / 1000).toFixed(1),
    medianMs: pct(0.5).toFixed(2),
    p95Ms: pct(0.95).toFixed(2),
    worstMs: (gaps[gaps.length - 1] || 0).toFixed(1),
    hScroll: doc.scrollWidth > doc.clientWidth,
    vScroll: doc.scrollHeight > doc.clientHeight,
    cores: navigator.hardwareConcurrency, mem: navigator.deviceMemory,
    sky: window.__diwali ? {
      capacity: window.__diwali.world.particles.capacity,
      active: window.__diwali.world.skyCount,
      skyPop: window.__diwali.world.skyPopulation,
      textPoints: window.__diwali.world.textFormation.points.length,
      pitch: window.__diwali.world.textFormation.pitch,
      assigned: window.__diwali.world.textFormation.assigned.length,
      dpr: window.__diwali.world.dpr,
      qualityCap: window.__diwali.world.qualityCap,
    } : null,
    greetingVisible: document.getElementById('greeting')?.dataset.visible,
    shareVisible: document.getElementById('share-block')?.dataset.visible,
    teluguRendered: (() => {
      const el = document.querySelector('.greeting__script');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height), font: getComputedStyle(el).fontFamily };
    })(),
  };
});

const fps = stats.medianMs > 0 ? (1000 / Number(stats.medianMs)).toFixed(1) : '?';

console.log(`\n── ${label} ─────────────────────────────`);
console.log(`run time to SHARE      ${seconds}s`);
console.log(`frames                 ${stats.frames} over ${stats.span}s`);
console.log(`frame gap median/p95   ${stats.medianMs}ms / ${stats.p95Ms}ms  (~${fps} fps)`);
console.log(`worst frame            ${stats.worstMs}ms`);
console.log(`horizontal scroll      ${stats.hScroll ? 'YES (bug)' : 'no'}`);
console.log(`page scroll            ${stats.vScroll ? 'YES (bug)' : 'no'}`);
console.log(`greeting / share       ${stats.greetingVisible} / ${stats.shareVisible}`);
console.log(`telugu line            ${JSON.stringify(stats.teluguRendered)}`);
console.log(`device                 ${stats.cores} cores / ${stats.mem} GB`);
console.log(`sky                    ${JSON.stringify(stats.sky)}`);
console.log(`console problems       ${problems.length}`);
for (const p of problems.slice(0, 25)) console.log(`   ${p}`);

await browser.close();
server.kill();
process.exit(problems.length ? 1 : 0);
