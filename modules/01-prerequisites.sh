#!/usr/bin/env bash
# shellcheck disable=SC2034 # MODULE_* are read by ./setup
MODULE_NAME=prerequisites
MODULE_DESC="Xcode CLT, Homebrew, git, node, python3"
MODULE_DEFAULT=on
MODULE_DEPS=""

prerequisites_status() {
  local ok=0 n=0 t
  xcode-select -p >/dev/null 2>&1 && ok=$((ok + 1)); n=$((n + 1))
  for t in brew git node python3; do has "$t" && ok=$((ok + 1)); n=$((n + 1)); done
  if [ "$ok" -eq "$n" ]; then echo installed; elif [ "$ok" -eq 0 ]; then echo missing; else echo partial; fi
}

prerequisites_install() {
  if ! xcode-select -p >/dev/null 2>&1; then
    run xcode-select --install || true
    followup "Xcode Command Line Tools: finish the macOS installer dialog, then re-run ./setup"
    [ "$DRY_RUN" = 1 ] || return 1
  fi
  if ! has brew; then
    # shellcheck disable=SC2016 # expanded by run_sh, not here
    run_sh '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'
    [ "$DRY_RUN" = 1 ] || ensure_brew_path
  fi
  has git || brew_install git
  has node || brew_install node
  has python3 || brew_install python
}
