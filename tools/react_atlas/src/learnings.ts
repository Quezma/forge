import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeNoFollow } from "./atlas_dir.ts";

export const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const REQUIRED = ["project", "branch", "cause", "query", "tool", "expected", "actual", "evidence"];
const TOOLS = ["find_reusable", "context_for_task", "audit"];

// ponytail: single append per line, no cross-process locking
const append = (file: string, obj: unknown) => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeNoFollow(file, JSON.stringify(obj) + "\n", true);
};

/** Audit expectations are `{check, file}` or the string "check file". */
function auditExpect(e: any): { check: string; file: string } | null {
  if (typeof e === "string") {
    const m = e.trim().match(/^(\S+)\s+(\S+)$/);
    return m ? { check: m[1], file: m[2] } : null;
  }
  return e && typeof e.check === "string" && typeof e.file === "string" && e.check && e.file ? { check: e.check, file: e.file } : null;
}

/** Appends a learning to `<repoRoot>/learnings/open.jsonl` (+ an acceptance fixture for tool misses). */
export function record(repoRoot: string, l: any): { ok: true } | { error: string } {
  const missing = REQUIRED.find((k) => l?.[k] === undefined || l[k] === null);
  if (missing) return { error: `missing: ${missing}` };
  if (!["tool_miss", "agent_ignored"].includes(l.cause)) return { error: `invalid cause: ${JSON.stringify(l.cause)}` };
  if (typeof l.project !== "string" || !/^[a-z0-9_-]+$/.test(l.project)) return { error: `invalid project: ${JSON.stringify(l.project)}` };
  if (!TOOLS.includes(l.tool)) return { error: `invalid tool: ${JSON.stringify(l.tool)}` };
  const expect = l.tool === "audit" ? auditExpect(l.expected) : l.expected;
  if (!expect || (typeof expect === "string" && !expect.trim())) return { error: l.tool === "audit" ? "invalid expected: audit needs 'check file'" : "invalid expected: must be a non-empty string" };
  if (l.args !== undefined && (typeof l.args !== "object" || l.args === null || Array.isArray(l.args))) return { error: "invalid args: must be an object" };
  if (l.tool === "context_for_task" && !(typeof l.args?.task === "string" && Array.isArray(l.args?.areas))) return { error: "invalid args: context_for_task needs task (string) and areas (list)" };

  append(path.join(repoRoot, "learnings", "open.jsonl"), { ...l, recorded_at: new Date().toISOString() });
  if (l.cause === "tool_miss") {
    const args = l.tool === "find_reusable" ? { query: l.query, ...l.args } : (l.args ?? {});
    append(path.join(repoRoot, "test", "acceptance", `${l.project}.jsonl`), { tool: l.tool, args, expect, top_k: 5 });
  }
  return { ok: true };
}
