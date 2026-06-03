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
- `bun test` — run the headless correctness tests (`test/roll.test.ts`).
- `bun install` — install dev dependencies (only `@types/bun`).

## Layout

- `src/index.html` — the page shell; the bundler entry point. Holds the
  `<canvas>` the die is drawn on (no inline SVG die anymore).
- `src/die3d.ts` — **pure, DOM-free** geometry + 3D math: the pentagonal
  trapezohedron's vertices/faces, vector/quaternion helpers, the per-face digit
  map, and `restQuat` (the orientation that lands a chosen face square to the
  camera). Imported by both `main.ts` and the test.
- `src/main.ts` — the canvas renderer, the throw animation, and all DOM wiring.
- `src/style.css` — all styles and `@keyframes` (linked from the HTML).
- `src/favicon.svg` — the d10 favicon.
- `test/roll.test.ts` — headless `bun test` asserting the roll invariant
  (settled face == chosen result over many rolls) and the geometry.
- `build.ts` — production build (calls `Bun.build`).
- `scripts/serve-dist.ts` — local sub-path preview server.
- `.github/workflows/deploy.yml` — GitHub Pages deploy pipeline.

## Conventions & invariants (don't break these)

- **Static & self-contained.** No network calls, no external CDNs or fonts, no
  server runtime. It must work offline and when opened from a sub-path.
- **Relative asset paths.** The build must emit `./`-relative URLs so the site
  works at `https://<user>.github.io/<repo>/`. This is why `build.ts` does **not**
  set `publicPath`. Verify with `bun run preview` after changing the build.
- **Roll correctness.** A roll is a uniform integer in **1–10**. The die tumbles
  freely through real 3D faces, but the result is chosen up front and the tumble
  decays onto a precomputed rest orientation, so the value shown when the die
  settles **must equal the actual random result**. `bun test` guards this.
- **Accessibility.** Honor `prefers-reduced-motion` with a calm fallback (snap to
  the result, no tumble); keep the roll control keyboard-operable; announce
  results via `aria-live`.
- **Stay dependency-light.** Don't reintroduce React, Tailwind, a UI kit, a 3D
  engine (three.js), a physics library, or any runtime dependency. The 3D die is
  a hand-written canvas renderer; keep it that way.

## Bun notes

- Default to Bun over Node: `bun <file>`, `bun test`, `bun install`, `bunx`.
- Bun loads `.env` automatically; don't add `dotenv`.
- `bun ./src/index.html` runs a full dev server with bundling + HMR — no Vite.
- Prefer `Bun.file` / `Bun.serve` over `node:fs` / `express` if server code is ever needed.
- Bun API docs are vendored under `node_modules/bun-types/docs/**.mdx`.
