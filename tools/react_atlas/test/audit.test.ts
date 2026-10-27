import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { cpSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildIndex } from "../src/indexer.ts";
import { audit } from "../src/audit.ts";
import { loadConfig } from "../src/config.ts";
import { stateMap } from "../src/checks/state_misuse.ts";

const root = fileURLToPath(new URL("./fixtures/app", import.meta.url));
const idx = buildIndex(root);
const cfg = loadConfig(root);
const TAG = "src/features/cart/PriceTag.tsx";
const LABEL = "src/features/checkout/PriceLabel.tsx";

test("config: defaults and shallow per-key merge", () => {
  assert.deepEqual(cfg.designSystem.paths, ["src/components/ui"]);
  assert.deepEqual(cfg.designSystem.packages, []);
  assert.ok(["div", "span", "p", "ul", "h1", "svg"].every((t) => cfg.designSystem.structuralTags.includes(t)));
  assert.ok(!cfg.designSystem.structuralTags.includes("button"));
  assert.deepEqual(cfg.duplicates, { threshold: 0.85, minNodes: 3 });
  assert.deepEqual(cfg.wrongUsage, { minUsages: 5, dominance: 0.8, outliers: false });
  assert.deepEqual(cfg.state, { allowedAreas: {} });
  assert.deepEqual(cfg.ignore, []);
});

test("indexer: components carry a shape fingerprint", () => {
  const tag = idx.symbols[`${TAG}#PriceTag`];
  assert.deepEqual(tag.shape, idx.symbols[`${LABEL}#PriceLabel`].shape);
  assert.equal(tag.shapeSize, 3);
  assert.ok(tag.shape.includes("{") && tag.shape.includes("}") && !tag.shape.some((t: string) => t.includes("price")));
});

test("duplicate_component: PriceTag/PriceLabel flagged once, anchored at the later file", () => {
  const { findings, summary } = audit(idx, { config: cfg, checks: ["duplicate_component"] });
  assert.equal(findings.length, 1);
  const f = findings[0];
  assert.equal(f.check, "duplicate_component");
  assert.equal(f.severity, "warning");
  assert.equal(f.file, LABEL); // checkout > cart
  assert.equal(f.related[0].file, TAG);
  assert.match(f.message, /PriceLabel is one of 2 near-identical components; reuse PriceTag \(src\/features\/cart\/PriceTag\.tsx\)/);
  assert.match(f.evidence, /min score 1\.00/);
  assert.equal(summary.duplicate_component, 1);
});

const copyApp = () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ra-audit-"));
  cpSync(root, dir, { recursive: true });
  return dir;
};

test("duplicate_component: a cluster of 3 copies yields 2 findings, canonical = most callers", () => {
  const dir = copyApp();
  writeFileSync(path.join(dir, "src/features/checkout/PriceBadge.tsx"), 'export function PriceBadge({ cost }: { cost: number }) {\n  return <span className="price">{`$${cost.toFixed(2)}`}</span>;\n}\n');
  writeFileSync(path.join(dir, "src/features/checkout/UsesBadge.tsx"), 'import { PriceBadge } from "./PriceBadge";\nexport function UsesBadge() {\n  return <PriceBadge cost={1} />;\n}\n');
  const i = buildIndex(dir);
  const { findings } = audit(i, { config: cfg, checks: ["duplicate_component"] });
  assert.deepEqual(findings.map((f) => f.symbol).sort(), ["src/features/checkout/PriceLabel.tsx#PriceLabel", "src/features/cart/PriceTag.tsx#PriceTag"].sort());
  for (const f of findings) {
    assert.match(f.message, /one of 3 near-identical components; reuse PriceBadge \(src\/features\/checkout\/PriceBadge\.tsx\)/);
    assert.equal(f.related[0].id, "src/features/checkout/PriceBadge.tsx#PriceBadge");
    assert.equal(f.related.length, 2);
  }
});

