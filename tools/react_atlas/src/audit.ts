import type { Config } from "./config.ts";
import type { Index } from "./index_store.ts";
import { duplicateComponent } from "./checks/duplicate_component.ts";
import { dsBypass } from "./checks/ds_bypass.ts";
import { stateMisuse } from "./checks/state_misuse.ts";
import { wrongUsage } from "./checks/wrong_usage.ts";
import { loadAll, type Loaded } from "./patterns.ts";

export type Finding = {
  check: string;
  severity: "error" | "warning" | "info";
  file: string;
  line: number;
  symbol?: string;
  message: string;
  related: { id: string; file: string; line: number }[];
  evidence: string;
};
export type Check = (index: Index, config: Config, patterns: Loaded) => Finding[];

export const CHECKS: Record<string, Check> = { duplicate_component: duplicateComponent, ds_bypass: dsBypass, state_misuse: stateMisuse, wrong_usage: wrongUsage };

const under = (file: string, prefixes: string[]) => prefixes.some((p) => file === p || file.startsWith(p.replace(/\/*$/, "/")));

export function audit(index: Index, opts: { config: Config; paths?: string[]; checks?: string[] }) {
  const names = opts.checks ?? Object.keys(CHECKS);
  const unknown = names.find((n) => !CHECKS[n]);
  if (unknown) throw new Error(`unknown check: ${unknown}; available: ${Object.keys(CHECKS).join(", ")}`);
  const root = (index as any).meta?.root;
  const patterns: Loaded = root ? loadAll(root) : { areas: {}, warnings: [] };
  const summary: Record<string, number> = {};
  const findings: Finding[] = [];
  for (const n of names) {
    const found = CHECKS[n](index, opts.config, patterns).filter((f) => !under(f.file, opts.config.ignore) && (!opts.paths?.length || under(f.file, opts.paths)));
    summary[n] = found.length;
    findings.push(...found);
  }
  findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  return { findings, summary };
}
