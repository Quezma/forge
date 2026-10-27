#!/usr/bin/env bash
# shellcheck disable=SC2034 # MODULE_* are read by ./setup
MODULE_NAME=mcp
MODULE_DESC="Global MCP servers from mcp.json (context7, codegraph, figma, stitch)"
MODULE_DEFAULT=on
MODULE_DEPS="prerequisites"

# Servers owned by a tool module are not merged here.
_mcp_servers() { mcp_names "$REPO/mcp.json" | grep -vx -e qa-engineer -e react_atlas; }

mcp_status() {
  local n=0 ok=0 s
  has python3 || { echo missing; return; }
  for s in $(_mcp_servers); do n=$((n + 1)); mcp_present "$s" && ok=$((ok + 1)); done
  if [ "$ok" -eq "$n" ]; then echo installed; elif [ "$ok" -eq 0 ]; then echo missing; else echo partial; fi
}

mcp_install() {
  local s
  for s in $(_mcp_servers); do json_merge_mcp "$s" "$REPO/mcp.json"; done
  # codegraph lives in ~/.codegraph/versions/<v> with a bundled node (npm package
  # @colbymchenry/codegraph); the exact installer used is not recorded, so no guess.
  has codegraph || followup "codegraph not found: install it so 'codegraph' is on PATH (npm package @colbymchenry/codegraph), then ./setup --only mcp"
  followup "figma and stitch: run /mcp inside Claude Code to log in"
}
