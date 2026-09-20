/**
 * scripts/semantic/sequence.mjs
 *
 * Heuristic v1 semantic linting for sequenceDiagram. Regex/text-analysis,
 * not a real AST-based linter. All messages are severity "warning".
 *
 * KNOWN LIMITATIONS (intentional, v1):
 * - Regex-based tokenizing of the "who talks to whom" prefix of a message
 *   line (everything before the first `:`), not a real parser. Lines
 *   that are control constructs (`Note ...`, `loop`/`alt`/`opt`/`par`/
 *   `rect`/`box` headers, `activate`/`deactivate`, etc.) are excluded on
 *   purpose -- they are not message arrows.
 * - Mermaid auto-creates a participant the first time its name is used,
 *   in diagram order, and that is completely normal, valid Mermaid -- so
 *   this rule never flags a name just for being implicitly declared. It
 *   only flags a name that looks like an accidental typo (differs from
 *   an already-known name by case only, or by a single-character edit)
 *   of a name already declared/used earlier in the file.
 */

const CONTROL_KEYWORD_RE =
  /^(sequenceDiagram|participant|actor|note|loop|alt|opt|par|and|else|end\b|rect|box|activate|deactivate|autonumber|title|link|links|properties|critical|option|break)\b/i;

const ARROW_PRESENCE_RE = /-{1,2}[-x)>]{1,3}>?/;

const DECLARE_RE = /^\s*(?:participant|actor)\s+([A-Za-z0-9_]+)/i;

/** True when `a` and `b` differ by at most one single-character edit
 * (insertion, deletion, or substitution) and are not identical. */
function differsByOneEdit(a, b) {
  if (a === b) return false;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > 1) return false;

  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < la && j < lb) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    edits++;
    if (edits > 1) return false;
    if (la === lb) {
      i++;
      j++;
    } else if (la > lb) {
      i++;
    } else {
      j++;
    }
  }
  edits += la - i + (lb - j);
  return edits <= 1;
}

function isLikelyTypo(a, b) {
  if (a === b) return false;
  if (a.toLowerCase() === b.toLowerCase()) return true;
  return differsByOneEdit(a, b);
}

export function lint(sourceText, diagramType) {
  const lines = sourceText.split(/\r\n|\r|\n/);
  const messages = [];

  // Pass 1: every explicitly declared participant/actor, anywhere.
  const declared = new Set();
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('%%')) continue;
    const dm = trimmed.match(DECLARE_RE);
    if (dm) declared.add(dm[1]);
  }

  // Pass 2: first-seen line for every name (declared or used), and the
  // first line each undeclared name is used in a message arrow.
  const firstSeenLine = new Map();
  const usedNotDeclared = new Map();

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed.startsWith('%%')) continue;

    const dm = trimmed.match(DECLARE_RE);
    if (dm) {
      if (!firstSeenLine.has(dm[1])) firstSeenLine.set(dm[1], i + 1);
      continue;
    }

    if (CONTROL_KEYWORD_RE.test(trimmed)) continue;
    if (!ARROW_PRESENCE_RE.test(trimmed)) continue;
    if (!trimmed.includes(':')) continue;

    const prefix = trimmed.slice(0, trimmed.indexOf(':'));
    const tokens = prefix.match(/[A-Za-z0-9_]+/g) || [];
    for (const name of tokens) {
      if (!firstSeenLine.has(name)) firstSeenLine.set(name, i + 1);
      if (!declared.has(name) && !usedNotDeclared.has(name)) {
        usedNotDeclared.set(name, i + 1);
      }
    }
  }

  const allKnown = [...firstSeenLine.keys()];

  for (const [name, line] of usedNotDeclared) {
    let bestMatch = null;
    for (const other of allKnown) {
      if (other === name) continue;
      const otherFirst = firstSeenLine.get(other);
      if (otherFirst === undefined || otherFirst > line) continue; // must already be known
      if (isLikelyTypo(name, other)) {
        bestMatch = other;
        break;
      }
    }
    if (bestMatch) {
      messages.push({
        line,
        column: 1,
        severity: 'warning',
        message: `Participant "${name}" is never declared with "participant ${name}" / "actor ${name}" and looks like a typo of already-used name "${bestMatch}"`,
        ruleId: 'sequence-possible-participant-typo',
      });
    }
  }

  return messages.sort((a, b) => a.line - b.line);
}