test("duplicate_component: Button vs Input and wrapper components are not flagged", () => {
  const { findings } = audit(idx, { config: cfg, checks: ["duplicate_component"] });
  assert.ok(findings.every((f) => !f.file.includes("ui/")));
  const shape = ["<div", "@className", "<Inner", "/Inner", "/div"];
  const mk = (id: string, shape: string[]) => ({ id, name: id, kind: "component", file: id + ".tsx", line: 1, props: [], callers: 0, shape, shapeSize: 4 });
  const fake: any = { symbols: { A: mk("A", shape), B: mk("B", shape) }, usages: [{ from: "A", target: "B", file: "A.tsx", line: 1 }], calls: [], styles: [] };
  assert.equal(audit(fake, { config: cfg, checks: ["duplicate_component"] }).findings.length, 0);
  fake.usages = [];
  assert.equal(audit(fake, { config: cfg, checks: ["duplicate_component"] }).findings.length, 1);
});

test("duplicate_component: threshold and minNodes from config", () => {
  const strict = { ...cfg, duplicates: { threshold: 1.01, minNodes: 3 } };
  assert.equal(audit(idx, { config: strict, checks: ["duplicate_component"] }).findings.length, 0);
  const big = { ...cfg, duplicates: { threshold: 0.85, minNodes: 4 } };
  assert.equal(audit(idx, { config: big, checks: ["duplicate_component"] }).findings.length, 0);
});

test("audit: paths filter and sorting", () => {
  assert.equal(audit(idx, { config: cfg, paths: ["src/features/cart"], checks: ["duplicate_component"] }).findings.length, 0);
  assert.equal(audit(idx, { config: cfg, paths: ["src/features/checkout"], checks: ["duplicate_component"] }).findings.length, 1);
});

const BYPASS = ["ds_bypass"];
const ds = (paths: string[]) => ({ ...cfg, designSystem: { ...cfg.designSystem, paths } });

test("ds_bypass: raw <button> is an error pointing at Button; style and color are warnings", () => {
  const { findings } = audit(idx, { config: cfg, checks: BYPASS });
  const cart = findings.filter((f) => f.file === "src/features/cart/CartButton.tsx");
  const err = cart.filter((f) => f.severity === "error");
  assert.equal(err.length, 1);
  assert.match(err[0].message, /<button>.*Button/);
  assert.deepEqual(err[0].related.map((r) => r.id), ["src/components/ui/Button.tsx#Button"]); // Card renders a <button> but its root is <div>
  assert.equal(err[0].line, 3);
  assert.equal(cart.filter((f) => f.severity === "warning").length, 2); // static inline style + color
  assert.ok(cart.some((f) => /inline style/i.test(f.message)));
  assert.ok(cart.some((f) => /design tokens/i.test(f.message)));
});

test("ds_bypass: clean files, DS internals and unwrapped tags report nothing", () => {
  const files = audit(idx, { config: cfg, checks: BYPASS }).findings.map((f) => f.file);
  assert.deepEqual([...new Set(files)], ["src/features/cart/CartButton.tsx"]);
  const fake: any = {
    symbols: { "ui/B.tsx#B": { id: "ui/B.tsx#B", name: "B", kind: "component", file: "ui/B.tsx", line: 1 } },
    usages: [
      { from: "ui/B.tsx#B", target: "intrinsic:button", file: "ui/B.tsx", line: 2 },
      { from: "a.tsx#A", target: "intrinsic:span", file: "a.tsx", line: 2 },
    ],
    styles: [], calls: [],
  };
  assert.equal(audit(fake, { config: ds(["ui"]), checks: BYPASS }).findings.length, 0);
});

test("ds_bypass: raw div is silent although a DS component renders a div; dynamic style is silent", () => {
  const { findings } = audit(idx, { config: cfg, checks: BYPASS });
  assert.equal(findings.filter((f) => f.file === "src/features/cart/CartPanel.tsx").length, 0);
  // a tag is flagged only when it is the ROOT of a DS component and not structural
  const fake: any = {
    symbols: {
      "ui/Box.tsx#Box": { id: "ui/Box.tsx#Box", name: "Box", kind: "component", file: "ui/Box.tsx", line: 1, root: "intrinsic:div" },
      "ui/Link.tsx#Link": { id: "ui/Link.tsx#Link", name: "Link", kind: "component", file: "ui/Link.tsx", line: 1, root: "intrinsic:a" },
    },
    // the DS components forward props to their root, which is what makes them wrappers
    usages: [
      { from: "ui/Box.tsx#Box", target: "intrinsic:div", file: "ui/Box.tsx", line: 1, spread: true },
      { from: "ui/Link.tsx#Link", target: "intrinsic:a", file: "ui/Link.tsx", line: 1, spread: true },
      { from: "x.tsx#X", target: "intrinsic:div", file: "x.tsx", line: 2 },
      { from: "x.tsx#X", target: "intrinsic:a", file: "x.tsx", line: 3 },
    ],
    styles: [], calls: [],
  };
  assert.deepEqual(audit(fake, { config: ds(["ui"]), checks: BYPASS }).findings.map((f) => f.line), [3]);
  const loose = { ...ds(["ui"]), designSystem: { paths: ["ui"], packages: [], structuralTags: [] } };
  assert.deepEqual(audit(fake, { config: loose, checks: BYPASS }).findings.map((f) => f.line), [2, 3]);
});

