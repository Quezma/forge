import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ensureDir, writeNoFollow } from "./atlas_dir.ts";

// Ported from ex_atlas patterns.ex. Files: <root>/.react_atlas/patterns/<area>.json.
const KINDS = ["rule", "helper", "api", "anti_pattern"];
const AUDIENCES = ["internal", "external"];
const FIELDS = ["kind", "audience", "text", "evidence", "prevalence", "match"];

type Index = { symbols: Record<string, any> };
export type PatternFile = { area?: string; entries: any[]; purposes?: Record<string, string> };
export type Loaded = { areas: Record<string, PatternFile>; warnings: string[] };

const dir = (root: string) => path.join(root, ".react_atlas", "patterns");
const isStrings = (v: unknown) => Array.isArray(v) && v.every((x) => typeof x === "string");

function readFile(p: string): PatternFile | null {
  try {
    const f = JSON.parse(readFileSync(p, "utf8"));
    const okEntries = Array.isArray(f?.entries) && f.entries.every((e: any) => e && typeof e.id === "string" && isStrings(e.evidence));
    const okPurposes = f.purposes == null || (typeof f.purposes === "object" && !Array.isArray(f.purposes) && Object.values(f.purposes).every((v) => typeof v === "string"));
    return okEntries && okPurposes ? f : null;
  } catch {
    return null;
  }
}

export function loadAll(root: string): Loaded {
  const out: Loaded = { areas: {}, warnings: [] };
  if (!existsSync(dir(root))) return out;
  for (const name of readdirSync(dir(root)).filter((n) => n.endsWith(".json")).sort()) {
    const f = readFile(path.join(dir(root), name));
    if (f) out.areas[name.slice(0, -5)] = f;
    else out.warnings.push(`skipped invalid pattern file: ${name}`);
  }
  return out;
}

function readArea(root: string, area: unknown): PatternFile & { purposes: Record<string, string> } {
  if (typeof area !== "string" || !/^[A-Za-z0-9_-]+$/.test(area)) throw new Error(`invalid area: ${JSON.stringify(area)}`);
  const p = path.join(dir(root), `${area}.json`);
  if (!existsSync(p)) return { area, entries: [], purposes: {} };
  const f = readFile(p);
  if (!f) throw new Error(`invalid pattern file: ${p}`);
  return { ...f, area, purposes: f.purposes ?? {} };
}

const sorted = (v: any): any =>
  Array.isArray(v) ? v.map(sorted) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])])) : v;

function write(root: string, area: string, file: PatternFile) {
  const p = path.join(ensureDir(root, "patterns"), `${area}.json`);
  writeNoFollow(p + ".tmp", JSON.stringify(sorted(file), null, 2) + "\n");
  renameSync(p + ".tmp", p);
}

function checkEvidence(index: Index, ev: unknown) {
  if (!Array.isArray(ev) || ev.length === 0) throw new Error("evidence must be a non-empty list");
  const bad = ev.find((e) => typeof e !== "string" || !(e in index.symbols));
  if (bad !== undefined) throw new Error(`unknown evidence: ${bad}`);
}

function checkEnums(e: any) {
  if (!KINDS.includes(e.kind)) throw new Error(`invalid kind: ${JSON.stringify(e.kind)}`);
  if (!AUDIENCES.includes(e.audience)) throw new Error(`invalid audience: ${JSON.stringify(e.audience)}`);
}

/** Optional machine check of an anti_pattern: {target, from_area?}; consumed by the wrong_usage audit. */
function checkMatch(index: Index, e: any) {
  if (!("match" in e)) return;
  const m = e.match;
  if (e.kind !== "anti_pattern") throw new Error("match requires kind anti_pattern");
  if (!m || typeof m.target !== "string" || (m.from_area !== undefined && typeof m.from_area !== "string")) throw new Error("invalid match: expected {target, from_area?}");
  if (!(m.target in index.symbols) && !/^(intrinsic|external):/.test(m.target)) throw new Error(`invalid match: unknown target ${m.target}`);
  e.match = m.from_area === undefined ? { target: m.target } : { target: m.target, from_area: m.from_area };
}

const pick = (e: any) => Object.fromEntries(FIELDS.filter((k) => k in e).map((k) => [k, e[k]]));
const nextN = (entries: any[]) => Math.max(0, ...entries.map((e) => { const n = Number(String(e.id).split("-").pop()); return Number.isInteger(n) ? n : 0; })) + 1;
const find = (file: PatternFile, id: unknown) => {
  const e = file.entries.find((x) => x.id === id);
  if (!e) throw new Error(`unknown entry: ${id}`);
  return e;
};

export function record(root: string, index: Index, area: string, op: string, entry: any): any {
  if (!["add", "update", "retire"].includes(op)) throw new Error(`invalid operation: ${JSON.stringify(op)}`);
  entry = entry ?? {};
  const file = readArea(root, area);
  if (op === "add") {
    if (typeof entry.text !== "string" || entry.text === "") throw new Error("add requires kind, text and non-empty evidence");
    checkEvidence(index, entry.evidence);
    const e = { audience: "internal", ...pick(entry), id: `${area}-${nextN(file.entries)}` };
    checkEnums(e);
    checkMatch(index, e);
    write(root, area, { ...file, entries: [...file.entries, e] });
    return e;
  }
  const old = find(file, entry.id);
  if (op === "retire") {
    write(root, area, { ...file, entries: file.entries.filter((x) => x !== old) });
    return old;
  }
  if ("evidence" in entry) checkEvidence(index, entry.evidence);
  const merged = { ...old, ...pick(entry) };
  checkEnums({ audience: "internal", ...merged });
  checkMatch(index, merged);
  write(root, area, { ...file, entries: file.entries.map((x) => (x === old ? merged : x)) });
  return merged;
}

export function setPurpose(root: string, index: Index, area: string, id: string, text: unknown): void {
  const file = readArea(root, area);
  if (typeof text !== "string" || text.trim() === "") throw new Error("invalid purpose text");
  if (!(id in index.symbols)) throw new Error(`unknown symbol: ${id}`);
  write(root, area, { ...file, purposes: { ...file.purposes, [id]: text } });
}

export const purposes = (l: Loaded): Record<string, string> => Object.assign({}, ...Object.values(l.areas).map((f) => f.purposes ?? {}));

/** Cited evidence id -> texts of the entries citing it. */
export function patternText(l: Loaded): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const f of Object.values(l.areas)) for (const e of f.entries) if (typeof e.text === "string") for (const id of e.evidence) (out[id] ??= []).push(e.text);
  return out;
}

export type Stale = { area: string; entry_id: string; missing: string[] };
export function stale(index: Index, l: Loaded): Stale[] {
  return Object.entries(l.areas).sort(([a], [b]) => (a < b ? -1 : 1)).flatMap(([area, f]) =>
    f.entries.flatMap((e) => {
      const missing = e.evidence.filter((id: string) => !(id in index.symbols));
      return missing.length ? [{ area, entry_id: e.id, missing }] : [];
    }));
}
