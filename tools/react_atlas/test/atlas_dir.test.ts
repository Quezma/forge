import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { append } from "../src/usage_log.ts";
import { reindex } from "../src/index_store.ts";

// A hostile repo must not redirect our writes to files outside it through symlinks.
const setup = () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "ra-symlink-"));
  cpSync("test/fixtures/app", root, { recursive: true });
  const victim = path.join(mkdtempSync(path.join(os.tmpdir(), "ra-victim-")), "victim.txt");
  writeFileSync(victim, "original\n");
  return { root, victim };
};

test("refuses a symlinked .react_atlas directory", () => {
  const { root, victim } = setup();
  symlinkSync(path.dirname(victim), path.join(root, ".react_atlas"));
  assert.throws(() => append(root, "find_reusable", {}, []), /symlink/);
  assert.equal(readFileSync(victim, "utf8"), "original\n");
});

test("refuses a symlinked usage.jsonl", () => {
  const { root, victim } = setup();
  mkdirSync(path.join(root, ".react_atlas"));
  symlinkSync(victim, path.join(root, ".react_atlas", "usage.jsonl"));
  assert.throws(() => append(root, "find_reusable", {}, []));
  assert.equal(readFileSync(victim, "utf8"), "original\n");
});

test("refuses a symlinked index temp file", () => {
  const { root, victim } = setup();
  mkdirSync(path.join(root, ".react_atlas"));
  symlinkSync(victim, path.join(root, ".react_atlas", "index.json.tmp"));
  assert.throws(() => reindex(root, { full: true }));
  assert.equal(readFileSync(victim, "utf8"), "original\n");
});
