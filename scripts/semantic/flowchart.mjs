/**
 * scripts/semantic/flowchart.mjs
 *
 * Heuristic v1 semantic linting for flowchart / graph diagrams. This is
 * regex/text-analysis, not a real AST-based linter -- see the contract's
 * v1 scope. All messages are severity "warning" (heuristic, not a hard
 * grammar error).
 *
 * KNOWN LIMITATIONS (intentional, v1):
 * - Recognizes only the common arrow tokens (-->, ---, -.->, -.-, ==>,
 *   ===, <-->, --o, --x, o--o, x--x, ~~~) and the standard shape
 *   delimiters ([ ( { > [[ (( {{ [/ [\ ). Exotic/newer syntax may be
 *   silently skipped rather than mis-flagged -- that's the safer failure
 *   mode for a heuristic tool.
 * - "Duplicate edge" detection compares the whole trimmed,
 *   whitespace-normalized line as text. It will not notice that two
 *   differently-formatted lines describe the same edge.
 * - Typo detection is narrow on purpose: it only flags a node ID that
 *   (a) never appears with a shape/label anywhere in the file, and
 *   (b) is a case-only variant of another ID that IS known elsewhere
 *   (e.g. "NodeA" vs "nodea"). It will not catch typos differing by more
 *   than casing -- that would need real edit-distance tuning and risks
 *   false positives on legitimately similar but distinct node names.
 */

const ARROW_RE = /(<-->|-\.->|-\.-|==>|===|--o|--x|o--o|x--x|~~~|-->|---)/;

const SHAPE_RE_SOURCE = '\\b([A-Za-z_][\\w-]*)\\s*(?:\\(\\(|\\[\\[|\\{\\{|\\[\\/|\\[\\\\|[\\[({>])';

const SKIP_LINE_RE =
  /^(subgraph\b|end\b|classDef\b|class\s|click\b|style\b|linkStyle\b|direction\b|flowchart\b|graph\b)/;

export function lint(sourceText, diagramType) {
  const lines = sourceText.split(/\r\n|\r|\n/);
  const messages = [];

  // Pass 1: every node ID that ever appears with a shape/label anywhere.
  const hasShapeOrLabel = new Set();
  for (const line of lines) {
    if (/^\s*%%/.test(line)) continue;
    const re = new RegExp(SHAPE_RE_SOURCE, 'g');
    let m;
    while ((m = re.exec(line))) {
      hasShapeOrLabel.add(m[1]);
    }
  }

  // Pass 2: walk edges, tracking bare-only IDs and duplicate edge lines.
  const declaredIdsAll = new Set(hasShapeOrLabel);
  const bareOnlyFirstLine = new Map();
  const seenNormalizedEdge = new Map();

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed.startsWith('%%')) continue;
    if (SKIP_LINE_RE.test(trimmed)) continue;
    if (!ARROW_RE.test(trimmed)) continue;

    const normalized = trimmed.replace(/\s+/g, ' ');
    if (seenNormalizedEdge.has(normalized)) {
      messages.push({
        line: i + 1,
        column: 1,
        severity: 'warning',
        message: `Duplicate edge definition: "${normalized}" (first defined on line ${seenNormalizedEdge.get(normalized)})`,
        ruleId: 'flowchart-duplicate-edge',
      });
    } else {
      seenNormalizedEdge.set(normalized, i + 1);
    }

    const segments = trimmed.split(ARROW_RE);
    for (let s = 0; s < segments.length; s += 2) {
      let seg = segments[s];
      if (!seg) continue;
      seg = seg.replace(/^\s*\|[^|]*\|/, ''); // strip a leading edge label, e.g. |Yes|
      const idm = seg.match(/^\s*([A-Za-z_][\w-]*)/);
      if (!idm) continue;
      const id = idm[1];
      declaredIdsAll.add(id);
      if (!hasShapeOrLabel.has(id) && !bareOnlyFirstLine.has(id)) {
        bareOnlyFirstLine.set(id, i + 1);
      }
    }
  }

  // Group known IDs by lowercase spelling to spot case-mismatch typos.
  const idsByLower = new Map();
  for (const id of declaredIdsAll) {
    const lower = id.toLowerCase();
    if (!idsByLower.has(lower)) idsByLower.set(lower, new Set());
    idsByLower.get(lower).add(id);
  }

  for (const [id, line] of bareOnlyFirstLine) {
    const variants = idsByLower.get(id.toLowerCase());
    if (variants && variants.size > 1) {
      const other = [...variants].find((v) => v !== id);
      messages.push({
        line,
        column: 1,
        severity: 'warning',
        message: `Node ID "${id}" only ever appears bare in an edge (no shape/label anywhere in the file) and looks like a case-mismatched typo of "${other}"`,
        ruleId: 'flowchart-possible-id-typo',
      });
    }
  }

  return messages.sort((a, b) => a.line - b.line);
}
