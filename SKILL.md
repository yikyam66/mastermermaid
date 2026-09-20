---
name: mastermermaid
description: Create, fix, validate, or render any Mermaid diagram — flowcharts, sequence diagrams, class diagrams, state diagrams, ER diagrams, C4/architecture diagrams, Gantt charts, git graphs, pie charts, mindmaps, timelines, quadrant charts, requirement diagrams, and user journeys. Use this skill whenever the user wants any of these 14 diagram types created, fixed, debugged, validated, or rendered — even if they never say the word "mermaid" — for example "draw me a flowchart for this process," "make an architecture diagram of our services," "diagram this API call sequence," "chart out this database schema," "plan this project as a gantt chart," "map our org as a mindmap," or "this diagram is broken, fix it." Also use it for "validate mermaid syntax," auto-repairing a broken .mmd file, or adding diagrams to documentation. This skill is not a text-pattern matcher: it runs a real deterministic grammar parser plus heuristic semantic linting to catch mistakes before the user sees them, then renders themed SVG/PNG/ASCII output with no headless browser required. Reach for it before hand-writing Mermaid from memory alone.
---

# MasterMermaid

MasterMermaid turns a diagram request into Mermaid source that has actually been
checked, not just eyeballed. Two independent capabilities back this up:

1. **A real validator** (`scripts/validate.mjs`) — deterministic grammar parsing via
   the official `mermaid` parser (not regex-guessing at error strings), plus
   heuristic semantic linting for the diagram types that have it, plus a
   best-effort mechanical auto-fixer. It needs no AI agent to run: a human
   engineer can call it from a pre-commit hook or a CI job on a machine that has
   never heard of Claude.
2. **A themed renderer** (`scripts/render/render.mjs`) — a vendored, credited
   fork of the Pretty-mermaid-skills renderer, producing themed SVG, PNG, or
   ASCII output without a headless browser.

Use the two together: validate (and repair) first, render only once the source
is actually valid.

## Supported diagram types (v1 core — 14)

These 14 types are "core": documented with correct-syntax references *and*
backed by the validator above.

| Category | Types | Reference file |
|---|---|---|
| Structural | flowchart, class diagram, ER diagram | `references/types/structural.md` |
| Behavioral | sequence diagram, state diagram, C4 diagram | `references/types/behavioral.md` |
| Planning | gantt chart, timeline, user journey | `references/types/planning.md` |
| Analytical | pie chart, mindmap, quadrant chart, requirement diagram, git graph | `references/types/analytical.md` |

**Read the matching reference file before writing source for one of these
types**, even for ones that feel familiar. Mermaid's syntax has enough sharp
edges per diagram type (arrow variants, required keywords, quoting rules) that
guessing from general memory is exactly how avoidable validator round-trips
happen — this is doubly true for the less common types like quadrant charts or
requirement diagrams, which are easy to misremember.

## The authoring loop

This is the core workflow. Follow it in order, every time:

1. **Pick the right diagram type** for what the user is asking for. If it's one
   of the 14 core types above, open its reference file in `references/types/`
   and confirm the exact syntax (keywords, arrow forms, required blocks) before
   writing anything.
2. **Write the `.mmd` source** to a file.
3. **Run the validator**: `node scripts/validate.mjs <file> --json`, and parse
   the JSON result.
4. **If `valid` is `false`**: read the `messages` array, fix the specific
   lines/issues it names, and re-run. Allow yourself up to **3 attempts
   total** (the first pass plus up to 2 repairs).
5. **If still invalid after 3 attempts, stop.** Do not keep guessing at a 4th,
   5th, or 6th variation. Show the user the exact validator messages and the
   current diagram source, and ask how they'd like to proceed. See "Why
   bounded retries" below for the reasoning — this is a deliberate design
   choice, not a shortcut.
