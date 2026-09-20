/**
 * scripts/semantic/class.mjs
 *
 * Heuristic v1 semantic linting for classDiagram. Regex/text-analysis,
 * not a real AST-based linter -- see the contract's v1 scope. All
 * messages are severity "warning".
 *
 * KNOWN LIMITATIONS (intentional, v1):
 * - Only recognizes a relationship when the source and target identifiers
 *   and one of Mermaid's standard relationship tokens (<|--, --|>, ..|>,
 *   <.., ..>, -->, <--, *--, --*, o--, --o, --, ..) all sit on the SAME
 *   line, with only an optional quoted cardinality string in between.
 *   Relationships split across lines are silently skipped.
 * - "Declared" matches the contract precisely: a `class X` statement
 *   anywhere in the file, whether or not it opens a `{ ... }` block.
 *   Classes introduced only through composition inside another class's
 *   member block, or only via `<<interface>> X`, are not counted as
 *   declared by this v1 heuristic.
 */

const RELATION_TOKEN =
  '(?:<\\|--|--\\|>|\\.\\.\\|>|\\.\\.>|<\\.\\.|-->|<--|\\*--|--\\*|o--|--o|--|\\.\\.)';

const RELATION_RE = new RegExp(
  `^\\s*([A-Za-z_]\\w*)\\b(?:\\s*"[^"]*")?\\s*${RELATION_TOKEN}\\s*(?:"[^"]*")?\\s*([A-Za-z_]\\w*)\\b`
);

const DECLARE_RE = /^\s*class\s+([A-Za-z_]\w*)/;

export function lint(sourceText, diagramType) {
  const lines = sourceText.split(/\r\n|\r|\n/);
  const messages = [];

  const declared = new Set();
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('%%')) continue;
    const dm = trimmed.match(DECLARE_RE);
    if (dm) declared.add(dm[1]);
  }

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed.startsWith('%%')) continue;
    if (DECLARE_RE.test(trimmed)) continue; // a declaration line, not a relationship

    const rm = trimmed.match(RELATION_RE);
    if (!rm) continue;

    const [, left, right] = rm;
    if (!declared.has(left) && !declared.has(right)) {
      messages.push({
        line: i + 1,
        column: 1,
        severity: 'warning',
        message: `Relationship references "${left}" and "${right}", but neither is ever declared via a "class ${left}" or "class ${right}" statement`,
        ruleId: 'class-undeclared-relationship',
      });
    }
  }

  return messages;
}
