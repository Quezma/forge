# react-atlas

MCP server that indexes a React/TypeScript project and audits component misuse, duplicates, design-system bypass and global-state misuse. Design: `docs/specs/2026-10-26-react-atlas-design.md`.

Requires Node >= 23 (runs TypeScript directly).

## Install

```sh
npm install
npm link            # exposes `react-atlas`
```

## Per-project setup

In the target project:

```sh
react-atlas install                                # .react_atlas/, config.json, AGENTS.md block
react-atlas index                                  # build the index
claude mcp add react_atlas -- react-atlas server   # MCP over stdio
```

Commit `.react_atlas/patterns/` and `config.json`; the rest is git-ignored. Check `designSystem.paths` in `config.json`.

CLI: `react-atlas audit [paths...]` (exit 1 on error findings), `react-atlas acceptance [--eval]`.

## Skills

- `react-atlas-discover`: first use in a project; maps patterns and purposes through the MCP tools.
- `react-atlas-learn`: before merging a branch; finds missed reuse and audit misses and calls `record_learning`.

## Improvement round

Misses are recorded centrally in this repo, not in the target project.

1. Read `learnings/open.jsonl`.
2. Fix the tool.
3. Prove `react-atlas acceptance` passes in the affected project (fixtures: `test/acceptance/<project>.jsonl`, project = `package.json` name sanitized to `[a-z0-9_-]`).
4. Move resolved lines to `learnings/resolved.jsonl` with the fixing commit sha.

`react-atlas acceptance --eval` ranks `test/acceptance/<project>_eval.jsonl` queries (hit@1/5/10, MRR) and never fails.

Tests: `npm test`.
