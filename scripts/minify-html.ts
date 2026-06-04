/**
 * A tiny, dependency-free HTML minifier used by the production build.
 *
 * Bun's `minify` only minifies the JS and CSS it bundles — it emits the HTML
 * document itself verbatim (comments and indentation intact). This stage closes
 * that gap so the whole `dist/` artifact is minified, without taking on a
 * third-party minifier (d10 is deliberately dependency-light — see CLAUDE.md).
 *
 * It is conservative: it only removes whitespace that cannot change how the
 * page renders.
 *   • HTML comments are dropped — but never the `<!doctype>` declaration.
 *   • Whitespace *inside* a start tag (between attributes) collapses to a single
 *     space; quoted attribute values are copied verbatim.
 *   • A whitespace-only run *between* tags collapses to a single space rather
 *     than being deleted: such a run renders as one space between inline
 *     elements, so collapsing (not deleting) is guaranteed render-safe.
 *   • The contents of raw-text elements (script/style/pre/textarea) are left
 *     exactly as they are.
 * The pass is idempotent: minifying already-minified HTML is a no-op.
 */
export function minifyHtml(html: string): string {
  // Elements whose text content is significant and must be copied verbatim.
  const RAW = /^(?:script|style|pre|textarea)$/i;
  const isSpace = (ch: string | undefined) => ch !== undefined && /\s/.test(ch);

  const n = html.length;
  let out = "";
  let i = 0;
  // Whether a single inter-content space is owed before the next real output.
  // Tracking it (rather than emitting spaces eagerly) collapses the whitespace
  // on *both* sides of a dropped comment into one space, and keeps the pass
  // idempotent.
  let space = false;

  while (i < n) {
    // --- Text node: everything up to the next '<'. ---
    if (html[i] !== "<") {
      let j = i;
      while (j < n && html[j] !== "<") j++;
      const collapsed = html.slice(i, j).replace(/\s+/g, " ");
      i = j;
      if (collapsed.trim() === "") {
        if (out) space = true; // whitespace-only run -> owe a single space
      } else {
        if ((space || collapsed.startsWith(" ")) && out) out += " ";
        out += collapsed.trim();
        space = collapsed.endsWith(" ");
      }
      continue;
    }

    // --- Comment: drop it entirely (never matches the <!doctype>). ---
    // Left before the pending-space flush so a comment between two whitespace
    // runs doesn't turn into a doubled space.
    if (html.startsWith("<!--", i)) {
      const end = html.indexOf("-->", i + 4);
      i = end === -1 ? n : end + 3;
      continue;
    }

    // --- A tag: copy it, collapsing inter-attribute whitespace. ---
    if (space && out) out += " ";
    space = false;
    let tag = "<";
    i++;
    let name = "";
    let inName = true;
    let quote = "";
    while (i < n) {
      const ch = html[i]!;
      if (quote) {
        tag += ch;
        if (ch === quote) quote = "";
        i++;
      } else if (ch === '"' || ch === "'") {
        quote = ch;
        tag += ch;
        i++;
      } else if (isSpace(ch)) {
        inName = false;
        let k = i;
        while (k < n && isSpace(html[k])) k++;
        // Drop whitespace that only pads the closing '>' or '/>'.
        if (html[k] === ">" || (html[k] === "/" && html[k + 1] === ">")) {
          i = k;
        } else {
          tag += " ";
          i = k;
        }
      } else {
        if (inName && /[A-Za-z0-9-]/.test(ch)) name += ch;
        else inName = false;
        tag += ch;
        i++;
        if (ch === ">") break;
      }
    }
    out += tag;

    // --- Raw-text element: copy its body + closing tag verbatim. ---
    if (RAW.test(name) && !tag.endsWith("/>")) {
      const close = new RegExp(`</${name}\\s*>`, "i");
      const m = close.exec(html.slice(i));
      const stop = m ? i + m.index + m[0].length : n;
      out += html.slice(i, stop);
      i = stop;
    }
  }

  return out.trim();
}
