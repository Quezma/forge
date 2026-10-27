#!/usr/bin/env bash
# shellcheck disable=SC2034 # MODULE_* are read by ./setup
MODULE_NAME=react-atlas
MODULE_DESC="React component index, audits and MCP (tools/react_atlas)"
MODULE_DEFAULT=on
MODULE_DEPS="prerequisites"

react_atlas_status() {
  if has react-atlas && mcp_present react_atlas; then echo installed
  elif has react-atlas || mcp_present react_atlas; then echo partial
  else echo missing; fi
}

react_atlas_install() {
  run_in "$REPO/tools/react_atlas" npm ci
  run_in "$REPO/tools/react_atlas" npm link
  json_merge_mcp react_atlas - <<'J'
{"react_atlas": {"type": "stdio", "command": "react-atlas", "args": ["server"]}}
J
  codex_mcp_add react_atlas react-atlas server
  # rules now live in the composed claude-setup:rules block; drop the old per-tool block
  remove_block "$HOME/.claude/CLAUDE.md" react_atlas
}
