# MasterMermaid

Deterministic Mermaid diagram validation, semantic linting, and auto-repair for AI coding agents — no headless browser required.

[![skills.sh](https://skills.sh/b/yikyam66/mastermermaid)](https://skills.sh/yikyam66/mastermermaid)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

MasterMermaid is a Mermaid-diagram skill for AI coding agents — Claude Code, Trae, Zed, Cursor, and the ~20 other agents [skills.sh](https://skills.sh) supports. It gives an agent (or a CI pipeline) a way to check that a Mermaid diagram actually parses, catch diagrams that parse but don't make sense, fix what it can automatically, and render the result with real themes.

## Why MasterMermaid

There are two existing Mermaid skills worth knowing about. Here's how MasterMermaid compares, based on reading their source:

| Feature | [design-doc-mermaid](https://github.com/spillwavesolutions/design-doc-mermaid) | [Pretty-mermaid-skills](https://github.com/imxv/Pretty-mermaid-skills) | MasterMermaid |
|---|---|---|---|
| Grammar validation | Shells out to the official `mermaid-cli`, which requires a headless Chromium install | None | Deterministic — parses with Mermaid's own JS parser, no browser |
| Semantic linting | None | None | Heuristic linting (undefined refs, orphan nodes, common structural mistakes) |
| Auto-repair | Fuzzy-matches the parser's error text against a static, 28-entry troubleshooting cheat sheet — no programmatic fix | None | Bounded auto-repair loop that re-validates after each fix attempt |
| Themed rendering | — | 15 themes, SVG/PNG/ASCII, no browser needed, 6 diagram types | 15 themes (vendored from Pretty Mermaid) + an official-mermaid fallback path, no browser either way, 12 of 14 diagram types |
| Diagram types | 13 | 6 | 14 (v1) |
| Runs standalone, no AI agent present | Partially — still needs Chromium at runtime | Render only | Yes — validation, linting, repair, and rendering all run headless |
| Reach | 172 stars, ~49.8k skills.sh installs | — | — |

design-doc-mermaid and Pretty-mermaid-skills each do one half of the job well: one validates (awkwardly, via a browser dependency and a static cheat sheet), the other renders beautifully (but doesn't validate at all, and covers fewer diagram types). MasterMermaid's goal is to do both properly — real grammar validation and a genuine repair loop, plus the rendering quality of Pretty Mermaid — in one dependency-light package, across a superset of design-doc-mermaid's diagram coverage.

## Install

```bash
npx skills add yikyam66/mastermermaid
```

This installs the skill for whichever supported agent you run it from.

## Quick start

Validate a diagram (grammar + semantic lint), as JSON:

```bash
node scripts/validate.mjs diagram.mmd --json
```

Render a diagram to SVG with a theme:

```bash
node scripts/render/render.mjs --input diagram.mmd --output out.svg --theme tokyo-night
```

## Diagram types (v1)

MasterMermaid validates and lints all 14 core Mermaid diagram types, and
renders 12 of them to a standalone SVG/PNG/ASCII file:

| # | Type | Renders to a file? |
|---|---|---|
| 1 | Flowchart | ✅ |
| 2 | Sequence diagram | ✅ |
| 3 | Class diagram | ✅ |
| 4 | State diagram | ✅ |
| 5 | Entity-relationship (ER) diagram | ✅ |
| 6 | C4 diagram | ✅ |
| 7 | Gantt chart | ✅ |
| 8 | Git graph | ✅ |
| 9 | Pie chart | ✅ |
| 10 | Timeline | ✅ |
| 11 | Quadrant chart | ✅ |
| 12 | User journey | ✅ |
| 13 | Mindmap | validated + linted only (needs a native `canvas` dependency to render — not yet added) |
| 14 | Requirement diagram | validated + linted only (renderer's SVG-path bounding-box estimate isn't accurate for this type yet) |

That's a superset of design-doc-mermaid's 13 supported types, and every type
above 100% works as a validated \`\`\`mermaid code block regardless of local
rendering support — that's actually the primary way this skill hands a
diagram back, since GitHub, VS Code, Notion, Claude, and Obsidian all render
that natively. Rendering to a standalone image file is for when you
specifically need one (embedding somewhere that doesn't render Mermaid,
slide decks, email attachments, etc.), not a requirement for every diagram.

## Roadmap

- **v1 (current):** the 14 diagram types above, with grammar validation, semantic linting, bounded auto-repair, and themed rendering.
- **v2:** full coverage of Mermaid's ~30 diagram types.
- **v3:** living diagrams — keeping diagrams in sync with the codebases they describe as the code changes.

## Credits

MasterMermaid stands on two projects' work:

- **[Mermaid.js](https://github.com/mermaid-js/mermaid)** (MIT) — the diagram language this entire project is built on. All validation and linting runs on Mermaid's own parser, and 7 of the 12 rendered diagram types (pie, quadrantChart, journey, gantt, timeline, gitGraph, C4) render through Mermaid's own official renderer as well, running in plain Node under a jsdom shim.
- **[Pretty Mermaid](https://github.com/imxv/Pretty-mermaid-skills)** (MIT) — MasterMermaid's primary rendering engine (`scripts/render/render.mjs`, `png.mjs`, `themes.mjs`, ...) is a vendored, adapted copy of Pretty Mermaid's renderer for 5 diagram types (flowchart, sequence, class, state, ER), used under its MIT license. All credit for the theme system and no-browser rendering approach goes to that project; please check it out directly if you just need rendering without validation.

## License

MIT — see [LICENSE](./LICENSE).
