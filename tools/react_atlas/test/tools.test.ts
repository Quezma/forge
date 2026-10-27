import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, existsSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRegistry } from "../src/tools.ts";
import { registerAtlasTools } from "../src/atlas_tools.ts";

const fixture = fileURLToPath(new URL("./fixtures/app", import.meta.url));
const copy = () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ra-tools-"));
  cpSync(fixture, dir, { recursive: true });
  rmSync(path.join(dir, ".react_atlas"), { recursive: true, force: true });
  return dir;
};
const setup = (dir = copy()) => {
  const reg = createRegistry();
  registerAtlasTools(reg, dir);
  const call = (name: string, args: Record<string, unknown> = {}): any => {
    const invalid = reg.validate(name, args);
    assert.equal(invalid, null);
    return reg.call(name, args, null);
  };
  return { reg, dir, call };
};
const BUTTON = "src/components/ui/Button.tsx#Button";

const NAMES = ["find_reusable", "component", "callers", "reindex", "context_for_task", "record_pattern", "set_purpose", "audit", "state_map", "record_learning"];
test("registers the tools with schemas", () => {
  const { reg } = setup();
  assert.deepEqual(reg.list().map((t) => t.name), NAMES);
  assert.deepEqual(reg.list()[0].inputSchema.required, ["query"]);
});

test("index is built lazily on first call, not at registration", () => {
  const { dir, call } = setup();
  assert.equal(existsSync(path.join(dir, ".react_atlas/index.json")), false);
  call("find_reusable", { query: "button" });
  assert.equal(existsSync(path.join(dir, ".react_atlas/index.json")), true);
});

test("find_reusable: ranking, kind filter, limit, shape", () => {
  const { call } = setup();
  const top = call("find_reusable", { query: "price tag" }).ok.results;
  assert.deepEqual(top.slice(0, 2).map((r: any) => r.id.split("#")[1]).sort(), ["PriceLabel", "PriceTag"]);
  const b = call("find_reusable", { query: "button", kind: "component" }).ok.results;
  assert.equal(b[0].id, BUTTON);
  assert.ok(b[0].callers >= 1 && b[0].area === "components");
  assert.equal(call("find_reusable", { query: "price", limit: 1 }).ok.results.length, 1);
  const old = call("find_reusable", { query: "old card" }).ok.results[0];
  assert.equal(old.deprecated, true);
  assert.match(call("find_reusable", { query: "x", kind: "bogus" }).error, /kind/);
});

test("callers: Button is rendered by Summary with prop names", () => {
  const { call } = setup();
  const r = call("callers", { id: BUTTON }).ok;
  assert.equal(r.id, BUTTON);
  const site = r.callers.find((c: any) => c.from === "src/features/checkout/Summary.tsx#Summary");
  assert.ok(site && site.file === "src/features/checkout/Summary.tsx" && site.line > 0);
  assert.deepEqual(site.props, ["onClick"]);
  assert.match(call("callers", { id: "nope#Nope" }).error, /unknown/);
});

test("component: by id or unique name, with usages, renders and calls", () => {
  const { call } = setup();
  const byName = call("component", { id_or_name: "Button" }).ok;
  assert.equal(byName.symbol.id, BUTTON);
  assert.deepEqual(call("component", { id_or_name: BUTTON }).ok.symbol, byName.symbol);
  assert.ok(byName.used_by.some((u: any) => u.from.endsWith("#Summary") && u.props.includes("onClick")));
  const summary = call("component", { id_or_name: "Summary" }).ok;
  assert.ok(summary.renders.some((u: any) => u.target === BUTTON));
  const total = call("component", { id_or_name: "Total" }).ok;
  assert.ok(total.calls.some((c: any) => c.target.endsWith("#useAppStore")));
});

