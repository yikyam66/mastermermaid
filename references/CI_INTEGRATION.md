# CI / pre-commit integration (no AI agent required)

MasterMermaid's validator is a plain Node.js CLI (`scripts/validate.mjs`, exposed
as the `mastermermaid-validate` bin). It does not call an LLM, does not need an
AI coding agent in the loop, and exits non-zero on an invalid diagram — which
means any engineering team can drop it into their own CI pipeline or Git
pre-commit hook exactly like they would ESLint or Prettier, whether or not
they use an AI agent at all.

This page shows two such setups, for a hypothetical team with Mermaid source
files in `docs/diagrams/*.mmd` in their own (unrelated) repo:

1. A GitHub Actions job that fails a pull request if any diagram is broken.
2. A Husky + lint-staged pre-commit hook that blocks a broken diagram from
   ever being committed.

Everything below was actually run, not just written to look plausible — see
["What was verified"](#what-was-verified-vs-documented) at the bottom for the
exact commands, tool versions, and a bug this testing caught.

## GitHub Actions

```yaml
# .github/workflows/validate-diagrams.yml
name: Validate Mermaid diagrams

on:
  push:
    branches: [main]
  pull_request:

jobs:
  validate-diagrams:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20.x'

      - name: Validate every diagram in docs/diagrams/
        run: |
          npx --yes --package=github:yikyam66/mastermermaid -- \
            mastermermaid-validate docs/diagrams/*.mmd --json
```

Notes:

- `npx --package=github:yikyam66/mastermermaid -- mastermermaid-validate <file> --json`
  is a real, runnable one-liner — verified from a completely empty npx cache,
  with no `mastermermaid` install anywhere on the machine beforehand. See the
  verification section for the exact transcript.
- `mastermermaid-validate` accepts multiple file arguments in one call (each
  is checked independently; the overall exit code is 0 only if every file is
  valid) — pass the whole glob at once as shown above. An earlier version of
  this CLI only ever read its *first* argument and silently ignored the
  rest, which this testing caught via a real pre-commit hook letting a
  broken diagram through (see "What was verified" below) — that's now fixed
  upstream, so the per-file shell loop this doc used to recommend as a
  workaround is no longer necessary.
- `npx --package=github:...` re-resolves the GitHub ref over the network on
  *every* invocation (confirmed: ~11s per call even when the git object was
  already cached locally), because it has to check whether `main` moved. For
  a docs folder with more than a handful of diagrams, install once and reuse
  the local bin instead, which is 4-5x faster per call once installed:

  ```yaml
      - name: Install MasterMermaid
        run: npm install --no-save github:yikyam66/mastermermaid#<commit-sha>

      - name: Validate every diagram in docs/diagrams/
        run: npx mastermermaid-validate docs/diagrams/*.mmd --json
  ```

  Pinning to a commit SHA (rather than floating on the default branch) also
  makes the CI run reproducible — a later MasterMermaid commit can't change
  what a past PR validated against. Both the floating-branch and pinned-SHA
  install forms were verified to work.

## Husky + lint-staged pre-commit hook

```bash
npm install --save-dev husky lint-staged github:yikyam66/mastermermaid#<commit-sha>
npx husky init
```

`npx husky init` creates `.husky/pre-commit` running `npm test` by default —
replace its contents with:

```bash
# .husky/pre-commit
npx lint-staged
```

Then add a lint-staged config -- the ordinary single shared-command form
works, since `mastermermaid-validate` checks every file it's given:

```js
// lint-staged.config.js  (use lint-staged.config.mjs + `export default` if
// your package.json has "type": "module")
module.exports = {
  '*.mmd': 'npx mastermermaid-validate --json',
};
```

lint-staged appends every staged `.mmd` path to that command
(`mastermermaid-validate --json a.mmd b.mmd c.mmd`), and the validator now
checks all of them and exits non-zero if any is broken.

**History, for anyone who finds an older copy of this doc or an older
MasterMermaid checkout**: this used to be broken. An earlier version of
`mastermermaid-validate` only read its *first* file argument and silently
ignored the rest, so the config above would only ever check `a.mmd` --
`b.mmd` and `c.mmd` could be committed broken with a clean pass. This was
reproduced for real in a scratch repo (a syntactically broken diagram slipped
through `git commit` uncaught) before being fixed in `scripts/validate.mjs`
itself. If `mastermermaid-validate --version`-equivalent info shows a commit
older than this fix, either upgrade or fall back to the one-command-per-file
function form:
```js
module.exports = { '*.mmd': (files) => files.map((f) => `npx mastermermaid-validate "${f}" --json`) };
```

## What was verified vs. documented

Everything above was tested for real in a scratch directory (macOS, Node
v24.19.0, npm 11.17.0) against this repo's own `assets/example_diagrams/*.mmd`
files, plus a deliberately-broken diagram, rather than assumed from reading
the source. Concretely:

**Verified — the ephemeral npx one-liner:**
- Cleared the local npx cache (`~/.npm/_npx/<hash>`) entirely, then ran
  `npx --package=github:yikyam66/mastermermaid -- mastermermaid-validate <file> --json`
  from scratch. It printed `npm warn exec ... will be installed`, installed
  the package straight from `github:yikyam66/mastermermaid` (no npm registry
  publish needed), and produced correct JSON output.
- Confirmed it works both with `--yes` and, piped from a non-interactive
  shell, without it (no confirmation prompt blocked it either way).
- Confirmed the exit code is `0` on a valid diagram and `1` on an invalid one
  (tested with a deliberately malformed flowchart), which is what makes it
  usable as a CI gate at all.
- Confirmed pinning to a specific commit
  (`github:yikyam66/mastermermaid#<sha>`) installs and runs identically to
  the floating `github:yikyam66/mastermermaid` (default-branch) form.
- Confirmed a pinned-commit `npm install --save-dev` followed by calling the
  locally-installed `mastermermaid-validate` bin (via `npx` or
  `node_modules/.bin/`) works and is markedly faster per call (~2.7s vs.
  ~11s) than re-resolving the GitHub ref through `npx --package=...` on every
  invocation.

**Verified — the multi-file bug, and that the fix landed:**
- Originally found that passing two files to one `mastermermaid-validate`
  invocation only validated the first; the second was silently ignored (a
  direct consequence of `scripts/validate.mjs`'s `parseArgs`, which took the
  first non-flag argument as *the* file path and ignored the rest).
- Reproduced this concretely with a real Husky v9.1.7 + lint-staged v17.5.1
  setup in a scratch git repo: with the single shared-command lint-staged
  config, `git commit` on a broken diagram staged alongside a valid one
  **succeeded** (exit 0) when the broken file happened to sort after the
  valid one in lint-staged's file list — i.e. it was silently let through.
- The real fix (`scripts/validate.mjs` now accepts and checks every file
  argument, exiting non-zero if any is invalid) has since landed in
  `scripts/validate.mjs` and is covered by regression tests in
  `test/validate.test.mjs`. Re-ran the same scratch-repo Husky + lint-staged
  setup with the fixed CLI and the *plain* single-command config from the
  section above: the broken diagram now correctly **blocked** the commit
  (pre-commit exited 1, no commit created), and a commit with only valid
  diagrams staged **succeeded** — no special array-returning config needed
  any more.

**Documented pattern, not independently re-run inside GitHub's own hosted
Actions infrastructure:**
- The GitHub Actions YAML above is a thin, standard wrapper (checkout →
  setup-node → shell loop) around the exact shell commands verified above; it
  was not separately triggered end-to-end on a real `github.com` Actions
  runner as part of this work, since doing so would have required pushing a
  workflow to a live repository. The loop syntax (`shopt -s nullglob`, `for`,
  `::group::`) is standard bash / workflow-command syntax, and every command
  it calls was verified directly, but the specific combination running
  inside Actions' own container image was not separately observed.
