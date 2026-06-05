/**
 * Minifies the production build's HTML documents.
 *
 * Bun's `minify` only minifies the JS & CSS it bundles — it emits each HTML
 * document verbatim (comments and indentation intact). This stage closes that
 * gap so the whole `dist/` artifact is minified.
 *
 * It wraps `html-minifier-terser` with a conservative, render-safe config:
 *   • HTML comments are dropped (the `<!doctype>` is preserved).
 *   • Whitespace collapses, but `conservativeCollapse` reduces a run to a single
 *     space rather than deleting it — so a significant space between inline
 *     elements always survives.
 *   • Raw-text bodies (`script`/`style`/`pre`/`textarea`) and quoted attribute
 *     values are left untouched.
 * JS/CSS minification is left off: Bun already minified the bundled assets, and
 * the only inline scripts here are module `src` references with empty bodies.
 */
import { minify, type Options } from "html-minifier-terser";

const OPTIONS: Options = {
  collapseWhitespace: true,
  conservativeCollapse: true,
  removeComments: true,
  minifyJS: false,
  minifyCSS: false,
};

export function minifyHtml(html: string): Promise<string> {
  return minify(html, OPTIONS);
}
