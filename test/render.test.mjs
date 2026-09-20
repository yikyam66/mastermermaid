/**
 * test/render.test.mjs
 *
 * Automated coverage for the rendering pipeline:
 *   - scripts/render/render.mjs (CLI: primary renderer + automatic fallback)
 *   - scripts/render/fallback-renderer.mjs (renderWithFallback, FALLBACK_SUPPORTED_TYPES)
 *
 * Run with: node --test
 *
 * Uses only node:test + node:assert/strict, per this project's
 * minimal-dependency philosophy (no jest/mocha/vitest, no headless browser).
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  renderWithFallback,
  FALLBACK_SUPPORTED_TYPES,
} from '../scripts/render/fallback-renderer.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const renderScript = join(repoRoot, 'scripts', 'render', 'render.mjs');

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const FLOWCHART = `flowchart LR
    Start([Start]) --> Input[/Input Data/]
    Input --> Process[Process Data]
    Process --> Decision{Valid?}
    Decision -->|Yes| Success[Success]
    Decision -->|No| Error[Error Handler]
    Error --> Input
    Success --> End([End])
`;

const PIE = `pie title Pets adopted by type
    "Dogs" : 386
    "Cats" : 85
    "Rats" : 15
`;

const GANTT = `gantt
    title A Gantt Diagram
    dateFormat  YYYY-MM-DD
    section Section
    A task           :a1, 2024-01-01, 30d
    Another task     :after a1, 20d
`;

const MINDMAP = `mindmap
  root((Root))
    A
    B
`;

// All test fixtures/outputs live in one throwaway temp dir, removed after
// the whole suite runs (see `after` below) -- nothing is left behind in the
// repo.
let tmpDir;

before(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'mastermermaid-render-test-'));
});

after(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function writeFixture(name, content) {
  const path = join(tmpDir, name);
  writeFileSync(path, content, 'utf8');
  return path;
}

/** Runs the render CLI and returns stdout. Throws (with .stdout/.stderr on
 * the error) if the process exits non-zero. */
function runRender(args) {
  return execFileSync(process.execPath, [renderScript, ...args], {
    encoding: 'utf8',
  });
}

/** Parses an SVG's root viewBox="minX minY width height" into numbers. */
function parseViewBox(svg) {
  const m = svg.match(/viewBox="([^"]*)"/);
  assert.ok(m, 'expected the SVG to have a viewBox attribute');
  const nums = m[1].trim().split(/\s+/).map(Number);
  assert.equal(nums.length, 4, `expected 4 viewBox numbers, got: ${m[1]}`);
  assert.ok(nums.every((n) => Number.isFinite(n)), `viewBox numbers should be finite: ${m[1]}`);
  return { minX: nums[0], minY: nums[1], width: nums[2], height: nums[3] };
}

function assertSaneViewBox(svg, label) {
  const { width, height } = parseViewBox(svg);
  assert.ok(width > 10 && width < 20000, `${label}: viewBox width should be sane, got ${width}`);
  assert.ok(height > 10 && height < 20000, `${label}: viewBox height should be sane, got ${height}`);
}

// ---------------------------------------------------------------------------
// 1. Primary-path rendering: flowchart -> SVG via the CLI
// ---------------------------------------------------------------------------

test('primary path: renders a flowchart .mmd to a real SVG file', () => {
  const input = writeFixture('flowchart.mmd', FLOWCHART);
  const output = join(tmpDir, 'flowchart.svg');

  runRender(['--input', input, '--output', output]);

  assert.ok(existsSync(output), 'output SVG file should exist');
  const size = statSync(output).size;
  assert.ok(size > 500, `output SVG should be non-trivial size, got ${size} bytes`);

  const svg = readFileSync(output, 'utf8');
  assert.match(svg, /<svg[\s>]/, 'output should contain a real <svg tag');
});

// ---------------------------------------------------------------------------
// 2. Primary-path rendering: flowchart -> PNG via the CLI
// ---------------------------------------------------------------------------

test('primary path: renders a flowchart .mmd to a valid PNG file', () => {
  const input = writeFixture('flowchart-png.mmd', FLOWCHART);
  const output = join(tmpDir, 'flowchart.png');

  runRender(['--input', input, '--output', output, '--format', 'png']);

  assert.ok(existsSync(output), 'output PNG file should exist');
  const buf = readFileSync(output);
  assert.ok(buf.length > 500, `output PNG should be non-trivial size, got ${buf.length} bytes`);
  assert.ok(
    buf.subarray(0, 8).equals(PNG_MAGIC),
    `expected PNG magic bytes, got ${buf.subarray(0, 8).toString('hex')}`
  );
});

// ---------------------------------------------------------------------------
// 3. Fallback-path rendering via the CLI: pie and gantt, with a sane viewBox
// ---------------------------------------------------------------------------

