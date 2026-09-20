/**
 * test/validate.test.mjs
 *
 * End-to-end tests for scripts/validate.mjs, exercised as a CLI subprocess
 * (the way real callers use it: `node scripts/validate.mjs <file> [--json]
 * [--fix]`). Each test writes its own .mmd fixture to a fresh temp dir and
 * cleans it up in a t.after() hook.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const validateScript = join(repoRoot, 'scripts', 'validate.mjs');

/** Writes `content` to a fresh temp file and registers cleanup on `t`. */
function writeTempFixture(t, content, filename = 'diagram.mmd') {
  const dir = mkdtempSync(join(tmpdir(), 'mastermermaid-test-'));
  const filePath = join(dir, filename);
  writeFileSync(filePath, content, 'utf8');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return filePath;
}

function runValidate(args) {
  return spawnSync(process.execPath, [validateScript, ...args], {
    encoding: 'utf8',
  });
}

/** Runs validate.mjs with --json (plus any extraArgs) and parses stdout. */
function runValidateJson(filePath, extraArgs = []) {
  const result = runValidate([filePath, '--json', ...extraArgs]);
  let json = null;
  try {
    json = JSON.parse(result.stdout);
  } catch {
    // leave json null; callers assert on raw stdout/stderr for diagnosis
  }
  return { ...result, json };
}

// One valid fixture per diagram type required by the test plan. Syntax is
// modeled directly on assets/example_diagrams/*.mmd (known-good mermaid
// input already used elsewhere in this repo) plus standard mermaid-docs
// patterns for the types that don't have an example asset.
const VALID_FIXTURES = {
  flowchart: `flowchart LR
    Start([Start]) --> Input[/Input Data/]
    Input --> Process[Process Data]
    Process --> Decision{Valid?}
    Decision -->|Yes| Success[Success]
    Decision -->|No| Error[Error Handler]
    Error --> Input
    Success --> End([End])
`,
  sequenceDiagram: `sequenceDiagram
    participant User
    participant Client
    participant Server

    User->>Client: Request Data
    Client->>Server: API Call
    Server-->>Client: Response
    Client-->>User: Display Data
`,
  classDiagram: `classDiagram
    class User {
        +String id
        +String name
        +login()
    }

    class Post {
        +String id
        +String title
    }

    User "1" --> "*" Post: creates
`,
  'stateDiagram-v2': `stateDiagram-v2
    [*] --> Idle
    Idle --> Loading: Start Request
    Loading --> Success: Data Received
    Loading --> Error: Request Failed
    Success --> Idle: Reset
    Error --> Idle: Retry
    Error --> [*]: Abort
`,
  erDiagram: `erDiagram
    USER ||--o{ ORDER : places
    USER {
        string id PK
        string name
    }
    ORDER {
        string id PK
        string user_id FK
    }
`,
  gantt: `gantt
    title A Gantt Diagram
    dateFormat YYYY-MM-DD
    section Section
    A task           :a1, 2024-01-01, 30d
    Another task     :after a1, 20d
`,
  pie: `pie title Pets adopted by volunteers
    "Dogs" : 386
    "Cats" : 85
    "Rats" : 15
`,
  gitGraph: `gitGraph
    commit
    branch develop
    checkout develop
    commit
    checkout main
    merge develop
    commit
`,
};

describe('validate.mjs --json: valid diagrams', () => {
  for (const [diagramType, source] of Object.entries(VALID_FIXTURES)) {
    test(`${diagramType}: reports {valid: true, messages: []} and exits 0`, (t) => {
      const filePath = writeTempFixture(t, source);
      const { status, json, stdout, stderr } = runValidateJson(filePath);
      assert.ok(json, `expected parseable JSON on stdout, got stdout=${stdout} stderr=${stderr}`);
      assert.equal(json.valid, true);
      assert.deepEqual(json.messages, []);
      assert.equal(status, 0);
    });
  }
});

describe('validate.mjs --json: invalid diagram', () => {
  test('flowchart missing a subgraph "end" reports valid:false with line/column and exits 1', (t) => {
    const source = `flowchart TD
    subgraph Group1
        A --> B
    A --> C
`;
    const filePath = writeTempFixture(t, source);
    const { status, json, stdout } = runValidateJson(filePath);
    assert.ok(json, `expected parseable JSON on stdout, got: ${stdout}`);
    assert.equal(json.valid, false);
    assert.ok(json.messages.length > 0, 'expected at least one message');
    for (const message of json.messages) {
      assert.equal(typeof message.line, 'number');
      assert.equal(typeof message.column, 'number');
    }
    assert.equal(status, 1);
  });
});

