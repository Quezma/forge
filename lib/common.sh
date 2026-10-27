#!/usr/bin/env bash
# Shared helpers for the setup wizard and its modules. bash 3.2 compatible.
# Globals: DRY_RUN (1 = print mutating commands), INTERACTIVE (1 = may prompt),
# FOLLOWUP_FILE (optional file collecting manual follow-ups).

DRY_RUN="${DRY_RUN:-0}"
INTERACTIVE="${INTERACTIVE:-0}"

log()  { printf '%s\n' "$*"; }
warn() { printf '!! %s\n' "$*" >&2; }
die()  { warn "$*"; exit 1; }
has()  { command -v "$1" >/dev/null 2>&1; }

# followup "text": remember a manual step for the final summary.
followup() {
  if [ -n "${FOLLOWUP_FILE:-}" ]; then printf '%s\n' "$1" >>"$FOLLOWUP_FILE"
  else printf 'follow-up: %s\n' "$1"; fi
}

# run cmd...: execute, or print "+ cmd" in dry-run mode.
run() {
  if [ "$DRY_RUN" = 1 ]; then printf '+ %s\n' "$*"; return 0; fi
  "$@"
}

# try cmd...: like run, but a failure only warns.
try() { run "$@" || warn "failed (continuing): $*"; }

# run_in dir cmd...: run inside a directory.
run_in() {
  local dir="$1"; shift
  if [ "$DRY_RUN" = 1 ]; then printf '+ %s\n' "$*"; return 0; fi
  (cd "$dir" && "$@")
}

# run_sh 'string': like run for shell snippets that must not be expanded before use.
run_sh() {
  if [ "$DRY_RUN" = 1 ]; then printf '+ %s\n' "$1"; return 0; fi
  eval "$1"
}

# ask_secret VAR "prompt": keep $VAR if already set, else read it hidden (interactive only).
ask_secret() {
  local var="$1" prompt="$2" val=""
  [ -n "${!var:-}" ] && return 0
  [ "$INTERACTIVE" = 1 ] || return 1
  read -rs -p "$prompt (hidden, Enter to skip): " val </dev/tty || true
  echo >&2
  [ -n "$val" ] || return 1
  export "$var=$val"
}

ensure_brew_path() {
  has brew && return 0
  local b
  for b in /opt/homebrew/bin/brew /usr/local/bin/brew; do
    if [ -x "$b" ]; then eval "$("$b" shellenv)"; return 0; fi
  done
  return 0
}

# brew_install pkg...: install missing formulae (tap-qualified names allowed).
brew_install() {
  local p
  if ! has brew && [ "$DRY_RUN" != 1 ]; then
    warn "brew missing: cannot install $*"
    followup "install manually (Homebrew missing): $*"
    return 0
  fi
  for p in "$@"; do
    if has brew && brew list --formula "${p##*/}" >/dev/null 2>&1; then continue; fi
    run brew install "$p"
  done
}

# --- JSON (python3) -------------------------------------------------------

# mcp_names file: list server names in a {name: server} JSON file.
mcp_names() {
  python3 -c 'import json,sys; print("\n".join(json.load(open(sys.argv[1]))))' "$1"
}

# mcp_present name: is the server in ~/.claude.json?
mcp_present() {
  [ -f "$HOME/.claude.json" ] || return 1
  python3 - "$HOME/.claude.json" "$1" <<'PY'
import json, sys
sys.exit(0 if sys.argv[2] in json.load(open(sys.argv[1])).get("mcpServers", {}) else 1)
PY
}

_MCP_PY='
import json, os, re, sys
act, name, src, home = sys.argv[1:5]
servers = json.load(open(src))
text = json.dumps(servers[name]).replace("__HOME__", json.dumps(home)[1:-1])
need = sorted(set(re.findall(r"\$\{(\w+)\}", text)))
if act == "vars":
    print("\n".join(v for v in need if v not in os.environ))
    sys.exit(0)
