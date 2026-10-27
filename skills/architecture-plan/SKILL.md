---
name: architecture-plan
description: "Trigger: new service, new project, new big/major feature, architecture plan, plan the architecture, topology, design proposal, target architecture, current vs proposed, diagrams of the proposal. Maps the current project from evidence, then proposes the target as validated Archify diagrams plus trade-offs, and hands the approved plan to writing-plans. Orchestrates sibling skills; writes only to the plan dir."
license: Apache-2.0
metadata:
  author: "quezma"
  version: "1.0"
---

## Activation Contract

Load when the user starts a new project, service, or major feature, or asks for an architecture plan, topology, design proposal, or diagrams of a proposal. Not for placing code inside an existing design (`architecture-patterns` Guide) or audits (`architecture-patterns` Audit). This skill sits on top of other skills and runs them in order; it owns only the mapping evidence, the diagram set, the trade-offs table, and the plan dir.

| Concern | Owner |
|---|---|
| Intent, goals, success criteria | `superpowers:brainstorming` |
| Forces, monolith vs split, contexts, sync/async, consistency, patterns | `architecture-patterns` Design (`assets/design.md`) |
| Framework/stack rules | stack skills matched in `rules/skills.md` (`nestjs`, `nx-monorepo`, `elixir-*`, ...) |
| Rendering and validation | Archify (`~/.claude/skills/archify`) |
| Task plan | `superpowers:writing-plans` |

## Hard Rules

- Map before proposing. Use CodeGraph `codegraph_explore` when available; else delegate ONE read-only Explore/mapper subagent. The parent never reads 4+ files inline.
- Current state = evidence only. Every current-state component carries `file:line` evidence. Never invent infrastructure: no queue, cache, broker, or store unless the repo has it, or it is a proposed addition justified by a force and a rule ID.
- Proposed elements are visibly marked new/changed/removed: `compare architecture` (Architecture Delta) for topology, plus `tag` and `cards` in single diagrams (`assets/procedure.md` step 5). Proposed architecture components reuse current `id`s for anything that survives, or Delta reports them as removed+added.
- A diagram is drawn only when it answers a named question for this proposal (selection table in `assets/procedure.md`). No diagram dumping; no type is mandatory except current and proposed topology.
- Every diagram passes Archify `finalize`. Repair within Archify's limit (two focused repairs per persistent issue, then one evidence-based retry); report any remaining failure with its diagnostic code. Never hand-edit generated HTML.
- Archify missing (`~/.claude/skills/archify/bin/archify.mjs` absent) → tell the user to run `./setup --only archify` and stop the diagram steps. Never vendor or copy Archify.
- Do not restate `architecture-patterns` rules; cite its rule IDs.
- Writes go only to `docs/architecture/<YYYY-MM-DD>-<topic>/` (or the dir the user names). No source, config, or migration changes. Nothing outside the plan dir until the user approves the plan; implementation starts only via `superpowers:writing-plans`.
- Ask the user only for forces not readable from the repo; one question at a time, then wait.
- Terse, machine-oriented output. English artifacts.

## Decision Gates

| Situation | Action |
|---|---|
| Intent/goals not yet agreed in this conversation | Run `superpowers:brainstorming` first |
| Intent already agreed (spec, ticket, prior brainstorm) | Skip brainstorming; restate goals in one line |
| Greenfield repo (nothing to map) | Skip current-state diagrams and Delta; proposed diagrams only, note "greenfield" |
| Repo has an `origin` remote | Repository-backed: `meta.repository` + `sources` + `--repo-root` (verified by Archify) |
| No `origin` remote | No `sources`/`meta.repository` (Archify refuses them); keep `file:line` in plan.md evidence table |
| Uncommitted changes in mapped paths | Evidence is checked at the pinned revision; list the dirty paths in plan.md context |
| Force unknown and decision depends on it | Ask one question; else record "unknown" and the assumption |
| Question has no matching diagram type | Answer in plan.md text; do not force a diagram |
| User asks for a shareable one-page summary | Archify `explainer` of the trade-offs (optional) |
| User requests changes in review | Edit JSON, re-run `finalize`/`compare`, re-present; plan dir only |
| User approves | Hand off to `superpowers:writing-plans` with `plan.md` as the spec |

## Execution Steps

1. Intent: `superpowers:brainstorming` unless already done. Record goals, non-goals, constraints.
2. Map the current project (`assets/procedure.md` step 1) → `diagrams/current.json` with evidence.
3. Decide: `architecture-patterns` Design steps 1-8 plus every stack skill matched in `rules/skills.md` (`assets/procedure.md` step 2).
4. Select diagrams by question (`assets/procedure.md` step 3); author each JSON from the Archify schema for its type.
5. Trade-offs and risks (`assets/procedure.md` step 4).
6. Render and validate: `finalize` every diagram, `compare architecture` current → proposed (`assets/procedure.md` step 5).
7. Write `plan.md` from `assets/plan-template.md`. Present (`assets/procedure.md` step 6); review loop until approved.
8. Handoff to `superpowers:writing-plans` (`assets/procedure.md` step 7).

## Output Contract

- Plan dir layout and `plan.md` sections per `assets/plan-template.md`.
- Reply: plan path, one line per diagram (`<title>: <question it answers>` + relative `.html` path), Delta summary counts, open questions, Archify failures if any. No command recaps.
- Verification claim: "Archify automated checks passed; not visually reviewed" unless a visual review ran.

## References

- `assets/procedure.md` - mapping checklist, diagram selection table, trade-offs, Archify commands and marking, review loop, handoff.
- `assets/plan-template.md` - plan dir layout and `plan.md` template.
- `../architecture-patterns/assets/design.md` - forces, split criteria, pattern table (owner of decisions).
- `~/.claude/skills/archify/SKILL.md`, `schemas/<type>.schema.json`, `references/repository-authoring.md` - Archify contract (installed by `./setup --only archify`).
