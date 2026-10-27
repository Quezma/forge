# Forge

**A one-command wizard that sets up Claude Code, its config, skills, plugins, MCP servers and companion tools on a fresh Mac.**

[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
![Platform: macOS](https://img.shields.io/badge/platform-macOS-lightgrey.svg)
![Shell: bash 3.2+](https://img.shields.io/badge/shell-bash%203.2%2B-green.svg)

Forge turns a new machine into a ready-to-work Claude Code environment in one run. It is plain bash, modular, idempotent and safe to re-run, with a `--dry-run` mode that shows every command before anything changes.

## Features

- **Interactive wizard** with module toggles, automatic dependency selection and a clear `ok|failed|skipped` summary.
- **Modular**: each installable unit is one small script in `modules/`; adding your own takes a few lines.
- **Safe by default**: backups of changed files, deep-merged `settings.json`, symlink-guarded state, and nothing destructive on re-run.
- **No secrets in git**: MCP credentials are `${VAR}` placeholders resolved at install time.
- **Round-trip**: `snapshot.sh` exports a machine's current config back into the repo.
- **Tested**: plain bash tests in a temporary `HOME`, plus shellcheck.

## Quick start

Requirements: macOS (works with the system `/bin/bash` 3.2). Everything else (Xcode CLT, Homebrew, git, node, python3) is installed by the `prerequisites` module.

```sh
git clone https://github.com/Quezma/forge.git && cd forge && ./setup
```

## Project layout

```
setup            the wizard (plain bash, works with macOS /bin/bash 3.2)
wizard/          Go + Bubbletea TUI frontend for setup (optional; bash menu is the fallback)
install.sh       shim: exec ./setup
snapshot.sh      export this machine's config back into the repo
lib/common.sh    shared helpers (run, log, followup, json_merge_mcp, insert_block, ...)
modules/NN-*.sh  one installable unit each
tests/           run.sh + t_*.sh (plain bash tests)
claude/          CLAUDE.md, settings.json (with __HOME__), mods
skills/          skills, symlinked into ~/.claude/skills
mcp.json         global MCP servers (secrets are ${VAR} placeholders)
plugins.json     Claude Code marketplaces and plugins
tools/           ex_atlas, react_atlas, qa-engineer (git subtree imports)
```

## Usage

In a terminal, `./setup` opens a full-screen TUI: `↑/↓` or `j/k` move, `space` toggles, `a` all, `n` none, `Enter` continues (welcome, pick, review, live progress, summary), `esc` goes back, `q` quits. Selecting a module also selects its dependencies; deselecting one also deselects the modules that need it. The binary is built with `go build` into `wizard/bin/forge` when Go is installed, else downloaded from the latest GitHub release; if neither works, or `FORGE_NO_TUI=1` is set, or stdin/stdout is not a terminal, you get the plain numbered menu: numbers toggle modules, `a` selects all, `n` none, Enter runs. With `--dry-run` the TUI is only used when `wizard/bin/forge` already exists (nothing is built or downloaded). Dependencies are selected for you. Modules run in numeric order; a failing module does not stop the others, but its dependents are skipped. The summary lists `ok|failed|skipped` and manual follow-ups. Re-running is safe.

| Module | Default | What it does |
|---|---|---|
| prerequisites | on | Xcode CLT, Homebrew, git, node, python3 |
| claude-config | on | `~/.claude` config files (`CLAUDE.md`, `settings.json`, `mods/`; `.bak.<ts>` backup of changed ones; existing `CLAUDE.md` marker blocks and `settings.json` keys, hooks and plugins are kept, with `settings.json` deep-merged) |
| skills | on | symlinks `skills/*` into `~/.claude/skills` (existing real dirs are backed up) |
| plugins | on | marketplaces and plugins from `plugins.json` |
| mcp | on | `mcp.json` servers into `~/.claude.json` (not the tool-owned ones) |
| react-atlas | on | `npm ci && npm link`, global MCP entry (also in Codex when present), agent rules |
| ex-atlas | off | Mix archive; per project run `mix ex_atlas.install` |
| qa-engineer | off | Go binary in `~/.local/bin`, MCP entry (also in Codex when present), agent rules; dashboard via `make build` in its folder |

## Flags

```
./setup --list              modules with status (installed|partial|missing)
./setup --dry-run           print every mutating command as "+ <cmd>"
./setup --yes               no prompts: saved choices, else module defaults
./setup --only a,b          exactly these modules (plus dependencies); implies --yes
```

Choices are saved one per line in `~/.config/claude-setup/choices` (refused if the path or its directory is a symlink). `--dry-run` still saves them.

## Secrets

Never in git. `mcp.json` holds `${VAR}` placeholders (e.g. `STITCH_X_GOOG_API_KEY`). The `mcp` module reads them from the environment, or asks with hidden input when interactive, and writes the value only to `~/.claude.json`. With `--yes` and no value, that server is skipped with a follow-up. figma and stitch also need `/mcp` login inside Claude Code.

## Adding a module

Create `modules/NN-name.sh` (the number is the run order) defining:

```bash
MODULE_NAME=name
MODULE_DESC="one line"
MODULE_DEFAULT=on            # or off
MODULE_DEPS="prerequisites"  # space-separated module names
name_status()  { echo installed; }   # installed|partial|missing, fast, no side effects
name_install() { run echo hi; }      # idempotent; hyphens in the name become underscores
```

Use the helpers from `lib/common.sh` so `--dry-run` works: `run`, `try`, `run_in dir cmd`, `run_sh 'snippet'`, `brew_install`, `json_merge_mcp name file|-`, `insert_block file marker text`, `remove_block file marker`, `codex_mcp_add name cmd args...`, `render_template src dest`, `ask_secret VAR prompt`, `followup "text"`, `log`, `warn`, `has`.

## Agent rules

Global rules for the tools you install live in `rules/<module>.md` (today: `react-atlas`, `ex-atlas`, `qa-engineer`). After the modules run, `./setup` composes the rules of every module that succeeded this run or is already `installed`, in module order, into one block between `<!-- claude-setup:rules:start/end -->` in `~/.claude/CLAUDE.md` and, if `~/.codex` exists or `codex` is on PATH, `~/.codex/AGENTS.md`. Re-runs replace only that block; with no rules left the block is removed. A failed module contributes nothing.

- Edit a tool's rules: change `rules/<module>.md` and re-run `./setup` (any selection; it reuses saved choices with `--yes`).
- Add rules for a module: create `rules/<module-name>.md`, starting with a `## <Tool>` heading, short and imperative.
- Modules that install an MCP also register it in Codex (`codex mcp add`) when Codex is present, so a rule never points at a tool the agent lacks.
- Other marker blocks already in those files (any `<!-- name:start/end -->`) are kept; rules here never move them, and `./setup` never edits them.

## Keeping tools in sync

`tools/*` are subtree imports and the source of truth here. While the originals still exist:

```sh
git subtree pull --prefix tools/react_atlas <path-or-url-of-original> <branch> -m "chore: sync react_atlas"
```

Branches imported: ex_atlas `main`, react_atlas `feat/foundation`, qa-engineer `feat/upload-file-tool`.

## snapshot.sh

`./snapshot.sh` copies the current machine's `~/.claude` config, skills, MCP servers (without `workbench` and `react_atlas`) and plugin list into the repo, replacing `$HOME` with `__HOME__` and secrets with `${VAR}`. It only re-syncs `mods/` and skills already in this repo (symlinked ones are skipped), and drops `autoMode`, `outputStyle`, hooks of other tools and third-party (`engram`) plugin and marketplace entries. It never touches `tools/`. Review `git diff` before committing.

## Tests

```sh
tests/run.sh
shellcheck setup lib/*.sh modules/*.sh snapshot.sh tests/*.sh install.sh
```

Tests use a temporary `HOME` and `--dry-run`; nothing touches your real config.

## Contributing

Issues and pull requests are welcome. Before opening a PR:

1. Keep scripts compatible with macOS `/bin/bash` 3.2.
2. Run `tests/run.sh` and `shellcheck` (see [Tests](#tests)); both must pass.
3. Use [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, ...).
4. Never commit secrets; use `${VAR}` placeholders.

## Credits / third-party

Plugins (`plugins.json`) are installed from their own upstream marketplaces; nothing from them is redistributed here. `tools/qa-engineer/internal/browser/axe.min.js` is [axe-core](https://github.com/dequelabs/axe-core) (MPL-2.0, Deque Systems), kept with its original header.

## License

[Apache-2.0](LICENSE) © Quezma. Third-party components keep their own licenses (see above).
