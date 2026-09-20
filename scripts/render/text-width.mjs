/**
 * scripts/render/text-width.mjs
 *
 * Zero-dependency text width estimation, used to polyfill SVGElement.getBBox()
 * and .getComputedTextLength() under jsdom (see fallback-renderer.mjs).
 *
 * jsdom does not implement real font/layout metrics (there is no rendering
 * engine behind it), so calling the browser's actual getBBox()/getComputedTextLength()
 * on a jsdom-backed SVGElement always throws. Mermaid's own layout code for
 * several diagram types (gantt, timeline, requirementDiagram, gitGraph, ...)
 * calls these to size and position labels, so without *some* estimate those
 * diagrams either crash or lay out with degenerate (zero or absurdly large)
 * dimensions.
 *
 * WHERE THESE NUMBERS COME FROM: the ASCII table below is the standard
 * Helvetica AFM character-width metrics (units per 1000 em) published by
 * Adobe as part of the Core 14 PostScript fonts -- the same public-domain
 * numeric data long bundled in tools like pdfkit/pdf-lib/reportlab for the
 * same "measure text without a real font engine" purpose. It is not exact
 * for whatever font a given Mermaid theme actually renders with, but it is
 * a real per-character metric, not a flat "N px per character" guess, and it
 * is close enough to Helvetica/Arial/sans-serif (Mermaid's own default
 * stack) to keep gantt bars, timeline labels, etc. from overlapping or
 * collapsing to zero width.
 *
 * CJK / other "wide" scripts have no meaningful entry in a Latin AFM table,
 * so code points in the common wide-script Unicode blocks are estimated at
 * a full 1000/1000 em (roughly square glyphs), which is the standard
 * approximation used for CJK in typography.
 */

const HELVETICA_WIDTHS = {
  ' ': 278, '!': 278, '"': 355, '#': 556, '$': 556, '%': 889, '&': 667, "'": 191,
  '(': 333, ')': 333, '*': 389, '+': 584, ',': 278, '-': 333, '.': 278, '/': 278,
  '0': 556, '1': 556, '2': 556, '3': 556, '4': 556, '5': 556, '6': 556, '7': 556,
  '8': 556, '9': 556, ':': 278, ';': 278, '<': 584, '=': 584, '>': 584, '?': 556,
  '@': 1015,
  A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 500,
  K: 667, L: 556, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611,
  U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
  '[': 278, '\\': 278, ']': 278, '^': 469, _: 556, '`': 333,
  a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222, j: 222,
  k: 500, l: 222, m: 833, n: 556, o: 556, p: 556, q: 556, r: 333, s: 500, t: 278,
  u: 556, v: 500, w: 722, x: 500, y: 500, z: 500,
  '{': 334, '|': 260, '}': 334, '~': 584,
};

const DEFAULT_LATIN_WIDTH = 556; // fallback for any ASCII/Latin char missing above
const WIDE_SCRIPT_WIDTH = 1000; // CJK / Hangul / fullwidth glyphs are ~1em square

function isWideScript(codePoint) {
  return (
    (codePoint >= 0x1100 && codePoint <= 0x115f) || // Hangul Jamo
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf) || // CJK Radicals .. Yi Syllables
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) || // Hangul Syllables
    (codePoint >= 0xf900 && codePoint <= 0xfaff) || // CJK Compatibility Ideographs
    (codePoint >= 0xff00 && codePoint <= 0xff60) || // Fullwidth Forms
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
    (codePoint >= 0x20000 && codePoint <= 0x3ffff) // CJK Ext B and beyond
  );
}

/** Estimate the rendered width (in px) of `text` at `fontSize` px, sans-serif. */
export function estimateTextWidth(text, fontSize = 16) {
  if (!text) return 0;
  let units = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (isWideScript(cp)) units += WIDE_SCRIPT_WIDTH;
    else units += HELVETICA_WIDTHS[ch] ?? DEFAULT_LATIN_WIDTH;
  }
  return (units / 1000) * fontSize;
}

/** Parse a `font-size: <n>px` declaration out of an inline style string. */
export function fontSizeFromStyle(styleAttr, fallback = 16) {
  const m = /font-size:\s*([\d.]+)px/.exec(styleAttr || '');
  return m ? parseFloat(m[1]) : fallback;
}
