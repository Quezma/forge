import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { audit } from "./audit.ts";
import { buildContext } from "./context.ts";
import { loadConfig } from "./config.ts";
import { load, reindex } from "./index_store.ts";
import { REPO_ROOT } from "./learnings.ts";
import { loadAll, patternText, purposes } from "./patterns.ts";
import { buildCorpus, find } from "./search.ts";

const EVAL_DEPTH = 50;

/** package.json `name` reduced to [a-z0-9_-]; falls back to the directory name. */
export function projectName(root: string): string {
  let name = path.basename(root);
  try {
    name = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).name || name;
  } catch {}
  return String(name).toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
}

const readJsonl = (file: string): any[] =>
  existsSync(file) ? readFileSync(file, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l)) : [];

const label = (f: any) => f.args?.query ?? f.args?.task ?? (f.tool === "audit" ? `${f.expect?.check} ${f.expect?.file}` : "(malformed)");
const hit = (expect: string, id: string) => id === expect || (!expect.includes("#") && id.endsWith(`#${expect}`));

/** Rank (1-based) of the expectation for a find_reusable fixture within `limit` results, or null. */
function check(index: any, root: string, f: any, limit: number): { pass: boolean; rank?: number; top: string[] } {
  if (typeof f.expect !== "string" && f.tool !== "audit") return { pass: false, top: ["malformed fixture: expect must be a string"] };
  const loaded = loadAll(root);
  if (f.tool === "find_reusable" && typeof f.args?.query === "string") {
    const corpus = buildCorpus(index, { purposes: purposes(loaded), patternText: patternText(loaded) });
    const top = find(corpus, f.args.query, { limit }).map((r) => r.id);
    const i = top.findIndex((id) => hit(f.expect, id));
    return { pass: i >= 0, rank: i + 1, top };
  }
  if (f.tool === "context_for_task" && typeof f.args?.task === "string" && Array.isArray(f.args?.areas)) {
    const r = buildContext(index, loaded, f.args.task, f.args.areas);
    const ids = [...r.global, ...Object.values(r.areas).flatMap((v: any) => v.entries), ...Object.values(r.neighbours).flatMap((v: any) => v.entries)].map((e: any) => e.id);
    return { pass: ids.includes(f.expect), top: [] };
  }
  if (f.tool === "audit" && typeof f.expect?.check === "string" && typeof f.expect?.file === "string") {
    const { findings } = audit(index, { config: loadConfig(root), paths: f.args?.paths, checks: f.args?.checks });
    return { pass: findings.some((x) => x.check === f.expect.check && x.file === f.expect.file), top: findings.map((x) => `${x.check} ${x.file}`) };
  }
  return { pass: false, top: [`malformed fixture or unknown tool: ${f.tool}`] };
}

/** `react-atlas acceptance [--eval]`: runs the central fixtures for this project against its index. */
export function runAcceptance(root: string, opts: { repoRoot?: string; eval?: boolean } = {}): { lines: string[]; code: number } {
  const name = projectName(root);
  const file = path.join(opts.repoRoot ?? REPO_ROOT, "test", "acceptance", `${name}${opts.eval ? "_eval" : ""}.jsonl`);
  const fixtures = readJsonl(file);
  if (!fixtures.length) return { lines: [`no fixtures in ${file}`], code: 0 };
  const r = reindex(root);
  const index = load(root);
  if (!index || index === "corrupt") return { lines: [`react-atlas: cannot build index: ${r.compile_error ?? "unknown error"}`], code: 2 };

  if (opts.eval) {
    const idx = index;
    const ranks = fixtures.filter((f) => f.tool === "find_reusable").map((f) => (check(idx, root, f, EVAL_DEPTH).rank || null));
    const lines = fixtures.filter((f) => f.tool === "find_reusable").map((f, i) => `${label(f)} -> ${ranks[i] ? `rank ${ranks[i]}` : `miss (top ${EVAL_DEPTH})`}`);
    const n = ranks.length, at = (k: number) => ranks.filter((x) => x !== null && x <= k).length;
    const mrr = n ? ranks.reduce<number>((s, x) => s + (x !== null ? 1 / x : 0), 0) / n : 0;
    lines.push(`n=${n} ${[1, 5, 10].map((k) => `hit@${k}=${at(k)} (${(n ? at(k) / n : 0).toFixed(2)})`).join(" ")} MRR=${mrr.toFixed(3)}`);
    return { lines, code: 0 };
  }

  let failed = false;
  const lines = fixtures.map((f) => {
    const c = check(index, root, f, f.top_k ?? 5);
    if (c.pass) return `PASS ${f.tool} ${label(f)}${c.rank ? ` -> rank ${c.rank}` : ""}`;
    failed = true;
    return `FAIL ${f.tool} ${label(f)} -> expected ${JSON.stringify(f.expect)}, got: ${c.top.slice(0, 3).join(", ")}`;
  });
  return { lines, code: failed ? 1 : 0 };
}
