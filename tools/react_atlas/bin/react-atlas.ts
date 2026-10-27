#!/usr/bin/env node
import { runServer } from "../src/server.ts";
import { reindex } from "../src/index_store.ts";

const [cmd, ...flags] = process.argv.slice(2);

if (cmd === "server") {
  await runServer();
} else if (cmd === "index") {
  console.log(JSON.stringify(reindex(process.cwd(), { full: flags.includes("--full") })));
} else if (cmd === "audit") {
  const { runAudit } = await import("../src/audit_cli.ts");
  const { lines, code } = runAudit(process.cwd(), flags);
  lines.forEach((l) => console.log(l));
  process.exit(code);
} else if (cmd === "install") {
  const { install } = await import("../src/install.ts");
  install(process.cwd()).forEach((l) => console.log(l));
} else if (cmd === "acceptance") {
  const { runAcceptance } = await import("../src/acceptance.ts");
  const { lines, code } = runAcceptance(process.cwd(), { eval: flags.includes("--eval") });
  lines.forEach((l) => console.log(l));
  process.exit(code);
} else {
  console.error(`react-atlas: ${cmd ?? "(no command)"}: not implemented`);
  process.exit(1);
}
