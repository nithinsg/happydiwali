# A Sky Full of Diyas 🪔

An interactive Diwali greeting. You light one diya; it rises into the night. You
light a few more; then the sky answers with hundreds, and the lights themselves
draw **शुभ दीपावली / HAPPY DIWALI** across it. The whole thing takes about a
minute, and it exists to say one thing:

> Light is more beautiful when it is shared.

A personal greeting from **Dr. Harikishan Gonugantla** closes it, and a single
button passes the light on.

---

## Running it

No build step, no dependencies at runtime, no backend.

```bash
npm install          # dev tooling only (Playwright, for tests + image generation)
npm run dev          # serves ./public at http://127.0.0.1:4173
```

Open `/` or `/diwali`.

The site is the contents of `public/`. It can be hosted by anything that serves
static files.

## Layout

```
public/
  index.html          the whole document — every word of the greeting is real HTML
  styles.css          design system, layout, motion, reduced-motion fallbacks
  fonts.css           @font-face for the self-hosted subsets (generated)
  fonts/              4 woff2 subsets, 73 KB total (Telugu fetched late)
  og.jpg              social preview (generated)
  js/
    main.js           bootstrap: canvas, loop, input, degradation, error paths
    scene-manager.js  the narrative, as one linear awaitable script + state machine
    world.js          everything on the canvas; the API the scene drives
    particle-system.js pooled sky of diyas + a pool of short-lived glow particles
    diya-particle.js  one light: drift mode and letterform-seeking mode
    flame-renderer.js procedural flame, clay lamp, and the pre-baked sprite atlas
    text-formation.js Unicode text → target coordinates for the constellation
    fireworks.js      the restrained, atmospheric firework layer
    scenery.js        sky, stars, haze, rooftop skyline, rangoli
    audio-manager.js  the entire soundscape, synthesised — no audio files
    ui.js             every piece of DOM the experience touches
    utils.js          math and timing helpers
tools/                dev-only: static server, browser test harness, generators
```

## How a few things work

**The sky is one canvas, not hundreds of elements.** Each lamp costs a single
`drawImage` from a pre-baked 12-frame flicker atlas. Slots are allocated once
with stratified depths, so the pool is permanently sorted back-to-front and
never needs a per-frame sort.

**The letters are made of light, not drawn as text.** `text-formation.js`
renders real Unicode into an offscreen canvas, samples it on a grid whose pitch
is a fraction of the font size, and springs particles to those coordinates.
Two details make it legible rather than a smear: each light shrinks to about
the sampling pitch when it joins a letter, and a very faint warm bloom of the
same mask sits behind the swarm — the light the assembled lamps would cast
between themselves.

**The greeting is written in Telugu first, then English,** and the card
measures itself against the viewport and scales down until it fits — no
phone, browser chrome or font fallback should make someone scroll to read a
wish. The Telugu face is the largest of the four and nothing needs it until
the final scene, so it is fetched then rather than at the cold open.

**Nothing is autoplayed and nothing is collected.** No name, no email, no
analytics, no cookies, no backend. Audio is synthesised with Web Audio and only
after the viewer asks for it.

**It degrades rather than breaks.** Frame times are measured; if the device
struggles, resolution drops first and the sky stops growing — lights already on
screen are never taken away. With no canvas at all, or with JavaScript off, the
greeting is still there: it is plain HTML that was in the document from the
start, and it is also exposed to screen readers up front so nobody has to play
through an animation to read what was written for them.

## Dev tools

```bash
npm run check                       # drive the whole experience in Chromium, 390×844
node tools/check.mjs --w=1440 --h=900 --shots
node tools/check.mjs --reduced      # prefers-reduced-motion path
node tools/make-og.mjs              # regenerate og.jpg and apple-touch-icon.png
node tools/fetch-fonts.mjs          # re-download the font subsets
```

`check.mjs` lights all four diyas, walks every state to `SHARE`, and reports
frame-time percentiles, console errors, scroll leaks and the sky's particle
budget. `--shots` writes screenshots of each beat to `tools/out/`.

### Changing the greeting text

`tools/fetch-fonts.mjs` subsets the Devanagari and Telugu faces down to the
exact text they render. If you change the Devanagari constellation line in
`js/scene-manager.js`, or any of the Telugu in `index.html` (the heading, the
wish, or the sign-off), update the matching constant in the fetch script and
re-run it — otherwise the new characters will have no glyphs.

## Deploying

`vercel.json` serves `public/` as static output with no build step, and rewrites
`/diwali` to the same page.

```bash
vercel deploy --prod
```

## Licences

Cormorant Garamond, Inter, Noto Serif Devanagari and Noto Sans Telugu are used
under the SIL Open Font License 1.1. Every other asset — the diyas, the flame,
the rangoli, the skyline, the fireworks and the entire soundtrack — is generated
in code by this repository.
