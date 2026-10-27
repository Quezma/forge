import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runAcceptance, projectName } from "../src/acceptance.ts";

const fixture = fileURLToPath(new URL("./fixtures/app", import.meta.url));
const bin = fileURLToPath(new URL("../bin/react-atlas.ts", import.meta.url));
const copy = () => {
  const d = mkdtempSync(path.join(tmpdir(), "ra-acc-"));
  cpSync(fixture, d, { recursive: true });
  rmSync(path.join(d, ".react_atlas"), { recursive: true, force: true });
  return d;
};
const repoWith = (name: string, fixtures: object[]) => {
  const r = mkdtempSync(path.join(tmpdir(), "ra-accrepo-"));
  mkdirSync(path.join(r, "test/acceptance"), { recursive: true });
  writeFileSync(path.join(r, `test/acceptance/${name}.jsonl`), fixtures.map((f) => JSON.stringify(f)).join("\n") + "\n");
  return r;
};

test("projectName sanitizes package.json name", () => {
  const d = mkdtempSync(path.join(tmpdir(), "ra-pn-"));
  writeFileSync(path.join(d, "package.json"), '{"name":"@Acme/My App"}');
  assert.equal(projectName(d), "acme_my_app");
});

test("CLI: seeded fixtures all PASS, exit 0", () => {
  const r = spawnSync("node", [bin, "acceptance"], { cwd: copy(), encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const out = r.stdout.trim().split("\n");
  assert.ok(out.length >= 4 && out.every((l) => l.startsWith("PASS")), r.stdout);
});

test("all tool kinds pass and fail correctly, exit 1 on any fail", () => {
  const d = copy();
  const repoRoot = repoWith("fixture-app", [
    { tool: "find_reusable", args: { query: "price tag" }, expect: "PriceTag", top_k: 5 },
    { tool: "context_for_task", args: { task: "x", areas: ["components"] }, expect: "nope" },
    { tool: "audit", args: {}, expect: { check: "ds_bypass", file: "src/features/cart/CartButton.tsx" } },
  ]);
  const { lines, code } = runAcceptance(d, { repoRoot });
  assert.deepEqual(lines.map((l) => l.split(" ")[0]), ["PASS", "FAIL", "PASS"]);
  assert.equal(code, 1);
});

test("a failing audit fixture exits 1", () => {
  const repoRoot = repoWith("fixture-app", [{ tool: "audit", args: {}, expect: { check: "ds_bypass", file: "src/Nope.tsx" } }]);
  assert.equal(runAcceptance(copy(), { repoRoot }).code, 1);
});

test("--eval prints ranks and summary, never fails", () => {
  const repoRoot = repoWith("fixture-app_eval", [
    { tool: "find_reusable", args: { query: "price tag" }, expect: "PriceTag" },
    { tool: "find_reusable", args: { query: "zzzzqqq" }, expect: "Missing" },
  ]);
  const { lines, code } = runAcceptance(copy(), { repoRoot, eval: true });
  assert.equal(code, 0);
  assert.match(lines[0], /rank \d+/);
  assert.match(lines[1], /miss/);
  assert.match(lines.at(-1)!, /n=2 hit@1=\d.*hit@5=.*hit@10=.*MRR=/);
});
