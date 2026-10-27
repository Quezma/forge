#!/usr/bin/env bash
# Core wizard tests: flags, selection, saved choices, failure handling, helpers.
# stub_modules: two throwaway modules so core tests do not depend on the real ones.
stub_modules() {
  d="$HOME/stub-mods"; mkdir -p "$d"
  for n in skills mcp; do
    cat >"$d/1$([ $n = mcp ] && echo 1 || echo 0)-$n.sh" <<M
MODULE_NAME=$n; MODULE_DESC="stub"; MODULE_DEFAULT=on; MODULE_DEPS=""
${n}_status() { echo missing; }
${n}_install() { echo "stub $n"; }
M
  done
  export SETUP_MODULES_DIR="$d"
}

test_choices_saved_then_replayed_by_yes() {
  stub_modules
  "$REPO/setup" --only skills --dry-run >/dev/null
  assert_eq "$(cat "$HOME/.config/claude-setup/choices")" "skills"
  out="$("$REPO/setup" --yes --dry-run)"
  assert_contains "$out" "==> skills"
  assert_absent "$out" "==> mcp"
}

test_choices_file_symlink_is_refused() {
  stub_modules
  mkdir -p "$HOME/.config/claude-setup"
  ln -s /dev/null "$HOME/.config/claude-setup/choices"
  rc=0; out="$("$REPO/setup" --only skills --dry-run 2>&1)" || rc=$?
  [ "$rc" -ne 0 ]
  assert_contains "$out" "refus"
  assert_eq "$(readlink "$HOME/.config/claude-setup/choices")" "/dev/null"
}

test_choices_dir_symlink_is_refused() {
  stub_modules
  mkdir -p "$HOME/.config" "$HOME/elsewhere"
  ln -s "$HOME/elsewhere" "$HOME/.config/claude-setup"
  rc=0; out="$("$REPO/setup" --only skills --dry-run 2>&1)" || rc=$?
  [ "$rc" -ne 0 ]
  assert_contains "$out" "refus"
  [ ! -e "$HOME/elsewhere/choices" ]
}

test_failed_module_skips_dependents() {
  d="$HOME/mods"; mkdir -p "$d"
  cat >"$d/10-bad.sh" <<'M'
MODULE_NAME=bad; MODULE_DESC="fails"; MODULE_DEFAULT=on; MODULE_DEPS=""
bad_status() { echo missing; }
bad_install() { false; }
M
  cat >"$d/20-child.sh" <<'M'
MODULE_NAME=child; MODULE_DESC="needs bad"; MODULE_DEFAULT=on; MODULE_DEPS="bad"
child_status() { echo missing; }
child_install() { echo CHILD-RAN; }
M
  cat >"$d/30-free.sh" <<'M'
MODULE_NAME=free; MODULE_DESC="independent"; MODULE_DEFAULT=on; MODULE_DEPS=""
free_status() { echo missing; }
free_install() { echo FREE-RAN; }
M
  rc=0; out="$(SETUP_MODULES_DIR="$d" "$REPO/setup" --yes 2>&1)" || rc=$?
  [ "$rc" -ne 0 ]
  assert_contains "$out" "failed   bad"
  assert_contains "$out" "skipped  child"
  assert_contains "$out" "FREE-RAN"
  assert_absent "$out" "CHILD-RAN"
}

test_insert_block_is_idempotent_and_replaces() {
  . "$REPO/lib/common.sh"
  f="$HOME/sub/CLAUDE.md"
  insert_block "$f" demo "first"
  insert_block "$f" demo "first"
  assert_eq "$(grep -c 'demo:start' "$f")" "1"
  insert_block "$f" demo "second"
  assert_eq "$(grep -c 'demo:start' "$f")" "1"
  assert_contains "$(cat "$f")" "second"
  assert_absent "$(cat "$f")" "first"
}

test_json_merge_mcp_substitutes_and_skips_unset() {
  . "$REPO/lib/common.sh"
  INTERACTIVE=0
  cat >"$HOME/m.json" <<'J'
{"a": {"type": "http", "url": "https://x", "headers": {"K": "${TEST_SECRET_A}"}},
 "b": {"command": "__HOME__/bin/b"}}
J
  TEST_SECRET_A="s3cr\"et" json_merge_mcp a "$HOME/m.json"
  json_merge_mcp b "$HOME/m.json"
  unset TEST_SECRET_A
  json_merge_mcp a "$HOME/m.json" # already present stays; unset must not clobber
  python3 - "$HOME" <<'P'
import json, sys
h = sys.argv[1]
s = json.load(open(h + "/.claude.json"))["mcpServers"]
assert s["a"]["headers"]["K"] == 's3cr"et', s
assert s["b"]["command"] == h + "/bin/b", s
P
  rm "$HOME/.claude.json"
  json_merge_mcp a "$HOME/m.json" # unset var, non-interactive -> skipped
  [ ! -e "$HOME/.claude.json" ] || ! grep -q '"a"' "$HOME/.claude.json"
}

