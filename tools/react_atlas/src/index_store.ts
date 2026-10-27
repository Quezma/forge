import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { buildIndex, isTestFile } from "./indexer.ts";
import { ensureDir, writeNoFollow } from "./atlas_dir.ts";
import { loadAll, stale, type Stale } from "./patterns.ts";

export type Index = Omit<ReturnType<typeof buildIndex>, "syntaxError">;
export type Report = { changed_files: string[]; degraded: boolean; compile_error?: string; pattern_review_needed: boolean; stale: Stale[]; warnings: string[] };

const FORMAT = 4; // bump whenever indexed fields change, so old indexes rebuild
const dir = (root: string) => path.join(root, ".react_atlas");
const file = (root: string) => path.join(dir(root), "index.json");

/** The saved index, null when absent, 'corrupt' when unreadable or from another format. */
export function load(root: string): Index | null | "corrupt" {
  if (!existsSync(file(root))) return null;
  try {
    const { format, ...index } = JSON.parse(readFileSync(file(root), "utf8"));
    return format === FORMAT && index.symbols && index.files ? index : "corrupt";
  } catch {
    return "corrupt";
  }
}

const sha1 = (f: string) => {
  try {
    return createHash("sha1").update(readFileSync(f, "utf8")).digest("hex");
  } catch {
    return undefined; // removed
  }
};

// Files that differ from the saved index. New files are only looked for inside top-level dirs
// that already hold indexed files, so root configs outside the program never look "new".
function staleFiles(root: string, old: Index): string[] {
  const stale = Object.entries(old.files).filter(([f, h]) => sha1(path.join(root, f)) !== h).map(([f]) => f);
  const tops = new Set(Object.keys(old.files).map((f) => f.split("/")[0]));
  for (const top of tops) {
    for (const abs of ts.sys.readDirectory(path.join(root, top), [".ts", ".tsx", ".js", ".jsx"], ["node_modules", ".react_atlas"])) {
      const rel = path.relative(root, abs).split(path.sep).join("/");
      if (!rel.endsWith(".d.ts") && !isTestFile(rel) && !(rel in old.files)) stale.push(rel);
    }
  }
  return stale;
}

const diff = (a: Record<string, string>, b: Record<string, string>) =>
  [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((f) => a[f] !== b[f]).sort();

export function reindex(rootArg: string, opts: { full?: boolean } = {}): Report {
  const root = path.resolve(rootArg);
  const report = rebuild(root, opts);
  const idx = load(root);
  return { ...report, stale: idx && idx !== "corrupt" ? stale(idx, loadAll(root)) : [] };
}

function rebuild(root: string, opts: { full?: boolean }): Report {
  const loaded = load(root);
  const old = loaded === null || loaded === "corrupt" ? null : loaded;
  if (old && !opts.full && staleFiles(root, old).length === 0) return { changed_files: [], degraded: false, pattern_review_needed: false, stale: [], warnings: [] };

  // ponytail: any change rebuilds the whole program (resolution needs the full project);
  // swap in ts.createProgram(..., oldProgram) reuse if rebuilds get slow on large repos.
  let built: ReturnType<typeof buildIndex>;
  try {
    built = buildIndex(root);
  } catch (e) {
    return degraded(e instanceof Error ? e.message : String(e));
  }
  const { syntaxError, ...index } = built;
  if (syntaxError) return degraded(syntaxError);

  ensureDir(root);
  const tmp = file(root) + ".tmp";
  writeNoFollow(tmp, JSON.stringify({ format: FORMAT, ...index }));
  renameSync(tmp, file(root));
  const changed = diff(old?.files ?? {}, index.files);
  const warnings = Object.keys(index.files).length ? [] : ["no source files indexed — check tsconfig include/references"];
  return { changed_files: changed, degraded: false, pattern_review_needed: changed.some((f) => f.startsWith("src/")), stale: [], warnings };
}

// Keeps the old index on disk untouched.
function degraded(compile_error: string): Report {
  return { changed_files: [], degraded: true, compile_error, pattern_review_needed: false, stale: [], warnings: [] };
}
