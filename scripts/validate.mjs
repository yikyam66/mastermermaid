#!/usr/bin/env node
/**
 * scripts/validate.mjs
 *
 * Usage: node scripts/validate.mjs <path-to-file.mmd> [<path2.mmd> ...] [--json] [--fix]
 *
 * Multiple files may be passed in one invocation (each checked
 * independently; overall exit code is 0 only if every file is valid).
 * Exactly one file keeps the original flat single-object JSON shape;
 * two or more produce a JSON array of that same shape.
 *
 * Real, deterministic Mermaid syntax validation that runs in plain Node.js
 * -- no headless Chromium / puppeteer / mermaid-cli required.
 *
 * HOW THE GRAMMAR CHECK WORKS
 * ----------------------------
 * The official "mermaid" npm package is imported and its `mermaid.parse()`
 * is called directly. Mermaid's bundle expects a handful of browser
 * globals (window, document, navigator, SVGElement, ...) to exist at
 * *import* time, so a minimal "jsdom" shim is installed on `global`
 * BEFORE `import('mermaid')` ever runs. No rendering / layout / canvas
 * work happens -- jsdom only needs to look enough like a browser for
 * mermaid's module-level `typeof document` etc. checks to pass and for
 * its internal diagram-specific jison/langium/chevrotain parsers to run.
 *
 * Empirically confirmed (see final report / commit message for the exact
 * list): this approach works for every diagram type mermaid.parse()
 * itself supports -- flowchart, sequenceDiagram, classDiagram,
 * stateDiagram-v2, erDiagram, gantt, gitGraph, pie, mindmap, timeline,
 * quadrantChart, requirementDiagram, journey, and C4Context all threw a
 * real, catchable parse error on deliberately-broken input and parsed
 * cleanly on valid input. No diagram type required a fallback parser.
 *
 * SEMANTIC MODULES
 * ----------------
 * For diagram types with a module at scripts/semantic/<type>.mjs (v1:
 * flowchart, classDiagram, stateDiagram/-v2, sequenceDiagram) this script
 * also calls that module's `lint(sourceText, diagramType)` and merges its
 * (always severity: "warning") messages in. Diagram types without a
 * module simply skip this step -- that is an intentional v1 scope limit.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execSync } from 'node:child_process';
import { detectDiagramType } from './diagram-type.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

/** A freshly `npx skills add`-installed skill has no node_modules yet (they
 * aren't, and shouldn't be, checked into the repo). Auto-install once on
 * first use rather than making every caller know to run "npm install"
 * first -- mirrors the same pattern scripts/render/*.mjs already use. */
let autoInstallAttempted = false;
async function importWithAutoInstall(specifier, friendlyName) {
  try {
    return await import(specifier);
  } catch (firstError) {
    if (autoInstallAttempted) throw firstError;
    autoInstallAttempted = true;
    try {
      execSync('npm install --no-fund --no-audit', {
        cwd: repoRoot,
        stdio: ['pipe', 'pipe', 'inherit'],
        timeout: 120000,
      });
    } catch (installError) {
      throw new Error(
        `Missing dependency "${friendlyName}" and auto-install failed: ${installError.message}. Run "npm install" in ${repoRoot} manually.`
      );
    }
    try {
      return await import(specifier);
    } catch (secondError) {
      throw new Error(
        `Missing dependency "${friendlyName}" (ran "npm install" in ${repoRoot} but it still won't load: ${secondError.message}).`
      );
    }
  }
}

// ---------------------------------------------------------------------
// CLI arg parsing
// ---------------------------------------------------------------------

function parseArgs(argv) {
  const args = argv.slice(2);
  const filePaths = [];
  let json = false;
  let fix = false;
  for (const arg of args) {
    if (arg === '--json') json = true;
    else if (arg === '--fix') fix = true;
    else if (!arg.startsWith('--')) filePaths.push(arg);
  }
  return { filePaths, json, fix };
}

// ---------------------------------------------------------------------
// Diagram type detection (first meaningful line)
// ---------------------------------------------------------------------

// Diagram type detection lives in ./diagram-type.mjs (shared with the
// renderer's fallback path, so the two can't drift out of sync). Returns
// 'unknown' when nothing recognized matches -- mermaid.parse() is still
// attempted in that case, it just means no severity-"warning" semantic
// module can be dispatched.

// ---------------------------------------------------------------------
// Mermaid + jsdom bootstrap (grammar validation)
// ---------------------------------------------------------------------

let mermaidPromise = null;

