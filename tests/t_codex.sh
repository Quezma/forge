#!/usr/bin/env bash
# Codex side of the skills and mcp modules.

# fake_codex: `codex mcp get NAME` succeeds only when config.toml already has that server.
fake_codex() {
  b="$HOME/bin"; mkdir -p "$b"
  cat >"$b/codex" <<'SH'
#!/bin/sh
[ "$1 $2" = "mcp get" ] && grep -qF "[mcp_servers.\"$3\"]" "$HOME/.codex/config.toml" 2>/dev/null
SH
  chmod +x "$b/codex"
  PATH="$b:$PATH"
}

test_skills_link_into_agents_skills_only_with_codex() {
  . "$REPO/lib/common.sh"; . "$REPO/modules/03-skills.sh"
  has() { return 1; }
  skills_install
  [ ! -e "$HOME/.agents" ]
  assert_eq "$(skills_status)" installed
  mkdir "$HOME/.codex"
  assert_eq "$(skills_status)" partial
  skills_install
  assert_eq "$(readlink "$HOME/.agents/skills/qa-engineer")" "$REPO/skills/qa-engineer"
  assert_eq "$(skills_status)" installed
}

test_codex_mcp_merge_writes_toml_once_and_skips_unset_secrets() {
  . "$REPO/lib/common.sh"; fake_codex
  export STITCH_X_GOOG_API_KEY='k"1'
  for s in codegraph stitch qa-engineer codegraph; do codex_mcp_merge "$s" "$REPO/mcp.json"; done
  t="$(cat "$HOME/.codex/config.toml")"
  assert_eq "$(grep -cF '[mcp_servers."codegraph"]' "$HOME/.codex/config.toml")" "1"
  assert_contains "$t" 'command = "codegraph"'
  assert_contains "$t" 'args = ["serve", "--mcp"]'
  assert_contains "$t" 'url = "https://stitch.googleapis.com/mcp"'
  assert_contains "$t" 'http_headers = { "X-Goog-Api-Key" = "k\"1" }'
  assert_contains "$t" "command = \"$HOME/.local/bin/qa-engineer\""
  assert_absent "$t" 'type ='
  assert_absent "$t" 'env ='
  . "$REPO/modules/05-mcp.sh"
  assert_eq "$(mcp_status)" partial # nothing in ~/.claude.json, codegraph+stitch in Codex
  rm "$HOME/.codex/config.toml"; unset STITCH_X_GOOG_API_KEY
  codex_mcp_merge stitch "$REPO/mcp.json"
  [ ! -e "$HOME/.codex/config.toml" ]
}

test_mcp_dry_run_lists_codex_servers_without_tool_owned_ones() {
  fake_codex
  out="$("$REPO/setup" --only mcp --dry-run)"
  assert_contains "$out" "+ add MCP server context7 to $HOME/.codex/config.toml"
  assert_absent "$out" "add MCP server qa-engineer to"
  [ ! -e "$HOME/.codex/config.toml" ]
}
