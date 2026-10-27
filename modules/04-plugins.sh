#!/usr/bin/env bash
# shellcheck disable=SC2034 # MODULE_* are read by ./setup
MODULE_NAME=plugins
MODULE_DESC="Claude Code marketplaces and plugins from plugins.json"
MODULE_DEFAULT=on
MODULE_DEPS="prerequisites claude-config"

_plugins_list() {
  python3 - "$REPO/plugins.json" "$HOME" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
for s in d["marketplaces"].values():
    print("M", s.get("repo") or s.get("path", "").replace("__HOME__", sys.argv[2]))
for p in d["plugins"]:
    print("P", p)
PY
}

plugins_status() {
  local f="$HOME/.claude/plugins/installed_plugins.json" n=0 ok=0 kind arg
  has python3 || { echo missing; return; }
  while read -r kind arg; do
    [ "$kind" = P ] || continue
    n=$((n + 1)); { [ -f "$f" ] && grep -qF "\"$arg\"" "$f"; } && ok=$((ok + 1))
  done < <(_plugins_list)
  if [ "$ok" -eq "$n" ]; then echo installed; elif [ "$ok" -eq 0 ]; then echo missing; else echo partial; fi
}

plugins_install() {
  local kind arg
  if ! has claude && [ "$DRY_RUN" != 1 ]; then
    followup "plugins skipped: install Claude Code (claude CLI), then run ./setup --only plugins"
    return 0
  fi
  while read -r kind arg; do
    if [ "$kind" = M ]; then try claude plugin marketplace add "$arg"
    else try claude plugin install "$arg"; fi
  done < <(_plugins_list)
}