text = re.sub(r"\$\{(\w+)\}", lambda m: json.dumps(os.environ[m.group(1)])[1:-1], text)
if act == "toml":  # Codex [mcp_servers.<name>] table; JSON strings/arrays are valid TOML
    s, q = json.loads(text), json.dumps
    tbl = lambda d: "{ " + ", ".join(q(k) + " = " + q(v) for k, v in d.items()) + " }"
    out = ["", "[mcp_servers.%s]" % q(name)]
    if "url" in s:
        out.append("url = " + q(s["url"]))
        if s.get("headers"): out.append("http_headers = " + tbl(s["headers"]))
    else:
        out.append("command = " + q(s["command"]))
        if s.get("args"): out.append("args = " + q(s["args"]))
        if s.get("env"): out.append("env = " + tbl(s["env"]))
    print("\n".join(out))
    sys.exit(0)
path = home + "/.claude.json"
cfg = json.load(open(path)) if os.path.exists(path) else {}
cfg.setdefault("mcpServers", {})[name] = json.loads(text)
tmp = path + ".tmp"
with open(tmp, "w") as f:
    json.dump(cfg, f, indent=2)
os.chmod(tmp, 0o600)  # holds MCP secrets
os.replace(tmp, path)
'

# json_merge_mcp name file: merge one server from a {name: server} file ("-" = stdin)
# into ~/.claude.json. __HOME__ and ${VAR} are substituted; a server with an unset
# ${VAR} is prompted for (interactive) or skipped with a follow-up; a server already in
# ~/.claude.json with an unset ${VAR} is kept as is, without prompting.
json_merge_mcp() {
  local name="$1" file="$2" tmp="" missing v rc=0
  if [ "$file" = "-" ]; then tmp="$(mktemp)"; cat >"$tmp"; file="$tmp"; fi
  if [ "$DRY_RUN" = 1 ]; then
    printf '+ merge MCP server %s into %s/.claude.json\n' "$name" "$HOME"
  else
    missing="$(python3 -c "$_MCP_PY" vars "$name" "$file" "$HOME")"
    if [ -n "$missing" ] && mcp_present "$name"; then # existing install: keep its secret
      log "ok mcp $name (kept existing)"; [ -z "$tmp" ] || rm -f "$tmp"; return 0
    fi
    for v in $missing; do
      ask_secret "$v" "Value for $v (MCP server $name)" || true
    done
    missing="$(python3 -c "$_MCP_PY" vars "$name" "$file" "$HOME")"
    if [ -n "$missing" ]; then
      warn "skipped MCP server $name: set ${missing//$'\n'/ } and re-run"
      followup "MCP server $name skipped: export ${missing//$'\n'/ } and re-run ./setup --only mcp"
    else
      python3 -c "$_MCP_PY" merge "$name" "$file" "$HOME" && log "ok mcp $name" || rc=$?
    fi
  fi
  [ -z "$tmp" ] || rm -f "$tmp"
  return "$rc"
}

# codex_mcp_merge name file: append one server from a {name: server} file to
# ~/.codex/config.toml when Codex is installed and lacks it. Header-carrying HTTP servers
# need config.toml (codex mcp add has no header flag). An unset ${VAR} skips quietly:
# json_merge_mcp already asked for it and recorded the follow-up.
codex_mcp_merge() {
  local name="$1" file="$2" cfg="$HOME/.codex/config.toml"
  has codex || return 0
  codex mcp get "$name" >/dev/null 2>&1 && return 0
  if [ "$DRY_RUN" = 1 ]; then printf '+ add MCP server %s to %s\n' "$name" "$cfg"; return 0; fi
  [ -z "$(python3 -c "$_MCP_PY" vars "$name" "$file" "$HOME")" ] || return 0
  mkdir -p "$HOME/.codex"
  (umask 077; : >>"$cfg"); chmod 600 "$cfg" # holds MCP secrets
  python3 -c "$_MCP_PY" toml "$name" "$file" "$HOME" >>"$cfg" && log "ok codex mcp $name"
}

# --- text blocks ----------------------------------------------------------

# _block_awk marker mode: mode "drop" prints everything but the block, "get" only its body.
_block_awk() {
  awk -v s="<!-- $1:start -->" -v e="<!-- $1:end -->" -v mode="$2" '
    $0 == s { inb = 1; next }
    $0 == e { inb = 0; next }
    (mode == "get") == (inb == 1) { print }'
}

