import type { Check, Finding } from "../audit.ts";

const COLOR = /#[0-9a-fA-F]{3,8}\b|(?:rgb|hsl)a?\([^)]*\)/;
const timingOnly = (text: string) => {
  const keys = [...text.matchAll(/([A-Za-z-]+)\s*:/g)].map((m) => m[1]);
  return keys.length > 0 && keys.every((k) => /^(animation|transition)/i.test(k));
};

export const dsBypass: Check = (index, config) => {
  const inDs = (file: string) => config.designSystem.paths.some((p) => file === p || file.startsWith(p.replace(/\/*$/, "/")));
  // tag -> DS components whose ROOT element is that tag and receives forwarded props (`<button {...rest}>`).
  // A DS component that renders a tag inside (Card -> div) or fixes it (a logo's <img>) does not wrap it.
  // Components from `designSystem.packages` are opaque.
  const forwards = new Set((index.usages as any[]).filter((u) => u.spread).map((u) => `${u.from}|${u.target}`));
  const wrapped = new Map<string, any[]>();
  for (const s of Object.values(index.symbols) as any[]) {
    if (s.kind !== "component" || !inDs(s.file) || !s.root?.startsWith("intrinsic:") || !forwards.has(`${s.id}|${s.root}`)) continue;
    const tag = s.root.slice(10);
    wrapped.set(tag, [...(wrapped.get(tag) ?? []), s]);
  }
  for (const t of config.designSystem.structuralTags) wrapped.delete(t);
  const out: Finding[] = [];
  for (const u of index.usages as any[]) {
    const tag = u.target.startsWith("intrinsic:") ? u.target.slice(10) : "";
    const ds = wrapped.get(tag);
    if (!ds || inDs(u.file)) continue;
    out.push({
      check: "ds_bypass", severity: "error", file: u.file, line: u.line, symbol: u.from,
      message: `raw <${tag}> bypasses the design system; use ${ds.map((s) => s.name).join(" or ")}`,
      related: ds.map((s) => ({ id: s.id, file: s.file, line: s.line })),
      evidence: `${ds.map((s) => s.id).join(", ")} renders <${tag}>`,
    });
  }
  for (const s of index.styles as any[]) {
    // dynamic styles and animation/transition timing are not design-system concerns
    if (inDs(s.file) || (s.kind === "inline_style" && (!s.static || timingOnly(s.text)))) continue;
    out.push({
      check: "ds_bypass", severity: "warning", file: s.file, line: s.line, symbol: s.from,
      message: s.kind === "inline_style" ? "inline style outside the design system; use design tokens or a DS component" : `hardcoded color ${s.text.match(COLOR)?.[0] ?? s.text}; use design tokens`,
      related: [],
      evidence: s.text,
    });
  }
  return out;
};
