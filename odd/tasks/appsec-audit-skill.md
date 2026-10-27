# appsec-audit-skill

Objective: a stack-agnostic, report-only web security audit that runs after each feature implementation (and before merge), checks OWASP-backed rules, and enforces the project's own multi-tenancy rules and scopes.
Why: `elixir-audit`/`nestjs` have a few SEC rules each; nothing checks the whole OWASP surface on every feature, and nothing enforces tenant isolation as the project defines it. The global `security-audit` skill is a heavy full pen-test workflow, so this one is named `appsec-audit` to avoid shadowing it.
Scope: `skills/appsec-audit/` (SKILL.md, assets/checklist.md, assets/audit-brief.md) + its row in `rules/skills.md`. Sources: OWASP Top 10 (latest), OWASP ASVS (latest), OWASP API Security Top 10 2023, OWASP Cheat Sheet Series (incl. multi-tenant guidance if it exists), CWE Top 25 (latest).
Constraints: same format and hard rules as elixir-audit; report only; check-only tools that are already installed, no network-backed scanners, no installs; never read or print secret values; multi-tenancy rules come from the project (AGENTS.md/CLAUDE.md/docs) and win over generic rules; missing tenancy rules in a multi-tenant project is itself a finding; English; terse.
TDD: n/a for prose skill content; checks = tests/run.sh green + structural readback + `./setup --only skills --dry-run` symlinks it.

## Tasks
- [x] T1 Research + write SKILL.md, assets/checklist.md (IDs, severity, Src, tenancy section), assets/audit-brief.md (procedure, tenancy detection, report format). — route: delegated research+writer (3 files, preparation trigger) — evidence: SKILL.md 55 lines, brief 72, checklist 101 (69 rules: 52 [doc], 17 [unverified], 0 [3p]); OWASP Top 10:2025, ASVS 5.0.0, API 2023, multi-tenant cheat sheet verified.
- [x] T2 Add `appsec-audit` row to `rules/skills.md` (after feature implementation / before merging). — route: delegated with T1 (same writer) — evidence: row + bullet in rules/skills.md; tests/run.sh 37 passed 0 failed; setup dry-run symlinks appsec-audit.

## Acceptance
- Every checklist rule has an ID, severity, and a verified source URL.
- Tenancy: detection signals, project-rule extraction, and per-surface checks (queries, routes, jobs, caches, storage, logs, search, exports); undocumented rules → finding.
- tests/run.sh green; `./setup --only skills --dry-run` symlinks it.
