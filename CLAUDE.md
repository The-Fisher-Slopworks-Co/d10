# d10 — project guide for Claude

A tiny, beautiful single-page site that rolls one ten-sided die. It is a
**static site** built with **Bun + vanilla TypeScript + hand-written CSS** and
deployed to **GitHub Pages**. There is no framework, no runtime dependency, and
no server — the whole thing is bundled to static files.

## Commands

Use Bun for everything.

- `bun run dev` — start the dev server with hot reload (Bun serves `src/index.html`).
- `bun run build` — bundle to `dist/` (this is what GitHub Pages publishes).
- `bun run preview` — build, then serve `dist/` under a `/d10/` sub-path to mimic
  GitHub Pages project hosting (http://localhost:4173/d10/). Use this to catch
  base-path / relative-URL regressions before deploying.
- `bun install` — install dev dependencies (only `@types/bun`).

## Layout

- `src/index.html` — the page shell; the bundler entry point.
- `src/main.ts` — roll logic and the animation wiring (all behavior lives here).
- `src/style.css` — all styles and `@keyframes` (linked from the HTML).
- `src/favicon.svg` — the d10 favicon.
- `build.ts` — production build (calls `Bun.build`).
- `scripts/serve-dist.ts` — local sub-path preview server.
- `.github/workflows/deploy.yml` — GitHub Pages deploy pipeline.

## Conventions & invariants (don't break these)

- **Static & self-contained.** No network calls, no external CDNs or fonts, no
  server runtime. It must work offline and when opened from a sub-path.
- **Relative asset paths.** The build must emit `./`-relative URLs so the site
  works at `https://<user>.github.io/<repo>/`. This is why `build.ts` does **not**
  set `publicPath`. Verify with `bun run preview` after changing the build.
- **Roll correctness.** A roll is a uniform integer in **1–10**. Digits may
  flicker during the tumble for effect, but the value shown when the die settles
  **must equal the actual random result**.
- **Accessibility.** Honor `prefers-reduced-motion` with a calm fallback; keep
  the roll control keyboard-operable; announce results via `aria-live`.
- **Stay dependency-light.** Don't reintroduce React, Tailwind, a UI kit, or any
  runtime dependency. A bespoke animation needs custom CSS keyframes anyway.

## Bun notes

- Default to Bun over Node: `bun <file>`, `bun test`, `bun install`, `bunx`.
- Bun loads `.env` automatically; don't add `dotenv`.
- `bun ./src/index.html` runs a full dev server with bundling + HMR — no Vite.
- Prefer `Bun.file` / `Bun.serve` over `node:fs` / `express` if server code is ever needed.
- Bun API docs are vendored under `node_modules/bun-types/docs/**.mdx`.
