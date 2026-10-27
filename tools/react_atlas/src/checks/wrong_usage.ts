import type { Check, Finding } from "../audit.ts";
import { areaOf } from "../area.ts";

export const wrongUsage: Check = (index: any, config, patterns) => {
  const out: Finding[] = [];
  const sym = (id: string) => index.symbols[id];
  const rel = (s: any) => [{ id: s.id, file: s.file, line: s.line }];
  const base = (u: any) => ({ check: "wrong_usage", file: u.file, line: u.line, symbol: u.from });

  for (const u of index.usages as any[]) {
    const t = sym(u.target);
    if (!t) continue;
    if (t.deprecated) out.push({ ...base(u), severity: "error", message: `${t.name} is deprecated${t.deprecatedText ? `: ${t.deprecatedText}` : ""}`, related: rel(t), evidence: "@deprecated" });
    for (const p of u.props.filter((p: string) => t.deprecatedProps?.includes(p)))
      out.push({ ...base(u), severity: "warning", message: `${t.name} prop ${p} is deprecated`, related: rel(t), evidence: "@deprecated prop" });
  }

  // Outlier: a prop most usages pass, missing here. Spread usages may carry it, so they are skipped.
  // Off by default: on a real project nearly every hit was optional-prop noise.
  const { minUsages, dominance, outliers } = config.wrongUsage;
  const byTarget = new Map<string, any[]>();
  for (const u of index.usages as any[]) if (sym(u.target)?.kind === "component") byTarget.set(u.target, [...(byTarget.get(u.target) ?? []), u]);
  for (const [target, us] of byTarget) {
    if (!outliers || us.length < minUsages) continue;
    const counts = new Map<string, number>();
    for (const u of us) for (const p of new Set<string>(u.props)) counts.set(p, (counts.get(p) ?? 0) + 1);
    for (const [p, n] of counts) {
      if (n / us.length < dominance) continue;
      for (const u of us.filter((u) => !u.spread && !u.props.includes(p)))
        out.push({ ...base(u), severity: "info", message: `${sym(target).name} usually gets prop ${p} (${n}/${us.length} usages); missing here`, related: rel(sym(target)), evidence: `${n}/${us.length}` });
    }
  }

  // Pattern-backed: anti_pattern entries with a machine `match`.
  const rules = Object.values(patterns.areas).flatMap((f) => f.entries.filter((e) => e.kind === "anti_pattern" && e.match?.target));
  for (const e of rules) {
    for (const u of [...index.usages, ...index.calls] as any[]) {
      if (u.target !== e.match.target) continue;
      if (e.match.from_area && (sym(u.from)?.area ?? areaOf(u.file)) !== e.match.from_area) continue;
      out.push({ ...base(u), severity: "error", message: `${e.text} (${e.id})`, related: sym(e.match.target) ? rel(sym(e.match.target)) : [], evidence: `pattern ${e.id}` });
    }
  }
  return out;
};
