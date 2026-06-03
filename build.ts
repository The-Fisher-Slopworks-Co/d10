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

console.log("✅ Built to dist/");
for (const output of result.outputs) {
  console.log(`   ${path.relative(process.cwd(), output.path)}  ${(output.size / 1024).toFixed(1)} KB`);
}
