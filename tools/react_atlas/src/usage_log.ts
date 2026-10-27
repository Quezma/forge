import path from "node:path";
import { execFileSync } from "node:child_process";
import { ensureDir, writeNoFollow } from "./atlas_dir.ts";

const git = (root: string, args: string[]): string | null => {
  try {
    return execFileSync("git", args, { cwd: root, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return null; // not a repo, or git missing
  }
};

/** Appends one JSON line per tool call to .react_atlas/usage.jsonl. */
export function append(root: string, tool: string, input: unknown, results: string[]): void {
  const line = { ts: new Date().toISOString(), branch: git(root, ["rev-parse", "--abbrev-ref", "HEAD"]), sha: git(root, ["rev-parse", "HEAD"]), tool, input, results };
  writeNoFollow(path.join(ensureDir(root), "usage.jsonl"), JSON.stringify(line) + "\n", true);
}
