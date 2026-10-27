#!/usr/bin/env bash
# shellcheck disable=SC2034 # MODULE_* are read by ./setup
MODULE_NAME=skills
MODULE_DESC="Symlink repo skills into ~/.claude/skills (edits stay in the repo)"
MODULE_DEFAULT=on
MODULE_DEPS=""

# Only names present in the repo are touched; other skills there are left alone.
skills_status() {
  local n=0 ok=0 s
  for s in "$REPO"/skills/*/; do
    s="${s%/}"; n=$((n + 1))
    [ "$(readlink "$HOME/.claude/skills/${s##*/}" 2>/dev/null)" = "$s" ] && ok=$((ok + 1))
  done
  if [ "$n" -gt 0 ] && [ "$ok" -eq "$n" ]; then echo installed; elif [ "$ok" -eq 0 ]; then echo missing; else echo partial; fi
}

skills_install() {
  local s name dest ts
  ts="$(date +%s)"
  run mkdir -p "$HOME/.claude/skills"
  for s in "$REPO"/skills/*/; do
    s="${s%/}"; name="${s##*/}"; dest="$HOME/.claude/skills/$name"
    [ "$(readlink "$dest" 2>/dev/null)" = "$s" ] && continue
    if [ -L "$dest" ]; then run rm "$dest"
    elif [ -e "$dest" ]; then run mv "$dest" "$dest.bak.$ts"; fi
    run ln -s "$s" "$dest"
  done
}
