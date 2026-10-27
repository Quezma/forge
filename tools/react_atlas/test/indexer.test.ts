import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { cpSync, mkdtempSync, renameSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildIndex, isTestFile } from "../src/indexer.ts";
import { areaOf } from "../src/area.ts";
import { reindex } from "../src/index_store.ts";

const root = fileURLToPath(new URL("./fixtures/app", import.meta.url));
const idx = buildIndex(root);
const id = (f: string, n: string) => `src/${f}#${n}`;
const B = id("components/ui/Button.tsx", "Button");
const names = (props: { name: string }[]) => props.map((p) => p.name).sort();

test("components are detected with prop names", () => {
  const want: [string, string, string[]][] = [
    ["components/ui/Button.tsx", "Button", ["children", "kind", "onClick", "variant"]],
    ["components/ui/Input.tsx", "Input", ["onChange", "value"]],
    ["components/ui/OldCard.tsx", "OldCard", ["children"]],
    ["features/cart/PriceTag.tsx", "PriceTag", ["amount"]],
    ["features/checkout/PriceLabel.tsx", "PriceLabel", ["value"]],
  ];
  for (const [f, n, props] of want) {
    const s = idx.symbols[id(f, n)];
    assert.equal(s.kind, "component", n);
    assert.deepEqual(names(s.props), props, n);
  }
  const variant = idx.symbols[B].props.find((p: any) => p.name === "variant");
  assert.equal(variant.optional, true);
  assert.match(variant.type, /primary/);
});

test("deprecated symbols carry the tag text", () => {
  const s = idx.symbols[id("components/ui/OldCard.tsx", "OldCard")];
  assert.equal(s.deprecated, true);
  assert.equal(s.deprecatedText, "use Card");
  assert.equal(idx.symbols[B].deprecated, false);
});

test("hook, store and context kinds", () => {
  assert.equal(idx.symbols[id("store/hooks.ts", "useAppStore")].kind, "hook");
  assert.equal(idx.symbols[id("store/store.ts", "useStore")].kind, "store");
  assert.equal(idx.symbols[id("features/cart/CartContext.ts", "CartContext")].kind, "context");
});

test("raw intrinsic usage plus inline style and color literal", () => {
  const from = id("features/cart/CartButton.tsx", "CartButton");
  assert.ok(idx.usages.some((u: any) => u.from === from && u.target === "intrinsic:button"));
  const kinds = idx.styles.filter((s: any) => s.from === from).map((s: any) => s.kind).sort();
  assert.deepEqual(kinds, ["color_literal", "inline_style"]);
});

test("JSX usage resolves to the defining symbol with prop names", () => {
  const u = idx.usages.find((u: any) => u.from === id("features/checkout/Summary.tsx", "Summary"));
  assert.equal(u.target, B);
  assert.deepEqual(u.props, ["onClick"]);
  assert.equal(u.spread, false);
  assert.equal(u.file, "src/features/checkout/Summary.tsx");
});

test("import through a barrel resolves to the original symbol", () => {
  const u = idx.usages.find((u: any) => u.from === id("features/cart/CartBadge.tsx", "CartBadge"));
  assert.equal(u.target, id("components/ui/Input.tsx", "Input"));
});

test("state access calls are distinguished", () => {
  const callsFrom = (f: string, n: string) => idx.calls.filter((c: any) => c.from === id(f, n)).map((c: any) => c.target);
  assert.deepEqual(callsFrom("features/cart/CartCount.tsx", "CartCount"), [id("store/store.ts", "useStore")]);
  assert.deepEqual(callsFrom("features/checkout/Total.tsx", "Total"), [id("store/hooks.ts", "useAppStore")]);
  const badge = callsFrom("features/cart/CartBadge.tsx", "CartBadge");
  assert.ok(badge.includes("external:react#useContext"));
  assert.ok(badge.includes(id("features/cart/CartContext.ts", "CartContext")));
  const via = idx.calls.find((c: any) => c.via === "useContext");
  assert.equal(via.target, id("features/cart/CartContext.ts", "CartContext"));
});

test("callers counts distinct sites", () => {
  assert.equal(idx.symbols[B].callers, 2);
  assert.equal(idx.symbols[id("store/store.ts", "useStore")].callers, 2);
  assert.equal(idx.symbols[id("features/cart/CartContext.ts", "CartContext")].callers, 3);
  assert.equal(idx.symbols[id("features/cart/PriceTag.tsx", "PriceTag")].callers, 0);
});

