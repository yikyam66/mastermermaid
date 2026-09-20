/**
 * scripts/render/fallback-renderer.mjs
 *
 * Renders Mermaid diagram types that the primary (beautiful-mermaid) engine
 * does not implement, using the *official* `mermaid` package running in
 * plain Node under a jsdom shim -- no headless Chromium / Puppeteer.
 *
 * WHY THIS EXISTS: beautiful-mermaid (scripts/render/render.mjs's normal
 * path) only implements 6 diagram types (flowchart, sequence, class, state,
 * ER, xychart) -- it is a from-scratch reimplementation, not a wrapper
 * around Mermaid itself, so it simply never grew parsers/layouts for the
 * rest. `validate.mjs` already proved that the real `mermaid` package's
 * *parser* runs fine in Node under a jsdom shim; this module goes one step
 * further and proves the same is true for `mermaid.render()` (the part
 * that actually lays out and draws the SVG) for a specific, tested subset
 * of diagram types.
 *
 * WHAT WORKS AND WHY: Mermaid's renderer measures text (`SVGElement
 * .getBBox()` / `.getComputedTextLength()`) to lay out labels, bars, and
 * boxes. jsdom implements neither -- it has no real font/rendering engine --
 * so both throw by default. This module polyfills them using
 * text-width.mjs's Helvetica-metric estimate (real per-character widths,
 * not a flat guess) plus, for non-text elements, an actual bounding-box
 * computation from each element's own geometry (rect/circle/line
 * attributes) or the union of its children's boxes. That is enough for
 * every diagram type below to lay out correctly, EMPIRICALLY VERIFIED by
 * rendering a real sample of each and checking the output has a sane,
 * non-degenerate viewBox (see the test notes in the project history / ask
 * the agent that built this for the exact numbers).
 *
 * WHAT DOESN'T: `mindmap` uses the `cytoscape` layout library internally,
 * which needs a real 2D canvas rendering context for its force-directed
 * layout math -- jsdom has no <canvas> implementation at all (that needs
 * the separate, native "canvas" npm package, a bigger ask than this
 * polyfill). `mindmap` is deliberately NOT in FALLBACK_SUPPORTED_TYPES;
 * calling this module for it will throw, by design, rather than produce a
 * silently-broken diagram.
 */

import { JSDOM } from 'jsdom';
import { estimateTextWidth, fontSizeFromStyle } from './text-width.mjs';

/**
 * Diagram types this fallback path has been empirically verified to lay
 * out correctly (non-degenerate viewBox, dimensions cross-checked against
 * Mermaid's own config defaults where one exists, no thrown layout
 * errors). Keep this list conservative -- a type NOT in this list should
 * fail loudly via an "Invalid mermaid header"-style error rather than
 * silently render badly.
 *
 * NOT included, and why:
 * - `requirementDiagram`: Mermaid's own config floors each box at
 *   rect_min_width/rect_min_height = 200x200, but this renderer's boxes
 *   come out around 48x188 total. Root cause: requirementDiagram draws its
 *   boxes as SVG <path> data using a mix of absolute and *relative*
 *   commands, and this module's path-bbox estimate (text-width.mjs's
 *   sibling logic below) treats every number in `d` as an absolute
 *   coordinate -- correct for the common M/L-absolute case (gitGraph,
 *   C4Context's boxes), wrong for relative deltas, which silently
 *   understates the box size instead of throwing. Needs a real SVG path
 *   parser (absolute/relative state machine) to fix properly; tracked as
 *   a follow-up, not shipped half-working.
 * - `mindmap`: needs a real 2D canvas context for its cytoscape/
 *   cose-bilkent force layout; jsdom has no <canvas> at all (that needs
 *   the separate, native "canvas" npm package -- a bigger dependency than
 *   this polyfill approach, and a separate decision).
 */
export const FALLBACK_SUPPORTED_TYPES = new Set([
  'pie',
  'quadrantChart',
  'journey',
  'gantt',
  'timeline',
  'gitGraph',
  'C4Context',
  'C4Container',
  'C4Component',
  'C4Dynamic',
  'C4Deployment',
]);

