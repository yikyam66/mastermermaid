/**
 * scripts/diagram-type.mjs
 *
 * Shared diagram-type detection, used by both validate.mjs and
 * render/render.mjs's fallback path so type detection can't drift out of
 * sync between the two.
 */

const DIAGRAM_PATTERNS = [
  { re: /^flowchart\b/, type: 'flowchart' },
  { re: /^graph\b/, type: 'graph' },
  { re: /^sequenceDiagram\b/, type: 'sequenceDiagram' },
  { re: /^classDiagram\b/, type: 'classDiagram' },
  { re: /^stateDiagram-v2\b/, type: 'stateDiagram-v2' },
  { re: /^stateDiagram\b/, type: 'stateDiagram' },
  { re: /^erDiagram\b/, type: 'erDiagram' },
  { re: /^(C4Context|C4Container|C4Component|C4Dynamic|C4Deployment)\b/, type: null },
  { re: /^gantt\b/, type: 'gantt' },
  { re: /^gitGraph\b/, type: 'gitGraph' },
  { re: /^pie\b/, type: 'pie' },
  { re: /^mindmap\b/, type: 'mindmap' },
  { re: /^timeline\b/, type: 'timeline' },
  { re: /^quadrantChart\b/, type: 'quadrantChart' },
  { re: /^requirementDiagram\b/, type: 'requirementDiagram' },
  { re: /^journey\b/, type: 'journey' },
];

/** Detects the diagram type from the file's first meaningful (non-blank,
 * non-comment, post-frontmatter) line. Returns 'unknown' when nothing
 * recognized matches. */
export function detectDiagramType(text) {
  const lines = text.split(/\r\n|\r|\n/);
  let i = 0;

  // Skip a leading YAML frontmatter block ("---\n...\n---").
  if (lines[0] !== undefined && lines[0].trim() === '---') {
    let j = 1;
    while (j < lines.length && lines[j].trim() !== '---') j++;
    i = j + 1;
  }

  for (; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (line.startsWith('%%')) continue; // comment, or a %%{init: ...}%% directive

    for (const pattern of DIAGRAM_PATTERNS) {
      const m = line.match(pattern.re);
      if (m) return pattern.type ?? m[1];
    }
    return 'unknown';
  }
  return 'unknown';
}