_insert_block() {
  local file="$1" marker="$2" content="$3" tmp
  mkdir -p "$(dirname "$file")"
  [ -f "$file" ] || : >"$file"
  tmp="$(mktemp)"
  if grep -qF "<!-- $marker:start -->" "$file"; then
    # replace in place: keep text before/after the block
    C="$content" awk -v s="<!-- $marker:start -->" -v e="<!-- $marker:end -->" '
      $0 == s { print; print ENVIRON["C"]; inb = 1; next }
      $0 == e { inb = 0 }
      !inb { print }' "$file" >"$tmp"
  else
    { cat "$file"; [ ! -s "$file" ] || echo; printf '<!-- %s:start -->\n%s\n<!-- %s:end -->\n' "$marker" "$content" "$marker"; } >"$tmp"
  fi
  cat "$tmp" >"$file"
  rm -f "$tmp"
}

# insert_block file marker content: idempotent block between marker comments.
insert_block() {
  if [ "$DRY_RUN" = 1 ]; then printf '+ insert block %s into %s\n' "$2" "$1"; return 0; fi
  _insert_block "$1" "$2" "$3"
}

# remove_block file marker: drop the block (and nothing else); no-op if absent.
remove_block() {
  local file="$1" marker="$2" tmp
  [ -f "$file" ] && grep -qF "<!-- $marker:start -->" "$file" || return 0
  if [ "$DRY_RUN" = 1 ]; then printf '+ remove block %s from %s\n' "$marker" "$file"; return 0; fi
  tmp="$(mktemp)"
  _block_awk "$marker" drop <"$file" >"$tmp"
  cat "$tmp" >"$file"
  rm -f "$tmp"
}

# _foreign_blocks template dest: print the top-level `<!-- ns:name -->...<!-- /ns:name -->`
# blocks of dest (nested ones travel with their parent) whose opening line template lacks.
_foreign_blocks() {
  awk -v re='^<!-- [A-Za-z0-9_-]+:[A-Za-z0-9_-]+ -->$' '
    NR == FNR { seen[$0] = 1; next }
    $0 ~ re && $0 !~ /:(start|end) -->$/ { if (!depth++) { keep = !($0 in seen); if (keep) print "" } }
    keep { print }
    $0 ~ /^<!-- \/[A-Za-z0-9_-]+:[A-Za-z0-9_-]+ -->$/ && depth > 0 { depth-- }' "$1" "$2"
}

# _MERGE_PY: deep-merge template (argv[2]) over dest (argv[1]) into argv[3]: objects recurse,
# dest-only keys stay, lists are unioned (dest order first), other values come from the template.
_MERGE_PY='
import json, sys
def merge(d, t):
    if isinstance(d, dict) and isinstance(t, dict):
        return {**{k: merge(v, t[k]) if k in t else v for k, v in d.items()}, **{k: v for k, v in t.items() if k not in d}}
    if isinstance(d, list) and isinstance(t, list):
        return d + [x for x in t if x not in d]
    return t
d, t, out = sys.argv[1:4]
with open(out, "w") as f:
    json.dump(merge(json.load(open(d)), json.load(open(t))), f, indent=2, ensure_ascii=False)
    f.write("\n")
'

# render_template src dest: replace __HOME__, back up a differing dest (.bak.<ts>),
# keep marker blocks (claude-setup:rules start/end, foreign ns:name blocks) that dest has but
# the template lacks, and deep-merge *.json instead of replacing.
render_template() {
  local src="$1" dest="$2" tmp m
  if [ "$DRY_RUN" = 1 ]; then
    printf '+ render %s -> %s (__HOME__ -> %s)\n' "$src" "$dest" "$HOME"; return 0
  fi
  tmp="$(mktemp)"
  sed "s#__HOME__#$HOME#g" "$src" >"$tmp"
  if [ -f "$dest" ]; then
    # shellcheck disable=SC2013 # marker names contain no spaces
    for m in $(grep -o '<!-- [A-Za-z0-9_-]*:start -->' "$dest" | sed 's/<!-- \(.*\):start -->/\1/'); do
      grep -qF "<!-- $m:start -->" "$tmp" || _insert_block "$tmp" "$m" "$(_block_awk "$m" get <"$dest")"
    done
    m="$(_foreign_blocks "$tmp" "$dest")" # captured first: awk must not read what we append
    [ -z "$m" ] || printf '%s\n' "$m" >>"$tmp"
    case "$dest" in *.json)
      cp "$tmp" "$tmp.t"
      python3 -c "$_MERGE_PY" "$dest" "$tmp.t" "$tmp" 2>/dev/null || cp "$tmp.t" "$tmp" # unparsable dest: template wins
      rm -f "$tmp.t" ;;
    esac
    if cmp -s "$tmp" "$dest"; then rm -f "$tmp"; return 0; fi
    cp "$dest" "$dest.bak.$(date +%s)"
  fi
  mkdir -p "$(dirname "$dest")"
  mv "$tmp" "$dest"
}

