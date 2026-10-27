import { audit } from "./audit.ts";
import { loadConfig } from "./config.ts";
import { load, reindex } from "./index_store.ts";

/** `react-atlas audit [paths...]`: one `file:line  check  message` line per finding; code 1 on any error finding. */
export function runAudit(root: string, paths: string[]) {
  const r = reindex(root);
  const index = load(root);
  if (!index || index === "corrupt") return { lines: [`react-atlas: cannot build index: ${r.compile_error ?? "unknown error"}`], code: 2 };
  const { findings } = audit(index, { config: loadConfig(root), paths });
  return {
    lines: findings.map((f) => `${f.file}:${f.line}  ${f.check}  ${f.message}`),
    code: findings.some((f) => f.severity === "error") ? 1 : 0,
  };
}
