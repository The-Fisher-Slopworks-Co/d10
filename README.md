# 🎲 d10

**Roll a single ten-sided die — beautifully.**

A tiny, fast, dependency-free web toy: one d10 you can **grab and throw**. The
die is an actual pentagonal trapezohedron simulated as a real rigid body on a
canvas — fling it across the floor and it tumbles, bounces, and settles on
whatever number lands face-up. Nothing is decided up front; the result is
emergent and provably fair. Built with Bun and vanilla TypeScript (no 3D or
physics library — the renderer *and* the physics are hand-written), bundled to
static files, and deployed to GitHub Pages.

<p align="center">
  <img src="./assets/screenshot.png" alt="A faceted purple ten-sided die tumbling across a glowing grid floor mid-throw, numbered faces catching the light" width="640" />
</p>

> **Live:** `https://the-fisher-slopworks-co.github.io/d10/`
> _(goes live once Pages is enabled — see [Deployment](#deployment))_

## Features

- **Grab it and throw it.** Drag the die and let go to fling it across the floor —
  release velocity becomes the throw, the flick becomes the spin. Or press **Roll**
  (or <kbd>Space</kbd>/<kbd>Enter</kbd>) for a fair machine throw.
- **Real physics, not a fake.** The die is an actual pentagonal trapezohedron
  simulated as a rigid body — its true inertia tensor, gravity, impulse-based
  collisions against the floor and walls, friction, and a clean settle. The number
  is **whatever face lands up**; nothing is chosen up front.
- **Provably fair.** Because the throw starts from a uniform-random orientation and
  tumbles hard on an isohedral solid, every digit **1–10** is equally likely — and a
  seeded chi-square test over thousands of simulated throws keeps it that way.
- **Accessible.** Respects `prefers-reduced-motion` with a calm fallback (a fair pick
  snapped flat, no tumble), is fully keyboard-operable, and announces each result to
  screen readers.
- **Featherweight.** No framework, no runtime dependencies, no network calls. Works
  offline and loads instantly.

## Tech stack

- [**Bun**](https://bun.com) — runtime, bundler, dev server, and test runner (no Webpack/Vite).
- **Vanilla TypeScript** + a hand-written **canvas** 3D renderer **and** a
  hand-written rigid-body physics engine (no three.js, no cannon/rapier) +
  hand-written **CSS**. That's it.

## Local development

Prerequisite: [install Bun](https://bun.com/docs/installation).

```bash
bun install        # install dev deps (@types/bun)
bun run dev        # dev server with hot reload → http://localhost:3000
```

Other scripts:

```bash
bun test           # headless tests: geometry, inertia, settling + fairness (~15s)
bun run build      # bundle to ./dist (what gets published)
bun run preview    # build + serve dist under a /d10/ sub-path, like GitHub Pages
                   # → http://localhost:4173/d10/
```

`preview` mimics GitHub Pages **project** hosting (a sub-path), which is the best
local check that the build's relative asset URLs resolve correctly.

## Deployment

This repo ships a GitHub Actions workflow (`.github/workflows/deploy.yml`) that
builds the site and publishes it with the official GitHub Pages actions. It runs
on every push to `main`.

**One-time setup** (required before the first deploy works):

1. Push this repository to GitHub.
2. In the repo, go to **Settings → Pages**.
3. Under **Build and deployment → Source**, choose **GitHub Actions**.

After that, every push to `main` deploys automatically. The site is served from
`https://<your-username>.github.io/<repo>/` — the build uses **relative** asset
paths so it works under that sub-path without extra configuration.

> Forking under a different repo name works too: the relative paths mean you don't
> need to hardcode the repo name anywhere.
