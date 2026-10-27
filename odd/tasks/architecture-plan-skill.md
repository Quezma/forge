# architecture-plan-skill

Objective: a skill that turns a new service or big feature into a visual architecture plan: map the current project first, then propose the target with Archify diagrams (topology, models/relations, connections, data flows, sequences, user flows, lifecycle, rollout, current-vs-proposed delta) plus trade-offs, and hand off to implementation planning.
Why: brainstorming and writing-plans produce text; `architecture-patterns` Design produces a decision record. Nothing shows the proposal visually against the real current system before code is written.
Scope: `skills/architecture-plan/` (SKILL.md + assets), `modules/09-archify.sh` (installs the Archify skill/CLI, the "tool"), its tests in `tests/t_modules.sh`, row in `rules/skills.md`. Archify: https://github.com/tt-a1i/archify (Apache-2.0, zero-dep Node CLI: guide/validate/deliver/preview/compare; 10 diagram types + Explainer + Architecture Delta).
Constraints: same skill format as `architecture-patterns`; orchestrates sibling skills, never duplicates them (brainstorming owns intent, `architecture-patterns` owns pattern decisions, stack skills own framework rules, `superpowers:writing-plans` owns the task plan); current-state diagrams contain only components evidenced in the repo (`file:line`), proposed components are labelled as new/changed; Archify is installed, never vendored; no custom MCP/CLI (Archify covers validation and rendering); English; terse.
TDD: strict; runner `tests/run.sh`. Module: RED test first. Prose: structural readback.
Delivery: forecast ~350 authored lines, single-pr strategy n/a (repo commits to main per precedent).

## Tasks
- [ ] T1 RED test + `modules/09-archify.sh` (install via `npx skills add tt-a1i/archify --skill archify --agent claude-code --global --yes`, status, dry-run, followup when npx missing). — route: delegated writer (2+ files)
- [ ] T2 Write `skills/architecture-plan/SKILL.md`, `assets/procedure.md` (scrape → forces → diagram set → trade-offs → handoff), `assets/plan-template.md`; verify Archify CLI commands/schema against the installed skill. — route: delegated writer (same worker, preparation trigger)
- [ ] T3 Add row to `rules/skills.md` (new project/service/major feature, before `architecture-patterns` Design). — route: inline (one line)

## Acceptance
- tests/run.sh green; `./setup --only archify --dry-run` prints the install command; `./setup --only skills --dry-run` symlinks the skill.
- Every Archify command and JSON field the skill names exists in the installed Archify version.
- Plan output dir layout and diagram set are defined; current-state nodes require repo evidence.
