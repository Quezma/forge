import type { Check, Finding } from "../audit.ts";

const jaccard = (a: Set<string>, b: Set<string>) => {
  if (!a.size && !b.size) return 1;
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n / (a.size + b.size - n);
};
const grams = (t: string[]) => new Set(t.length < 3 ? [t.join(" ")] : t.slice(0, -2).map((_, i) => t.slice(i, i + 3).join(" ")));

export const duplicateComponent: Check = (index, config) => {
  const { threshold, minNodes } = config.duplicates;
  const comps = Object.values(index.symbols)
    .filter((s: any) => s.kind === "component" && s.shape && s.shapeSize >= minNodes)
    .map((s: any) => ({ s, grams: grams(s.shape), names: new Set<string>(s.props.map((p: any) => p.name)), types: new Set<string>(s.props.map((p: any) => p.type)) }));
  const renders = new Set(index.usages.map((u: any) => `${u.from}>${u.target}`));
  // Pairs at or above the threshold are edges; connected components are clusters (union-find).
  const parent = comps.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const edges: { i: number; j: number; score: number }[] = [];
  // ponytail: O(n^2) pairs; bucket by shapeSize (+-30%) if repos with >2k components get slow.
  for (let i = 0; i < comps.length; i++) {
    for (let j = i + 1; j < comps.length; j++) {
      const [a, b] = [comps[i], comps[j]];
      if (renders.has(`${a.s.id}>${b.s.id}`) || renders.has(`${b.s.id}>${a.s.id}`)) continue;
      // Props match by name, or by type when only the names differ (amount: number vs value: number).
      const propSim = Math.max(jaccard(a.names, b.names), jaccard(a.types, b.types));
      const score = 0.7 * jaccard(a.grams, b.grams) + 0.3 * propSim;
      if (score < threshold) continue;
      edges.push({ i, j, score });
      parent[find(i)] = find(j);
    }
  }
  const clusters = new Map<number, { members: any[]; min: number }>();
  comps.forEach((c, i) => {
    if (edges.some((e) => e.i === i || e.j === i)) {
      const k = find(i);
      clusters.set(k, { members: [...(clusters.get(k)?.members ?? []), c.s], min: 1 });
    }
  });
  for (const e of edges) { const c = clusters.get(find(e.i))!; c.min = Math.min(c.min, e.score); }

  const out: Finding[] = [];
  const ref = (s: any) => ({ id: s.id, file: s.file, line: s.line });
  for (const { members, min } of clusters.values()) {
    // canonical: most callers, then shortest path, then id
    const [canon, ...rest] = [...members].sort((a, b) => b.callers - a.callers || a.file.length - b.file.length || (a.id < b.id ? -1 : 1));
    for (const m of rest) {
      out.push({
        check: "duplicate_component",
        severity: "warning",
        file: m.file,
        line: m.line,
        symbol: m.id,
        message: `${m.name} is one of ${members.length} near-identical components; reuse ${canon.name} (${canon.file})`,
        related: [ref(canon), ...rest.filter((o) => o !== m).slice(0, 5).map(ref)],
        evidence: `min score ${min.toFixed(2)} across ${members.length} components; ${canon.name} has ${canon.callers} callers`,
      });
    }
  }
  return out;
};
