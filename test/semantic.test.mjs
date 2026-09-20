/**
 * test/semantic.test.mjs
 *
 * Unit tests for the four v1 semantic linter modules, calling their
 * lint(sourceText, diagramType) exports directly (no CLI subprocess).
 *
 * Each module's own header comment documents exactly what its heuristic
 * does and does not catch -- these tests are written to match that
 * documented behavior, not a generic notion of "typo detection":
 *
 *  - flowchart.mjs / state.mjs only flag a CASE-MISMATCH between two
 *    spellings of the same name (e.g. "Build" vs "build"), never a
 *    general edit-distance typo (e.g. "Buld" vs "Build").
 *  - sequence.mjs is the one module that also catches a single-character
 *    edit-distance typo, in addition to case-mismatches.
 *  - class.mjs flags a relationship whose *both* endpoints are undeclared.
 *
 * For each module: one true-positive case (the exact pattern the module's
 * header says it is designed to catch) and one true-negative case (a
 * legitimate diagram that must NOT be flagged, guarding against false
 * positives).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { lint as lintFlowchart } from '../scripts/semantic/flowchart.mjs';
import { lint as lintClass } from '../scripts/semantic/class.mjs';
import { lint as lintState } from '../scripts/semantic/state.mjs';
import { lint as lintSequence } from '../scripts/semantic/sequence.mjs';

describe('scripts/semantic/flowchart.mjs', () => {
  test('flags a node ID that only ever appears bare and is a case-mismatch of a known ID', () => {
    const source = `flowchart TD
    NodeA[Start] --> NodeB[End]
    NodeB --> nodea
`;
    const messages = lintFlowchart(source, 'flowchart');
    assert.equal(messages.length, 1);
    assert.equal(messages[0].ruleId, 'flowchart-possible-id-typo');
    assert.equal(messages[0].severity, 'warning');
    assert.equal(messages[0].line, 3);
    assert.match(messages[0].message, /"nodea"/);
    assert.match(messages[0].message, /"NodeA"/);
  });

  test('does not flag a legitimate diagram where every ID is consistent', () => {
    const source = `flowchart TD
    A[Start] --> B[Process]
    B --> C[End]
    B --> D[Alt]
`;
    const messages = lintFlowchart(source, 'flowchart');
    assert.deepEqual(messages, []);
  });
});

describe('scripts/semantic/class.mjs', () => {
  test('flags a relationship whose endpoints are never declared via "class X"', () => {
    const source = `classDiagram
    class Animal
    Foo --|> Bar
`;
    const messages = lintClass(source, 'classDiagram');
    assert.equal(messages.length, 1);
    assert.equal(messages[0].ruleId, 'class-undeclared-relationship');
    assert.equal(messages[0].severity, 'warning');
    assert.equal(messages[0].line, 3);
    assert.match(messages[0].message, /"Foo"/);
    assert.match(messages[0].message, /"Bar"/);
  });

  test('does not flag a relationship where at least one endpoint is declared', () => {
    const source = `classDiagram
    class Animal
    class Dog
    Dog --|> Animal
`;
    const messages = lintClass(source, 'classDiagram');
    assert.deepEqual(messages, []);
  });
});

describe('scripts/semantic/state.mjs', () => {
  // state.mjs's header is explicit: it only flags a CASE-MISMATCH typo
  // (e.g. "build" vs "Build"), not a general edit-distance typo like
  // "Buld" vs "Build" -- using the latter here would be the exact
  // confusion the project's own eval fixtures already hit once.
  test('flags a single-use, undeclared state name that is a case-mismatch of a known state', () => {
    const source = `stateDiagram-v2
    [*] --> Build
    Build --> Test
    Test --> Deploy
    Deploy --> [*]
    Deploy --> build
`;
    const messages = lintState(source, 'stateDiagram-v2');
    assert.equal(messages.length, 1);
    assert.equal(messages[0].ruleId, 'state-possible-typo');
    assert.equal(messages[0].severity, 'warning');
    assert.match(messages[0].message, /"build"/);
    assert.match(messages[0].message, /"Build"/);
  });

  test('does not flag ordinary single-use terminal states that have no case-variant collision', () => {
    const source = `stateDiagram-v2
    [*] --> Idle
    Idle --> Success
    Idle --> Error
`;
    const messages = lintState(source, 'stateDiagram-v2');
    assert.deepEqual(messages, []);
  });
});

describe('scripts/semantic/sequence.mjs', () => {
  test('flags an undeclared participant that is a case-mismatch typo of an already-known name', () => {
    const source = `sequenceDiagram
    participant Alice
    participant Bob
    Alice->>Bob: Hello
    alice->>Bob: Hi again
`;
    const messages = lintSequence(source, 'sequenceDiagram');
    assert.equal(messages.length, 1);
    assert.equal(messages[0].ruleId, 'sequence-possible-participant-typo');
    assert.equal(messages[0].severity, 'warning');
    assert.equal(messages[0].line, 5);
    assert.match(messages[0].message, /"alice"/);
    assert.match(messages[0].message, /"Alice"/);
  });

  test('does not flag legitimate, never-typo\'d, implicitly-declared participants', () => {
    // Mermaid auto-creates a participant the first time its name is used;
    // sequence.mjs's header says this must never be flagged on its own.
    const source = `sequenceDiagram
    Alice->>Bob: Hello
    Bob-->>Carol: Forward
`;
    const messages = lintSequence(source, 'sequenceDiagram');
    assert.deepEqual(messages, []);
  });
});
