# Architecture plan procedure

`ARCHIFY=~/.claude/skills/archify/bin/archify.mjs`. Run every command from the repo root; `P=docs/architecture/<YYYY-MM-DD>-<topic>`. Every Archify JSON sets `meta.output` to its HTML path relative to the repo root (e.g. `docs/architecture/2026-10-26-billing/diagrams/current.html`) and `meta.quality_profile: "showcase"`. Before writing any JSON, read Archify `SKILL.md`, `references/authoring-defaults.md`, the type's `schemas/<type>.schema.json` (+ `schemas/common.schema.json` for non-architecture types) and its example from the Archify Type router.

## 1. Scrape the current project

Via `codegraph_explore` or ONE read-only mapper subagent. The mapper returns facts with `path:line-end_line`, never file dumps. Cover:

| Item | Where to look |
|---|---|
| Stack, versions | manifests: `package.json`, `mix.exs`, `go.mod`, `pyproject.toml`, `Cargo.toml`, lockfiles |
| Modules / bounded contexts | top-level source dirs, workspace config (`nx.json`, umbrella apps), module registration |
| Entry points | `main`/bootstrap files, routers/controllers, CLI entry, job/consumer registration |
| Data stores + schemas | DB config, migrations, ORM models/schemas; owner module per table |
| External integrations | HTTP clients, SDK imports, webhooks, env var names (never values) |
| Messaging | queue/topic/consumer config, outbox tables, cron/schedulers |
| Deployment | `Dockerfile`, compose, k8s/helm, terraform, CI workflows, `fly.toml`/`render.yaml` etc. |
| Conventions / decisions | `CLAUDE.md`, `AGENTS.md`, `docs/adr/`, READMEs, lint/arch rules |

Repository identity (repo-backed only): `git rev-parse HEAD`, `git remote get-url origin` (strip HTTP userinfo), `git status --short`. Write `meta.repository: {url, revision, link_mode}`; `link_mode: "local-only"` for SSH or unsupported forges. Archify verifies `sources` against committed bytes at that revision.

Write `$P/diagrams/current.json` (`diagram_type: "architecture"`): one component per evidenced runtime unit/store/external, `type` from `frontend|backend|database|cloud|security|messagebus|external`, `sources: [{path, line, end_line, label}]` (1-3 ranges). Connections only for observed call/I/O sites, cited on the component that owns the call. Unknowns go in a `cards` entry, not as nodes.

## 2. Forces and decisions

Run `architecture-patterns` Design (`assets/design.md` steps 1-8) on the scraped facts, plus each stack skill matched in `rules/skills.md`. Output: forces (evidence or "unknown"), structure, contexts, sync/async per interaction, consistency per operation, patterns used/rejected with rule IDs. Do not re-derive these here; copy the decisions into plan.md with their rule IDs.

## 3. Diagram selection

Draw a row only when its question is open for this proposal. Ids are exact Archify `diagram_type` values.

| Question | Archify type | File |
|---|---|---|
| What exists today and how is it connected? | `architecture` | `current.json` |
| What will exist and how is it connected? | `architecture` | `proposed.json` |
| What changes between current and proposed? | `compare architecture` (Delta) | `delta.html` |
| Which models/tables, keys, relations? | `erd` | `models.json` |
| Domain types, interfaces, inheritance/composition? | `class` | `domain.json` |
| Where does data move, which contracts, which consumers? | `dataflow` | `dataflow-<name>.json` |
| Key interactions / API call order, async returns? | `sequence` | `seq-<name>.json` |
| User or operator flow with gates and branches? | `workflow` | `flow-<name>.json` |
| Which states can an entity be in; retries, terminals? | `lifecycle` | `state-<entity>.json` |
| Module/package or capability breakdown (single parent)? | `tree` | `modules.json` |
| Rollout/migration phases over time? | `timeline` | `rollout.json` |
| Where does request latency go (budget)? | `waterfall` | `latency-<name>.json` (only with a stated latency budget; `meta.evidence: "illustrative"` unless traced) |

Ambiguous choice: `node $ARCHIFY guide "<question>" --json`.

## 4. Trade-offs

In plan.md, one table per decision that had real alternatives:

| Option | Pros | Cons | Cost | Risk | Reversibility | Decision |
|---|---|---|---|---|---|---|

Then risks: `risk | likelihood | impact | detection | mitigation | rule ID`. Options must include "keep current / modular monolith" when a split is proposed (`architecture-patterns` DES/MSV rules). Archify `explainer` (`finalize explainer <x>.archify.md <x>.html --json`) only when the user asks for a shareable page; read Archify `references/explainer-authoring.md` first.

## 5. Render, mark, validate

Marking proposed elements:
- Topology: `proposed.json` keeps current `id`s for surviving components/connections; Delta marks each as added `+`, removed `−`, changed `~`, moved, rerouted, evidence-changed.
- In single diagrams: `tag: "NEW" | "CHANGED"` on proposed elements where the type has `tag` (architecture, workflow, dataflow, lifecycle; NOT erd, where `tag` is the domain band); `variant: "dashed"` on proposed connections where the type has `variant`; plus one `cards` entry `{dot: "amber", title: "Proposed changes", items: [...]}` listing new/changed/removed elements (all native types have `cards`).
- Proposed components carry no `sources` (nothing to cite yet); surviving ones keep theirs.

Commands (add `--repo-root .` when the JSON has `meta.repository`):

```bash
node $ARCHIFY finalize <type> $P/diagrams/<name>.json $P/diagrams/<name>.html --quality showcase --json
node $ARCHIFY compare architecture $P/diagrams/current.json $P/diagrams/proposed.json $P/delta.html --json
```

`finalize` = validate + deliver + check + browser-check; non-zero exit is failure. Read the diagnostics (`code`, `subject`, `supportedFixes`), fix the JSON, rerun the full command; after a run reached browser-check, rerun with `--out-dir $P/diagrams/review-<n>`. Limit: two focused repairs per persistent diagnostic, then one evidence-based retry, then report it. `repository-evidence/*` codes mean wrong `path`/line range or repository identity: fix the citation, never drop evidence to pass. `compare` prints added/changed/removed counts in `summary`; copy them into plan.md.

## 6. Present and review

Reply per SKILL.md Output Contract. Ask for review: approve, or list changes. Apply changes to the JSON + plan.md only, rerun step 5 for touched diagrams, re-present. No source writes during the loop.

## 7. Handoff

On approval: set plan.md `Status: approved`, then invoke `superpowers:writing-plans` with `$P/plan.md` as the spec (diagram links stay as references). Tasks inherit the rule IDs and stack skills recorded in plan.md.
