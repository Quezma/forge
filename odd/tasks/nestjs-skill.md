# nestjs-skill

Objective: a skill that enforces NestJS + TypeScript good practices from the official docs, recommends patterns/architecture/Nest features, and enforces module boundaries so circular dependencies never appear.
Why: keep module structure, DI, validation and layering consistent; prevent `forwardRef` sprawl and import cycles; same shape as nx-monorepo (guide + report-only audit).
Scope: `skills/nestjs/` (SKILL.md + assets). Sources: docs.nestjs.com (primary), typescript-eslint/madge/dependency-cruiser docs, reputable blogs (tagged third-party).
Constraints: follow existing skill format (frontmatter, Activation Contract, Hard Rules, Decision Gates, Execution Steps, Output Contract, References); English; project conventions win over generic rules; `forwardRef` is a smell, never the fix.
TDD: n/a for prose skill content; checks = tests/run.sh still green + structural readback.

## Tasks
- [x] T1 Research NestJS best practices + cycle prevention with sources, then write SKILL.md, assets/checklist.md (rule IDs + sources), assets/audit-brief.md, assets/boundaries.md. — route: delegated research+writer (4 files, preparation trigger) Evidence: skills/nestjs (334 lines), 82 rules all with Check+Src+tag, baseline Nest 12, 5 [unverified] + 9 [3p], tests 33/33, setup --dry-run symlinks it.

## Acceptance
- Every checklist rule has an ID and a source URL; version-specific rules are marked.
- Skill installs via `./setup --only skills` (symlink) and tests stay green.
