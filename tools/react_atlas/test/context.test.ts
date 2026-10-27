import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { load, reindex } from "../src/index_store.ts";
import { loadAll, record } from "../src/patterns.ts";
import { buildContext } from "../src/context.ts";
import { append } from "../src/usage_log.ts";

const fixture = fileURLToPath(new URL("./fixtures/app", import.meta.url));
const BUTTON = "src/components/ui/Button.tsx#Button";
const setup = () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ra-ctx-"));
  cpSync(fixture, dir, { recursive: true });
  rmSync(path.join(dir, ".react_atlas"), { recursive: true, force: true });
  reindex(dir, { full: true });
  const index = load(dir) as any;
  record(dir, index, "_global", "add", { kind: "rule", text: "global rule", evidence: [BUTTON] });
  record(dir, index, "cart", "add", { kind: "rule", text: "cart rule", evidence: [BUTTON] });
  record(dir, index, "components", "add", { kind: "api", audience: "external", text: "Button is public", evidence: [BUTTON] });
  record(dir, index, "components", "add", { kind: "rule", text: "internal only", evidence: [BUTTON] });
  return { dir, index };
};

test("global + area entries + external-only neighbour entries with api", () => {
  const { dir, index } = setup();
  const r = buildContext(index, loadAll(dir), "add coupon", ["cart", "checkout"]);
  assert.equal(r.task, "add coupon");
  assert.deepEqual(r.global.map((e: any) => e.text), ["global rule"]);
  assert.deepEqual(r.areas.cart.entries.map((e: any) => e.text), ["cart rule"]);
  assert.deepEqual(r.areas.checkout.entries, []);
  assert.deepEqual(Object.keys(r.neighbours), ["components", "store"]);
  assert.deepEqual(r.neighbours.components.entries.map((e: any) => e.text), ["Button is public"]);
  const api = r.neighbours.components.api.map((a: any) => a.id);
  assert.ok(api.includes(BUTTON));
  assert.deepEqual(r.unknown_areas, []);
  assert.deepEqual(r.truncated, []);
  assert.ok(r.tokens > 0 && !r.over_budget);
});

test("unknown areas are reported with known_areas", () => {
  const { dir, index } = setup();
  const r = buildContext(index, loadAll(dir), "t", ["cart", "nope"]);
  assert.deepEqual(r.unknown_areas, ["nope"]);
  assert.ok(r.known_areas.includes("cart") && r.known_areas.includes("components"));
  assert.ok(!r.known_areas.includes("_global"));
});

test("budget trims the lowest-ranked neighbour and lists it in truncated", () => {
  const { dir, index } = setup();
  const full = buildContext(index, loadAll(dir), "t", ["cart"]);
  assert.ok(Object.keys(full.neighbours).length >= 1);
  const tight = buildContext(index, loadAll(dir), "t", ["cart"], 1);
  assert.deepEqual(tight.neighbours, {});
  assert.deepEqual(tight.truncated, Object.keys(full.neighbours).sort());
  assert.equal(tight.over_budget, true);
});

test("entries whose evidence vanished are marked stale", () => {
  const { dir } = setup();
  rmSync(path.join(dir, "src/features/checkout/Legacy.tsx"));
  const index = load(dir) as any;
  record(dir, index, "cart", "add", { kind: "rule", text: "legacy", evidence: ["src/features/checkout/Legacy.tsx#Legacy"] });
  reindex(dir);
  const r = buildContext(load(dir) as any, loadAll(dir), "t", ["cart"]);
  assert.deepEqual(r.areas.cart.entries.find((e: any) => e.text === "legacy").stale, true);
  assert.deepEqual(r.stale, [{ area: "cart", entry_id: "cart-2", missing: ["src/features/checkout/Legacy.tsx#Legacy"] }]);
});

test("usage log appends a JSON line and creates .gitignore", () => {
  const { dir } = setup();
  append(dir, "context_for_task", { task: "x" }, ["a-1"]);
  const line = JSON.parse(readFileSync(path.join(dir, ".react_atlas/usage.jsonl"), "utf8").trim());
  assert.equal(line.tool, "context_for_task");
  assert.deepEqual(line.results, ["a-1"]);
  assert.equal(line.branch, null); // temp dir is not a git repo
  assert.equal(typeof line.ts, "string");
  assert.equal(readFileSync(path.join(dir, ".react_atlas/.gitignore"), "utf8"), "/*\n!/.gitignore\n!/patterns/\n!/config.json\n");
});
