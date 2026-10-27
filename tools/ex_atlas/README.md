# ex_atlas

A Mix archive that indexes an Elixir project and serves the index plus pattern knowledge to AI agents over MCP. Zero dependencies in target projects.

## Install

```sh
mix archive.build && mix archive.install ex_atlas-0.1.0.ez --force
```

Rebuild and reinstall the archive after every Elixir/OTP upgrade.

## Per-project setup

In each project root:

```sh
mix ex_atlas.install
mix ex_atlas.index                               # build the index once; the server never compiles at startup
claude mcp add ex_atlas -- mix ex_atlas.server   # the command install prints
```

`mix ex_atlas.install` creates `.ex_atlas/.gitignore` (the index is ignored, `.ex_atlas/patterns/` is committed) and adds agent instructions to `AGENTS.md`. Re-running it is safe. If `CLAUDE.md` exists, add `@AGENTS.md` to it so Claude Code sees the instructions.

The server answers immediately and loads the saved index (or builds one if missing) on the first tool call.

## Discovery

To seed pattern knowledge for a project, run the `ex-atlas-discover` skill in your agent.

## Improvement round

1. Read `learnings/open.jsonl`.
2. Fix the tool.
3. Prove `mix ex_atlas.acceptance` passes in the affected project.
4. Move resolved lines to `learnings/resolved.jsonl` with the fixing commit sha.
