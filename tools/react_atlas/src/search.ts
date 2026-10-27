// Ported from ex_atlas search.ex: Σ max_field_weight(token) · ln(1 + N/df), TF-free.
const STOPWORDS = new Set("a an the to of by if in for and or is with from on it".split(" "));
const SUFFIXES = ["ancy", "ance", "ing", "ion", "ed", "er"];
const PREFIX = 5;
const PREFIX_FACTOR = 0.6;

function stem(t: string): string {
  if (t.length > 3 && t.endsWith("s") && !t.endsWith("ss")) t = t.slice(0, -1);
  const s = SUFFIXES.find((x) => t.endsWith(x) && t.length - x.length >= 4);
  return s ? t.slice(0, -s.length) : t;
}

export function tokens(text: string | undefined | null): string[] {
  if (!text) return [];
  return text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t && t.length > 1 && !STOPWORDS.has(t))
    .map(stem);
}

export type Extras = { purposes?: Record<string, string>; patternText?: Record<string, string[]> };
export type Hit = {
  id: string; kind: string; file: string; line: number; doc: string; props: any[];
  callers: number; area: string; score: number; deprecated: boolean; purpose?: string;
};
type Entry = { s: any; weights: Map<string, number>; prefixes: Map<string, number> };
export type Corpus = { entries: Entry[] };

// token -> max weight across fields
function fieldWeights(s: any, x: Extras): Map<string, number> {
  const fields: [number, string[]][] = [
    [3, tokens(s.name)],
    [2, tokens(x.purposes?.[s.id])],
    [2, tokens(s.doc)],
    [1, (s.props ?? []).flatMap((p: any) => tokens(p.name))],
    [1, tokens(s.deprecatedText)],
    [1, (x.patternText?.[s.id] ?? []).flatMap(tokens)],
  ];
  const w = new Map<string, number>();
  for (const [weight, toks] of fields) for (const t of toks) w.set(t, Math.max(w.get(t) ?? 0, weight));
  return w;
}

export function buildCorpus(index: { symbols: Record<string, any> }, extras: Extras = {}): Corpus {
  return {
    entries: Object.values(index.symbols).map((s) => {
      const weights = fieldWeights(s, extras);
      const prefixes = new Map<string, number>();
      for (const [t, w] of weights) if (t.length >= PREFIX) prefixes.set(t.slice(0, PREFIX), Math.max(prefixes.get(t.slice(0, PREFIX)) ?? 0, w));
      return { s: { ...s, purpose: extras.purposes?.[s.id] }, weights, prefixes };
    }),
  };
}

export function find(corpus: Corpus, query: string, opts: { limit?: number; kind?: string } = {}): Hit[] {
  const qs = [...new Set(tokens(query))];
  const n = corpus.entries.length;
  if (!qs.length || !n) return [];
  const weighted = corpus.entries.flatMap((e) => {
    const m = new Map<string, number>();
    for (const t of qs) {
      const exact = e.weights.get(t);
      const pre = t.length >= PREFIX ? e.prefixes.get(t.slice(0, PREFIX)) : undefined;
      const w = Math.max(exact ?? 0, pre === undefined ? 0 : pre * PREFIX_FACTOR);
      if (w > 0) m.set(t, w);
    }
    return m.size ? [{ s: e.s, m }] : [];
  });
  // N and df use the whole index, so scores do not depend on the kind filter.
  const idf = new Map(qs.map((t) => {
    const df = weighted.filter((x) => x.m.has(t)).length;
    return [t, df ? Math.log(1 + n / df) : 0] as const;
  }));
  const hits: Hit[] = [];
  for (const { s, m } of weighted) {
    if (opts.kind && s.kind !== opts.kind) continue;
    let base = 0;
    for (const [t, w] of m) base += w * idf.get(t)!;
    const score = base * (s.exported ? 1 : 0.6) + 0.2 * Math.log(1 + s.callers);
    hits.push({ id: s.id, kind: s.kind, file: s.file, line: s.line, doc: s.doc, props: s.props ?? [], callers: s.callers, area: s.area, score, deprecated: s.deprecated, ...(s.purpose && { purpose: s.purpose }) });
  }
  return hits.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1)).slice(0, Math.max(opts.limit ?? 10, 1));
}