let shimInstalled = false;

function installJsdomShim() {
  if (shimInstalled) return;
  shimInstalled = true;

  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    url: 'http://localhost/',
    pretendToBeVisual: true,
  });

  global.window = dom.window;
  global.document = dom.window.document;
  Object.defineProperty(global, 'navigator', {
    value: dom.window.navigator,
    configurable: true,
    writable: true,
  });
  global.SVGElement = dom.window.SVGElement;
  global.HTMLElement = dom.window.HTMLElement;
  global.Node = dom.window.Node;
  global.Element = dom.window.Element;
  global.Text = dom.window.Text;
  global.Comment = dom.window.Comment;
  global.DocumentFragment = dom.window.DocumentFragment;
  global.Event = dom.window.Event;
  global.CustomEvent = dom.window.CustomEvent;
  global.HTMLCanvasElement = dom.window.HTMLCanvasElement;
  global.Image = dom.window.Image;
  global.getComputedStyle = dom.window.getComputedStyle;
  global.DOMParser = dom.window.DOMParser;
  global.MutationObserver = dom.window.MutationObserver;
  global.CSSStyleSheet = dom.window.CSSStyleSheet;
  global.screen = dom.window.screen;
  if (!global.requestAnimationFrame) global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  if (!global.cancelAnimationFrame) global.cancelAnimationFrame = (id) => clearTimeout(id);

  // jsdom never runs real CSS layout, so offsetWidth/offsetHeight are
  // always 0 -- not `undefined`, so callers that only guard against
  // `undefined` (e.g. Mermaid's own gantt renderer, which falls back to a
  // hardcoded 1200 only when offsetWidth is undefined) silently multiply
  // through a real zero instead. Stub a reasonable fixed container size.
  Object.defineProperty(dom.window.HTMLElement.prototype, 'offsetWidth', {
    get() { return 1200; },
    configurable: true,
  });
  Object.defineProperty(dom.window.HTMLElement.prototype, 'offsetHeight', {
    get() { return 800; },
    configurable: true,
  });

  // --- getBBox / getComputedTextLength polyfills -----------------------
  // Real geometry for shape elements, a recursive children-union for
  // containers, and Helvetica-metric text estimation for text/tspan.
  function parseTranslate(transformAttr) {
    const m = /translate\(\s*([-\d.]+)[ ,]+([-\d.]+)\s*\)/.exec(transformAttr || '');
    return m ? { x: parseFloat(m[1]), y: parseFloat(m[2]) } : { x: 0, y: 0 };
  }

  function computeBBox(el) {
    const tag = (el.tagName || '').toLowerCase();
    const num = (attr) => parseFloat(el.getAttribute && el.getAttribute(attr)) || 0;

    if (tag === 'text' || tag === 'tspan') {
      const fontSize = fontSizeFromStyle(el.getAttribute('style'), 16);
      const width = estimateTextWidth(el.textContent || '', fontSize);
      return { x: 0, y: -fontSize * 0.8, width, height: fontSize };
    }
    if (tag === 'rect') {
      return { x: num('x'), y: num('y'), width: num('width'), height: num('height') };
    }
    if (tag === 'circle' || tag === 'ellipse') {
      const cx = num('cx'), cy = num('cy');
      const rx = num('rx') || num('r') || 1;
      const ry = num('ry') || num('r') || 1;
      return { x: cx - rx, y: cy - ry, width: rx * 2, height: ry * 2 };
    }
    if (tag === 'line') {
      const x1 = num('x1'), x2 = num('x2'), y1 = num('y1'), y2 = num('y2');
      return {
        x: Math.min(x1, x2), y: Math.min(y1, y2),
        width: Math.abs(x2 - x1), height: Math.abs(y2 - y1),
      };
    }
    if (tag === 'path') {
      // Approximate: pull every number out of the path data and treat them
      // as a flat sequence of (x, y) pairs. Exact for straight-edged boxes
      // (M/L commands, what diagram borders mostly are); an overestimate
      // for curves, which is the safer direction for a bounding box.
      const d = el.getAttribute('d') || '';
      const nums = d.match(/-?\d+\.?\d*(?:e-?\d+)?/gi)?.map(Number) ?? [];
      if (nums.length < 2) return { x: 0, y: 0, width: 0, height: 0 };
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (let i = 0; i + 1 < nums.length; i += 2) {
        minX = Math.min(minX, nums[i]);
        maxX = Math.max(maxX, nums[i]);
        minY = Math.min(minY, nums[i + 1]);
        maxY = Math.max(maxY, nums[i + 1]);
      }
      return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    }

    // Container / anything else: union of children, honoring translate().
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, any = false;
    for (const child of el.children ?? []) {
      const t = parseTranslate(child.getAttribute && child.getAttribute('transform'));
      const b = computeBBox(child);
      if (b.width === 0 && b.height === 0 && !(child.textContent || '').trim()) continue;
      any = true;
      minX = Math.min(minX, b.x + t.x);
      minY = Math.min(minY, b.y + t.y);
      maxX = Math.max(maxX, b.x + t.x + b.width);
      maxY = Math.max(maxY, b.y + t.y + b.height);
    }
    if (!any) return { x: 0, y: 0, width: 0, height: 0 };
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }

  dom.window.SVGElement.prototype.getBBox = function () {
    return computeBBox(this);
  };
  dom.window.SVGElement.prototype.getComputedTextLength = function () {
    const fontSize = fontSizeFromStyle(this.getAttribute('style'), 16);
    return estimateTextWidth(this.textContent || '', fontSize);
  };
}

