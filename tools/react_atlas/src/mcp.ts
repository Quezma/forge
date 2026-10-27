import type { Registry } from "./tools.ts";

const DEFAULT_PROTOCOL = "2025-06-18";
const VERSION = "0.1.0";

export type State = { tools: Registry; initialized: boolean };

export const newState = (tools: Registry): State => ({ tools, initialized: false });

const reply = (id: unknown, body: { result: unknown } | { error: { code: number; message: string } }) =>
  JSON.stringify({ jsonrpc: "2.0", id, ...body });
const fail = (id: unknown, code: number, message: string) => reply(id, { error: { code, message } });
const content = (payload: unknown, isError: boolean) => ({
  content: [{ type: "text", text: JSON.stringify(payload) }],
  ...(isError && { isError }),
});

type Msg = { id?: unknown; method?: unknown; params?: any };

/** Handles one JSON-RPC line; returns the reply line, or null when none is due. */
export function handle(state: State, line: string): string | null {
  let msg: Msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return fail(null, -32700, "parse error");
  }
  try {
    if (typeof msg !== "object" || msg === null || Array.isArray(msg)) return fail(null, -32600, "invalid request");
    if (typeof msg.method !== "string") return "result" in msg || "error" in msg ? null : fail(null, -32600, "invalid request");
    return dispatch(state, msg.method, msg.params ?? {}, msg);
  } catch (e) {
    return fail(null, -32603, `internal error: ${e instanceof Error ? e.message : e}`);
  }
}

function dispatch(state: State, method: string, params: any, msg: Msg): string | null {
  if (method === "notifications/initialized") {
    state.initialized = true;
    return null;
  }
  if (!("id" in msg)) return null; // other notifications
  const id = msg.id;
  if (typeof id !== "string" && typeof id !== "number") return fail(null, -32600, "invalid request");

  switch (method) {
    case "initialize":
      state.initialized = true;
      return reply(id, {
        result: {
          protocolVersion: params?.protocolVersion ?? DEFAULT_PROTOCOL,
          capabilities: { tools: {} },
          serverInfo: { name: "react_atlas", version: VERSION },
        },
      });
    case "ping":
      return reply(id, { result: {} });
    case "tools/list":
      return reply(id, { result: { tools: state.tools.list() } });
    case "tools/call": {
      if (typeof params.name !== "string") return fail(id, -32602, "missing tool name");
      const args = params.arguments ?? {};
      if (typeof args !== "object" || args === null || Array.isArray(args))
        return fail(id, -32602, "arguments must be an object");
      const invalid = state.tools.validate(params.name, args);
      if (invalid) return fail(id, -32602, invalid);
      const out = state.tools.call(params.name, args, state);
      return reply(id, { result: "ok" in out ? content(out.ok, false) : content({ error: out.error }, true) });
    }
    default:
      return fail(id, -32601, `method not found: ${method}`);
  }
}