test("ds_bypass: custom designSystem.paths changes the result", () => {
  const { findings } = audit(idx, { config: ds(["src/features/cart"]), checks: BYPASS });
  // CartButton renders <button> but forwards no props, so it does not become the button wrapper
  assert.ok(!findings.some((f) => f.severity === "error" && f.file === "src/components/ui/Button.tsx"));
  assert.ok(findings.every((f) => !f.file.startsWith("src/features/cart")));
  assert.ok(audit(idx, { config: cfg, checks: BYPASS }).findings.some((f) => f.file.startsWith("src/features/cart")), "default paths still flag cart");
});

const STORE = "src/store/store.ts#useStore";
const HOOK = "src/store/hooks.ts#useAppStore";
const CTX = "src/features/cart/CartContext.ts#CartContext";
const USE_CART = "src/features/cart/useCart.ts#useCart";
const SM = ["state_misuse"];

test("state_misuse: raw store and raw context calls are warnings pointing at the wrapper", () => {
  const { findings } = audit(idx, { config: cfg, checks: SM });
  const by = (f: string) => findings.filter((x) => x.file === f);
  const count = by("src/features/cart/CartCount.tsx");
  assert.equal(count.length, 1);
  assert.equal(count[0].severity, "warning");
  assert.equal(count[0].line, 5);
  assert.match(count[0].message, /use useAppStore instead of useStore/);
  assert.equal(count[0].related[0].id, HOOK);
  for (const f of ["CartBadge", "CartTotals"]) {
    const r = by(`src/features/cart/${f}.tsx`);
    assert.equal(r.length, 1, f);
    assert.equal(r[0].related[0].id, USE_CART);
    assert.match(r[0].message, /use useCart instead of CartContext/);
  }
  assert.equal(findings.length, 3); // Total, the wrappers and the store file are clean
});

test("state_misuse: allowedAreas turns calls from other areas into errors", () => {
  const c = { ...cfg, state: { allowedAreas: { [STORE]: ["checkout", "store"] } } };
  const { findings } = audit(idx, { config: c, checks: SM });
  const count = findings.filter((f) => f.file === "src/features/cart/CartCount.tsx");
  assert.deepEqual(count.map((f) => f.severity), ["error"]);
  assert.match(count[0].message, /area cart/);
  assert.equal(findings.filter((f) => f.severity === "error").length, 1);
});

test("state_misuse: external state APIs wrapped by a project hook", () => {
  const sym = (id: string, kind: string, file: string) => ({ id, name: id.split("#")[1], kind, file, line: 1, area: "a" });
  const fake: any = {
    symbols: { "w.ts#useSel": sym("w.ts#useSel", "hook", "w.ts"), "c.tsx#C": sym("c.tsx#C", "component", "c.tsx") },
    usages: [], styles: [],
    calls: [
      { from: "w.ts#useSel", target: "external:react-redux#useSelector", file: "w.ts", line: 2 },
      { from: "c.tsx#C", target: "external:react-redux#useSelector", file: "c.tsx", line: 3 },
      { from: "c.tsx#C", target: "external:react#useContext", file: "c.tsx", line: 4 }, // generic: no specific context
    ],
  };
  const { findings } = audit(fake, { config: cfg, checks: SM });
  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /use useSel instead of useSelector/);
  assert.equal(findings[0].related[0].id, "w.ts#useSel");
});

