## Skills (claude-setup repo skills)

Mandatory. Before the first source edit of any implementation (feature, fix, refactor, new project), detect the project and load every skill whose row matches. Before merging a branch, run the merge column of every matching row. State in one line which skills were loaded; if none matched, say so.

| Project signal | Before implementing | Before merging |
|---|---|---|
| Any code change that crosses a boundary: layers, remote calls, DB writes, messaging, locks, retries | `architecture-patterns` (Guide) | `architecture-patterns` (Audit) |
| New project, service, or major feature | `architecture-plan` (orchestrates brainstorming → `architecture-patterns` Design → Archify diagrams → writing-plans) | — |
| `nx.json` at the root | `nx-monorepo` (Guide) | `nx-monorepo` (Audit) |
| `@nestjs/core` in `package.json` | `nestjs` (Guide) | `nestjs` (Audit), `nestjs-perf` |
| `mix.exs` (Elixir/Phoenix) | `ex-atlas-discover` if `.ex_atlas/patterns/` is empty | `elixir-audit`, `elixir-perf`, `ex-atlas-learn` |
| React/TypeScript with the `react_atlas` MCP | `react-atlas-discover` if `.react_atlas/patterns/` is empty | `react-atlas-learn` |
| UI behavior changed | — | `qa-engineer` against the running app |

- Rows stack: a NestJS service in an Nx workspace loads `architecture-patterns`, `nx-monorepo`, and `nestjs`. The stack skill owns framework rules; `architecture-patterns` owns cross-cutting ones.
- Audits are report-only; a `FIX_REQUIRED` verdict blocks the merge until fixed and re-audited once on the fix diff.
- Delegated writers get the loaded skill names and must read them before editing.
