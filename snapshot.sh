#!/usr/bin/env bash
# Never touches tools/ (the repo is their source of truth).
# Copy this machine's Claude Code setup into the repo. Secrets are replaced by ${VAR} placeholders.
set -euo pipefail
REPO="$(cd "$(dirname "$0")" && pwd)"
C="$HOME/.claude"
mkdir -p "$REPO/claude" "$REPO/skills"

# Third-party tooling (gentle-ai, engram) is not part of this repo: its marker blocks are dropped.
sed -e "s#$HOME#__HOME__#g" -e '/<!-- gentle-ai:/,/<!-- \/gentle-ai:/d' "$C/CLAUDE.md" > "$REPO/claude/CLAUDE.md"
# Only mods are owned here (agents, commands, hooks, output-styles come from plugins/other tools).
[ -d "$C/mods" ] && rsync -a --delete "$C/mods/" "$REPO/claude/mods/"
# Only skills already in the repo are re-synced; others on this machine belong to other tools.
# -L follows symlinks; skills the wizard symlinked into this repo are skipped (not copied onto themselves).
for d in "$REPO"/skills/*/; do
  n="$(basename "$d")"; src="$C/skills/$n"
  case "$(readlink "$src" 2>/dev/null)" in "$REPO"/skills/*) continue ;; esac
  if [ -d "$src" ]; then rsync -aL --delete "$src/" "$REPO/skills/$n/"; fi
done
rm -rf "$REPO/claude/helpers"

python3 - "$REPO" "$HOME" <<'PY'
import json, re, sys
repo, home = sys.argv[1], sys.argv[2]
# workbench stays out of the repo; react_atlas is registered by its wizard module; engram is third-party
EXCLUDED_MCP = {"workbench", "react_atlas", "engram"}
THIRD_PARTY = "engram"
st = json.load(open(f"{home}/.claude/settings.json"))
for k in ("autoMode", "outputStyle"): st.pop(k, None)  # client environment / removed output style
hooks = {}
for ev, groups in st.pop("hooks", {}).items():
    kept = [g for g in groups if not any("gentle-ai" in h.get("command", "") for h in g.get("hooks", []))]
    if kept: hooks[ev] = kept
if hooks: st["hooks"] = hooks
st["enabledPlugins"] = {k: v for k, v in st.get("enabledPlugins", {}).items() if THIRD_PARTY not in k}
st["extraKnownMarketplaces"] = {k: v for k, v in st.get("extraKnownMarketplaces", {}).items() if THIRD_PARTY not in k}
open(f"{repo}/claude/settings.json", "w").write(json.dumps(st, indent=2).replace(home, "__HOME__") + "\n")
cfg = json.load(open(f"{home}/.claude.json"))
servers = {k: v for k, v in cfg.get("mcpServers", {}).items() if k not in EXCLUDED_MCP}
for s in servers.values():  # brew prefix differs between Apple Silicon and Intel: rely on PATH
    if re.match(r"^/(opt/homebrew|usr/local)/bin/", s.get("command") or ""):
        s["command"] = s["command"].rsplit("/", 1)[1]
for name, s in servers.items():
    for field in ("headers", "env"):
        for k in list(s.get(field) or {}):
            var = re.sub(r"\W", "_", f"{name}_{k}").upper()
            s[field][k] = "${" + var + "}"
            print(f"redacted {name}.{field}.{k} -> ${{{var}}}")
text = json.dumps(servers, indent=2).replace(home, "__HOME__")
open(f"{repo}/mcp.json", "w").write(text + "\n")

markets = json.load(open(f"{home}/.claude/plugins/known_marketplaces.json"))
plugins = json.load(open(f"{home}/.claude/plugins/installed_plugins.json"))["plugins"]
out = {
    "marketplaces": {k: v["source"] for k, v in markets.items() if THIRD_PARTY not in k},
    "plugins": sorted(p for p in plugins if THIRD_PARTY not in p),
}
open(f"{repo}/plugins.json", "w").write(json.dumps(out, indent=2).replace(home, "__HOME__") + "\n")
PY
echo "snapshot done -> $REPO"
