/**
 * scripts/semantic/state.mjs
 *
 * Heuristic v1 semantic linting for stateDiagram / stateDiagram-v2.
 * Regex/text-analysis, not a real AST-based linter. All messages are
 * severity "warning".
 *
 * JUDGMENT CALL (flagged per the contract's instructions -- see the
 * final report): a literal reading of "flag a state used in a transition
 * that is never defined as its own state" would require an explicit
 * `state X` (or `state "Label" as X`, or an `X : description` line) for
 * EVERY state. But idiomatic Mermaid stateDiagrams -- including this
 * project's own assets/example_diagrams/state.mmd -- almost never
 * declare states explicitly; states are introduced purely by appearing
 * in transitions, which is completely normal Mermaid style, not a code
 * smell. Flagging every such state would make this rule fire on nearly
 * every valid diagram and would be useless noise.
 *
 * Instead this module flags a state name used as a transition endpoint
 * only when BOTH:
 *   1. It is never explicitly declared (`state X`, `state "Label" as X`,
 *      or an `X : description` line), and it appears as a transition
 *      endpoint EXACTLY ONCE in the whole file -- i.e. it was never
 *      really "defined" anywhere else, just typed once -- excluding the
 *      special `[*]` marker.
 *   2. A different, differently-cased spelling of the same name IS used
 *      elsewhere in the file (e.g. "Sucess" vs "Success"), which is a
 *      strong, low-noise signal of a genuine typo rather than a real,
 *      legitimately-single-use terminal state.
 * This mirrors flowchart.mjs's case-mismatch heuristic and avoids
 * flagging ordinary single-use terminal states that don't happen to
 * collide (case-insensitively) with another name.
 */

const DECLARE_RE = /^\s*state\s+(?:"[^"]*"\s+as\s+([A-Za-z_]\w*)|([A-Za-z_]\w*))\b/;
const DESCRIPTION_RE = /^\s*([A-Za-z_]\w*)\s*:\s*\S/;
const TRANSITION_RE = /^\s*(\[\*\]|[A-Za-z_]\w*)\s*-->\s*(\[\*\]|[A-Za-z_]\w*)\s*(:.*)?$/;

export function lint(sourceText, diagramType) {
  const lines = sourceText.split(/\r\n|\r|\n/);
  const messages = [];

  const explicitlyDeclared = new Set();
  const transitionOccurrences = new Map(); // name -> [line, ...]

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed.startsWith('%%')) continue;

    const dm = trimmed.match(DECLARE_RE);
    if (dm) {
      explicitlyDeclared.add(dm[1] || dm[2]);
      continue;
    }

    const tm = trimmed.match(TRANSITION_RE);
    if (tm) {
      for (const name of [tm[1], tm[2]]) {
        if (name === '[*]') continue;
        if (!transitionOccurrences.has(name)) transitionOccurrences.set(name, []);
        transitionOccurrences.get(name).push(i + 1);
      }
      continue;
    }

    const descm = trimmed.match(DESCRIPTION_RE);
    if (descm) explicitlyDeclared.add(descm[1]);
  }

  const allNames = new Set([...explicitlyDeclared, ...transitionOccurrences.keys()]);

  for (const [name, occurrences] of transitionOccurrences) {
    if (explicitlyDeclared.has(name)) continue;
    if (occurrences.length !== 1) continue;

    const lower = name.toLowerCase();
    const variant = [...allNames].find((other) => other !== name && other.toLowerCase() === lower);
    if (variant) {
      messages.push({
        line: occurrences[0],
        column: 1,
        severity: 'warning',
        message: `State "${name}" is used only once and is never explicitly declared; it looks like a case-mismatched typo of "${variant}"`,
        ruleId: 'state-possible-typo',
      });
    }
  }

  return messages.sort((a, b) => a.line - b.line);
}