6. **Once valid, deliver it.** The primary way to hand back a diagram is a
   validated \`\`\`mermaid code block in your response — GitHub, VS Code,
   Notion, Claude, Obsidian, and most other places this gets read all render
   that natively, so a correct code block is a complete deliverable on its
   own, not a placeholder waiting for an image. Only reach for
   `node scripts/render/render.mjs --input <file.mmd> --output
   <file.svg|.png|.txt> [--format svg|png|ascii] [--theme <name>] [--width
   <px>]` when the user specifically wants a standalone image file (to embed
   somewhere that doesn't render Mermaid, attach to an email, drop in a
   slide deck, etc.) — see "Renderer CLI reference" below for exactly which
   of the 14 types that command currently covers.
7. **Be honest about scope.** Only the 14 types above get validation and
   semantic linting in this version. Other Mermaid diagram types (e.g. sankey,
   XY charts, block diagrams, kanban) can still be attempted from general
   knowledge if the user wants one, but say plainly that they haven't been
   run through the validator or linter yet — that's a roadmap item, not
   something to quietly paper over.

## Why bounded retries, why a standalone CLI

Two design choices in this skill are easy to second-guess in the moment, so
here's the reasoning behind them.

**Why stop at 3 attempts instead of iterating until it works?** A validator
that reports a real, specific error (wrong line, wrong column, a named rule)
is telling you something concrete is wrong — usually fixable in one or two
tries. If three attempts haven't converged, the problem is very likely not a
small syntax slip anymore; it's a misunderstanding about what the user
actually wants, an ambiguity in the request, or a diagram-type limitation
worth surfacing rather than papering over with a fourth guess. Professional
linters with `--fix` behave the same way: they fix what's mechanical and stop
short of silently reinterpreting the input. Looping indefinitely would also
hide a real problem behind the appearance of "still working on it," which is
worse for the user than a clear, early "here's exactly what's wrong, how do
you want to proceed?"

**Why does the validator have to work with zero AI involved?** Because that's
the actual competitive bar this skill is built to clear. Some Mermaid tooling
"validates" by shelling out to a headless-Chromium renderer and calling a
render success a validation pass, or by fuzzy-matching error text against a
static troubleshooting cheat sheet — which only catches errors someone already
saw before and wrote down. `scripts/validate.mjs` instead runs the actual
Mermaid grammar parser (the same one that decides whether a diagram renders at
all) directly in plain Node, under a `jsdom` shim, with no browser and no
agent. That means a human engineer can drop it into a pre-commit hook or a CI
pipeline on a machine that has never run an AI agent, and it will catch real
syntax errors — not just the ones someone anticipated. When you, the agent,
call it mid-conversation, you're using the exact same deterministic tool a CI
pipeline would use; that's what makes its "valid" verdict trustworthy enough
to act on without re-checking it yourself.

## Validator CLI reference

```
node scripts/validate.mjs <path-to-file.mmd> [--json] [--fix]
```

**Type detection** — from the file's first meaningful line: `flowchart`/`graph`,
`sequenceDiagram`, `classDiagram`, `stateDiagram`/`stateDiagram-v2`,
`erDiagram`, `C4Context`/`C4Container`/`C4Component`/`C4Dynamic`/`C4Deployment`,
`gantt`, `gitGraph`, `pie`, `mindmap`, `timeline`, `quadrantChart`,
`requirementDiagram`, `journey`.

**Default (human-readable) output** — one issue per line:
```
<line>:<column> [error|warning] <message> (<ruleId>)
```
or, if there are zero messages: `✓ valid <diagramType> diagram`.

**`--json` output** — exactly this shape (ESLint-style):
```json
{
  "filePath": "<the input path as given>",
  "diagramType": "<detected type>",
  "valid": true,
  "messages": [
    { "line": 4, "column": 1, "severity": "error", "message": "...", "ruleId": "..." }
  ]
}
```
`valid` is `true` only when no message has `severity: "error"` (warnings alone
still leave it valid). Always parse this JSON form when you're driving the
loop programmatically rather than trying to read the human-readable form.

**Exit code**: `0` when `valid` is `true`, `1` when `valid` is `false`. This is
what makes it usable as `node scripts/validate.mjs somefile.mmd; echo $?` in a
shell script or CI step with no agent reading the output at all.

**`--fix`**: best-effort, mechanical-only autofix — unbalanced brackets/quotes,
a flowchart `subgraph` missing its `end`, and similarly structural slips. It
rewrites the file only if it actually changed something; otherwise the file is
left untouched. It deliberately does **not** attempt anything that needs
semantic judgment (e.g. "this looks like a typo of that other node") — that
class of fix is left to step 4 of the authoring loop above, where you read the
JSON `messages` and edit the file yourself with full context on what the user
actually meant.

## Semantic linting modules

Beyond grammar, `scripts/semantic/<type>.mjs` modules add heuristic checks the
parser can't see — things that are syntactically fine but probably wrong.
Each exports `lint(sourceText, diagramType)` returning
`Array<{line, column, severity: "warning", ruleId, message}>`, and every
message from these modules is a `warning` (heuristic, not a hard error) merged
into the same `messages` array. A diagram type without a semantic module (any
of the 14 core types not listed here) simply skips this step — that's an
intentional v1 scope limit, not a bug, and it's fine to tell the user so if
asked.

| Module | Flags |
|---|---|
| `flowchart.mjs` | A node ID that only ever appears as an edge endpoint (never labeled) and looks like a case-typo of another declared node ID (e.g. `NodeA` vs `nodea`); duplicate edge definitions. |
| `class.mjs` | A class name used in a relationship line (`A --\|> B`) where neither side was ever declared via a `class X { ... }` block or a `class X` statement. |
| `state.mjs` | A state name used in a transition (`A --> B`) that's never declared as its own state anywhere, excluding the `[*]` start/end marker. |
| `sequence.mjs` | A participant/actor name in a message arrow that looks like a typo of an already-used name (differs only by case or a single character) — not every implicit participant, since Mermaid legitimately auto-creates those on first use. |

These are heuristic, text/regex-based checks, not full AST semantic analysis —
each module documents that limitation in its own header comment. Expect them
to catch the common, cheap-to-detect mistakes (typo'd IDs, undeclared
relationship endpoints), not every logical error a diagram could have.

## Renderer CLI reference

```
node scripts/render/render.mjs --input <file.mmd> --output <file.svg|.png|.txt> \
  [--format svg|png|ascii] [--theme <name>] [--width <px>]
