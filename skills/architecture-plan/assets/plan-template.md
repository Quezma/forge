# Plan template

## Output dir layout

```
docs/architecture/<YYYY-MM-DD>-<topic>/
  plan.md
  delta.html                  # compare architecture current -> proposed (+ delta.receipt.json)
  diagrams/
    current.json  current.html
    proposed.json proposed.html
    <name>.json   <name>.html # only diagrams selected in procedure.md step 3
    *.delivery.json *.finalize.json *.finalize-summary.json *.browser-check.json  # Archify receipts, keep
```

## plan.md

```markdown
# <Topic> architecture plan
Status: draft|approved  Date: <YYYY-MM-DD>  Repo: <url or local> @ <revision>
Skills used: architecture-patterns (Design), <stack skills>

## Context
<current state in 3-6 lines>
| Component | Evidence |
|---|---|
| <name> | `<path>:<line>-<end_line>` |
Dirty paths at mapping time: <none | list>
Unknowns: <fact -> what would resolve it>

## Goals / Non-goals
- Goal: <measurable outcome>
- Non-goal: <explicitly out of scope>

## Proposal
<structure decision in 3-8 lines: monolith|modular monolith|services, contexts, what is new/changed/removed>

## Diagrams
| Diagram | Answers | View | Source |
|---|---|---|---|
| Current topology | what exists today | [html](diagrams/current.html) | [json](diagrams/current.json) |
| Proposed topology | what will exist | [html](diagrams/proposed.html) | [json](diagrams/proposed.json) |
| Delta | what changes (+<a> ~<c> −<r> components) | [html](delta.html) | - |
| <title> | <question> | [html](diagrams/<name>.html) | [json](diagrams/<name>.json) |
Checks: Archify automated checks <passed | failed: code(s)>; <not visually reviewed>

## Models & relations
<entities/tables, ownership per context, key relations; link erd/class diagram>

## Connections & integrations
| From | To | Sync/async | Contract | Timeout/retry/idempotency (rule IDs) |
|---|---|---|---|---|

## Flows
<key user/system flows and entity lifecycles; link sequence/workflow/lifecycle diagrams>

## Trade-offs
### <decision>
| Option | Pros | Cons | Cost | Risk | Reversibility | Decision |
|---|---|---|---|---|---|---|

## Risks
| Risk | Likelihood | Impact | Detection | Mitigation | Rule ID |
|---|---|---|---|---|---|

## Rollout / migration
<phases, backward-compatible migrations (DAT-07), flags, cutover, rollback; link timeline>

## Open questions
- <question> - blocks: <decision>

## Decisions
| Decision | Rule IDs (architecture-patterns) | Need / force |
|---|---|---|
Patterns rejected: <pattern -> why not now -> trigger to revisit>

## Next step
On approval: `superpowers:writing-plans` with this file as the spec.
```
