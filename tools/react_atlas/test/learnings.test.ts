import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { record } from "../src/learnings.ts";
import { createRegistry } from "../src/tools.ts";
import { registerAtlasTools } from "../src/atlas_tools.ts";

const repo = () => mkdtempSync(path.join(tmpdir(), "ra-learn-"));
const lines = (f: string) => readFileSync(f, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const base = { project: "my-app", branch: "feat/x", cause: "tool_miss", query: "price tag", tool: "find_reusable", expected: "PriceTag", actual: "nothing", evidence: "src/PriceTag.tsx" };

test("tool_miss appends to open.jsonl and a fixture line", () => {
  const r = repo();
  assert.deepEqual(record(r, base), { ok: true });
  const [open] = lines(path.join(r, "learnings/open.jsonl"));
  assert.equal(open.query, "price tag");
  assert.ok(open.recorded_at);
  assert.deepEqual(lines(path.join(r, "test/acceptance/my-app.jsonl")), [{ tool: "find_reusable", args: { query: "price tag" }, expect: "PriceTag", top_k: 5 }]);
});

test("agent_ignored writes no fixture", () => {
  const r = repo();
  assert.deepEqual(record(r, { ...base, cause: "agent_ignored" }), { ok: true });
  assert.equal(existsSync(path.join(r, "test/acceptance/my-app.jsonl")), false);
});

test("audit tool_miss: expected 'check file' becomes {check,file} fixture", () => {
  const r = repo();
  assert.deepEqual(record(r, { ...base, tool: "audit", expected: "ds_bypass src/A.tsx" }), { ok: true });
  assert.deepEqual(lines(path.join(r, "test/acceptance/my-app.jsonl"))[0].expect, { check: "ds_bypass", file: "src/A.tsx" });
});

test("validation errors write nothing", () => {
  const r = repo();
  const bad = (patch: object) => (record(r, { ...base, ...patch }) as any).error;
  assert.match(bad({ project: "Bad Name" }), /invalid project/);
  assert.match(bad({ project: "../x" }), /invalid project/);
  assert.match(bad({ cause: "knowledge_gap" }), /invalid cause/);
  assert.match(bad({ tool: "reindex" }), /invalid tool/);
  assert.match(bad({ expected: "" }), /invalid expected/);
  assert.match(bad({ tool: "audit", expected: "onlyone" }), /invalid expected/);
  assert.match(bad({ tool: "context_for_task" }), /invalid args/);
  assert.match((record(r, { ...base, evidence: undefined }) as any).error, /missing: evidence/);
  assert.equal(existsSync(path.join(r, "learnings")), false);
});

test("record_learning is registered and rejects bad input", () => {
  const reg = createRegistry();
  registerAtlasTools(reg, repo());
  assert.ok(reg.list().some((t) => t.name === "record_learning"));
  assert.match((reg.call("record_learning", { ...base, project: "BAD" }, null) as any).error, /invalid project/);
});
