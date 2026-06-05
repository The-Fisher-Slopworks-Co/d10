// Tests for the production build's HTML minify stage (scripts/minify-html.ts).
//
// The stage wraps html-minifier-terser with a conservative, render-safe config.
// These tests guard that config: they assert the stage shrinks the document
// while NEVER changing how the page renders — comments go, but the doctype,
// text, attribute values, raw-text element bodies, and the significant space
// between inline elements all survive. (They assert properties rather than an
// exact byte output, so they pin down render-safety without coupling to the
// library's exact formatting.)

import { expect, test } from "bun:test";
import { minifyHtml } from "../scripts/minify-html";

test("drops HTML comments but keeps the <!doctype> declaration", async () => {
  const out = await minifyHtml(`<!doctype html><!-- secret note --><html></html>`);
  expect(out).toMatch(/<!doctype html>/i);
  expect(out).not.toContain("<!--");
  expect(out).not.toContain("secret note");
});

test("collapses whitespace inside a tag and between tags", async () => {
  const out = await minifyHtml(`<div\n    class="a"\n    id="b"\n  >\n  <span></span>\n</div>`);
  // Multi-line start tag flattened; inter-tag whitespace collapsed to one space.
  expect(out).toContain(`<div class="a" id="b">`);
  expect(out).not.toContain("\n");
});

test("preserves text content and quoted attribute values verbatim", async () => {
  const html = `<p title="keep   me   spaced">Grab the die — or press Roll.</p>`;
  const out = await minifyHtml(html);
  // Spaces *inside* an attribute value must not be touched.
  expect(out).toContain(`title="keep   me   spaced"`);
  // Text (including the em dash and its single spaces) is preserved.
  expect(out).toContain("Grab the die — or press Roll.");
});

test("collapses inter-tag whitespace to a single space, never deletes it", async () => {
  // A space between two inline elements is significant — it must survive.
  expect(await minifyHtml(`<a>x</a>\n  <a>y</a>`)).toBe(`<a>x</a> <a>y</a>`);
});

test("leaves raw-text element bodies (script/style/pre) intact", async () => {
  // <pre> whitespace is significant and is preserved exactly.
  expect(await minifyHtml(`<pre>  two  spaces\n  and a newline</pre>`)).toBe(
    `<pre>  two  spaces\n  and a newline</pre>`,
  );
  // A comment-looking string inside a <script> is content, not a comment.
  const out = await minifyHtml(`<script>const a = 1; // <!-- not a comment -->\n</script>`);
  expect(out).toContain("const a = 1; // <!-- not a comment -->");
});

test("the real page shell shrinks but keeps its meaning", async () => {
  // A faithful slice of src/index.html (multi-line tag + a real comment).
  const html = [
    `<!doctype html>`,
    `<html lang="en">`,
    `  <body>`,
    `    <h1 class="title"><b>d</b>10</h1>`,
    `    <!-- the canvas itself is the grabbable die -->`,
    `    <canvas`,
    `      id="dieCanvas"`,
    `      role="button"`,
    `      aria-label="Ten-sided die, showing 10. Press Enter to roll."`,
    `    ></canvas>`,
    `    <button class="roll-btn" id="rollBtn" type="button">Roll</button>`,
    `  </body>`,
    `</html>`,
  ].join("\n");
  const out = await minifyHtml(html);

  expect(out.length).toBeLessThan(html.length);
  expect(out).not.toContain("<!--");
  expect(out).not.toContain("\n");
  // Multi-line start tag flattened to single spaces between attributes.
  expect(out).toContain(`<canvas id="dieCanvas" role="button"`);
  // Significant content kept exactly.
  expect(out).toContain(`<h1 class="title"><b>d</b>10</h1>`);
  expect(out).toContain(`aria-label="Ten-sided die, showing 10. Press Enter to roll."`);
  expect(out).toContain(`>Roll</button>`);
});
