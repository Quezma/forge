# architecture-patterns-skill

Objective: a stack-agnostic skill that enforces architecture and design patterns, including distributed-systems/microservice patterns, from authoritative documentation with good/bad examples, so it can say whether code is right or wrong and guide new features or projects.
Why: stack skills (nestjs, nx-monorepo, elixir-audit) cover framework rules; nothing covers cross-cutting architecture (layering, DDD boundaries) and reliability patterns (circuit breaker, retries, idempotency, locks, transactions, outbox, sagas).
Scope: `skills/architecture-patterns/` (SKILL.md + assets). Sources: microservices.io, martinfowler.com, Azure Architecture Center cloud design patterns, AWS Prescriptive Guidance / Builders' Library, Stripe idempotency docs, PostgreSQL docs, Kleppmann (locks), resilience library docs; third-party opinion tagged `[3p]`.
Constraints: same format as nestjs (Activation Contract, Hard Rules, Decision Gates, Execution Steps Guide/Audit/Design, Output Contract, References); English; project conventions win; stack-specific rules defer to the stack skill; examples language-agnostic pseudocode/TypeScript; a pattern is recommended only for a stated need (no speculative circuit breakers or microservices).
TDD: n/a for prose skill content; checks = tests/run.sh green + structural readback.

## Tasks
- [x] T1 Research patterns with sources, then write SKILL.md, assets/checklist.md (rule IDs + Check + Src + tag), assets/examples.md (good/bad pairs per critical rule), assets/design.md (new project/feature decision procedure), assets/audit-brief.md. — route: delegated research+writer (5 files, preparation trigger) Evidence: skills/architecture-patterns (625 lines), 86 rules all with severity+Check+Src, 9 blockers all with examples, 51 [doc] / 11 [3p] / 24 [unverified], tests 33/33, setup --dry-run symlinks it.

## Acceptance
- Every checklist rule has an ID, a check, and a source URL.
- Every blocker-level rule has a good/bad example.
- Skill installs via `./setup --only skills` (symlink) and tests stay green.
