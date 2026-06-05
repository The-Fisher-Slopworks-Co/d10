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
  `<canvas>` the floor + die are drawn on (the canvas is itself the grabbable,
  keyboard-operable die).
- `src/die3d.ts` — **pure, DOM-free** geometry + 3D math: the pentagonal
  trapezohedron's vertices/faces, vector/quaternion/3×3-matrix helpers, the
  per-face digit map, the **real inertia tensor** (exact tetrahedron
  decomposition — a symmetric top), and the top-face read/`settleQuat` helpers.
  Imported by `physics.ts`, `main.ts`, and the test.
- `src/physics.ts` — **pure, DOM-free** rigid-body simulator: a `Body` (position,
  orientation, linear + angular velocity) stepped under gravity with
  impulse-based collisions (floor + invisible walls), Coulomb friction, and a
  sleep/settle snap. Also the throw makers (`autoThrow`, `releasedBody`) and the
  headless `simulateToRest`. No result is decided up front — the number is
  whatever the die settles on.
- `src/rng.ts` — **pure, DOM-free** seedable RNG (`mulberry32`), a uniform
  `randomQuat` (Shoemake) and `randomDir`. Production passes `Math.random`; the
  test passes a fixed seed so the fairness check is reproducible.
- `src/main.ts` — the canvas renderer, the single camera (used for both
  projection and the drag pick), the animation loop that steps the sim, the
  drag-to-throw interaction, and all DOM wiring.
- `src/style.css` — all styles and `@keyframes` (linked from the HTML).
- `src/favicon.svg` — the d10 favicon.
- `test/roll.test.ts` — headless `bun test` asserting the geometry, the inertia
  tensor (symmetric top), settling (lands flat on one face in bounded time), and
  the **fairness** of the emergent result (seeded chi-square over thousands of
  throws). ~15s because each throw is a full simulation.
- `test/minify-html.test.ts` — headless `bun test` for the HTML minify stage:
  comments go, whitespace collapses, and everything significant (doctype, text,
  attribute values, raw-text bodies, inter-inline spaces) survives.
- `build.ts` — production build. Calls `Bun.build` (which minifies the bundled
  JS + CSS), then runs the HTML minify stage over every emitted `.html`.
- `scripts/serve-dist.ts` — local sub-path preview server.
- `scripts/minify-html.ts` — the build's HTML minify stage. Bun's `minify` leaves
  the HTML shell verbatim; this wraps `html-minifier-terser` (a **build-time-only**
  devDependency — it never ships in the bundle) with a conservative, render-safe
  config that strips comments and collapses insignificant whitespace.
- `.github/workflows/deploy.yml` — GitHub Pages deploy pipeline.

## Conventions & invariants (don't break these)

- **Static & self-contained.** No network calls, no external CDNs or fonts, no
  server runtime. It must work offline and when opened from a sub-path.
- **Relative asset paths.** The build must emit `./`-relative URLs so the site
  works at `https://<user>.github.io/<repo>/`. This is why `build.ts` does **not**
  set `publicPath`. Verify with `bun run preview` after changing the build.
- **Roll correctness = fairness, emergent.** A roll is a real rigid-body throw;
  the result is **whichever face lands up**, not chosen up front. Fairness (a
  uniform integer **1–10**) comes from the throw: a uniform-random initial
  orientation (`randomQuat`) plus a vigorous tumble, on an isohedral solid. The
  number is read off the **top** face once the die sleeps. `bun test` guards this
  with a seeded chi-square — keep the test deterministic (inject the RNG; never
  call `Math.random` inside the sim or the throw generator).
- **Accessibility.** Honor `prefers-reduced-motion` with a calm fallback (pick a
  fair result and snap the die flat, no tumble); keep the roll control
  keyboard-operable; announce results via `aria-live`.
- **Stay dependency-light.** Don't reintroduce React, Tailwind, a UI kit, a 3D
  engine (three.js), a physics library (cannon/rapier/etc.), or any runtime
  dependency. Both the renderer **and** the physics are hand-written; keep them
  that way.

## Bun notes

- Default to Bun over Node: `bun <file>`, `bun test`, `bun install`, `bunx`.
- Bun loads `.env` automatically; don't add `dotenv`.
- `bun ./src/index.html` runs a full dev server with bundling + HMR — no Vite.
- Prefer `Bun.file` / `Bun.serve` over `node:fs` / `express` if server code is ever needed.
- Bun API docs are vendored under `node_modules/bun-types/docs/**.mdx`.
