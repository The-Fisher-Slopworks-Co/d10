/**
 * Builds the static site into ./dist for GitHub Pages.
 *
 * Note: we deliberately do NOT set `publicPath`, so Bun emits *relative*
 * asset URLs (e.g. `./chunk-abc.js`). That is required for GitHub Pages
 * project sites, which are served from `https://<user>.github.io/<repo>/`.
 */
import { rm } from "node:fs/promises";
import path from "node:path";

const outdir = path.join(process.cwd(), "dist");
await rm(outdir, { recursive: true, force: true });

const result = await Bun.build({
  entrypoints: ["src/index.html"],
  outdir,
  minify: true,
  target: "browser",
  // No sourcemap in production — keeps the deployed artifact lean and avoids
  // shipping the original TypeScript as a public .map file.
  sourcemap: "none",
});

if (!result.success) {
  console.error("❌ Build failed");
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

// GitHub Pages serves the custom domain only if a `CNAME` file sits at the
// root of the published site. `dist/` is gitignored and rebuilt from scratch
// every time, so we can't commit one — we emit it here so it always ends up in
// the Pages artifact (the deploy workflow uploads `dist/` wholesale).
const CUSTOM_DOMAIN = "d10.slopworks.org";
await Bun.write(path.join(outdir, "CNAME"), `${CUSTOM_DOMAIN}\n`);

console.log("✅ Built to dist/");
for (const output of result.outputs) {
  console.log(`   ${path.relative(process.cwd(), output.path)}  ${(output.size / 1024).toFixed(1)} KB`);
}
