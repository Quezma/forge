#!/usr/bin/env bash
# shellcheck disable=SC2034 # MODULE_* are read by ./setup
MODULE_NAME=archify
MODULE_DESC="Archify diagram skill + CLI in ~/.claude/skills/archify (via npx skills)"
MODULE_DEFAULT=on
MODULE_DEPS="prerequisites"

# Installed as a copied dir, not a repo symlink: the skills module and snapshot.sh only touch repo-owned names.
archify_status() {
  if [ -f "$HOME/.claude/skills/archify/bin/archify.mjs" ]; then echo installed; else echo missing; fi
}

archify_install() {
  if ! has npx && [ "$DRY_RUN" != 1 ]; then
    followup "archify skipped: install node (npx), then run ./setup --only archify"
    return 0
  fi
  try npx -y skills add tt-a1i/archify --skill archify --agent claude-code --global --yes
}
