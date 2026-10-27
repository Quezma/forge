#!/usr/bin/env bash
# shellcheck disable=SC2034 # MODULE_* are read by ./setup
MODULE_NAME=skills
MODULE_DESC="Symlink repo skills into ~/.claude/skills (and ~/.agents/skills for Codex)"
MODULE_DEFAULT=on
MODULE_DEPS=""

# Codex reads user skills from ~/.agents/skills (~/.codex/skills is deprecated).
_skill_dirs() {
  echo "$HOME/.claude/skills"
  if [ -d "$HOME/.codex" ] || has codex; then echo "$HOME/.agents/skills"; fi
}

# Only names present in the repo are touched; other skills there are left alone.
skills_status() {
  local n=0 ok=0 s d
  for d in $(_skill_dirs); do
    for s in "$REPO"/skills/*/; do
      s="${s%/}"; n=$((n + 1))
      [ "$(readlink "$d/${s##*/}" 2>/dev/null)" = "$s" ] && ok=$((ok + 1))
    done
  done
  if [ "$n" -gt 0 ] && [ "$ok" -eq "$n" ]; then echo installed; elif [ "$ok" -eq 0 ]; then echo missing; else echo partial; fi
}

skills_install() {
  local s name dest ts d
  ts="$(date +%s)"
  for d in $(_skill_dirs); do
    run mkdir -p "$d"
    for s in "$REPO"/skills/*/; do
      s="${s%/}"; name="${s##*/}"; dest="$d/$name"
      [ "$(readlink "$dest" 2>/dev/null)" = "$s" ] && continue
      if [ -L "$dest" ]; then run rm "$dest"
      elif [ -e "$dest" ]; then run mv "$dest" "$dest.bak.$ts"; fi
      run ln -s "$s" "$dest"
    done
  done
}
