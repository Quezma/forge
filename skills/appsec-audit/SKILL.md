---
name: appsec-audit
description: "Trigger: security audit, security check, OWASP, check security after a feature, before merging a slice/feature branch, multi-tenant, tenant isolation. Report-only, stack-agnostic web app/API security audit with first-class multi-tenancy checks; writes an agent-ready report, never fixes."
license: Apache-2.0
metadata:
  author: "quezma"
  version: "1.0"
---

## Activation Contract

Load when the user asks for a security audit/check of a web app or API change, or mentions OWASP, multi-tenant, or tenant isolation. Also load after an implementation agent finishes a feature (before QA/merge) and before merging a feature/slice branch into the default branch. Distinct from the global `security-audit` skill (full pen-test workflow): this one is a per-change diff audit.

## Hard Rules

- REPORT ONLY. Never edit, format, or fix source. The only write is the report file.
- Delegate the audit to ONE `general-purpose` subagent (model `opus`) with `assets/audit-brief.md` filled in; source reads must not flood the parent context.
- Only check-only tools, and only if already installed or in project deps (semgrep with local rules only, gitleaks, sobelow, brakeman, bandit, a configured eslint security plugin). Never install anything.
- No network-backed scanners (`npm audit`, `osv-scanner`, online `mix deps.audit`, `pip-audit`) unless the user explicitly allows; record as skipped.
- Never print secret values in the report or chat; redact to the first 4 characters.
- Every finding cites `file:line` and a rule ID from `assets/checklist.md` (or `X-<slug>` for something not in the catalogue). No evidence, no finding.
- Multi-tenancy is a gate: detect it, extract the project's own tenancy rules and scopes (AGENTS.md, CLAUDE.md, docs, ADRs, enforcement code); those win over generic TEN rules. Multi-tenant project with no documented rules → `major` finding to document them; fall back to generic TEN rules.
- Any diff-caused tenant isolation break is a `blocker`.
- Findings on code the diff did not touch are tagged `pre-existing`; they never raise the verdict.
- Respect the project's own security conventions over generic rules; waived categories go under `## Waived`.
- Report is terse and machine-oriented: no prose intros, no praise, no restating the code.

## Decision Gates

| Situation | Scope |
|-----------|-------|
| Default / "check security" | Branch diff vs merge-base (`git merge-base HEAD <default>`) plus direct callers/callees and the routes/handlers/queries the diff reaches |
| After a feature, before QA/merge | Same; the whole feature/slice, not one commit |
| Before merging a slice/feature branch | `git merge-base <default> HEAD`..`HEAD` |
| User says "full", "whole project" | Whole app source + config; TEN and AUTHZ first |
| User names files/routes | Exactly those + their data access |
| Multi-tenant signals present | TEN section mandatory, tenancy rules extracted before auditing |
| Intent/task text available | Also verify intent: each requirement → met / partial / missing |

## Execution Steps

1. Resolve root (`git rev-parse --show-toplevel`), base ref, scope, stack, intent text, and where tenancy rules are documented (AGENTS.md, CLAUDE.md, `docs/`, ADRs).
2. Fill `assets/audit-brief.md` and dispatch the subagent.
3. Subagent writes `<root>/.audit/<YYYY-MM-DD>-<branch>-appsec.md` and returns the same content.
4. Show the user the header (verdict + counts), the `## Tenancy` block, and the report path. Do not fix. Offer to hand the report to the implementation agent.
5. `FIX_REQUIRED` blocks the merge. The implementation agent fixes the findings, then re-audit once scoped to the fix diff. No loop-until-clean; anything still open goes to the user.

## Output Contract

The report format is defined in `assets/audit-brief.md` (`## Report format`). Verdict: `FIX_REQUIRED` if any blocker/major caused by the diff, else `PASS`.

## References

- `assets/audit-brief.md` — subagent brief: procedure, tools, tenancy detection, report format.
- `assets/checklist.md` — rule catalogue with IDs (TEN, AUTHZ, AUTHN, INJ, INPUT, SSRF, CRYPTO, CONF, DATA, RATE, SUPPLY, LOG, ERR) mapped to OWASP Top 10:2025, API Top 10:2023, ASVS 5.0.0, CWE.