test_list_porcelain_defaults_then_saved_choices() {
  stub_modules
  out="$("$REPO/setup" --list --porcelain)"
  assert_eq "$(printf '%s\n' "$out" | sed -n 1p)" "$(printf 'skills\tmissing\ton\t1\t\tstub')"
  "$REPO/setup" --only skills --dry-run >/dev/null
  out="$("$REPO/setup" --list --porcelain)"
  assert_eq "$(printf '%s\n' "$out" | sed -n 2p)" "$(printf 'mcp\tmissing\ton\t0\t\tstub')"
}

test_forge_events_wrap_each_module() {
  d="$HOME/mods"; mkdir -p "$d"
  cat >"$d/10-bad.sh" <<'M'
MODULE_NAME=bad; MODULE_DESC="fails"; MODULE_DEFAULT=on; MODULE_DEPS=""
bad_status() { echo missing; }
bad_install() { false; }
M
  cat >"$d/20-child.sh" <<'M'
MODULE_NAME=child; MODULE_DESC="needs bad"; MODULE_DEFAULT=on; MODULE_DEPS="bad"
child_status() { echo missing; }
child_install() { echo CHILD-RAN; }
M
  cat >"$d/30-free.sh" <<'M'
MODULE_NAME=free; MODULE_DESC="independent"; MODULE_DEFAULT=on; MODULE_DEPS=""
free_status() { echo missing; }
free_install() { echo FREE-RAN; }
M
  out="$(FORGE_EVENTS=1 SETUP_MODULES_DIR="$d" "$REPO/setup" --yes 2>&1)" || true
  assert_contains "$out" "@@forge start bad"
  assert_contains "$out" "@@forge result bad failed exit 1"
  assert_contains "$out" "@@forge result child skipped dependency bad did not succeed"
  assert_contains "$out" "@@forge result free ok"
  assert_absent "$out" "@@forge start child"
  out="$(SETUP_MODULES_DIR="$d" "$REPO/setup" --yes 2>&1)" || true
  assert_absent "$out" "@@forge"
}

# fake_tui: a stand-in forge binary that just reports how it was launched.
fake_tui() {
  printf '#!/bin/sh\necho "TUI-LAUNCHED repo=$FORGE_REPO args=$*"\n' >"$HOME/forge"
  chmod +x "$HOME/forge"; export FORGE_BIN="$HOME/forge"
}

test_tui_not_launched_without_tty() {
  stub_modules; fake_tui
  out="$("$REPO/setup" --dry-run </dev/null 2>&1)"
  assert_absent "$out" "TUI-LAUNCHED"
  assert_contains "$out" "==> skills"
}

test_tui_launched_on_tty_and_opt_out() {
  command -v script >/dev/null 2>&1 || return 0
  stub_modules; fake_tui
  out="$(script -q /dev/null "$REPO/setup" --dry-run </dev/null 2>&1)" || true
  assert_contains "$out" "TUI-LAUNCHED repo=$REPO args=--dry-run"
  out="$(FORGE_NO_TUI=1 script -q /dev/null "$REPO/setup" --dry-run </dev/null 2>&1)" || true
  assert_absent "$out" "TUI-LAUNCHED"
  assert_contains "$out" "Select modules"
}

test_tui_skipped_for_only_and_yes() {
  command -v script >/dev/null 2>&1 || return 0
  stub_modules; fake_tui
  out="$(script -q /dev/null "$REPO/setup" --only skills --dry-run </dev/null 2>&1)" || true
  assert_absent "$out" "TUI-LAUNCHED"
  out="$(script -q /dev/null "$REPO/setup" --yes --dry-run </dev/null 2>&1)" || true
  assert_absent "$out" "TUI-LAUNCHED"
}

# The TUI child runs ./setup with INTERACTIVE=1 inherited from the launcher and stdout
# piped; it must not prompt on /dev/tty, which the TUI owns (MCP secret prompt hung).
test_inherited_interactive_is_cleared_when_not_on_a_tty() {
  d="$HOME/mods"; mkdir -p "$d"
  cat >"$d/10-probe.sh" <<'M'
MODULE_NAME=probe; MODULE_DESC="probe"; MODULE_DEFAULT=on; MODULE_DEPS=""
probe_status() { echo missing; }
probe_install() { echo "INTERACTIVE=$INTERACTIVE"; }
M
  out="$(INTERACTIVE=1 SETUP_MODULES_DIR="$d" "$REPO/setup" --only probe </dev/null 2>&1)"
  assert_contains "$out" "INTERACTIVE=0"
}
