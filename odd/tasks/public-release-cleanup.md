# public-release-cleanup

Objective: make the repo safe to publish on GitHub.
Problem: tracked files hold client/employer details, private product data, a personal chat ID, absolute local paths and vendored third-party content.
Scope: this repo only. Upstream plugins installed from their own marketplaces stay referenced (not redistributed), except engram.
TDD: strict (session config); runner `tests/run.sh`, plus `mix test` in tools/ex_atlas.

## Tasks
- [x] T1 Delete vendored third-party content (gentle-ai, engram, claude-flow, design skills), the Telegram hook, private nous-hr data and generated registries. — route: inline (mechanical `git rm`) — eb2b742
- [x] T2 Remove gentle-ai/engram/autoMode/client references from settings, CLAUDE.md, mcp.json, plugins.json, modules, README, tests, snapshot.sh; anonymize ex_atlas test; global paths in kept skills. — route: delegated writer (2+ non-trivial files)
- [ ] T3 Publish-ready history (no bixlabs author, no deleted private files). — pending user decision

## Acceptance
- `git grep -iE 'bixlabs|FindMyProfession|nous|gentle|engram|/Users/|8786700256'` returns nothing relevant.
- `tests/run.sh` and ex_atlas `mix test` pass.

## Progress
- Global git identity set to Quezma <marcoespinosa234@gmail.com>.
- T2 (delegated writer): RED 3 failing (snapshot filtering); GREEN tests/run.sh 31/31, ex_atlas mix test 129 passed, json valid, git grep clean (only snapshot.sh filter logic and its test fixtures mention gentle-ai/engram by design).
