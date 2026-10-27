import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { load, reindex } from "../src/index_store.ts";
import { loadAll, record, setPurpose, stale, purposes, patternText } from "../src/patterns.ts";

const fixture = fileURLToPath(new URL("./fixtures/app", import.meta.url));
const BUTTON = "src/components/ui/Button.tsx#Button";
const setup = () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ra-pat-"));
  cpSync(fixture, dir, { recursive: true });
  rmSync(path.join(dir, ".react_atlas"), { recursive: true, force: true });
  reindex(dir, { full: true });
  return { dir, index: load(dir) as any };
};
const file = (dir: string, area: string) => path.join(dir, ".react_atlas/patterns", `${area}.json`);

test("add assigns <area>-<n>, defaults audience, writes sorted-key JSON", () => {
  const { dir, index } = setup();
  const a = record(dir, index, "components", "add", { kind: "rule", text: "Use Button", evidence: [BUTTON] });
  assert.equal(a.id, "components-1");
  assert.equal(a.audience, "internal");
  const b = record(dir, index, "components", "add", { kind: "api", audience: "external", text: "Button API", evidence: [BUTTON] });
  assert.equal(b.id, "components-2");
  const raw = readFileSync(file(dir, "components"), "utf8");
  assert.deepEqual(Object.keys(JSON.parse(raw)), ["area", "entries", "purposes"]);
  assert.deepEqual(Object.keys(JSON.parse(raw).entries[0]), ["audience", "evidence", "id", "kind", "text"]);
  assert.equal(existsSync(file(dir, "components") + ".tmp"), false);
});

test("update merges, retire removes, next id is max+1", () => {
  const { dir, index } = setup();
  record(dir, index, "cart", "add", { kind: "rule", text: "one", evidence: [BUTTON] });
  record(dir, index, "cart", "add", { kind: "rule", text: "two", evidence: [BUTTON] });
  const u = record(dir, index, "cart", "update", { id: "cart-1", text: "uno" });
  assert.equal(u.text, "uno");
  assert.equal(u.kind, "rule");
  record(dir, index, "cart", "retire", { id: "cart-1" });
  assert.equal(record(dir, index, "cart", "add", { kind: "helper", text: "three", evidence: [BUTTON] }).id, "cart-3");
  assert.deepEqual(loadAll(dir).areas.cart.entries.map((e: any) => e.id), ["cart-2", "cart-3"]);
});

test("rejects unknown evidence, empty evidence, bad kind, bad area, unknown entry", () => {
  const { dir, index } = setup();
  assert.throws(() => record(dir, index, "cart", "add", { kind: "rule", text: "x", evidence: ["nope#Nope"] }), /unknown evidence: nope#Nope/);
  assert.throws(() => record(dir, index, "cart", "add", { kind: "rule", text: "x", evidence: [] }), /evidence/);
  assert.throws(() => record(dir, index, "cart", "add", { kind: "weird", text: "x", evidence: [BUTTON] }), /invalid kind/);
  assert.throws(() => record(dir, index, "../x", "add", { kind: "rule", text: "x", evidence: [BUTTON] }), /invalid area/);
  assert.throws(() => record(dir, index, "cart", "retire", { id: "cart-9" }), /unknown entry/);
  assert.throws(() => record(dir, index, "cart", "update", { id: "cart-9", text: "y" }), /unknown entry/);
  assert.throws(() => record(dir, index, "cart", "zap", {}), /invalid operation/);
  assert.equal(existsSync(file(dir, "cart")), false);
});

test("set_purpose requires a known symbol and non-empty text", () => {
  const { dir, index } = setup();
  setPurpose(dir, index, "components", BUTTON, "clickable control");
  assert.deepEqual(purposes(loadAll(dir)), { [BUTTON]: "clickable control" });
  assert.throws(() => setPurpose(dir, index, "components", "nope#Nope", "x"), /unknown symbol/);
  assert.throws(() => setPurpose(dir, index, "components", BUTTON, "  "), /purpose text/);
});

test("patternText maps evidence ids to entry texts; invalid files are warnings", () => {
  const { dir, index } = setup();
  record(dir, index, "_global", "add", { kind: "rule", text: "always use Button", evidence: [BUTTON] });
  assert.deepEqual(patternText(loadAll(dir))[BUTTON], ["always use Button"]);
  const bad = path.join(dir, ".react_atlas/patterns/broken.json");
  cpSync(file(dir, "_global"), bad);
  rmSync(bad);
  writeFileSync(bad, "{nope");
  const l = loadAll(dir);
  assert.deepEqual(l.warnings, ["skipped invalid pattern file: broken.json"]);
  assert.deepEqual(Object.keys(l.areas), ["_global"]);
});

test("stale lists entries whose evidence vanished after a reindex", () => {
  const { dir, index } = setup();
  record(dir, index, "components", "add", { kind: "rule", text: "r", evidence: [BUTTON, "src/components/ui/Input.tsx#Input"] });
  assert.deepEqual(stale(index, loadAll(dir)), []);
  rmSync(path.join(dir, "src/components/ui/Input.tsx"));
  const report = reindex(dir);
  assert.equal(report.degraded, false);
  assert.deepEqual(report.stale, [{ area: "components", entry_id: "components-1", missing: ["src/components/ui/Input.tsx#Input"] }]);
});

test("match: persisted on anti_pattern; target must exist unless intrinsic:/external:", () => {
  const { dir, index } = setup();
  const ev = [BUTTON];
  const m = { target: BUTTON, from_area: "cart" };
  const a = record(dir, index, "cart", "add", { kind: "anti_pattern", text: "no", evidence: ev, match: m });
  assert.deepEqual(JSON.parse(readFileSync(file(dir, "cart"), "utf8")).entries[0].match, m);
  assert.deepEqual(a.match, m);
  record(dir, index, "cart", "add", { kind: "anti_pattern", text: "no", evidence: ev, match: { target: "intrinsic:div" } });
  record(dir, index, "cart", "add", { kind: "anti_pattern", text: "no", evidence: ev, match: { target: "external:lodash#map" } });
  assert.throws(() => record(dir, index, "cart", "add", { kind: "anti_pattern", text: "no", evidence: ev, match: { target: "src/x.tsx#Nope" } }), /match/);
  assert.throws(() => record(dir, index, "cart", "add", { kind: "anti_pattern", text: "no", evidence: ev, match: { from_area: "cart" } }), /match/);
  assert.throws(() => record(dir, index, "cart", "add", { kind: "anti_pattern", text: "no", evidence: ev, match: { target: BUTTON, from_area: 3 } }), /match/);
  assert.throws(() => record(dir, index, "cart", "add", { kind: "rule", text: "no", evidence: ev, match: m }), /anti_pattern/);
  assert.throws(() => record(dir, index, "cart", "update", { id: a.id, match: { target: "src/x.tsx#Nope" } }), /match/);
});