test('fallback path: renders a pie chart to SVG with a non-degenerate viewBox', () => {
  const input = writeFixture('pie.mmd', PIE);
  const output = join(tmpDir, 'pie.svg');

  runRender(['--input', input, '--output', output]);

  assert.ok(existsSync(output));
  const svg = readFileSync(output, 'utf8');
  assert.match(svg, /<svg[\s>]/);
  assertSaneViewBox(svg, 'pie chart');
});

test('fallback path: renders a gantt chart to SVG with a non-degenerate viewBox', () => {
  const input = writeFixture('gantt.mmd', GANTT);
  const output = join(tmpDir, 'gantt.svg');

  runRender(['--input', input, '--output', output]);

  assert.ok(existsSync(output));
  const svg = readFileSync(output, 'utf8');
  assert.match(svg, /<svg[\s>]/);
  assertSaneViewBox(svg, 'gantt chart');
});

// ---------------------------------------------------------------------------
// 4. Unsupported-type handling: mindmap is in neither renderer's supported set
// ---------------------------------------------------------------------------

test('unsupported type: mindmap fails with a clear, specific error (not a stack trace)', () => {
  assert.equal(
    FALLBACK_SUPPORTED_TYPES.has('mindmap'),
    false,
    'sanity check: mindmap must not be fallback-supported for this test to be meaningful'
  );

  const input = writeFixture('mindmap.mmd', MINDMAP);
  const output = join(tmpDir, 'mindmap.svg');

  let threw = false;
  try {
    runRender(['--input', input, '--output', output]);
  } catch (err) {
    threw = true;
    const stderr = String(err.stderr);
    assert.match(
      stderr,
      /No local rendering path yet for "mindmap" diagrams\./,
      'error should name the diagram type explicitly'
    );
    assert.match(
      stderr,
      /```mermaid code block/,
      'error should suggest handing back a ```mermaid code block'
    );
    assert.doesNotMatch(
      stderr,
      /\bat \S+\(?.*:\d+:\d+/,
      'error should not leak a raw JS stack trace'
    );
  }

  assert.ok(threw, 'rendering an unsupported diagram type should exit non-zero');
  assert.ok(!existsSync(output), 'no output file should be written on failure');
});

// ---------------------------------------------------------------------------
// 5. Theming: two different --theme values must actually change the output
// ---------------------------------------------------------------------------

test('theming: dracula and github-light themes produce different SVG output', () => {
  const input = writeFixture('themed.mmd', FLOWCHART);
  const draculaOut = join(tmpDir, 'themed-dracula.svg');
  const lightOut = join(tmpDir, 'themed-github-light.svg');

  runRender(['--input', input, '--output', draculaOut, '--theme', 'dracula']);
  runRender(['--input', input, '--output', lightOut, '--theme', 'github-light']);

  const draculaSvg = readFileSync(draculaOut, 'utf8');
  const lightSvg = readFileSync(lightOut, 'utf8');

  assert.match(draculaSvg, /<svg[\s>]/);
  assert.match(lightSvg, /<svg[\s>]/);
  assert.notEqual(
    draculaSvg,
    lightSvg,
    'rendering with two different themes should produce different SVG bytes'
  );
});

// ---------------------------------------------------------------------------
// 6. renderWithFallback() called directly + FALLBACK_SUPPORTED_TYPES contents
// ---------------------------------------------------------------------------

test('renderWithFallback(): renders a pie chart directly (no CLI)', async () => {
  const svg = await renderWithFallback(PIE, {});
  assert.match(svg, /<svg[\s>]/);
  assertSaneViewBox(svg, 'direct pie chart');
});

test('renderWithFallback(): renders a gantt chart directly (no CLI)', async () => {
  const svg = await renderWithFallback(GANTT, {});
  assert.match(svg, /<svg[\s>]/);
  assertSaneViewBox(svg, 'direct gantt chart');
});

test('FALLBACK_SUPPORTED_TYPES: contains all 7 documented types (11 concrete entries, C4 has 5 subtypes)', () => {
  const expectedSupported = [
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
  ];

  for (const type of expectedSupported) {
    assert.ok(FALLBACK_SUPPORTED_TYPES.has(type), `expected FALLBACK_SUPPORTED_TYPES to include "${type}"`);
  }
});

test('FALLBACK_SUPPORTED_TYPES: deliberately excludes mindmap and requirementDiagram', () => {
  // See the comment block above FALLBACK_SUPPORTED_TYPES in
  // fallback-renderer.mjs: mindmap needs a real <canvas> for its
  // cytoscape/cose-bilkent force layout (jsdom has none), and
  // requirementDiagram's boxes come out degenerate (48x188 instead of the
  // configured 200x200 floor) because its SVG <path> data mixes absolute
  // and relative commands, which this module's path-bbox estimator doesn't
  // yet distinguish.
  assert.equal(FALLBACK_SUPPORTED_TYPES.has('mindmap'), false);
  assert.equal(FALLBACK_SUPPORTED_TYPES.has('requirementDiagram'), false);
});
