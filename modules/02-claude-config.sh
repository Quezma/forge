#!/usr/bin/env bash
# shellcheck disable=SC2034 # MODULE_* are read by ./setup
MODULE_NAME=claude-config
MODULE_DESC="CLAUDE.md, settings.json and mods in ~/.claude"
MODULE_DEFAULT=on
MODULE_DEPS="prerequisites"

claude_config_status() {
  local s="$HOME/.claude/settings.json"
  if [ -f "$s" ]; then echo installed; else echo missing; fi
}

claude_config_install() {
  run mkdir -p "$HOME/.claude"
  render_template "$REPO/claude/CLAUDE.md" "$HOME/.claude/CLAUDE.md"
  render_template "$REPO/claude/settings.json" "$HOME/.claude/settings.json"
  [ -d "$REPO/claude/mods" ] || return 0
  run mkdir -p "$HOME/.claude/mods"
  run rsync -a "$REPO/claude/mods/" "$HOME/.claude/mods/"
}
