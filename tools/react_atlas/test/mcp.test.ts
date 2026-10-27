import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { handle, newState, type State } from "../src/mcp.ts";
import { createRegistry } from "../src/tools.ts";

function setup() {
  const tools = createRegistry();
  tools.register({
    name: "echo",
    description: "Echo text",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string" }, n: { type: "integer" } },
      required: ["text"],
    },
    handler: (args: { text: string }) => ({ echoed: args.text }),
  });
  tools.register({
    name: "boom",
    description: "Always throws",
    inputSchema: { type: "object", properties: {}, required: [] },
    handler: () => {
      throw new Error("kaput");
    },
  });
  return newState(tools);
}

const send = (state: State, msg: unknown) => {
  const reply = handle(state, typeof msg === "string" ? msg : JSON.stringify(msg));
  return reply === null ? null : JSON.parse(reply);
};
const rpc = (id: number, method: string, params?: unknown) => ({ jsonrpc: "2.0", id, method, params });

test("initialize echoes protocolVersion and names the server", () => {
  const r = send(setup(), rpc(1, "initialize", { protocolVersion: "2024-11-05" }));
  assert.equal(r.id, 1);
  assert.equal(r.result.protocolVersion, "2024-11-05");
  assert.equal(r.result.serverInfo.name, "react_atlas");
  assert.deepEqual(r.result.capabilities, { tools: {} });
});

test("initialize defaults protocolVersion", () => {
  const r = send(setup(), rpc(1, "initialize"));
  assert.equal(r.result.protocolVersion, "2025-06-18");
});

test("notifications/initialized gets no reply", () => {
  const state = setup();
  assert.equal(send(state, { jsonrpc: "2.0", method: "notifications/initialized" }), null);
  assert.equal(state.initialized, true);
});

test("ping returns empty result", () => {
  assert.deepEqual(send(setup(), rpc(2, "ping")).result, {});
});

test("tools/list lists registered tools with schemas", () => {
  const { tools } = send(setup(), rpc(3, "tools/list")).result;
  assert.deepEqual(tools.map((t: { name: string }) => t.name), ["echo", "boom"]);
  assert.equal(tools[0].inputSchema.required[0], "text");
  assert.equal(tools[0].handler, undefined);
});

test("tools/call success wraps JSON payload in content text", () => {
  const r = send(setup(), rpc(4, "tools/call", { name: "echo", arguments: { text: "hi" } }));
  assert.equal(r.result.isError, undefined);
  assert.deepEqual(JSON.parse(r.result.content[0].text), { echoed: "hi" });
});

test("tools/call unknown tool is a tool error", () => {
  const r = send(setup(), rpc(5, "tools/call", { name: "nope", arguments: {} }));
  assert.equal(r.result.isError, true);
  assert.match(JSON.parse(r.result.content[0].text).error, /unknown tool/);
});

test("tools/call schema failures return -32602", () => {
  const state = setup();
  const missing = send(state, rpc(6, "tools/call", { name: "echo", arguments: {} }));
  assert.equal(missing.error.code, -32602);
  assert.match(missing.error.message, /text/);
  const wrong = send(state, rpc(7, "tools/call", { name: "echo", arguments: { text: 1 } }));
  assert.equal(wrong.error.code, -32602);
  const int = send(state, rpc(8, "tools/call", { name: "echo", arguments: { text: "a", n: 1.5 } }));
  assert.equal(int.error.code, -32602);
  const notObj = send(state, rpc(9, "tools/call", { name: "echo", arguments: [] }));
  assert.equal(notObj.error.code, -32602);
});

test("tool exception becomes isError and server survives", () => {
  const state = setup();
  const r = send(state, rpc(10, "tools/call", { name: "boom", arguments: {} }));
  assert.equal(r.result.isError, true);
  assert.equal(JSON.parse(r.result.content[0].text).error, "kaput");
  assert.deepEqual(send(state, rpc(11, "ping")).result, {});
});

test("unknown method is -32601", () => {
  assert.equal(send(setup(), rpc(12, "nope")).error.code, -32601);
});

test("parse error is -32700 with null id", () => {
  const r = send(setup(), "{not json");
  assert.equal(r.error.code, -32700);
  assert.equal(r.id, null);
});

test("stdio server answers initialize and tools/list", async () => {
  const child = spawn(process.execPath, ["bin/react-atlas.ts", "server"], { stdio: ["pipe", "pipe", "inherit"] });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.stdin.write(JSON.stringify(rpc(1, "initialize", {})) + "\n");
  child.stdin.write(JSON.stringify(rpc(2, "tools/list")) + "\n");
  child.stdin.end();
  await new Promise((resolve) => child.on("close", resolve));
  const lines = out.trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(lines.length, 2);
  assert.equal(lines[0].result.serverInfo.name, "react_atlas");
  assert.equal(lines[1].result.tools.length, 10);
});
