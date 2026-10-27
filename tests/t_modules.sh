#!/usr/bin/env bash
# Tests against the real modules.
ALL_MODULES="prerequisites claude-config skills plugins mcp react-atlas ex-atlas qa-engineer"

test_list_shows_all_modules_with_status() {
  out="$("$REPO/setup" --list)"
  for m in $ALL_MODULES; do
    line="$(printf '%s\n' "$out" | grep -- " $m " || true)"
    [ -n "$line" ] || { echo "no line for $m in: $out" >&2; return 1; }
    case "$line" in *installed*|*partial*|*missing*) ;; *) echo "no status: $line" >&2; return 1 ;; esac
  done
}

test_only_react_atlas_dry_run_adds_deps_and_touches_nothing() {
  out="$("$REPO/setup" --only react-atlas --dry-run)"
  assert_contains "$out" "==> prerequisites"
  assert_contains "$out" "==> react-atlas"
  assert_contains "$out" "+ npm link"
  assert_contains "$out" "react_atlas"
  stray="$(find "$HOME" ! -path "$HOME" ! -path "$HOME/.config" ! -path "$HOME/.config/claude-setup*")"
  assert_eq "$stray" ""
}


test_claude_config_dry_run_lists_home_substitution() {
  out="$("$REPO/setup" --only claude-config --dry-run)"
  assert_contains "$out" "__HOME__"
  assert_contains "$out" "$HOME/.claude/settings.json"
  assert_absent "$out" "brew install"
}

test_skills_links_repo_skills_and_backs_up_real_dirs() {
  mkdir -p "$HOME/.claude/skills/elixir-audit"
  echo mine >"$HOME/.claude/skills/elixir-audit/SKILL.md"
  "$REPO/setup" --only skills >/dev/null
  assert_eq "$(readlink "$HOME/.claude/skills/elixir-audit")" "$REPO/skills/elixir-audit"
  assert_eq "$(readlink "$HOME/.claude/skills/qa-engineer")" "$REPO/skills/qa-engineer"
  ls -d "$HOME"/.claude/skills/elixir-audit.bak.* >/dev/null
  out="$("$REPO/setup" --only skills)" # re-run: no new backups
  assert_eq "$(find "$HOME/.claude/skills" -maxdepth 1 -name 'elixir-audit.bak.*' | wc -l | tr -d ' ')" "1"
  listing="$("$REPO/setup" --list)"
  printf '%s\n' "$listing" | grep -Eq ' skills +installed' 
}

test_react_atlas_dry_run_registers_mcp_and_no_own_claude_block() {
  out="$("$REPO/setup" --only react-atlas --dry-run)"
  assert_contains "$out" "+ npm ci"
  assert_contains "$out" "merge MCP server react_atlas"
  assert_absent "$out" "insert block react_atlas"
}

test_react_atlas_rule_survives_claude_config_rerender() {
  . "$REPO/lib/common.sh"
  _insert_block "$HOME/.claude/CLAUDE.md" react_atlas "keep me"
  render_template "$REPO/claude/CLAUDE.md" "$HOME/.claude/CLAUDE.md"
  assert_contains "$(cat "$HOME/.claude/CLAUDE.md")" "keep me"
  render_template "$REPO/claude/CLAUDE.md" "$HOME/.claude/CLAUDE.md"
  assert_eq "$(find "$HOME/.claude" -maxdepth 1 -name 'CLAUDE.md.bak.*' | wc -l | tr -d ' ')" "1"
}

test_mcp_and_tool_modules_dry_run() {
  out="$("$REPO/setup" --only mcp,ex-atlas,qa-engineer,plugins --dry-run)"
  assert_contains "$out" "mix archive.install"
  assert_contains "$out" "go build"
  assert_contains "$out" "claude plugin install"
  assert_contains "$out" "merge MCP server context7"
  assert_eq "$(printf '%s\n' "$out" | grep -c 'merge MCP server qa-engineer')" "1" # owned by its module only
}

test_no_secret_in_tracked_or_new_files() {
  needle="AQ.Ab""8"
  if git -C "$REPO" grep -qF --untracked "$needle"; then echo "secret found" >&2; return 1; fi
}

