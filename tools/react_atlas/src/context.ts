import { stale as findStale, type Loaded } from "./patterns.ts";

// Ported from ex_atlas context.ex.
const MAX_API = 15;
const estimate = (r: unknown) => Math.floor(Buffer.byteLength(JSON.stringify(r)) / 4);

export function buildContext(index: { symbols: Record<string, any>; usages: any[]; calls: any[] }, loaded: Loaded, task: string, areasArg: string[], budget = 8000): any {
  const stale = findStale(index, loaded);
  const flagged = new Set(stale.map((s) => `${s.area}\0${s.entry_id}`));
  const entries = (area: string): any[] => loaded.areas[area]?.entries ?? [];
  const mark = (area: string, es: any[]) => es.map((e) => (flagged.has(`${area}\0${e.id}`) ? { ...e, stale: true } : e));

  const known = new Set([...Object.values(index.symbols).map((s: any) => s.area), ...Object.keys(loaded.areas)]);
  known.delete("_global");
  const uniq = [...new Set(areasArg)];
  const named = uniq.filter((a) => known.has(a));
  const unknown = uniq.filter((a) => !known.has(a));

  // One-hop neighbours ranked by cross-area edge count (usages + calls), ties by name.
  const areaOf = (id: string) => index.symbols[id]?.area as string | undefined;
  const isNamed = new Set(named);
  const weights = new Map<string, number>();
  const calledFromNamed = new Set<string>();
  for (const e of [...index.usages, ...index.calls]) {
    const a = areaOf(e.from), b = areaOf(e.target);
    if (!a || !b || a === b) continue;
    if (isNamed.has(a) && !isNamed.has(b)) { weights.set(b, (weights.get(b) ?? 0) + 1); calledFromNamed.add(e.target); }
    else if (isNamed.has(b) && !isNamed.has(a)) weights.set(a, (weights.get(a) ?? 0) + 1);
  }
  const ranked: [string, any][] = [...weights].filter(([a]) => a !== "other").sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1)).map(([a]) => {
    const api = Object.values(index.symbols)
      .filter((s: any) => s.area === a && s.exported && s.callers > 0 && calledFromNamed.has(s.id))
      .sort((x: any, y: any) => y.callers - x.callers || (x.id < y.id ? -1 : 1))
      .slice(0, MAX_API)
      .map((s: any) => ({ id: s.id, kind: s.kind, props: s.props ?? [], doc: s.doc }));
    return [a, { api, entries: mark(a, entries(a).filter((e) => (e.audience ?? "internal") === "external")) }];
  });

  const base: any = {
    task,
    global: mark("_global", entries("_global")),
    areas: Object.fromEntries(named.map((a) => [a, { entries: mark(a, entries(a)) }])),
    warnings: loaded.warnings,
    unknown_areas: unknown,
  };
  if (unknown.length) base.known_areas = [...known].sort();

  const measure = (kept: [string, any][], truncated: string[]) => {
    const emitted = new Set([
      ...base.global.map((e: any) => `_global\0${e.id}`),
      ...Object.entries(base.areas).flatMap(([a, v]: any) => v.entries.map((e: any) => `${a}\0${e.id}`)),
      ...kept.flatMap(([a, v]) => v.entries.map((e: any) => `${a}\0${e.id}`)),
    ]);
    const r = { ...base, neighbours: Object.fromEntries(kept), truncated: [...truncated].sort(), stale: stale.filter((s) => emitted.has(`${s.area}\0${s.entry_id}`)), tokens: 0 };
    r.tokens = estimate(r);
    r.tokens = estimate(r); // second pass: includes its own digits
    return r;
  };

  let kept = ranked;
  const truncated: string[] = [];
  for (;;) {
    const result = measure(kept, truncated);
    if (result.tokens <= budget) return result;
    if (kept.length === 0) return { ...result, over_budget: true };
    truncated.push(kept[kept.length - 1][0]);
    kept = kept.slice(0, -1);
  }
}