test("stateMap: stores and contexts with wrappers, readers, areas", () => {
  const stores: any[] = stateMap(idx).stores;
  assert.deepEqual(stores.map((s: any) => s.id).sort(), [CTX, STORE].sort());
  const st = stores.find((s: any) => s.id === STORE);
  assert.equal(st.kind, "store");
  assert.deepEqual(st.wrappers, [HOOK]);
  assert.deepEqual(st.readers.map((r: any) => r.from.split("#")[1]).sort(), ["CartCount", "useAppStore"]);
  assert.deepEqual(st.areas.sort(), ["cart", "store"]);
  const cx = stores.find((s: any) => s.id === CTX);
  assert.deepEqual(cx.wrappers, [USE_CART]);
  assert.equal(cx.readers.length, 3);
  assert.ok(cx.readers.every((r: any) => r.via === "useContext" && r.line > 0 && r.file));
  assert.deepEqual(stateMap(idx, "CartContext").stores.map((s: any) => s.id), [CTX]);
  assert.deepEqual(stateMap(idx, STORE).stores.map((s: any) => s.id), [STORE]);
  assert.deepEqual(stateMap(idx, "nope").stores, []);
});

test("duplicate_component: list components differing only inside .map() are not duplicates", () => {
  const dir = copyApp();
  const list = (name: string, inner: string) =>
    `export function ${name}({ rows }: { rows: string[] }) {\n  return (\n    <ul className="grid">\n      {rows.map((r) => (\n        ${inner}\n      ))}\n    </ul>\n  );\n}\n`;
  writeFileSync(path.join(dir, "src/features/cart/ListA.tsx"), list("ListA", `<li key={r}><strong>{r}</strong><em>{r}</em></li>`));
  writeFileSync(path.join(dir, "src/features/checkout/ListB.tsx"), list("ListB", `<li key={r}><section><h3>{r}</h3><p>{r}</p><small>{r}</small></section></li>`));
  writeFileSync(path.join(dir, "src/features/checkout/ListC.tsx"), list("ListC", `<li key={r}><strong>{r}</strong><em>{r}</em></li>`));
  const found = audit(buildIndex(dir), { config: loadConfig(dir), checks: ["duplicate_component"] }).findings;
  const names = found.map((f: any) => f.symbol ?? f.message).join(" | ");
  assert.ok(!/ListB/.test(names), `ListB must not cluster with ListA/ListC: ${names}`);
  assert.ok(/ListC|ListA/.test(names), `ListA and ListC are real copies: ${names}`);
});

test("ds_bypass: only DS components that forward props ({...rest}) to their root wrap a tag", () => {
  const dir = copyApp();
  writeFileSync(path.join(dir, "src/components/ui/Logo.tsx"), `export function Logo() {\n  return <img src="/logo.svg" alt="logo" />;\n}\n`);
  writeFileSync(path.join(dir, "src/features/cart/Avatar.tsx"), `export function Avatar({ src }: { src: string }) {\n  return <img src={src} alt="" />;\n}\n`);
  const found = audit(buildIndex(dir), { config: loadConfig(dir), checks: BYPASS }).findings;
  assert.ok(!found.some((f: any) => f.file.endsWith("Avatar.tsx")), "Logo does not forward props, so it is not the img wrapper");
  assert.ok(found.some((f: any) => f.file.endsWith("CartButton.tsx") && f.severity === "error"), "Button forwards props and still wraps <button>");
});

test("ds_bypass: animation/transition-only static styles are silent; color messages name only the color", () => {
  const dir = copyApp();
  writeFileSync(path.join(dir, "src/features/cart/Fade.tsx"), `export function Fade() {\n  return <div style={{ animationDelay: "80ms", transitionDuration: "1s" }}>x</div>;\n}\n`);
  writeFileSync(path.join(dir, "src/features/cart/Marker.tsx"), `export function Marker() {\n  const css = "display:block;border:3px solid var(--x);box-shadow:0 1px 4px rgba(0,0,0,.35)";\n  return <span data-css={css}>m</span>;\n}\n`);
  const found = audit(buildIndex(dir), { config: loadConfig(dir), checks: BYPASS }).findings;
  assert.ok(!found.some((f: any) => f.file.endsWith("Fade.tsx")), "timing-only style is not a design-system concern");
  const marker = found.find((f: any) => f.file.endsWith("Marker.tsx"));
  assert.equal(marker?.message, "hardcoded color rgba(0,0,0,.35); use design tokens");
});
