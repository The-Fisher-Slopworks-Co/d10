// Tests for the production build's HTML minify stage (scripts/minify-html.ts).
//
// Bun minifies the bundled JS & CSS but emits the HTML shell verbatim, so this
// pass exists to shrink it. The properties that matter are that it actually
// shrinks the document while NEVER changing how the page renders — so these
// assert that comments go, whitespace collapses, and everything that is
// semantically significant (the doctype, text, attribute values, raw-text
// element bodies, inter-inline spaces) survives untouched.

import { expect, test } from "bun:test";
import { minifyHtml } from "../scripts/minify-html";

test("drops HTML comments but keeps the <!doctype> declaration", () => {
  const out = minifyHtml(`<!doctype html><!-- secret note --><html></html>`);
  expect(out).toContain("<!doctype html>");
  expect(out).not.toContain("<!--");
  expect(out).not.toContain("secret note");
});

test("collapses whitespace inside a tag and between tags", () => {
  const out = minifyHtml(`<div\n    class="a"\n    id="b"\n  >\n  <span></span>\n</div>`);
  expect(out).toBe(`<div class="a" id="b"> <span></span> </div>`);
  expect(out).not.toContain("\n");
});

test("preserves text content and quoted attribute values verbatim", () => {
  const html = `<p title="keep   me   spaced">Grab the die — or press Roll.</p>`;
  const out = minifyHtml(html);
  // Spaces *inside* an attribute value must not be touched.
  expect(out).toContain(`title="keep   me   spaced"`);
  // Text (including the em dash and its single spaces) is preserved.
  expect(out).toContain("Grab the die — or press Roll.");
});

test("collapses inter-tag whitespace to a single space, never deletes it", () => {
  // A space between two inline elements is significant — it must survive.
  expect(minifyHtml(`<a>x</a>\n  <a>y</a>`)).toBe(`<a>x</a> <a>y</a>`);
});

test("leaves raw-text element bodies (script/style/pre) exactly as-is", () => {
  expect(minifyHtml(`<pre>  two  spaces\n  and a newline</pre>`)).toBe(
    `<pre>  two  spaces\n  and a newline</pre>`,
  );
  // A comment-looking string inside a <script> is content, not a comment.
  const js = `<script>const a = 1; // <!-- not a comment -->\n</script>`;
  expect(minifyHtml(js)).toBe(js);
});

test("a dropped comment between whitespace becomes one space, and is idempotent", () => {
  const html =
    `<!doctype html>\n<html>\n  <head>\n    <!-- c -->\n    <title>t</title>\n` +
    `  </head>\n  <body>\n    <p>hi</p>\n  </body>\n</html>`;
  const once = minifyHtml(html);
  expect(once.length).toBeLessThan(html.length); // it really shrinks
  expect(once).not.toContain("  "); // no doubled spaces survive
  expect(minifyHtml(once)).toBe(once); // running it again changes nothing
});

test("the real page shell shrinks but keeps its meaning", () => {
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
  const out = minifyHtml(html);

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