async function getMermaid() {
  if (mermaidPromise) return mermaidPromise;

  mermaidPromise = (async () => {
    const { JSDOM } = await importWithAutoInstall('jsdom', 'jsdom');

    // IMPORTANT: mermaid's ESM bundle reads browser globals (window,
    // document, navigator, ...) at *import* time, so all of this must be
    // installed on `global` BEFORE `import('mermaid')` runs below.
    const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
      url: 'http://localhost/',
      pretendToBeVisual: true,
    });

    global.window = dom.window;
    global.document = dom.window.document;
    // `navigator` is a getter-only global as of modern Node -- redefine it.
    Object.defineProperty(global, 'navigator', {
      value: dom.window.navigator,
      configurable: true,
      writable: true,
    });
    global.SVGElement = dom.window.SVGElement;
    global.HTMLElement = dom.window.HTMLElement;
    global.Node = dom.window.Node;
    global.getComputedStyle = dom.window.getComputedStyle;
    global.DOMParser = dom.window.DOMParser;
    global.MutationObserver = dom.window.MutationObserver;
    if (!global.requestAnimationFrame) {
      global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
    }
    if (!global.cancelAnimationFrame) {
      global.cancelAnimationFrame = (id) => clearTimeout(id);
    }

    const mermaidMod = await importWithAutoInstall('mermaid', 'mermaid');
    const mermaid = mermaidMod.default;
    mermaid.initialize({ startOnLoad: false, securityLevel: 'loose' });
    return mermaid;
  })();

  return mermaidPromise;
}

function nonEmptyTrimmedLines(message) {
  return String(message)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

/** Turns whatever shape of Error mermaid's various diagram parsers throw
 * (jison parsers set `.hash`; some chevrotain/langium-based parsers throw
 * a plain Error with only a message, or -- in at least one observed case,
 * mermaid's timeline parser on malformed input -- a raw runtime TypeError
 * with no location info at all) into a single-line human message. */
function messageFromParseError(err) {
  const hash = err && err.hash;
  if (hash && Array.isArray(hash.expected) && hash.expected.length) {
    const got = hash.token ? `, got '${hash.token}'` : '';
    return `Expecting ${hash.expected.join(', ')}${got}`;
  }
  const lines = nonEmptyTrimmedLines((err && err.message) || err);
  const expectingLine = lines.find((l) => /^expecting/i.test(l));
  if (expectingLine) return expectingLine;
  const informative = lines.find((l) => !/^-+\^?$/.test(l) && !/^\.\.\./.test(l));
  return (informative || lines[0] || 'Mermaid could not parse this diagram.').slice(0, 400);
}

function locationFromParseError(err) {
  const hash = err && err.hash;
  if (hash && hash.loc && Number.isFinite(hash.loc.first_line)) {
    return {
      line: hash.loc.first_line,
      column: Number.isFinite(hash.loc.first_column) ? hash.loc.first_column + 1 : 1,
    };
  }
  if (hash && Number.isFinite(hash.line)) {
    return { line: hash.line, column: 1 };
  }
  const msg = String((err && err.message) || err);
  const m = msg.match(/line\s+(\d+)(?:,\s*column\s+(\d+))?/i);
  if (m) return { line: Number(m[1]), column: m[2] ? Number(m[2]) : 1 };
  return { line: 1, column: 1 };
}

async function runGrammarCheck(sourceText) {
  let mermaid;
  try {
    mermaid = await getMermaid();
  } catch (e) {
    return [
      {
        line: 1,
        column: 1,
        severity: 'error',
        message: `Could not run Mermaid grammar validation: ${e.message}`,
        ruleId: 'validator-setup-error',
      },
    ];
  }

  try {
    await mermaid.parse(sourceText);
    return [];
  } catch (err) {
    const { line, column } = locationFromParseError(err);
    return [
      {
        line,
        column,
        severity: 'error',
        message: messageFromParseError(err),
        ruleId: 'syntax-error',
      },
    ];
  }
}

// ---------------------------------------------------------------------
// Semantic module dispatch
// ---------------------------------------------------------------------

const SEMANTIC_MODULE_BY_TYPE = {
  flowchart: 'flowchart.mjs',
  graph: 'flowchart.mjs',
  classDiagram: 'class.mjs',
  stateDiagram: 'state.mjs',
  'stateDiagram-v2': 'state.mjs',
  sequenceDiagram: 'sequence.mjs',
};

async function runSemanticCheck(diagramType, sourceText) {
  const moduleFile = SEMANTIC_MODULE_BY_TYPE[diagramType];
  if (!moduleFile) return [];

  const modulePath = join(__dirname, 'semantic', moduleFile);
  if (!existsSync(modulePath)) return [];

  try {
    const mod = await import(pathToFileURL(modulePath).href);
    if (typeof mod.lint !== 'function') return [];
    const result = mod.lint(sourceText, diagramType);
    return Array.isArray(result) ? result : [];
  } catch (e) {
    return [
      {
        line: 1,
        column: 1,
        severity: 'warning',
        message: `Semantic module "${moduleFile}" threw an error and was skipped: ${e.message}`,
        ruleId: 'semantic-module-error',
      },
    ];
  }
}

// ---------------------------------------------------------------------
// --fix: best-effort, purely mechanical autofixes
// ---------------------------------------------------------------------
//
// Every fix here only ever *appends* missing closing tokens at the very
// end of the file. That is a deliberate, conservative choice: knowing
// THAT a bracket/quote/subgraph is unbalanced is mechanical, but knowing
// WHERE in the middle of the file the missing token belongs is a
// semantic judgment call this script is explicitly told not to make.
// Appending at EOF is the one placement that never requires guessing
// intent, is trivially deterministic, and is also naturally idempotent
// (running --fix again on an already-fixed file is a no-op).

function countOccurrences(haystack, needle) {
  let count = 0;
  let idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    count++;
    idx += needle.length;
  }
  return count;
}

