import type { Check, Finding } from "../audit.ts";
import { areaOf } from "../area.ts";

// A project hook is a wrapper of X when it calls X. X: a store, a context (via useContext), or an
// external state API. Generic `external:react#useContext` / `useReducer` are not wrappable targets.
const GENERIC = /^external:react#(useContext|useReducer)$/;
const nameOf = (id: string) => id.split("#").pop()!;

function wrappersOf(index: any): Map<string, string[]> {
  const w = new Map<string, string[]>();
  for (const c of index.calls as any[]) {
    if (index.symbols[c.from]?.kind !== "hook" || GENERIC.test(c.target)) continue;
    const list = w.get(c.target) ?? [];
    if (!list.includes(c.from)) list.push(c.from);
    w.set(c.target, list);
  }
  return w;
}

const callerArea = (index: any, c: any) => index.symbols[c.from]?.area ?? areaOf(c.file);

export const stateMisuse: Check = (index: any, config) => {
  const wrappers = wrappersOf(index);
  const out: Finding[] = [];
  for (const c of index.calls as any[]) {
    const x = index.symbols[c.target];
    const state = x ? x.kind === "store" || x.kind === "context" : c.target.startsWith("external:");
    if (!state || GENERIC.test(c.target)) continue;
    if (x && c.file === x.file) continue; // the store's own file
    const base = { check: "state_misuse", file: c.file, line: c.line, symbol: c.from };
    const allowed = config.state.allowedAreas[c.target];
    const area = callerArea(index, c);
    if (allowed && !allowed.includes(area)) {
      out.push({ ...base, severity: "error", message: `${nameOf(c.target)} must not be used from area ${area}; allowed: ${allowed.join(", ")}`, related: x ? [{ id: x.id, file: x.file, line: x.line }] : [], evidence: `state.allowedAreas[${c.target}]` });
      continue;
    }
    const mine = wrappers.get(c.target);
    if (!mine || mine.includes(c.from)) continue;
    const w = index.symbols[mine[0]];
    out.push({ ...base, severity: "warning", message: `use ${w.name} instead of ${nameOf(c.target)}`, related: [{ id: w.id, file: w.file, line: w.line }], evidence: `wrapper ${w.id}` });
  }
  return out;
};

/** Stores and contexts with their wrapper hooks, direct readers and the areas those readers live in. */
export function stateMap(index: any, filter?: string) {
  const wrappers = wrappersOf(index);
  const stores = Object.values(index.symbols as Record<string, any>)
    .filter((s) => (s.kind === "store" || s.kind === "context") && (!filter || s.id === filter || s.name === filter))
    .map((s) => {
      const readers = (index.calls as any[]).filter((c) => c.target === s.id).map((c) => ({ from: c.from, file: c.file, line: c.line, via: c.via ?? "call", area: callerArea(index, c) }));
      return {
        id: s.id, kind: s.kind, file: s.file, wrappers: wrappers.get(s.id) ?? [],
        readers: readers.map(({ area, ...r }) => r),
        areas: [...new Set(readers.map((r) => r.area))].sort(),
      };
    });
  return { stores };
}
