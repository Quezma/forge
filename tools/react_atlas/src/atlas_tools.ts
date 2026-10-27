import path from "node:path";
import type { Registry } from "./tools.ts";
import { load, reindex, type Index } from "./index_store.ts";
import { createHash } from "node:crypto";
import { buildCorpus, find, type Corpus } from "./search.ts";
import { loadAll, patternText, purposes, record, setPurpose } from "./patterns.ts";
import { buildContext } from "./context.ts";
import { append } from "./usage_log.ts";
import { audit } from "./audit.ts";
import { loadConfig } from "./config.ts";
import { record as recordLearning, REPO_ROOT } from "./learnings.ts";
import { stateMap } from "./checks/state_misuse.ts";

const STR = { type: "string" };
const KINDS = ["component", "hook", "function", "context", "store"];

/** Registers the atlas tools. The index loads (or builds) on first use, never at registration. */
export function registerAtlasTools(reg: Registry, rootArg: string): void {
  const root = path.resolve(rootArg);
  let cache: { index: Index; corpus?: Corpus; key?: string } | undefined;

  function get() {
    if (cache) return cache;
    let index = load(root);
    if (index === null || index === "corrupt") {
      const r = reindex(root, { full: true });
      index = load(root);
      if (index === null || index === "corrupt") throw new Error(`cannot build index: ${r.compile_error ?? "unknown error"}`);
    }
    return (cache = { index });
  }

  // Corpus is rebuilt only when purposes or pattern text change (hash key); reindex drops the cache.
  function corpusOf() {
    const c = get();
    const l = loadAll(root);
    const extras = { purposes: purposes(l), patternText: patternText(l) };
    const key = createHash("sha1").update(JSON.stringify(extras)).digest("hex");
    if (!c.corpus || c.key !== key) (c.corpus = buildCorpus(c.index, extras)), (c.key = key);
    return c.corpus;
  }

  const site = (u: any) => ({ file: u.file, line: u.line });
  const usageOf = (index: Index, target: string) => index.usages.filter((u: any) => u.target === target);
  const callsOf = (index: Index, target: string) => index.calls.filter((c: any) => c.target === target);

  reg.register({
    name: "find_reusable",
    description: "Search the project for existing components, hooks, functions, contexts and stores that already do what you are about to write.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Natural-language description of what you need" },
        limit: { type: "integer", description: "Max results (default 10)" },
        kind: { type: "string", enum: KINDS, description: "Restrict to one symbol kind" },
      },
      required: ["query"],
    },
    handler: ({ query, limit = 10, kind }) => {
      if (kind !== undefined && !KINDS.includes(kind)) throw new Error(`kind must be one of ${KINDS.join(", ")}`);
      const results = find(corpusOf(), query, { limit, kind });
      append(root, "find_reusable", { query, limit, kind }, results.map((r) => r.id));
      return { results };
    },
  });

  reg.register({
    name: "component",
    description: "Full detail for one symbol: props, where it is rendered (with props), what it renders, and what it calls.",
    inputSchema: { type: "object", properties: { id_or_name: { type: "string", description: "Symbol id (file#Name) or a unique name" } }, required: ["id_or_name"] },
    handler: ({ id_or_name }) => {
      const { index } = get();
      const matches = index.symbols[id_or_name] ? [id_or_name] : Object.keys(index.symbols).filter((k) => index.symbols[k].name === id_or_name);
      if (matches.length === 0) throw new Error(`not found: ${id_or_name}`);
      if (matches.length > 1) throw new Error(`ambiguous name ${id_or_name}; use one of: ${matches.join(", ")}`);
      const id = matches[0];
      return {
        symbol: index.symbols[id],
        used_by: usageOf(index, id).map((u: any) => ({ from: u.from, ...site(u), props: u.props, spread: u.spread })),
        renders: index.usages.filter((u: any) => u.from === id).map((u: any) => ({ target: u.target, ...site(u), props: u.props })),
        calls: index.calls.filter((c: any) => c.from === id).map((c: any) => ({ target: c.target, ...site(c), ...(c.via && { via: c.via }) })),
        called_by: callsOf(index, id).map((c: any) => ({ from: c.from, ...site(c) })),
      };
    },
  });

  reg.register({
    name: "callers",
    description: "Every place a symbol is rendered or called, with the props passed at render sites.",
    inputSchema: { type: "object", properties: { id: { type: "string", description: "Symbol id (file#Name)" } }, required: ["id"] },
    handler: ({ id }) => {
      const { index } = get();
      const callers = [
        ...usageOf(index, id).map((u: any) => ({ from: u.from, ...site(u), props: u.props })),
        ...callsOf(index, id).map((c: any) => ({ from: c.from, ...site(c) })),
      ];
      if (!callers.length && !index.symbols[id]) throw new Error(`unknown symbol: ${id}`);
      return { id, callers };
    },
  });

  reg.register({
    name: "reindex",
    description: "Refresh the index after edits (incremental; full rebuilds from scratch).",
    inputSchema: { type: "object", properties: { full: { type: "boolean", description: "Force a full rebuild" } }, required: [] },
    handler: ({ full }) => {
      const report = reindex(root, { full: !!full });
      cache = undefined;
      return report;
    },
  });

  reg.register({
    name: "context_for_task",
    description: "Before implementing a task: global rules, patterns of the named areas, and a budgeted view of neighbouring areas' public API.",
    inputSchema: {
      type: "object",
      properties: {
        task: { type: "string", description: "What you are about to implement" },
        areas: { type: "array", description: "Area names the task touches" },
        budget: { type: "integer", description: "Token budget (default 8000)" },
      },
      required: ["task", "areas"],
    },
    handler: ({ task, areas, budget = 8000 }) => {
      if (!areas.every((a: unknown) => typeof a === "string")) throw new Error("areas must be strings");
      const r = buildContext(get().index, loadAll(root), task, areas, budget);
      const ids = [...r.global, ...Object.values(r.areas).flatMap((v: any) => v.entries), ...Object.values(r.neighbours).flatMap((v: any) => v.entries)].map((e: any) => e.id);
      append(root, "context_for_task", { task, areas, budget }, ids);
      return r;
    },
  });

  reg.register({
    name: "record_pattern",
    description: "Add, update or retire a pattern entry for an area ('_global' for project-wide rules). Evidence must be symbol ids that exist in the index.",
    inputSchema: {
      type: "object",
      properties: {
        area: { ...STR, description: "Area name, or _global" },
        op: { ...STR, enum: ["add", "update", "retire"] },
        entry: { type: "object", description: "add: {kind: rule|helper|api|anti_pattern, text, evidence:[ids], audience?, prevalence?}; update: {id, ...changes}; retire: {id}" },
      },
      required: ["area", "op", "entry"],
    },
    handler: ({ area, op, entry }) => record(root, get().index, area, op, entry),
  });

  reg.register({
    name: "set_purpose",
    description: "Set the one-line purpose of a symbol; it feeds find_reusable search.",
    inputSchema: {
      type: "object",
      properties: { area: { ...STR, description: "Area file to store it in" }, id: { ...STR, description: "Symbol id (file#Name)" }, text: STR },
      required: ["area", "id", "text"],
    },
    handler: ({ area, id, text }) => {
      setPurpose(root, get().index, area, id, text);
      return { ok: true, id };
    },
  });

  reg.register({
    name: "audit",
    description: "Deterministic findings (duplicate components, design-system bypass, ...) with file:line on both sides. Run before finishing a change.",
    inputSchema: {
      type: "object",
      properties: { paths: { type: "array", description: "Only report findings under these path prefixes" }, checks: { type: "array", description: "Only run these checks" } },
      required: [],
    },
    handler: ({ paths, checks }) => {
      if (![paths, checks].every((v) => v === undefined || (Array.isArray(v) && v.every((x) => typeof x === "string")))) throw new Error("paths and checks must be arrays of strings");
      const result = audit(get().index, { config: loadConfig(root), paths, checks });
      // results use the "<check> <file>" form record_learning expects for audit
      append(root, "audit", { paths, checks }, [...new Set(result.findings.map((f: any) => `${f.check} ${f.file}`))]);
      return result;
    },
  });

  reg.register({
    name: "state_map",
    description: "Who reads each store or context: wrapper hooks, direct readers (file:line) and their areas. Check before touching shared state.",
    inputSchema: { type: "object", properties: { store: { ...STR, description: "Store/context id or name (default: all)" } }, required: [] },
    handler: ({ store }) => stateMap(get().index, store),
  });

  reg.register({
    name: "record_learning",
    description: "Record a search miss or ignored result centrally in the react_atlas repo (learnings/open.jsonl); tool_miss also adds an acceptance fixture. For audit, expected is 'check file'.",
    inputSchema: {
      type: "object",
      properties: {
        project: { ...STR, description: "Project name, [a-z0-9_-]+" },
        branch: STR,
        cause: { ...STR, enum: ["tool_miss", "agent_ignored"] },
        query: STR,
        tool: { ...STR, enum: ["find_reusable", "context_for_task", "audit"] },
        expected: { ...STR, description: "Expected symbol id/name, context entry id, or 'check file' for audit" },
        actual: STR,
        evidence: STR,
        args: { type: "object", description: "Tool args; required for context_for_task ({task, areas})" },
      },
      required: ["project", "branch", "cause", "query", "tool", "expected", "actual", "evidence"],
    },
    handler: (args) => {
      const r = recordLearning(REPO_ROOT, args);
      if ("error" in r) throw new Error(r.error);
      return r;
    },
  });
}
