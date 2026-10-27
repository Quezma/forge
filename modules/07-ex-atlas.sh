#!/usr/bin/env bash
# shellcheck disable=SC2034 # MODULE_* are read by ./setup
MODULE_NAME=ex-atlas
MODULE_DESC="Elixir pattern index as a Mix archive (tools/ex_atlas)"
MODULE_DEFAULT=off
MODULE_DEPS="prerequisites"

ex_atlas_status() {
  if ls "$HOME"/.mix/archives/ex_atlas-* >/dev/null 2>&1; then echo installed; else echo missing; fi
}

ex_atlas_install() {
  local src="$REPO/tools/ex_atlas" work ez ver
  ver="$(sed -n 's/^ *version: "\(.*\)",$/\1/p' "$src/mix.exs" | head -1)"
  work="${TMPDIR:-/tmp}/claude-setup-ex_atlas"
  ez="$work/ex_atlas-$ver.ez"
  has mix || brew_install elixir
  run mkdir -p "$work"
  # build outside the repo so tools/ stays clean
  run_in "$src" env MIX_BUILD_PATH="$work/_build" mix archive.build -o "$ez"
  run_in "$src" mix archive.install "$ez" --force
  followup "ex_atlas: per project run 'mix ex_atlas.install' (its MCP server needs a Mix project, so it is not global); rebuild after Elixir/OTP upgrades"
}
