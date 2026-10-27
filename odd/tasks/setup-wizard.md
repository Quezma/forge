# setup-wizard

Locator: `odd/tasks/setup-wizard.md` · Memory mirror: `odd/setup-wizard/tasks`

## Objective

One repo (`~/personal/claude-setup`) holding the Claude Code setup and the user's own tools, with an interactive wizard that installs and configures the components the user picks, on any macOS machine.

## Why

The setup and tools live only on one Mac, scattered across `~/.claude`, `~/.agents`, `~/personal/*`, with no remotes. Moving to another computer is manual and error-prone.

## Scope / authorized (user, 2026-10-26)

- In the repo: Claude config (CLAUDE.md, settings, agents, commands, output styles, helpers, mods), skills, plugins list, MCP config, and tools `ex_atlas`, `react_atlas`, `qa-engineer` (from `~/personal/tester`).
- Out: `project_management` (workbench) — not imported, not installed by the wizard; its MCP entry is removed.
- react_atlas MCP registered globally (user scope), plus a global CLAUDE.md rule; no per-project registration.
- Originals stay untouched: tools are imported with `git subtree` (history kept); uncommitted WIP in `ex_atlas` (learnings) and `tester` (security/pentest tools) stays in the originals and is pulled later with `git subtree pull`.
- No remote / push: user's call (GitHub account not chosen yet).

## Decisions (parent's calls, user skipped questions)

- Wizard: plain bash compatible with macOS bash 3.2 (the only thing guaranteed on a fresh Mac); one file per module under `modules/`; checkbox menu; choices saved to `~/.config/claude-setup/choices`; `--yes` replays saved choices non-interactively; `--dry-run` prints actions without executing them.
- Secrets are prompted at install time (hidden input) or read from env; never written to the repo.
- Imported refs: ex_atlas `main`, react_atlas `feat/foundation`, qa-engineer `feat/upload-file-tool` (contains `feat/qa-engineer-mcp`; matches the installed binary's tools).

## TDD

Mode: strict (global CLAUDE.md). Runner: `tests/run.sh` (plain bash assertions; runs the wizard against a temp `HOME` with `--dry-run`), plus `shellcheck` on all scripts.

## Delivery

Strategy: ask-on-risk. The subtree imports are large by line count but are imported history, not authored lines; authored work is the wizard (~400-600 lines). Branch `feat/setup-wizard`; work-unit commits; no push.

## Tasks

- [x] T1 Baseline: initial commit of the existing snapshot on `main`; branch `feat/setup-wizard`; drop the workbench MCP entry (and keep snapshot.sh from re-adding it). Route: inline (git state + 2 small edits).
- [x] T2 Import tools with `git subtree add` into `tools/ex_atlas`, `tools/react_atlas`, `tools/qa-engineer`. Route: inline (git ops).
- [x] T3 Wizard core: `setup` entry, module contract, checkbox menu, saved choices, `--yes`, `--dry-run`, status per module; tests. Route: delegated (writer trigger).
- [x] T4 Modules: prerequisites (brew, git, node; elixir/go on demand), claude-config, skills, plugins, mcp (memory, external-tool, context7, codegraph, figma, stitch), react-atlas (npm link + global MCP + CLAUDE.md rule), ex-atlas (mix archive), qa-engineer (go build -> ~/.local/bin). Route: delegated.
- [x] T5 snapshot.sh for the new layout (tools/ are the source of truth; never overwritten by a snapshot) + README. Route: delegated with T4 or inline.
- [x] T5.1 Leave out (user, 2026-10-26): `skills/pm-*` (need workbench), `skills/synced/` (Claude-managed account sync; third-party skill-creator flagged by security review), `claude/helpers/` (unreferenced in settings.json; its "dangerous command" hook exits 1, which never blocks, then forces exit 0). Remove from repo and exclude in snapshot.sh. Route: inline after T3-T5 writer returns.
- [x] T7 Global agent rules (user: global, not per project): `rules/<module>.md` per module (react_atlas, codegraph, memory, qa-engineer, ex_atlas, ...); the wizard composes the selected modules' rules into one marked block in `~/.claude/CLAUDE.md` and, when Codex is present, `~/.codex/AGENTS.md`; re-runs replace only that block. Extract module-specific rules currently inlined in `claude/CLAUDE.md` into `rules/` (respecting external-tool-managed sections). Route: delegated after T5.1.
- [x] T6 Verification: full `--dry-run` under a temp HOME; real run of safe modules under a temp HOME. Route: per-action.

## Acceptance criteria

On a fresh `HOME`, `./setup` shows every module with its status, installs only the selected ones, can be re-run safely, and `./setup --yes` repeats the last selection without prompts. No secret lands in git.

## Progress / evidence

- T1 (inline): fee89ff initial snapshot on main; b80b023 on feat/setup-wizard drops workbench (mcp.json, install.sh, snapshot.sh EXCLUDED_MCP).
- T2 (inline): 1fa9a93 ex_atlas, eaf2e8f react_atlas, 75f40a0 qa-engineer via `git subtree add` (336K/364K/1.0M). Originals untouched (dirty counts unchanged: ex_atlas 4, tester 6). History secret scan: clean.
- Snapshot refresh adds react-atlas skills (commit after T2).
- T3-T5 (delegated, writer trigger): 128bc4a core, 9e822d4 modules, 675fd90 snapshot+docs+install.sh shim. RED: 8 core tests failing (missing setup/lib), then 7 module tests. GREEN 16/16, shellcheck clean. Parent spot check: 16/16; `--list` on temp HOME shows 8 modules with status. Not verifiable without real installs: brew/npm/mix/go/claude plugin paths (dry-run only); codegraph installer unidentified (followup).
- T5.1 (inline): 971d0b8 removes skills/pm-*, skills/synced, claude/helpers and excludes them in snapshot.sh; MCP commands under brew prefixes stored as bare names (memory) for Intel/Apple Silicon. RED 2+1 failing; GREEN 19/19, shellcheck ok.
- T7 design finding: CLAUDE.md and ~/.codex/AGENTS.md are mostly external-tool-managed blocks; rules/ covers only the user's own tools (react-atlas, ex-atlas, qa-engineer); Codex gets the MCPs registered too so rules never reference missing tools.
- T7 (delegated, writer trigger): 59fcba0. rules/{react-atlas,ex-atlas,qa-engineer}.md, compose_rules/write_rules, Codex MCP registration. RED 10 failing; GREEN 30/30, shellcheck clean. Real write_rules on temp HOME kept seeded external-tool markers byte-for-byte.
- T6 (parent): `tests/run.sh` 30/30; shellcheck clean; `HOME=<empty> ./setup --yes --dry-run` exit 0, 6 default modules ok, rules block targeted at .claude/CLAUDE.md and .codex/AGENTS.md; only file created: ~/.config/claude-setup/choices (plus Homebrew's own API cache from read-only brew queries). Real installs (brew/npm link/mix/go/claude plugin/codex mcp) NOT exercised: they would mutate this machine's global state; first real run belongs on the new machine or with the user's go-ahead here.
- Memory mirror: pending (earlier saves failed: multiple active sessions).

## Next step

Done on branch. User decisions: GitHub remote + push; whether to run `./setup` for real on this Mac (it would replace ~/.claude/skills dirs with repo symlinks, backing up the originals).