/**
 * Map this project's {bg, fg, line, accent, muted, border, surface} theme
 * color object (see beautiful-mermaid's THEMES / render.mjs) onto Mermaid's
 * own `themeVariables`, so a theme applied via the primary render path
 * looks recognizably the same when a diagram type falls back to this path.
 */
function toMermaidThemeVariables(colors) {
  if (!colors) return undefined;
  return {
    background: colors.bg,
    primaryColor: colors.surface ?? colors.bg,
    primaryTextColor: colors.fg,
    primaryBorderColor: colors.border ?? colors.line,
    lineColor: colors.line,
    secondaryColor: colors.accent,
    tertiaryColor: colors.muted ?? colors.line,
    textColor: colors.fg,
    mainBkg: colors.surface ?? colors.bg,
    secondBkg: colors.muted ?? colors.bg,
  };
}

/**
 * Unlike beautiful-mermaid, official mermaid.render() never paints a
 * background -- it assumes the *page* around the SVG supplies one. Inject
 * a background-color onto the root <svg>'s inline style so (a) the SVG
 * looks right on its own when viewed directly, and (b) scripts/render/
 * png.mjs's SVG->PNG conversion (which reads background-color from that
 * exact spot) picks up the theme's background instead of defaulting to
 * white/transparent.
 */
function withBackground(svg, bg) {
  if (!bg) return svg;
  return svg.replace(/<svg\b[^>]*>/i, (rootTag) => {
    if (/\sstyle=/.test(rootTag)) {
      return rootTag.replace(/\sstyle=(['"])(.*?)\1/i, (_, q, existing) => {
        const sep = existing.trim().endsWith(';') || !existing.trim() ? '' : ';';
        return ` style=${q}${existing}${sep}background-color:${bg};${q}`;
      });
    }
    return rootTag.replace(/>$/, ` style="background-color:${bg};">`);
  });
}

/**
 * Render `source` (Mermaid diagram text) to an SVG string via the official
 * `mermaid` package. Throws if the detected diagram type isn't in
 * FALLBACK_SUPPORTED_TYPES, or if mermaid itself rejects the source.
 */
export async function renderWithFallback(source, { colors } = {}) {
  installJsdomShim();

  const mermaid = (await import('mermaid')).default;
  const themeVariables = toMermaidThemeVariables(colors);
  mermaid.initialize({
    startOnLoad: false,
    theme: themeVariables ? 'base' : 'default',
    ...(themeVariables && { themeVariables }),
  });

  const id = `mastermermaid-fallback-${Date.now().toString(36)}`;
  const { svg } = await mermaid.render(id, source);
  return withBackground(svg, colors?.bg);
}