test("areas", () => {
  assert.equal(idx.symbols[id("features/cart/CartButton.tsx", "CartButton")].area, "cart");
  assert.equal(idx.symbols[id("features/checkout/Summary.tsx", "Summary")].area, "checkout");
  assert.equal(idx.symbols[B].area, "components");
  assert.equal(idx.symbols[id("store/store.ts", "useStore")].area, "store");
  assert.equal(areaOf("src/App.tsx"), "other");
  assert.equal(areaOf("lib/x.ts"), "other");
  assert.equal(areaOf("src/components/ui/Button.tsx", { ds: ["src/components/ui"] }), "ds");
});

test("files, meta and JSON round trip", () => {
  assert.match(idx.files["src/components/ui/Button.tsx"], /^[0-9a-f]{40}$/);
  assert.ok(!Object.keys(idx.files).some((f) => f.endsWith(".d.ts") || f.includes("node_modules")));
  assert.equal(idx.meta.format, 4);
  assert.equal(idx.meta.tsVersion, "6.0.3");
  assert.deepEqual(JSON.parse(JSON.stringify(idx)), idx);
});

test("solution-style tsconfig (Vite default) follows references to the JSX project", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "ra-solution-"));
  cpSync(root, dir, { recursive: true });
  renameSync(path.join(dir, "tsconfig.json"), path.join(dir, "tsconfig.app.json"));
  writeFileSync(path.join(dir, "tsconfig.node.json"), JSON.stringify({ compilerOptions: { composite: true }, include: [] }));
  writeFileSync(path.join(dir, "tsconfig.json"), JSON.stringify({ files: [], references: [{ path: "./tsconfig.node.json" }, { path: "./tsconfig.app.json" }] }));
  const sol = buildIndex(dir);
  assert.ok(sol.symbols[B], "Button indexed through the referenced project");
  assert.equal(Object.keys(sol.symbols).length, Object.keys(idx.symbols).length);
});

test("test files are not indexed but stay in the program", () => {
  const T = "src/features/cart/PriceTag.test.tsx";
  assert.ok(!(T in idx.files));
  assert.ok(!Object.values(idx.symbols).some((s: any) => s.file === T));
  for (const e of [...idx.usages, ...idx.calls, ...idx.styles] as any[]) assert.notEqual(e.file, T);
  assert.deepEqual(["a.test.ts", "a.spec.jsx", "src/__tests__/x.ts"].map(isTestFile), [true, true, true]);
  assert.deepEqual(["a.ts", "src/contest.ts", "src/latest/x.ts"].map(isTestFile), [false, false, false]);
});

test("components record their root element target", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "ra-root-"));
  cpSync(root, dir, { recursive: true });
  writeFileSync(path.join(dir, "src/features/cart/Roots.tsx"), `import { Button } from "../../components/ui/Button";
export function Frag() { return <><b /></>; }
export function Wrap() { return <Button>x</Button>; }
export function Early({ a }: { a: boolean }) { if (a) return null; return (<p>x</p>); }
export const Arrow = () => <i />;
export function None() { return null; }
`);
  const r = buildIndex(dir).symbols;
  const rootOf = (n: string) => r[`src/features/cart/Roots.tsx#${n}`].root;
  assert.deepEqual([rootOf("Frag"), rootOf("Wrap"), rootOf("Early"), rootOf("Arrow")], [null, B, "intrinsic:p", "intrinsic:i"]);
  assert.equal(idx.symbols[B].root, "intrinsic:button");
  assert.equal(idx.symbols[id("components/ui/Card.tsx", "Card")].root, "intrinsic:div");
  assert.equal(idx.symbols[id("features/cart/PriceTag.tsx", "PriceTag")].root, "intrinsic:span");
});

test("inline styles record whether every value is a literal", () => {
  const st = (n: string) => idx.styles.find((s: any) => s.kind === "inline_style" && s.from === id("features/cart/" + n + ".tsx", n));
  assert.equal(st("CartButton").static, true);
  assert.equal(st("CartPanel").static, false);
});

test("no source files -> reindex warns", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "ra-empty-"));
  assert.deepEqual(reindex(dir).warnings, ["no source files indexed — check tsconfig include/references"]);
  const ok = mkdtempSync(path.join(os.tmpdir(), "ra-ok-"));
  cpSync(root, ok, { recursive: true });
  assert.deepEqual(reindex(ok).warnings, []);
});
