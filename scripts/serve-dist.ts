/**
 * Serves the built ./dist under a `/d10/` sub-path to mimic how GitHub Pages
 * serves a *project* site (https://<user>.github.io/d10/). This is the best
 * local check that the build's relative asset paths actually resolve under a
 * sub-path. Run with `bun run preview`.
 */
import { serve } from "bun";
import { join, resolve, sep } from "node:path";

const dist = resolve(process.cwd(), "dist");
const BASE = "/d10/";

const server = serve({
  port: 4173,
  async fetch(req) {
    const url = new URL(req.url);

    // Send the bare root to the project sub-path, like GitHub Pages.
    if (url.pathname === "/") return Response.redirect(BASE, 302);

    // Strip the project sub-path prefix and reduce to a relative path.
    let rel = url.pathname;
    if (rel.startsWith(BASE)) rel = rel.slice(BASE.length);
    rel = decodeURIComponent(rel).replace(/^\/+/, "");
    if (rel === "" || rel.endsWith("/")) rel += "index.html";

    // Resolve, then enforce that the result stays inside dist — the only
    // safe way to prevent path traversal (../, absolute paths, etc.).
    const filePath = resolve(dist, rel);
    const contained = filePath === dist || filePath.startsWith(dist + sep);

    if (contained) {
      const file = Bun.file(filePath);
      if (await file.exists()) return new Response(file);
    }

    // SPA-style fallback so deep links still render the page.
    const fallback = Bun.file(join(dist, "index.html"));
    if (await fallback.exists()) return new Response(fallback);

    return new Response("Not found", { status: 404 });
  },
});

console.log(`🎲 Preview (GitHub Pages-style) → ${server.url}d10/`);