test_install_sh_is_a_shim_to_setup() {
  assert_contains "$(cat "$REPO/install.sh")" "exec \"\$(dirname \"\$0\")/setup\""
}

test_snapshot_skips_repo_symlinks_and_excludes_react_atlas() {
  cp="$HOME/repo"; mkdir -p "$cp"
  rsync -a --exclude .git --exclude tools "$REPO/" "$cp/"
  c="$HOME/.claude"; mkdir -p "$c/skills" "$c/plugins"
  echo x >"$c/CLAUDE.md"; echo '{}' >"$c/settings.json"
  ln -s "$cp/skills/elixir-audit" "$c/skills/elixir-audit"
  mkdir "$c/skills/new-one"; echo y >"$c/skills/new-one/SKILL.md"
  echo '{}' >"$c/plugins/known_marketplaces.json"; echo '{"plugins":{}}' >"$c/plugins/installed_plugins.json"
  echo '{"mcpServers":{"react_atlas":{"command":"x"},"keep":{"command":"y"}}}' >"$HOME/.claude.json"
  "$cp/snapshot.sh" >/dev/null
  [ -f "$cp/skills/elixir-audit/SKILL.md" ] # not deleted, not copied onto itself
  [ ! -e "$cp/skills/new-one" ] # skills not already owned by the repo are never imported
  assert_contains "$(cat "$cp/mcp.json")" '"keep"'
  assert_absent "$(cat "$cp/mcp.json")" "react_atlas"
}

test_snapshot_only_resyncs_owned_skills_and_copies_only_mods() {
  cp="$HOME/repo"; mkdir -p "$cp"
  rsync -a --exclude .git --exclude tools "$REPO/" "$cp/"
  c="$HOME/.claude"; mkdir -p "$c/skills/pm-plan" "$c/skills/synced/x" "$c/skills/keep-me" "$c/skills/qa-engineer" "$c/helpers" "$c/agents" "$c/hooks" "$c/commands" "$c/output-styles" "$c/mods" "$c/plugins"
  echo x >"$c/CLAUDE.md"; echo '{}' >"$c/settings.json"
  for f in pm-plan synced/x keep-me qa-engineer; do echo s >"$c/skills/$f/SKILL.md"; done
  for d in agents hooks commands output-styles helpers; do echo h >"$c/$d/f"; done
  echo m >"$c/mods/m.js"
  echo '{}' >"$c/plugins/known_marketplaces.json"; echo '{"plugins":{}}' >"$c/plugins/installed_plugins.json"
  echo '{"mcpServers":{}}' >"$HOME/.claude.json"
  "$cp/snapshot.sh" >/dev/null
  assert_eq "$(cat "$cp/skills/qa-engineer/SKILL.md")" "s" # owned skill is re-synced
  [ ! -e "$cp/skills/keep-me" ] && [ ! -e "$cp/skills/pm-plan" ] && [ ! -e "$cp/skills/synced" ] && [ ! -e "$cp/claude/helpers" ]
  [ -f "$cp/claude/mods/m.js" ]
  for d in agents hooks commands output-styles; do [ ! -e "$cp/claude/$d" ] || { echo "$d copied" >&2; return 1; }; done
}