function appendAtEof(text, suffixLines) {
  const needsNewline = text.length > 0 && !text.endsWith('\n');
  return text + (needsNewline ? '\n' : '') + suffixLines.join('\n') + '\n';
}

function fixMissingSubgraphEnd(text, diagramType) {
  if (diagramType !== 'flowchart' && diagramType !== 'graph') return text;
  const lines = text.split(/\r\n|\r|\n/);
  let opens = 0;
  let ends = 0;
  for (const line of lines) {
    const t = line.trim();
    if (/^subgraph\b/.test(t)) opens++;
    else if (/^end\b/.test(t)) ends++;
  }
  const missing = opens - ends;
  if (missing <= 0) return text;
  return appendAtEof(text, Array(missing).fill('end'));
}

function fixUnbalancedBracketPair(text, openCh, closeCh) {
  const opens = countOccurrences(text, openCh);
  const closes = countOccurrences(text, closeCh);
  if (opens <= closes) return text; // never guess which extra closer to remove
  return appendAtEof(text, [closeCh.repeat(opens - closes)]);
}

function fixUnbalancedQuotes(text) {
  const quoteCount = (text.match(/(?<!\\)"/g) || []).length;
  if (quoteCount % 2 === 0) return text;
  return appendAtEof(text, ['"']);
}

function applyFixes(text, diagramType) {
  let fixed = text;
  fixed = fixMissingSubgraphEnd(fixed, diagramType);
  fixed = fixUnbalancedBracketPair(fixed, '(', ')');
  fixed = fixUnbalancedBracketPair(fixed, '[', ']');
  fixed = fixUnbalancedBracketPair(fixed, '{', '}');
  fixed = fixUnbalancedQuotes(fixed);
  return fixed;
}

// ---------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------

function formatHuman(result) {
  if (result.messages.length === 0) {
    return `✓ valid ${result.diagramType} diagram`;
  }
  return result.messages
    .map((m) => `${m.line}:${m.column} [${m.severity}] ${m.message} (${m.ruleId})`)
    .join('\n');
}

function emit(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatHuman(result));
  }
}

// ---------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------

/** Validates a single file and returns a result object -- never calls
 * emit()/process.exit() itself, so main() can use this the same way for
 * both the single-file and multi-file cases. */
async function validateOneFile(filePath, { fix }) {
  const absPath = resolve(process.cwd(), filePath);

  let originalText;
  try {
    originalText = readFileSync(absPath, 'utf8');
  } catch (e) {
    return {
      filePath,
      diagramType: 'unknown',
      valid: false,
      messages: [
        {
          line: 1,
          column: 1,
          severity: 'error',
          message: `Could not read file: ${e.message}`,
          ruleId: 'file-read-error',
        },
      ],
    };
  }

  const diagramType = detectDiagramType(originalText);

  let sourceText = originalText;
  if (fix) {
    const fixedText = applyFixes(originalText, diagramType);
    if (fixedText !== originalText) {
      writeFileSync(absPath, fixedText, 'utf8');
      console.error(`[--fix] Applied automatic fix(es) and rewrote ${filePath}`);
      sourceText = fixedText;
    }
  }

  const [grammarMessages, semanticMessages] = await Promise.all([
    runGrammarCheck(sourceText),
    runSemanticCheck(diagramType, sourceText),
  ]);

  const messages = [...grammarMessages, ...semanticMessages].sort(
    (a, b) => a.line - b.line || a.column - b.column
  );
  const valid = !messages.some((m) => m.severity === 'error');

  return { filePath, diagramType, valid, messages };
}

async function main() {
  const { filePaths, json, fix } = parseArgs(process.argv);

  if (filePaths.length === 0) {
    console.error('Usage: node scripts/validate.mjs <path-to-file.mmd> [<path2> ...] [--json] [--fix]');
    process.exit(1);
  }

  const results = await Promise.all(filePaths.map((fp) => validateOneFile(fp, { fix })));

  // Single-file invocation is unchanged from earlier versions: one flat
  // {filePath, diagramType, valid, messages} object, not wrapped in an
  // array. SKILL.md's authoring loop and this project's own tests are
  // written against that exact single-file contract, so it stays as-is --
  // multi-file support (below) is additive, not a breaking change.
  if (results.length === 1) {
    emit(results[0], json);
    process.exit(results[0].valid ? 0 : 1);
  }

  // Multi-file: a naive "pass every staged/matched file as one command
  // line" caller (a lint-staged config, a hand-rolled CI loop, ...) should
  // get every file actually checked, not just the first -- an earlier
  // version of this CLI only ever looked at its first argument, which let
  // a broken diagram slip through a real pre-commit hook silently.
  if (json) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    for (const result of results) {
      console.log(`${result.filePath}:`);
      console.log(formatHuman(result));
      console.log('');
    }
  }
  process.exit(results.every((r) => r.valid) ? 0 : 1);
}

main().catch((e) => {
  console.error(`Unexpected error: ${(e && e.stack) || e}`);
  process.exit(1);
});