describe('validate.mjs --fix', () => {
  test('rewrites a missing subgraph "end" to a valid file, and a second run is idempotent', (t) => {
    const source = `flowchart TD
    subgraph Group1
        A --> B
`;
    const filePath = writeTempFixture(t, source);

    const firstFix = runValidateJson(filePath, ['--fix']);
    assert.ok(firstFix.json, `expected parseable JSON, got stderr: ${firstFix.stderr}`);
    assert.equal(firstFix.json.valid, true, `expected --fix to produce a valid file: ${JSON.stringify(firstFix.json)}`);
    assert.equal(firstFix.status, 0);
    assert.match(firstFix.stderr, /\[--fix\] Applied automatic fix/);

    const fixedContent = readFileSync(filePath, 'utf8');
    assert.notEqual(fixedContent, source, 'file on disk should have been rewritten');
    assert.match(fixedContent.trim(), /\bend\s*$/);

    // Second run: already valid/fixed, so --fix must be a no-op.
    const secondFix = runValidateJson(filePath, ['--fix']);
    assert.equal(secondFix.status, 0);
    assert.equal(secondFix.json.valid, true);
    assert.doesNotMatch(secondFix.stderr, /\[--fix\] Applied automatic fix/);

    const contentAfterSecondFix = readFileSync(filePath, 'utf8');
    assert.equal(contentAfterSecondFix, fixedContent, 'a second --fix run must not change an already-fixed file');
  });
});

describe('validate.mjs --json: diagramType detection', () => {
  test('detects "flowchart"', (t) => {
    const filePath = writeTempFixture(t, VALID_FIXTURES.flowchart);
    const { json } = runValidateJson(filePath);
    assert.equal(json.diagramType, 'flowchart');
  });

  test('detects "sequenceDiagram"', (t) => {
    const filePath = writeTempFixture(t, VALID_FIXTURES.sequenceDiagram);
    const { json } = runValidateJson(filePath);
    assert.equal(json.diagramType, 'sequenceDiagram');
  });

  test('detects the C4 subtype "C4Context"', (t) => {
    const source = `C4Context
    title System Context diagram
    Person(customer, "Customer", "A customer of the system")
    System(system, "System", "The system being described")
    Rel(customer, system, "Uses")
`;
    const filePath = writeTempFixture(t, source);
    const { json, stdout } = runValidateJson(filePath);
    assert.ok(json, `expected parseable JSON, got: ${stdout}`);
    assert.equal(json.diagramType, 'C4Context');
  });
});

describe('validate.mjs: default human-readable output', () => {
  test('prints "✓ valid <type> diagram" for a valid file', (t) => {
    const filePath = writeTempFixture(t, VALID_FIXTURES.flowchart);
    const { status, stdout } = runValidate([filePath]);
    assert.equal(status, 0);
    assert.equal(stdout.trim(), '✓ valid flowchart diagram');
  });

  test('prints "<line>:<column> [severity] message (ruleId)" lines for an invalid file', (t) => {
    const source = `flowchart TD
    subgraph Group1
        A --> B
`;
    const filePath = writeTempFixture(t, source);
    const { status, stdout } = runValidate([filePath]);
    assert.equal(status, 1);
    const lines = stdout.trim().split('\n');
    assert.ok(lines.length > 0);
    for (const line of lines) {
      assert.match(line, /^\d+:\d+ \[(error|warning)\] .+ \([\w-]+\)$/);
    }
  });
});

describe('validate.mjs: multi-file invocation', () => {
  // Regression tests for a real bug: an earlier version only ever looked at
  // its first CLI argument and silently ignored the rest, which let a
  // broken diagram slip through a real lint-staged pre-commit config that
  // passed every staged file to one shared command (see
  // references/CI_INTEGRATION.md for the full writeup).

  test('single-file invocation keeps the original flat JSON shape (no array wrapper)', (t) => {
    const filePath = writeTempFixture(t, VALID_FIXTURES.flowchart);
    const { json } = runValidateJson(filePath);
    assert.ok(json && !Array.isArray(json), 'expected a single flat object, not an array');
    assert.equal(json.valid, true);
  });

  test('two valid files: both are checked, JSON array output, exit 0', (t) => {
    const fileA = writeTempFixture(t, VALID_FIXTURES.flowchart, 'a.mmd');
    const fileB = writeTempFixture(t, VALID_FIXTURES.pie, 'b.mmd');
    const { status, stdout } = runValidate([fileA, fileB, '--json']);
    assert.equal(status, 0);
    const results = JSON.parse(stdout);
    assert.equal(results.length, 2);
    assert.ok(results.every((r) => r.valid === true));
    assert.deepEqual(results.map((r) => r.filePath), [fileA, fileB]);
  });

  test('a broken SECOND file is not silently skipped: exit 1, both results present', (t) => {
    const fileA = writeTempFixture(t, VALID_FIXTURES.flowchart, 'a.mmd');
    const brokenSource = `flowchart TD
    subgraph Group1
        A --> B
`;
    const fileB = writeTempFixture(t, brokenSource, 'b.mmd');
    const { status, stdout } = runValidate([fileA, fileB, '--json']);
    assert.equal(status, 1, 'overall exit code must be 1 when ANY file is invalid');
    const results = JSON.parse(stdout);
    assert.equal(results.length, 2, 'both files must appear in the output, not just the first');
    assert.equal(results[0].valid, true);
    assert.equal(results[1].valid, false);
    assert.ok(results[1].messages.length > 0);
  });

  test('multi-file human-readable output labels each file', (t) => {
    const fileA = writeTempFixture(t, VALID_FIXTURES.flowchart, 'a.mmd');
    const fileB = writeTempFixture(t, VALID_FIXTURES.pie, 'b.mmd');
    const { status, stdout } = runValidate([fileA, fileB]);
    assert.equal(status, 0);
    assert.ok(stdout.includes(fileA));
    assert.ok(stdout.includes(fileB));
  });
});
