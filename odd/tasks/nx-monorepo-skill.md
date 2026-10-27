# nx-monorepo-skill

Objective: a skill that brings Nx monorepo architecture, patterns and good practices to any Nx workspace and enforces them.
Why: keep boundaries, library types and task config consistent as the monorepo grows; same shape as elixir-audit (guide + report-only audit).
Scope: `skills/nx-monorepo/` (SKILL.md + assets). Sources: nx.dev docs/blog and reputable blogs, cited in the checklist.
Constraints: follow existing skill format (frontmatter, Activation Contract, Hard Rules, Decision Gates, Execution Steps, Output Contract, References); English; respect the workspace's own conventions over generic rules.
TDD: n/a for prose skill content; checks = tests/run.sh still green + structural readback.

## Tasks
- [ ] T1 Research Nx best practices with sources. — route: delegated research worker
- [ ] T2 Write SKILL.md, assets/checklist.md (rule IDs + sources), assets/audit-brief.md, assets/boundaries-setup.md. — route: delegated writer

## Acceptance
- Every checklist rule has an ID and a source URL; version-specific rules are marked.
- Skill installs via `./setup --only skills` (symlink) and tests stay green.
