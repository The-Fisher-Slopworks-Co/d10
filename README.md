# 🎲 d10

**Roll a single ten-sided die — beautifully.**

A tiny, fast, dependency-free web toy: one d10, one button, and a satisfying
roll animation. Built with Bun and vanilla TypeScript, bundled to static files,
and deployed to GitHub Pages.

<p align="center">
  <img src="./assets/screenshot.png" alt="A faceted purple ten-sided die showing 10, with a Roll button" width="640" />
</p>

> **Live:** `https://the-fisher-slopworks-co.github.io/d10/`
> _(goes live once Pages is enabled — see [Deployment](#deployment))_

## Features

- **One d10, done well.** Click (or press <kbd>Space</kbd>/<kbd>Enter</kbd>) to roll a
  uniform result from **1–10**.
- **A roll worth watching.** A tactile tumble-and-settle animation with the number
  landing on the true result — never a mismatch between what spins and what stops.
- **Accessible.** Respects `prefers-reduced-motion` with a calm fallback, is fully
  keyboard-operable, and announces each result to screen readers.
- **Featherweight.** No framework, no runtime dependencies, no network calls. Works
  offline and loads instantly.

## Tech stack

- [**Bun**](https://bun.com) — runtime, bundler, and dev server (no Webpack/Vite).
- **Vanilla TypeScript** + hand-written **CSS** animations. That's it.

## Local development

Prerequisite: [install Bun](https://bun.com/docs/installation).

```bash
bun install        # install dev deps (@types/bun)
bun run dev        # dev server with hot reload → http://localhost:3000
```

Other scripts:

```bash
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