test("component: ambiguous and unknown names are errors listing candidates", () => {
  const { call, dir } = setup();
  assert.match(call("component", { id_or_name: "Nothing" }).error, /not found/);
  cpSync(path.join(dir, "src/features/cart/PriceTag.tsx"), path.join(dir, "src/features/cart/Dup.tsx"));
  cpSync(path.join(dir, "src/features/cart/PriceTag.tsx"), path.join(dir, "src/features/checkout/Dup.tsx"));
  for (const f of ["cart", "checkout"]) {
    const file = path.join(dir, `src/features/${f}/Dup.tsx`);
    writeFileSync(file, readFileSync(file, "utf8").replace("PriceTag", "Dup"));
  }
  call("reindex");
  const err = call("component", { id_or_name: "Dup" }).error;
  assert.match(err, /ambiguous/);
  assert.match(err, /cart\/Dup\.tsx#Dup/);
  assert.match(err, /checkout\/Dup\.tsx#Dup/);
});

test("reindex tool reports and refreshes the cache", () => {
  const { call, dir } = setup();
  call("find_reusable", { query: "button" });
  const r = call("reindex", {}).ok;
  assert.equal(r.degraded, false);
  assert.deepEqual(r.changed_files, []);
  cpSync(path.join(dir, "src/features/cart/PriceTag.tsx"), path.join(dir, "src/features/cart/Extra.tsx"));
  const r2 = call("reindex", {}).ok;
  assert.deepEqual(r2.changed_files, ["src/features/cart/Extra.tsx"]);
  assert.ok(call("find_reusable", { query: "extra price" }).ok.results.some((x: any) => x.file.endsWith("Extra.tsx")));
});

test("stdio: tools/list and tools/call find_reusable via REACT_ATLAS_ROOT", async () => {
  const dir = copy();
  const child = spawn(process.execPath, ["bin/react-atlas.ts", "server"], { stdio: ["pipe", "pipe", "inherit"], env: { ...process.env, REACT_ATLAS_ROOT: dir } });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  const rpc = (id: number, method: string, params?: unknown) => JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
  child.stdin.write(rpc(1, "tools/list"));
  child.stdin.write(rpc(2, "tools/call", { name: "find_reusable", arguments: { query: "price tag" } }));
  child.stdin.end();
  await new Promise((resolve) => child.on("close", resolve));
  const [list, call] = out.trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(list.result.tools.map((t: any) => t.name), NAMES);
  const results = JSON.parse(call.result.content[0].text).results;
  assert.match(results[0].id, /PriceTag|PriceLabel/);
});

test("set_purpose: purpose-only words find the symbol; unknown id rejected", () => {
  const { call } = setup();
  assert.deepEqual(call("find_reusable", { query: "zebra stripes" }).ok.results, []);
  assert.match(call("set_purpose", { area: "components", id: "nope#Nope", text: "x" }).error, /unknown symbol/);
  call("set_purpose", { area: "components", id: BUTTON, text: "renders zebra stripes" });
  const r = call("find_reusable", { query: "zebra stripes" }).ok.results;
  assert.equal(r[0].id, BUTTON);
  assert.equal(r[0].purpose, "renders zebra stripes");
});

test("record_pattern text boosts cited symbols; evidence validated", () => {
  const { call } = setup();
  assert.match(call("record_pattern", { area: "components", op: "add", entry: { kind: "rule", text: "x", evidence: ["nope#Nope"] } }).error, /unknown evidence/);
  const e = call("record_pattern", { area: "components", op: "add", entry: { kind: "rule", text: "prefer quokka widgets", evidence: [BUTTON] } }).ok;
  assert.equal(e.id, "components-1");
  assert.equal(call("find_reusable", { query: "quokka" }).ok.results[0].id, BUTTON);
  call("record_pattern", { area: "components", op: "retire", entry: { id: "components-1" } });
  assert.deepEqual(call("find_reusable", { query: "quokka" }).ok.results, []);
});

test("context_for_task via tool; usage log records tool and results", () => {
  const { call, dir } = setup();
  call("record_pattern", { area: "cart", op: "add", entry: { kind: "rule", text: "cart rule", evidence: [BUTTON] } });
  const r = call("context_for_task", { task: "tweak cart", areas: ["cart", "zzz"] }).ok;
  assert.deepEqual(r.areas.cart.entries.map((e: any) => e.id), ["cart-1"]);
  assert.deepEqual(r.unknown_areas, ["zzz"]);
  call("find_reusable", { query: "button" });
  call("audit", { paths: ["src/features/cart"], checks: ["ds_bypass"] });
  const lines = readFileSync(path.join(dir, ".react_atlas/usage.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(lines.map((l) => l.tool), ["context_for_task", "find_reusable", "audit"]);
  assert.ok(lines[2].results.includes("ds_bypass src/features/cart/CartButton.tsx"));
  assert.ok(lines[0].results.includes("cart-1"));
  assert.ok(lines[1].results.includes(BUTTON));
});

test("reindex report includes stale entries", () => {
  const { call, dir } = setup();
  call("record_pattern", { area: "components", op: "add", entry: { kind: "rule", text: "r", evidence: ["src/components/ui/OldCard.tsx#OldCard"] } });
  rmSync(path.join(dir, "src/components/ui/OldCard.tsx"));
  assert.deepEqual(call("reindex", {}).ok.stale.map((s: any) => s.entry_id), ["components-1"]);
});

test("audit tool: findings with summary, paths and checks filters, unknown check rejected", () => {
  const { call } = setup();
  const r = call("audit", {}).ok;
  const dup = r.findings.find((f: any) => f.check === "duplicate_component");
  assert.equal(dup.file, "src/features/checkout/PriceLabel.tsx");
  assert.equal(r.summary.duplicate_component, 1);
  assert.ok(r.findings.some((f: any) => f.check === "ds_bypass" && f.severity === "error"));
  assert.equal(call("audit", { paths: ["src/features/cart"], checks: ["duplicate_component"] }).ok.findings.length, 0);
  assert.match(call("audit", { checks: ["nope"] }).error, /unknown check/);
});

test("cli audit: prints file:line  check  message", () => {
  const dir = copy();
  const r = spawnSync(process.execPath, [path.resolve("bin/react-atlas.ts"), "audit"], { cwd: dir, encoding: "utf8" });
  assert.match(r.stdout, /^src\/features\/checkout\/PriceLabel\.tsx:\d+ {2}duplicate_component {2}/m);
  assert.match(r.stdout, /^src\/features\/cart\/CartButton\.tsx:3 {2}ds_bypass {2}/m);
  assert.equal(r.status, 1);
  const clean = spawnSync(process.execPath, [path.resolve("bin/react-atlas.ts"), "audit", "src/store"], { cwd: dir, encoding: "utf8" });
  assert.equal(clean.status, 0);
});

test("state_map tool: all stores and contexts, filter by name or id", () => {
  const { call } = setup();
  const all = call("state_map", {}).ok.stores;
  assert.deepEqual(all.map((s: any) => s.kind).sort(), ["context", "store"]);
  const one = call("state_map", { store: "useStore" }).ok.stores;
  assert.equal(one.length, 1);
  assert.deepEqual(one[0].wrappers, ["src/store/hooks.ts#useAppStore"]);
  assert.equal(call("state_map", { store: "src/features/cart/CartContext.ts#CartContext" }).ok.stores[0].readers.length, 3);
  assert.deepEqual(call("state_map", { store: "nope" }).ok.stores, []);
});
