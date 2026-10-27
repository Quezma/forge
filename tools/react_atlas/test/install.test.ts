import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { install } from "../src/install.ts";

const proj = () => mkdtempSync(path.join(tmpdir(), "ra-install-"));
const read = (d: string, f: string) => readFileSync(path.join(d, f), "utf8");

test("creates .react_atlas, config with guessed design-system path, AGENTS.md block", () => {
  const d = proj();
  mkdirSync(path.join(d, "src/ui"), { recursive: true });
  const out = install(d).join("\n");
  assert.ok(existsSync(path.join(d, ".react_atlas/.gitignore")));
  assert.deepEqual(JSON.parse(read(d, ".react_atlas/config.json")).designSystem.paths, ["src/ui"]);
  const agents = read(d, "AGENTS.md");
  assert.match(agents, /<!-- react_atlas:start -->[\s\S]*context_for_task[\s\S]*<!-- react_atlas:end -->/);
  assert.match(out, /react-atlas index/);
  assert.match(out, /claude mcp add react_atlas -- react-atlas server/);
});

test("is idempotent: keeps config, replaces only the marked block", () => {
  const d = proj();
  install(d);
  writeFileSync(path.join(d, ".react_atlas/config.json"), '{"ignore":["x"]}');
  const agents = read(d, "AGENTS.md");
  writeFileSync(path.join(d, "AGENTS.md"), "# Mine\n\n" + agents.replace("find_reusable", "STALE") + "\ntail\n");
  install(d);
  assert.equal(read(d, ".react_atlas/config.json"), '{"ignore":["x"]}');
  const after = read(d, "AGENTS.md");
  assert.ok(after.startsWith("# Mine\n"));
  assert.ok(after.endsWith("tail\n"));
  assert.equal(after.split("react_atlas:start").length, 2);
  assert.ok(!after.includes("STALE"));
});

test("appends to an existing AGENTS.md without markers", () => {
  const d = proj();
  writeFileSync(path.join(d, "AGENTS.md"), "# Mine\n");
  install(d);
  assert.match(read(d, "AGENTS.md"), /^# Mine\n\n<!-- react_atlas:start -->/);
});

test("warns when CLAUDE.md does not import AGENTS.md", () => {
  const d = proj();
  writeFileSync(path.join(d, "CLAUDE.md"), "hi");
  assert.match(install(d).join("\n"), /CLAUDE\.md.*@AGENTS\.md/);
  writeFileSync(path.join(d, "CLAUDE.md"), "@AGENTS.md");
  assert.doesNotMatch(install(d).join("\n"), /CLAUDE\.md/);
});

test("design-system guess: first existing wins, in the documented order", () => {
  const guess = (...dirs: string[]) => {
    const d = proj();
    for (const x of dirs) mkdirSync(path.join(d, x), { recursive: true });
    install(d);
    return JSON.parse(read(d, ".react_atlas/config.json")).designSystem.paths[0];
  };
  assert.equal(guess("src/shared/ui", "src/components"), "src/shared/ui");
  assert.equal(guess("src/components/ui", "src/shared/ui"), "src/components/ui");
  assert.equal(guess("src/lib/ui", "src/components"), "src/lib/ui");
  assert.equal(guess("src/shared/components", "src/lib/ui"), "src/shared/components");
  assert.equal(guess("src/components"), "src/components");
});
