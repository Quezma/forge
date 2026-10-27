export type Areas = Record<string, string[]>;

// Config areas win (prefix match); else src/features/<x>/... or src/<x>/... -> x.
export function areaOf(file: string, areas?: Areas): string {
  for (const [name, prefixes] of Object.entries(areas ?? {})) {
    if (prefixes.some((p) => file.startsWith(p))) return name;
  }
  const parts = file.split("/");
  if (parts[0] !== "src") return "other";
  if (parts[1] === "features" && parts.length > 3) return parts[2];
  return parts.length > 2 ? parts[1] : "other";
}
