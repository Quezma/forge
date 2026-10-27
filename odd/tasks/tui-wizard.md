# tui-wizard

Locator: `odd/tasks/tui-wizard.md` · Memory mirror: `odd/tui-wizard/tasks`

## Objective

A modern, keyboard-navigable wizard for Forge: a Go + Bubbletea frontend over the existing bash modules.

## Why

The current wizard is a numbered menu (type numbers, press Enter). The user wants a modern full-screen UI with arrow-key navigation.

## Scope / decisions (user, 2026-10-26)

- Go/Bubbletea binary is a **frontend only**; bash modules, deps closure, run logic and tests stay.
- `./setup` stays the entry point: interactive TTY + `forge` binary available -> exec it; otherwise the existing numbered menu (fallback).
- Binary source: `go build` when Go is available, else GitHub Releases download (`releases/latest/download/forge-darwin-<arch>`), else fallback.
- Screens: welcome -> module picker (arrows/j k, space toggle, a/n, enter) -> review (deps auto-added, dry-run note) -> live progress (spinner per module) -> summary (ok/failed/skipped + follow-ups).

## Contract bash <-> Go

- `./setup --list --porcelain`: one line per module, tab-separated: name, status, default, selected(0/1 from saved choices or defaults), deps (space-separated), desc.
- `FORGE_EVENTS=1 ./setup --only a,b [--dry-run]`: setup prints `@@forge start <name>` and `@@forge result <name> <ok|failed|skipped> [note]` lines; other output is module log. Follow-ups stay in the normal summary output.

## TDD

Mode: strict (global CLAUDE.md). Runners: `tests/run.sh` + `shellcheck` (bash), `go test ./...` in `wizard/` (Go, teatest for the model).

## Delivery

ask-on-risk. Forecast ~500-700 authored lines (Go dominates). Branch `feat/tui-wizard`; work-unit commits; no push.

## Tasks

- [x] T1 Bash contract: `--list --porcelain`, `FORGE_EVENTS` lines; tests. Route: delegated (writer trigger, with T2).
- [x] T2 Go frontend in `wizard/` (go.mod, model, screens, runner via `setup`), tests. Route: delegated.
- [x] T3 `setup` launcher (exec binary / build / download / fallback) + release workflow + README. Route: delegated.
- [x] T4 Verification: all suites, a real TUI dry-run under a temp HOME. Route: parent.

## Progress / evidence

- Route: delegated writer (writer trigger), one writer for T1-T3. TDD: strict.
- T1 `2eb2035`: RED = 2 new tests failing in tests/run.sh, GREEN = 39 passed after change.
- T2 `31a9e68`: RED = `go vet` undefined: model (model_test.go written first); GREEN = go test ok. setup.go parsing/runner tests were written right after the code (not RED-first). Decisions: deselecting a module also deselects its dependents (notice shown); runner is a function field.
- T3: RED = tui launch test failing; GREEN = tests/run.sh 42 passed. Decision: in dry-run the TUI starts only if the binary already exists (no build/download, message printed). `FORGE_BIN` overrides the binary path (used by tests). Go build runs on every interactive launch when Go exists (incremental).

- T4 (parent): `tests/run.sh` 42/42, `go test` ok. Drove `forge --dry-run` in a Python pty (temp HOME, answering the OSC 11 / cursor-position queries): welcome -> picker (j moves focus, dep notes) -> review [dry run] -> progress -> summary `7 ok · 0 failed · 0 skipped` + follow-ups, exit 0. Not verified: real (non-dry) build/download path, release workflow, narrow terminals (no list scrolling; panels wrap at about 40 columns when width is unknown).

## Next step

T4 verification (real TUI under a TTY).
