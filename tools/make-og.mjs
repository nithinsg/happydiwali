/**
 * Renders the social preview image and the apple-touch icon.
 *
 *   node tools/make-og.mjs
 *
 * Both are drawn by the site's own renderers in a real browser, so the
 * WhatsApp preview and the page it links to look like the same thing.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const EXE = '/opt/pw-browsers/chromium';
const PORT = 4699;

const server = spawn(process.execPath, ['tools/serve.mjs', '.'], {
  stdio: 'ignore',
  env: { ...process.env, PORT: String(PORT) },
});
process.on('exit', () => server.kill());
await sleep(500);

const browser = await chromium.launch({ executablePath: EXE });

/* ---- Open Graph card ---- */
const og = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
og.on('pageerror', (e) => console.error('og page error:', e.message));
await og.goto(`http://127.0.0.1:${PORT}/tools/og.html`, { waitUntil: 'load' });
await og.waitForFunction(() => document.documentElement.dataset.ready === 'true', { timeout: 15000 });
await og.evaluate(() => document.fonts.ready);
await sleep(400);
/* JPEG, not PNG: a chat client fetches this before it can show a preview,
   and 60 KB arrives on a slow connection where 540 KB does not. */
await og.screenshot({ path: 'public/og.jpg', type: 'jpeg', quality: 88 });
const { statSync } = await import('node:fs');
console.log(`wrote public/og.jpg (1200×630, ${(statSync('public/og.jpg').size / 1024).toFixed(0)} KB)`);

/* ---- apple-touch-icon, straight from the favicon artwork ---- */
const icon = await browser.newPage({ viewport: { width: 180, height: 180 }, deviceScaleFactor: 1 });
await icon.goto(
  `data:text/html,<style>html,body{margin:0;width:180px;height:180px;background:%2305070D}` +
  `img{width:180px;height:180px;display:block}</style>` +
  `<img src="http://127.0.0.1:${PORT}/public/favicon.svg">`,
  { waitUntil: 'load' }
);
await sleep(300);
await icon.screenshot({ path: 'public/apple-touch-icon.png' });
console.log('wrote public/apple-touch-icon.png (180×180)');

await browser.close();
server.kill();