test_snapshot_drops_third_party_and_private_settings() {
  cp="$HOME/repo"; mkdir -p "$cp"
  rsync -a --exclude .git --exclude tools "$REPO/" "$cp/"
  c="$HOME/.claude"; mkdir -p "$c/skills" "$c/plugins"
  printf 'mine\n<!-- gentle-ai:persona -->\nx\n<!-- /gentle-ai:persona -->\n<!-- claude-setup:rules:start -->\nr\n<!-- claude-setup:rules:end -->\nend\n' >"$c/CLAUDE.md"
  echo '{"autoMode":{"environment":["x"]},"outputStyle":"N","hooks":{"Stop":[{"hooks":[{"command":"gentle-ai x"}]},{"hooks":[{"command":"mine.sh"}]}],"SessionStart":[{"hooks":[{"command":"gentle-ai y"}]}]},"enabledPlugins":{"engram@engram":true,"keep@m":true},"extraKnownMarketplaces":{"engram":{},"m":{}}}' >"$c/settings.json"
  echo '{"engram":{"source":{}},"m":{"source":{}}}' >"$c/plugins/known_marketplaces.json"
  echo '{"plugins":{"engram@engram":[],"keep@m":[]}}' >"$c/plugins/installed_plugins.json"
  echo '{"mcpServers":{"engram":{"command":"engram"},"keep":{"command":"k"}}}' >"$HOME/.claude.json"
  "$cp/snapshot.sh" >/dev/null
  claude="$(cat "$cp/claude/CLAUDE.md")"
  assert_absent "$claude" "gentle-ai"
  assert_contains "$claude" "mine"
  assert_contains "$claude" "claude-setup:rules:start"
  st="$(cat "$cp/claude/settings.json")"
  for w in autoMode outputStyle gentle-ai engram; do assert_absent "$st" "$w"; done
  assert_contains "$st" "mine.sh"
  assert_contains "$st" "keep@m"
  assert_absent "$(cat "$cp/mcp.json")" "engram"
  assert_absent "$(cat "$cp/plugins.json")" "engram"
  assert_contains "$(cat "$cp/plugins.json")" "keep@m"
}

test_claude_config_does_not_install_helpers() {
  out=$("$REPO/setup" --only claude-config --dry-run 2>&1)
  assert_absent "$out" "helpers"
}

test_snapshot_strips_brew_prefix_from_mcp_commands() {
  cp="$HOME/repo"; mkdir -p "$cp"
  rsync -a --exclude .git --exclude tools "$REPO/" "$cp/"
  c="$HOME/.claude"; mkdir -p "$c/skills" "$c/plugins"
  echo x >"$c/CLAUDE.md"; echo '{}' >"$c/settings.json"
  echo '{}' >"$c/plugins/known_marketplaces.json"; echo '{"plugins":{}}' >"$c/plugins/installed_plugins.json"
  echo '{"mcpServers":{"codegraph":{"command":"/opt/homebrew/bin/codegraph"},"old":{"command":"/usr/local/bin/x"}}}' >"$HOME/.claude.json"
  "$cp/snapshot.sh" >/dev/null
  assert_contains "$(cat "$cp/mcp.json")" '"command": "codegraph"'
  assert_absent "$(cat "$cp/mcp.json")" "/usr/local/bin"
}

test_render_keeps_foreign_marker_blocks_verbatim_and_idempotent() {
  . "$REPO/lib/common.sh"
  d="$HOME/.claude"; mkdir -p "$d"
  cat >"$d/CLAUDE.md" <<'M'
old text
<!-- gentle-ai:persona -->
persona body
<!-- /gentle-ai:persona -->

<!-- gentle-ai:agent-routing -->
routing
<!-- gentle-ai:remote-authorization -->
nested body
<!-- /gentle-ai:remote-authorization -->
tail
<!-- /gentle-ai:agent-routing -->
M
  _insert_block "$d/CLAUDE.md" claude-setup:rules "my rules"
  render_template "$REPO/claude/CLAUDE.md" "$d/CLAUDE.md"
  out="$(cat "$d/CLAUDE.md")"
  assert_contains "$out" $'<!-- gentle-ai:persona -->\npersona body\n<!-- /gentle-ai:persona -->'
  assert_contains "$out" $'<!-- gentle-ai:remote-authorization -->\nnested body\n<!-- /gentle-ai:remote-authorization -->\ntail\n<!-- /gentle-ai:agent-routing -->'
  assert_contains "$out" "my rules"
  assert_absent "$out" "old text"
  assert_eq "$(grep -c 'gentle-ai:remote-authorization -->' "$d/CLAUDE.md")" "2"
  render_template "$REPO/claude/CLAUDE.md" "$d/CLAUDE.md"
  assert_eq "$(grep -c 'gentle-ai:persona -->' "$d/CLAUDE.md")" "2"
  assert_eq "$(find "$d" -maxdepth 1 -name 'CLAUDE.md.bak.*' | wc -l | tr -d ' ')" "1"
}
