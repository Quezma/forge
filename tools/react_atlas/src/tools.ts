export type Schema = {
  type: "object";
  properties: Record<string, { type: string; description?: string; enum?: string[] }>;
  required: string[];
};

export type Tool = {
  name: string;
  description: string;
  inputSchema: Schema;
  // Returns the JSON payload; throw to report a tool error.
  handler: (args: any, state: any) => unknown;
};

export type Registry = {
  register: (tool: Tool) => void;
  list: () => Omit<Tool, "handler">[];
  validate: (name: string, args: Record<string, unknown>) => string | null;
  call: (name: string, args: Record<string, unknown>, state: unknown) => { ok: unknown } | { error: string };
};

const typeOk: Record<string, (v: unknown) => boolean> = {
  string: (v) => typeof v === "string",
  integer: (v) => Number.isInteger(v),
  number: (v) => typeof v === "number",
  boolean: (v) => typeof v === "boolean",
  array: (v) => Array.isArray(v),
  object: (v) => typeof v === "object" && v !== null && !Array.isArray(v),
};

export function createRegistry(): Registry {
  const tools = new Map<string, Tool>();

  const validate: Registry["validate"] = (name, args) => {
    const tool = tools.get(name);
    if (!tool) return null; // unknown tools surface from call()
    const { properties, required } = tool.inputSchema;
    const missing = required.find((k) => !(k in args));
    if (missing) return `missing required argument: ${missing}`;
    for (const [k, v] of Object.entries(args)) {
      const type = properties[k]?.type;
      if (type && !typeOk[type]?.(v)) return `argument ${k} must be ${type}`;
    }
    return null;
  };

  return {
    register: (tool) => void tools.set(tool.name, tool),
    list: () => [...tools.values()].map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
    validate,
    // A tool must never take the server down: exceptions become errors.
    call: (name, args, state) => {
      const tool = tools.get(name);
      if (!tool) return { error: `unknown tool: ${name}` };
      try {
        return { ok: tool.handler(args, state) };
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    },
  };
}
