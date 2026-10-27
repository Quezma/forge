import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, writeFileSync, appendFileSync, readFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { load, reindex } from "../src/index_store.ts";

const fixture = fileURLToPath(new URL("./fixtures/app", import.meta.url));
const copy = () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ra-store-"));
  cpSync(fixture, dir, { recursive: true });
  rmSync(path.join(dir, ".react_atlas"), { recursive: true, force: true });
  return dir;
};
const PRICE = "src/features/cart/PriceTag.tsx";

test("load: missing -> null, garbage or wrong format -> 'corrupt'", () => {
  const dir = copy();
  assert.equal(load(dir), null);
  mkdirSync(path.join(dir, ".react_atlas"));
  const file = path.join(dir, ".react_atlas/index.json");
  writeFileSync(file, "{nope");
  assert.equal(load(dir), "corrupt");
  writeFileSync(file, JSON.stringify({ format: 99, symbols: {} }));
  assert.equal(load(dir), "corrupt");
});

test("first reindex builds and saves a versioned index", () => {
  const dir = copy();
  const r = reindex(dir);
  assert.equal(r.degraded, false);
  assert.ok(r.changed_files.includes(PRICE));
  assert.equal(r.pattern_review_needed, true);
  const raw = JSON.parse(readFileSync(path.join(dir, ".react_atlas/index.json"), "utf8"));
  assert.equal(raw.format, 4);
  const idx = load(dir) as any;
  assert.ok(idx.symbols[`${PRICE}#PriceTag`]);
  assert.equal(idx.syntaxError, undefined);
  assert.equal(existsSync(path.join(dir, ".react_atlas/index.json.tmp")), false);
});

test("unchanged project: nothing rebuilt; full forces a rebuild", () => {
  const dir = copy();
  reindex(dir);
  const before = (load(dir) as any).meta.builtAt;
  const r = reindex(dir);
  assert.deepEqual(r, { changed_files: [], degraded: false, pattern_review_needed: false, stale: [], warnings: [] });
  assert.equal((load(dir) as any).meta.builtAt, before);
  const full = reindex(dir, { full: true });
  assert.notEqual((load(dir) as any).meta.builtAt, before);
  assert.equal(full.degraded, false);
});

test("changed, added and removed files are reported", () => {
  const dir = copy();
  reindex(dir);
  appendFileSync(path.join(dir, PRICE), "\nexport const extra = 1;\n");
  writeFileSync(path.join(dir, "src/features/cart/New.tsx"), "export const New = () => null;\n");
  rmSync(path.join(dir, "src/features/checkout/Legacy.tsx"));
  const r = reindex(dir);
  assert.deepEqual(r.changed_files.sort(), [PRICE, "src/features/cart/New.tsx", "src/features/checkout/Legacy.tsx"].sort());
  assert.equal(r.pattern_review_needed, true);
  const idx = load(dir) as any;
  assert.ok(idx.symbols["src/features/cart/New.tsx#New"]);
  assert.equal(idx.symbols["src/features/checkout/Legacy.tsx#Legacy"], undefined);
});

test("syntax error -> degraded, old index kept", () => {
  const dir = copy();
  reindex(dir);
  const before = readFileSync(path.join(dir, ".react_atlas/index.json"), "utf8");
  appendFileSync(path.join(dir, PRICE), "\nexport const = ;\n");
  const r = reindex(dir);
  assert.equal(r.degraded, true);
  assert.ok(r.compile_error && r.compile_error.length > 0);
  assert.equal(readFileSync(path.join(dir, ".react_atlas/index.json"), "utf8"), before);
});

test("semantic type errors do not degrade", () => {
  const dir = copy();
  reindex(dir);
  appendFileSync(path.join(dir, PRICE), "\nexport const bad: number = 'x';\n");
  const r = reindex(dir);
  assert.equal(r.degraded, false);
  assert.ok((load(dir) as any).symbols);
});

test("corrupt index is rebuilt", () => {
  const dir = copy();
  reindex(dir);
  writeFileSync(path.join(dir, ".react_atlas/index.json"), "{");
  const r = reindex(dir);
  assert.equal(r.degraded, false);
  assert.ok(load(dir) !== "corrupt" && load(dir) !== null);
});

test("CLI `index` prints the report as JSON", () => {
  const dir = copy();
  const out = execFileSync(process.execPath, [fileURLToPath(new URL("../bin/react-atlas.ts", import.meta.url)), "index"], { cwd: dir, encoding: "utf8" });
  assert.equal(JSON.parse(out).degraded, false);
  assert.ok(load(dir) !== null);
});
