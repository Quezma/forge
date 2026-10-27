# Learnings

Search misses and ignored results, recorded by the `record_learning` MCP tool (via the `react-atlas-learn` skill).

- `open.jsonl`: unresolved learnings, one JSON object per line.
- `resolved.jsonl`: fixed learnings, with the fixing commit sha.
- `tool_miss` learnings also append a regression fixture to `test/acceptance/<project>.jsonl`.

Improvement round: see the root README.
