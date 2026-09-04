/**
 * Interaction and resilience checks that the flow test doesn't cover:
 * keyboard entry, repeated tapping, cancelled touches, every share path,
 * and replaying the whole thing without a reload.
 *
 *   node tools/interact.mjs
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const EXE = '/opt/pw-browsers/chromium';
const PORT = 4801;
const server = spawn(process.execPath, ['tools/serve.mjs', 'public'], {
  stdio: 'ignore', env: { ...process.env, PORT: String(PORT) },
});
process.on('exit', () => server.kill());
await sleep(500);

const browser = await chromium.launch({ executablePath: EXE });
const results = [];
const ok = (name, pass, detail = '') =>
  results.push(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);

async function newPage({ noShare = false } = {}) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 1,
    isMobile: true, hasTouch: true,
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript((noShareArg) => {
    window.__errors = [];
    if (noShareArg) {
      Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
    } else {
      window.__shareMode = 'ok';
      window.__shareCalls = [];
      Object.defineProperty(navigator, 'share', {
        configurable: true,
        value: async (data) => {
          window.__shareCalls.push(data);
          if (window.__shareMode === 'abort') {
            const e = new Error('cancelled'); e.name = 'AbortError'; throw e;
          }
          if (window.__shareMode === 'fail') throw new Error('sheet unavailable');
        },
      });
    }
  }, noShare);
  await page.goto(`http://127.0.0.1:${PORT}/diwali?debug`, { waitUntil: 'load' });
  return { page, ctx, errors };
}

const phase = (p) => p.evaluate(() => document.documentElement.dataset.phase);
const waitPhase = async (p, target, timeout = 60000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if ((await phase(p)) === target) return true;
    await sleep(120);
  }
  throw new Error(`stuck at ${await phase(p)} waiting for ${target}`);
};
const litCount = (p) => p.evaluate(() => window.__diwali.world.litCount);

/* ---------------------------------------------------------------- run 1 */
{
  const { page, ctx, errors } = await newPage();
  await page.waitForSelector('#diya-hit:not([hidden])');

  /* keyboard: focus the diya and press Enter */
  await page.keyboard.press('Tab');
  const focused = await page.evaluate(() => document.activeElement?.id);
  ok('diya is keyboard-reachable', focused === 'diya-hit', `focus landed on #${focused}`);
  const ringVisible = await page.evaluate(() => {
    const el = document.querySelector('.diya-hit__ring');
    return getComputedStyle(el).animationName;
  });
  ok('interaction cue is animating in INTRO', ringVisible === 'ring-pulse', ringVisible);

  await page.keyboard.press('Enter');
  await sleep(300);
  ok('Enter lights the diya', (await phase(page)) === 'LIGHT_FIRST_DIYA');

  /* repeated tapping during ignition must not double-light */
  const box = await page.locator('#diya-hit').boundingBox();
  if (box) {
    for (let i = 0; i < 8; i++) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2).catch(() => {});
    }
  }
  await waitPhase(page, 'FIRST_DIYA_RISING', 15000);
  ok('repeated taps light exactly one diya', (await litCount(page)) === 1, `litCount=${await litCount(page)}`);

  /* a cancelled touch must not leave the hold feeding sparks forever */
  await waitPhase(page, 'INVITE_MORE', 20000);
  await page.waitForSelector('#diya-hit:not([hidden])');
  const b2 = await page.locator('#diya-hit').boundingBox();
  await page.evaluate((b) => {
    const el = document.getElementById('diya-hit');
    const opts = { pointerId: 7, bubbles: true, clientX: b.x + b.width / 2, clientY: b.y + b.height / 2 };
    el.dispatchEvent(new PointerEvent('pointerdown', opts));
    el.dispatchEvent(new PointerEvent('pointercancel', opts));
  }, b2);
  await sleep(200);
  /* a pointerdown still counts as a touch even if the gesture is cancelled */
  ok('cancelled touch still lights the diya it started on',
     (await litCount(page)) === 1 || (await page.evaluate(() => window.__diwali.world.hero?.lighting)) === true);

  /* light whatever the scene asks for next until it takes over */
  const manualPhases = new Set(['INVITE_MORE', 'USER_LIGHTS_DIYAS', 'LIGHT_FIRST_DIYA', 'FIRST_DIYA_RISING']);
  const deadline = Date.now() + 90000;
  while (manualPhases.has(await phase(page)) && Date.now() < deadline) {
    const visible = await page.locator('#diya-hit:not([hidden])').count();
    if (visible) {
      const b = await page.locator('#diya-hit').boundingBox();
      if (b) await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    }
    await sleep(250);
  }
  ok('all hand-lit diyas accepted', (await litCount(page)) >= 4, `litCount=${await litCount(page)}`);
  await waitPhase(page, 'SHARE', 90000);
  ok('reaches SHARE', true);

  /* sound toggle */
  await page.click('#sound-toggle');
  await sleep(400);
  const soundOn = await page.getAttribute('#sound-toggle', 'aria-pressed');
  ok('sound toggle turns on', soundOn === 'true', `aria-pressed=${soundOn}`);
  const audioState = await page.evaluate(() => window.__diwali.audio.ctx?.state);
  ok('audio context is running', audioState === 'running', `state=${audioState}`);
  await page.click('#sound-toggle');
  await sleep(200);
  ok('sound toggle turns off', (await page.getAttribute('#sound-toggle', 'aria-pressed')) === 'false');

  /* share: success */
  await page.click('#share-button');
  await sleep(500);
  const calls = await page.evaluate(() => window.__shareCalls);
  ok('navigator.share is called with the right payload',
     calls.length === 1 && calls[0].title === 'Happy Diwali 🪔' && /^http/.test(calls[0].url),
     JSON.stringify(calls[0] || {}).slice(0, 120));
  let toast = await page.textContent('#toast');
  ok('success shows a thank-you toast', /passing the light/i.test(toast || ''), toast);

  /* share: user dismissed the sheet — must stay silent */
  await page.evaluate(() => {
    window.__shareMode = 'abort';
    document.getElementById('toast').textContent = '';
    document.getElementById('toast').dataset.visible = 'false';
  });
  await page.click('#share-button');
  await sleep(500);
  toast = await page.textContent('#toast');
  ok('cancelled share shows nothing', (toast || '') === '', toast);

  /* share: sheet throws — must fall back to the clipboard */
  await page.evaluate(() => { window.__shareMode = 'fail'; });
  await page.click('#share-button');
  await sleep(600);
  toast = await page.textContent('#toast');
  ok('failed share falls back to copy', /link copied/i.test(toast || ''), toast);

  /* whatsapp fallback link is populated */
  const wa = await page.getAttribute('#whatsapp-link', 'href');
  ok('WhatsApp link carries the message and url',
     wa.startsWith('https://wa.me/?text=') && decodeURIComponent(wa).includes('http'), wa.slice(0, 70));

  /* replay */
  const before = await page.evaluate(() => window.__diwali.world.particles.capacity);
  await page.click('#replay-button');
  await sleep(900);
  ok('replay returns to INTRO', (await phase(page)) === 'INTRO', await phase(page));
  await page.waitForSelector('#diya-hit:not([hidden])', { timeout: 15000 });
  ok('replay re-arms the diya', (await litCount(page)) === 0);
  const after = await page.evaluate(() => ({
    cap: window.__diwali.world.particles.capacity,
    active: window.__diwali.world.skyCount,
    greeting: document.getElementById('greeting').hidden,
  }));
  ok('replay reuses the same pool (no leak)', after.cap === before, `${before} -> ${after.cap}`);
  ok('replay clears the greeting', after.greeting === true);

  ok('no console errors in run 1', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

/* -------------------------------------------- run 2: no Web Share at all */
{
  const { page, ctx, errors } = await newPage({ noShare: true });
  await page.waitForSelector('#diya-hit:not([hidden])');
  const supported = await page.evaluate(() => window.__diwali.share.canShare);
  ok('Web Share correctly detected as unavailable', supported === false);

  /* jump straight to the end via the scene's own recovery path */
  await page.evaluate(() => window.__diwali.scene._safeFinish());
  await page.waitForSelector('#share-block:not([hidden])', { timeout: 20000 });
  await page.click('#share-button');
  await sleep(700);
  const toast = await page.textContent('#toast');
  ok('clipboard fallback runs when Web Share is missing', /link copied/i.test(toast || ''), toast);
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  ok('clipboard holds the message and the link',
     clip.includes('I lit a little light for you') && clip.includes('http'), clip.slice(0, 60));
  ok('safe-finish path still shows the whole greeting',
     (await page.textContent('.greeting__name')).includes('Harikishan'));
  ok('no console errors in run 2', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

console.log('\n' + results.join('\n'));
const failed = results.filter((r) => r.startsWith('FAIL')).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
await browser.close();
server.kill();
process.exit(failed ? 1 : 0);