# --- agent rules (global, composed from rules/<module>.md) -----------------

RULES_MARKER="claude-setup:rules"

# compose_rules module...: header line + rules/<module>.md for each, in the given order.
# Modules without a rules file are skipped; prints nothing if none has rules.
compose_rules() {
  local dir="${SETUP_RULES_DIR:-$REPO/rules}" m out="" sep=""
  for m in "$@"; do
    [ -f "$dir/$m.md" ] || continue
    out="$out$sep$(cat "$dir/$m.md")"; sep=$'\n\n'
  done
  [ -z "$out" ] || printf '%s\n%s\n' '<!-- Generated by claude-setup from rules/*.md; edit the repo, then re-run ./setup. -->' "$out"
}

# write_rules module...: put the composed rules in one marked block in ~/.claude/CLAUDE.md
# and (if Codex is present) ~/.codex/AGENTS.md; no rules -> remove the block. Touches nothing else.
write_rules() {
  local body f files="$HOME/.claude/CLAUDE.md"
  body="$(compose_rules "$@")"
  if [ -d "$HOME/.codex" ] || has codex; then files="$files $HOME/.codex/AGENTS.md"; fi
  for f in $files; do
    if [ -z "$body" ]; then remove_block "$f" "$RULES_MARKER"
    elif [ "$DRY_RUN" = 1 ]; then printf '+ write rules block -> %s (%s)\n' "$f" "$*"
    else _insert_block "$f" "$RULES_MARKER" "$body"; fi
  done
}

# codex_mcp_add name cmd args...: register an MCP server in Codex when it is installed
# (skip if already there). Never calls codex in dry-run.
codex_mcp_add() {
  local name="$1"; shift
  [ "${1:-}" = "--" ] && shift
  has codex || return 0
  if [ "$DRY_RUN" = 1 ]; then printf '+ codex mcp add %s -- %s\n' "$name" "$*"; return 0; fi
  codex mcp get "$name" >/dev/null 2>&1 && return 0
  codex mcp add "$name" -- "$@" || warn "codex mcp add $name failed (continuing)"
}

# --- saved choices --------------------------------------------------------

CHOICES_DIR="$HOME/.config/claude-setup"
CHOICES_FILE="$CHOICES_DIR/choices"

_choices_guard() {
  [ ! -L "$HOME/.config" ] || die "refusing to use choices: $HOME/.config is a symlink"
  [ ! -L "$CHOICES_DIR" ] || die "refusing to use choices: $CHOICES_DIR is a symlink"
  [ ! -L "$CHOICES_FILE" ] || die "refusing to use choices: $CHOICES_FILE is a symlink"
}

# choices_load: print saved module names (nothing if none).
choices_load() { _choices_guard; [ ! -f "$CHOICES_FILE" ] || cat "$CHOICES_FILE"; }

# choices_save name...: write one name per line, atomically, never through a symlink.
choices_save() {
  _choices_guard
  mkdir -p "$CHOICES_DIR"
  local tmp; tmp="$(mktemp "$CHOICES_DIR/.choices.XXXXXX")"
  if [ "$#" -gt 0 ]; then printf '%s\n' "$@" >"$tmp"; else : >"$tmp"; fi
  mv "$tmp" "$CHOICES_FILE"
}
