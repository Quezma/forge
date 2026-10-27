import { createInterface } from "node:readline";
import { handle, newState } from "./mcp.ts";
import { createRegistry } from "./tools.ts";
import { registerAtlasTools } from "./atlas_tools.ts";

/** Serves newline-delimited JSON-RPC on stdio. Stdout carries only replies; logs go to stderr. */
export async function runServer(): Promise<void> {
  const tools = createRegistry();
  registerAtlasTools(tools, process.env.REACT_ATLAS_ROOT ?? process.cwd());
  const state = newState(tools);
  const rl = createInterface({ input: process.stdin });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const out = handle(state, trimmed);
    if (out) process.stdout.write(out + "\n");
  }
  console.error("react_atlas: stdin closed");
}
