import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { atlasDir, ensureDir, writeNoFollow } from "./atlas_dir.ts";
import { DEFAULTS } from "./config.ts";

const START = "<!-- react_atlas:start -->";
const END = "<!-- react_atlas:end -->";
const DS_GUESSES = ["src/components/ui", "src/shared/ui", "src/ui", "src/design-system", "src/shared/components", "src/lib/ui", "src/components"];
const SNIPPET = new URL("../priv/agents_snippet.md", import.meta.url);

/** `react-atlas install`: sets up `.react_atlas/`, config.json and the AGENTS.md block in `root`. Returns output lines. */
export function install(root: string): string[] {
  ensureDir(root);
  const out: string[] = [];
  const cfg = path.join(atlasDir(root), "config.json");
  if (!existsSync(cfg)) {
    const paths = DS_GUESSES.find((p) => existsSync(path.join(root, p))) ?? DEFAULTS.designSystem.paths[0];
    writeNoFollow(cfg, JSON.stringify({ ...DEFAULTS, designSystem: { ...DEFAULTS.designSystem, paths: [paths] } }, null, 2) + "\n");
    out.push(`created .react_atlas/config.json (designSystem.paths: ${paths})`);
  }

  const agents = path.join(root, "AGENTS.md");
  const block = `${START}\n${readFileSync(SNIPPET, "utf8").trim()}\n${END}\n`;
  const old = existsSync(agents) ? readFileSync(agents, "utf8") : "";
  const s = old.indexOf(START), e = old.indexOf(END);
  const next = s >= 0 && e > s ? old.slice(0, s) + block.trimEnd() + old.slice(e + END.length) : old ? old.replace(/\n*$/, "\n\n") + block : block;
  writeNoFollow(agents, next);
  out.push("updated AGENTS.md");

  const claude = path.join(root, "CLAUDE.md");
  if (existsSync(claude) && !readFileSync(claude, "utf8").includes("@AGENTS.md")) out.push("warning: CLAUDE.md does not import @AGENTS.md; add a line `@AGENTS.md` so Claude Code reads the instructions");

  out.push("next:", "  react-atlas index", "  claude mcp add react_atlas -- react-atlas server");
  return out;
}
