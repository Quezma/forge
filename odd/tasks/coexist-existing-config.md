# coexist-existing-config

Objective: installing this setup on a machine with gentle-ai (or any tool that manages ~/.claude) must not drop that tool's config.
Problem: `render_template` replaces ~/.claude/CLAUDE.md keeping only `<!-- X:start -->` blocks, so `<!-- ns:name -->...<!-- /ns:name -->` blocks (gentle-ai) are lost; ~/.claude/settings.json is replaced wholesale, dropping existing hooks/plugins.
TDD: strict; runner `bash tests/run.sh`.

## Tasks
- [ ] T1 CLAUDE.md render keeps foreign `<!-- ns:name -->...<!-- /ns:name -->` blocks from the existing file. — route: delegated writer
- [ ] T2 settings.json is deep-merged into the existing file (existing keys kept, lists/hooks unioned without duplicates, repo scalars win), with .bak only when changed. — route: delegated writer (same writer)

## Acceptance
- New tests for both behaviors RED then GREEN; full suite green; idempotent (second install = no change, no new .bak).