```

Only run this once the file validates. Full theme list (15 themes) and the
complete flag/option reference live in `references/RENDER_THEMES.md` and
`references/RENDER_API.md` — read whichever one answers the question at hand
(theme names and picking one → `RENDER_THEMES.md`; programmatic/API-level
options → `RENDER_API.md`) rather than guessing a theme name. Rendering never
needs a headless browser or `mermaid-cli` (Puppeteer, Chromium, ...) for any
of the 12 supported types below.

**Two render paths, chosen automatically — you never need to pick one:**

1. **Primary** (5 types: flowchart, sequence, class, state, ER) — a vendored
   fork of the Pretty-mermaid-skills renderer, credited in
   `scripts/render/LICENSE.pretty-mermaid`. Fast, from-scratch SVG/PNG/ASCII
   rendering with 15 themes.
2. **Fallback** (7 more types: pie, quadrantChart, journey, gantt, timeline,
   gitGraph, and all C4 diagrams) — the *official* `mermaid` package running
   under the same jsdom shim `scripts/validate.mjs` already uses for grammar
   checking, so it's still no real browser, just a heavier code path. `render.mjs`
   switches to this automatically when the primary renderer reports a type it
   doesn't implement (`scripts/render/fallback-renderer.mjs` has the full
   detail on why each of these specific 7 works and how). SVG and PNG both
   work through this path; ASCII does not (that's a primary-renderer-only
   feature) — say so plainly if asked for ASCII on a fallback-only type.

**2 of the 14 core types have no local rendering path yet: `mindmap` and
`requirementDiagram`.** Both are still fully validated and (for `mindmap`)
semantic-linted like every other core type — this gap is about producing a
static image file, not about correctness. If asked to render one of these two,
say so directly and offer the validated \`\`\`mermaid code block instead
(which, per the authoring loop above, is the primary deliverable anyway).
Root causes, if it's useful to explain: `mindmap`'s layout needs a real
Canvas 2D context that jsdom doesn't provide (would need the native `canvas`
npm package, a bigger dependency than anything else this skill pulls in);
`requirementDiagram` draws its boxes with SVG path data this renderer's
bounding-box estimator doesn't parse accurately yet (a real SVG path parser
would fix it — tracked as a roadmap item, not shipped half-working).

## Scope and roadmap

v1 ships 14 core diagram types with real validation, heuristic semantic
linting where a module exists, and themed rendering for 12 of the 14 (see
above). That's a deliberately broad starting surface, with a roadmap toward
covering Mermaid's full type set — and full rendering coverage — over time.
If a user asks for a diagram type outside the 14 (sankey, XY chart, block
diagram, kanban, and others), you can still write it from general Mermaid
knowledge — just say directly that it won't get the validation or
semantic-linting treatment yet, rather than implying it went through the same
rigor as the core types. Overclaiming coverage here is worse than admitting
the gap: the whole value of the validator is that its "valid" verdict can be
trusted, and that trust depends on being honest about where it doesn't yet
apply — the same principle applies to rendering coverage, which is why the
two gaps above are named explicitly rather than smoothed over.
