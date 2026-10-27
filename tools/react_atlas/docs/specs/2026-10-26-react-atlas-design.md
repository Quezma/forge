# react_atlas design

## Intent

A sibling of `ex_atlas` for React/TypeScript projects. It indexes a project and serves the index, pattern knowledge, and deterministic audit findings to AI agents over MCP, so agents reuse existing components instead of duplicating them, use the design system, and access global state the way the project does.

## Goals

- Index components, hooks, and functions with exact symbol resolution (TypeScript compiler API, using the target's `tsconfig.json`; `allowJs` for JS projects).
- Record JSX usage sites: which component is rendered where, with which props.
- Record global state access: store hooks, selectors, context consumers.
- Detect automatically (`audit` tool):
  - `duplicate_component`: components whose normalized JSX structure and prop names are near-identical.
  - `ds_bypass`: raw intrinsic elements (`<button>`, `<input>`, ...) rendered outside the design system when a design-system component wraps that element; hardcoded colors and inline styles outside the design system.
  - `wrong_usage`: rendering a `@deprecated` component or prop; prop usage that contradicts the dominant usage of a component (outlier); breaking a pattern entry that carries a machine check.
  - `state_misuse`: calling a raw store hook (`useSelector`, `useStore`, `useContext(X)`) when the project defines a wrapper for it; store access from areas the patterns forbid.
- Port the ex_atlas knowledge layer unchanged in spirit: pattern entries with evidence, purpose lines, `context_for_task`, `find_reusable`, usage log, learnings, acceptance fixtures.

## Non-goals

- Replacing ESLint or TypeScript errors (type-invalid props are the compiler's job).
- Runtime analysis, rendering, or visual diffing.
- Embeddings or model dependencies.
- Frameworks other than React (Vue, Svelte).

## Anti-goals

- Any dependency added to the target project.
- Noisy audits: a finding must cite file:line on both sides and a measured reason. Thresholds are configurable and default conservative.
- Pattern knowledge too large to load on every task (same 8k token budget as ex_atlas).

## Constraints and decisions

- Language: TypeScript run directly by Node >= 23 (type stripping). One runtime dependency: `typescript`. Tests: `node --test`.
- Distribution: global CLI `react-atlas` (`npm link` / `npm i -g`), commands `install`, `index [--full]`, `server`, `acceptance [--eval]`.
- MCP: newline-delimited JSON-RPC 2.0 over stdio, hand-rolled, pure handler, stdout carries only JSON-RPC.
- Storage: `.react_atlas/index.json` (gitignored, format-versioned), `.react_atlas/patterns/<area>.json` (committed), `.react_atlas/config.json` (committed), `.react_atlas/usage.jsonl` (gitignored).
- Symbol ids: `<repo-relative path>#<ExportOrLocalName>`.
- Kinds: `component` (function/arrow/class returning JSX, including `memo`/`forwardRef` wrappers), `hook` (`use[A-Z]*`), `function`, `context` (`createContext`), `store` (zustand `create`, redux `createSlice`/`configureStore`).
- Areas: `src/features/<x>/**` and `src/<x>/**` map to `x`; configurable via `config.areas` globs. The design system is declared in `config.designSystem` (paths or package names); default guesses `src/components/ui`.
- Incremental indexing by file content hash; degraded mode on compiler errors keeps last good data for unchanged files.

## Tools (MCP)

Ported: `context_for_task`, `find_reusable`, `component` (replaces `module`), `callers` (usage sites), `reindex`, `record_pattern`, `set_purpose`, `record_learning`.
New: `audit {paths?, checks?}` returns `{findings:[{check, severity, file, line, message, related:[{id,file,line}], evidence}]}`; `state_map {store?}` returns who reads/writes each store or context.

## Left to the builder

Exact similarity algorithm and threshold for duplicates; outlier statistics for prop usage; heuristics for recognizing store libraries beyond zustand/redux/context.
