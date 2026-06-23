/**
 * Builds the static site into ./dist for GitHub Pages.
 *
 * Note: we deliberately do NOT set `publicPath`, so Bun emits *relative*
 * asset URLs (e.g. `./chunk-abc.js`). That is required for GitHub Pages
 * project sites, which are served from `https://<user>.github.io/<repo>/`.
 */
import { cp, rm } from "node:fs/promises";
import path from "node:path";
import { minifyHtml } from "./scripts/minify-html";

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

// Minify stage. Bun minifies the bundled JS & CSS, but emits each HTML document
// verbatim (comments + indentation intact). Minify them here so the whole
// artifact is lean — see scripts/minify-html.ts for the render-safe config.
const encoder = new TextEncoder();
const htmlSavings: string[] = [];
for (const output of result.outputs) {
  if (path.extname(output.path) !== ".html") continue;
  const before = await Bun.file(output.path).text();
  const after = await minifyHtml(before);
  await Bun.write(output.path, after);
  const kb = (bytes: number) => (bytes / 1024).toFixed(1);
  htmlSavings.push(
    `   minified ${path.relative(process.cwd(), output.path)}  ` +
      `${kb(encoder.encode(before).length)} KB → ${kb(encoder.encode(after).length)} KB`,
  );
}

// Copy `public/` verbatim into the site root. These are files that must keep
// their exact name and bytes (robots.txt, sitemap.xml, llms.txt) — so they are
// deliberately NOT run through Bun's bundler, which would hash/transform them.
await cp(path.join(process.cwd(), "public"), outdir, { recursive: true });

// GitHub Pages serves the custom domain only if a `CNAME` file sits at the
// root of the published site. `dist/` is gitignored and rebuilt from scratch
// every time, so we can't commit one — we emit it here so it always ends up in
// the Pages artifact (the deploy workflow uploads `dist/` wholesale).
const CUSTOM_DOMAIN = "d10.slopworks.org";
await Bun.write(path.join(outdir, "CNAME"), `${CUSTOM_DOMAIN}\n`);

console.log("✅ Built to dist/");
for (const output of result.outputs) {
  // Read the size from disk so minified HTML reports its post-minify size.
  const bytes = Bun.file(output.path).size;
  console.log(`   ${path.relative(process.cwd(), output.path)}  ${(bytes / 1024).toFixed(1)} KB`);
}
for (const line of htmlSavings) console.log(line);
