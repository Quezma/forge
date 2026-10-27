#!/usr/bin/env bash
# shellcheck disable=SC2034 # MODULE_* are read by ./setup
MODULE_NAME=qa-engineer
MODULE_DESC="Browser QA MCP server, Go binary in ~/.local/bin (tools/qa-engineer)"
MODULE_DEFAULT=off
MODULE_DEPS="prerequisites"

qa_engineer_status() {
  if [ -x "$HOME/.local/bin/qa-engineer" ] && mcp_present qa-engineer; then echo installed
  elif [ -x "$HOME/.local/bin/qa-engineer" ] || mcp_present qa-engineer; then echo partial
  else echo missing; fi
}

qa_engineer_install() {
  has go || brew_install go
  run mkdir -p "$HOME/.local/bin"
  run_in "$REPO/tools/qa-engineer" go build -o "$HOME/.local/bin/qa-engineer" ./cmd/qa-engineer
  json_merge_mcp qa-engineer "$REPO/mcp.json"
  codex_mcp_add qa-engineer "$HOME/.local/bin/qa-engineer" mcp
  case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *) followup "add \$HOME/.local/bin to PATH" ;; esac
  followup "qa-engineer web dashboard is not built by the wizard: cd tools/qa-engineer && make build"
}
