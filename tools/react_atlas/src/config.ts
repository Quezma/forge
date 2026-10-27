import { readFileSync } from "node:fs";
import path from "node:path";

export type Config = {
  designSystem: { paths: string[]; packages: string[]; structuralTags: string[] };
  duplicates: { threshold: number; minNodes: number };
  /** allowedAreas: store/context id -> areas allowed to call it. */
  state: { allowedAreas: Record<string, string[]> };
  wrongUsage: { minUsages: number; dominance: number; outliers: boolean };
  ignore: string[];
};

export const DEFAULTS: Config = {
  designSystem: {
    paths: ["src/components/ui"],
    packages: [],
    /** Layout/text tags that are never a design-system bypass. */
    structuralTags: ["div", "span", "p", "section", "article", "header", "footer", "main", "nav", "aside", "ul", "ol", "li", "dl", "dt", "dd", "h1", "h2", "h3", "h4", "h5", "h6", "strong", "em", "small", "b", "i", "br", "hr", "figure", "figcaption", "fieldset", "legend", "form", "svg", "path", "g"],
  },
  duplicates: { threshold: 0.85, minNodes: 3 },
  state: { allowedAreas: {} },
  wrongUsage: { minUsages: 5, dominance: 0.8, outliers: false },
  ignore: [],
};

/** `<root>/.react_atlas/config.json` over the defaults; merged one level deep per key. */
export function loadConfig(root: string): Config {
  let user: any = {};
  try {
    user = JSON.parse(readFileSync(path.join(root, ".react_atlas", "config.json"), "utf8"));
  } catch {} // absent or unreadable -> defaults
  return {
    designSystem: { ...DEFAULTS.designSystem, ...user.designSystem },
    duplicates: { ...DEFAULTS.duplicates, ...user.duplicates },
    state: { ...DEFAULTS.state, ...user.state },
    wrongUsage: { ...DEFAULTS.wrongUsage, ...user.wrongUsage },
    ignore: Array.isArray(user.ignore) ? user.ignore : DEFAULTS.ignore,
  };
}
