import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildIndex } from "../src/indexer.ts";
import { audit } from "../src/audit.ts";
import { loadConfig } from "../src/config.ts";
import { load, reindex } from "../src/index_store.ts";
import { record } from "../src/patterns.ts";

const root = fileURLToPath(new URL("./fixtures/app", import.meta.url));
const idx = buildIndex(root);
const cfg = loadConfig(root);

const WU = ["wrong_usage"];
test("wrong_usage: deprecated component is an error, deprecated prop a warning", () => {
  const { findings } = audit(idx, { config: cfg, checks: WU });
  const legacy = findings.find((f) => f.file === "src/features/checkout/Legacy.tsx")!;
  assert.equal(legacy.severity, "error");
  assert.match(legacy.message, /OldCard.*deprecated.*use Card/);
  assert.equal(legacy.related[0].id, "src/components/ui/OldCard.tsx#OldCard");
  const promo = findings.find((f) => f.file === "src/features/checkout/Promo.tsx")!;
  assert.equal(promo.severity, "warning");
  assert.match(promo.message, /prop kind/);
  assert.equal(findings.length, 2);
});

const copy = () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ra-wu-"));
  cpSync(root, dir, { recursive: true });
  rmSync(path.join(dir, ".react_atlas"), { recursive: true, force: true });
  return dir;
};
const chip = (dir: string, uses: string[]) => {
  writeFileSync(path.join(dir, "src/components/ui/Chip.tsx"), "export function Chip({ label, tone }: { label: string; tone?: string }) { return <i className={tone}>{label}</i>; }\n");
  writeFileSync(path.join(dir, "src/features/cart/Many.tsx"), `import { Chip } from "../../components/ui/Chip";\nexport function Many() {\n  return (\n    <div>\n${uses.map((u) => `      ${u}`).join("\n")}\n    </div>\n  );\n}\n`);
  reindex(dir, { full: true });
  return load(dir) as any;
};
const FIVE = ['<Chip label="a" tone="x" />', '<Chip label="b" tone="x" />', '<Chip label="c" tone="x" />', '<Chip label="d" tone="x" />'];

test("wrong_usage: prop outliers are off by default", () => {
  const i = chip(copy(), [...FIVE, '<Chip label="e" />']);
  assert.equal(audit(i, { config: cfg, checks: WU }).findings.filter((f) => f.severity === "info").length, 0);
});

test("wrong_usage: prop outlier is info; spread, few usages and config are respected", () => {
  const dir = copy();
  const on = { ...cfg, wrongUsage: { ...cfg.wrongUsage, outliers: true } };
  const i = chip(dir, [...FIVE, '<Chip label="e" />']);
  const { findings } = audit(i, { config: on, checks: WU });
  const info = findings.filter((f) => f.severity === "info");
  assert.equal(info.length, 1);
  assert.equal(info[0].file, "src/features/cart/Many.tsx");
  assert.equal(info[0].line, 9);
  assert.match(info[0].message, /tone/);
  assert.equal(audit(i, { config: { ...on, wrongUsage: { ...on.wrongUsage, minUsages: 6 } }, checks: WU }).findings.filter((f) => f.severity === "info").length, 0);
  assert.equal(audit(i, { config: { ...on, wrongUsage: { ...on.wrongUsage, dominance: 0.9 } }, checks: WU }).findings.filter((f) => f.severity === "info").length, 0);
  const sp = chip(dir, [...FIVE, "<Chip label=\"e\" {...rest} />"]);
  assert.equal(audit(sp, { config: on, checks: WU }).findings.filter((f) => f.severity === "info").length, 0);
});

test("wrong_usage: anti_pattern with a machine match is an error per matching usage", () => {
  const dir = copy();
  reindex(dir, { full: true });
  const i = load(dir) as any;
  const e = record(dir, i, "cart", "add", { kind: "anti_pattern", text: "No raw buttons in cart", evidence: ["src/components/ui/Button.tsx#Button"], match: { target: "intrinsic:button", from_area: "cart" } });
  const { findings } = audit(i, { config: cfg, checks: WU });
  const hit = findings.filter((f) => f.severity === "error" && f.file === "src/features/cart/CartButton.tsx");
  assert.equal(hit.length, 1);
  assert.match(hit[0].message, /No raw buttons in cart/);
  assert.match(hit[0].message, new RegExp(e.id));
  record(dir, i, "cart", "update", { id: e.id, match: { target: "intrinsic:button", from_area: "checkout" } });
  assert.equal(audit(i, { config: cfg, checks: WU }).findings.filter((f) => f.file === "src/features/cart/CartButton.tsx").length, 0);
});
