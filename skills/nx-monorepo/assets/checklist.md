# Nx monorepo rule catalogue

Cite IDs in findings. Workspace conventions override these. Baseline: Nx 22/23 (verify with `nx report`).
Line format: `ID rule. Check: <probe>. Src: <url> [tag]`. Tags: `[nx]` official Nx docs; `[3p]` third-party opinion; `[unverified]` not confirmed against docs/the installed version (verify with `nx <cmd> --help` before relying on it).
Paid (optional, never required): Conformance/Powerpack, Nx Cloud.

## Dependency matrix (from row may depend on column)
| From \ To | app | feature | ui | data-access | util |
|---|---|---|---|---|---|
| app | no | yes | yes | yes | yes |
| feature | no | no (same scope only if chosen) | yes | yes | yes |
| ui | no | no | yes | no | yes |
| data-access | no | no | no | yes | yes |
| util | no | no | no | no | yes |

Scope rules on top: `shared` depends only on `shared`; a domain depends on itself + `shared`. The data-access row/column is an extension of Nx's multi-dimension example (tag-multiple-dimensions guide); Nx's own prose is looser (feature may depend on "any type") and its ESLint example omits data-access. The feature->feature ban is stricter than Nx.

## LAY - layout
- LAY-01 Apps are thin (entry point, config, feature composition); logic lives in libs. Check: app `src/` size/contents vs libs. Src: https://nx.dev/docs/kb/folder-structure [nx]
- LAY-02 Libs grouped by scope/domain, not by technical type; code that changes together lives together. Check: folder tree under `libs/`. Src: https://nx.dev/docs/kb/folder-structure [nx]
- LAY-03 Lib promoted to `shared` only when a second domain needs it. Check: `shared` libs with a single consuming scope. Src: https://nx.dev/docs/kb/folder-structure [nx]
- LAY-04 Large flat `libs/` or `packages/` folder (past a few dozen projects) gets grouping folders. Check: `nx show projects` count vs folder depth. Src: https://nx.dev/docs/kb/folder-structure [nx]
- LAY-05 Grouping folders have a CODEOWNERS entry. Check: `CODEOWNERS` vs scope folders. Src: https://nx.dev/docs/kb/folder-structure [nx]
- LAY-06 Deprecated `nx.json` keys absent (`workspaceLayout`, `npmScope`, `implicitDependencies`; `affected.defaultBase`->top-level `defaultBase`). Check: read `nx.json`; confirm with `nx report`/migrate notes. Src: https://nx.dev/docs/reference/nx-json [unverified]

## LIB - library types
- LIB-01 Each lib has exactly one type from a small, documented set (feature/ui/data-access/util or the workspace's own). Check: per-project tags/naming. Src: https://nx.dev/docs/kb/project-dependency-rules [nx]
- LIB-02 Type is identifiable by naming convention, tag, or both, consistently (e.g. `libs/booking/feature-shell`). Check: names vs tags agree. Src: https://nx.dev/docs/kb/project-dependency-rules [nx]
- LIB-03 Contents match the type: feature = smart/container; ui = presentational, data via inputs; data-access = API/state; util = low-level helpers. Check: read lib contents (ui importing data-access, util importing UI). Src: https://nx.dev/docs/kb/project-dependency-rules [nx]
- LIB-04 Number of types stays low; extra types (api/domain/shell) are a workspace choice, not Nx-defined. Check: distinct `type:*` values. Src: https://nx.dev/docs/kb/project-dependency-rules [nx]
- LIB-05 Prefer small dedicated API/contract libs over an overgrown shared kernel. Check: size/fan-in of `shared` libs. Src: https://www.angulararchitects.io/ [unverified]

## BND - boundaries and tags
- BND-01 Every project has a scope tag and a type tag. Check: `nx show project <n> --json` tags; untagged can depend on nothing. Src: https://nx.dev/docs/kb/enforce-module-boundaries [nx]
- BND-02 `@nx/enforce-module-boundaries` is enabled with `depConstraints` reflecting the matrix. Check: eslint config (flat or `.eslintrc`). Src: https://nx.dev/docs/features/enforce-module-boundaries [nx]
- BND-03 Tags live in `project.json` `tags` or the `nx` block of `package.json`. Check: where tags are declared. Src: https://nx.dev/docs/kb/enforce-module-boundaries [nx]
- BND-04 No project cycles. There is NO `allowCircularDependencies` option; cycles are always errors (only `allowCircularSelfDependency` and `ignoredCircularDependencies` pairs can be exempted). Check: graph JSON, lint. Src: https://nx.dev/blog/mastering-the-project-boundaries-in-nx [nx]
- BND-05 `ignoredCircularDependencies` / `allow` / `allowCircularSelfDependency` exceptions are empty or justified. Check: eslint rule options. Src: https://nx.dev/docs/guides/enforce-module-boundaries [nx]
- BND-06 Cycles fixed by extracting a lower-level contract lib, not by exempting them. Check: diff of cycle fixes. Src: https://dev.to/abdelaaziz_ouakala/the-shared-library-is-a-lie-fixing-your-nx-monorepo-architecture-3mie [3p]
- BND-07 Cross-scope bans use `notDependOnLibsWithTags` (checks the whole transitive tree); `onlyDependOnLibsWithTags` checks direct deps only. Check: constraints. Src: https://nx.dev/docs/guides/enforce-module-boundaries/ban-dependencies-with-tags [nx]
- BND-08 Multiple matching constraints combine with AND; a broad constraint must not contradict a narrow one. Check: overlapping `sourceTag`s. Src: https://nx.dev/docs/guides/enforce-module-boundaries [nx]
- BND-09 `banTransitiveDependencies` / `enforceBuildableLibDependency` set deliberately (both default false). Check: rule options. Src: https://nx.dev/docs/guides/enforce-module-boundaries [nx]
- BND-10 External-package restrictions use `allowedExternalImports`/`bannedExternalImports` in a constraint. Check: constraints. Src: https://nx.dev/docs/guides/enforce-module-boundaries [nx]
- BND-11 Edges violating the matrix (app->app, ui->data-access, util->feature, shared->domain). Check: graph JSON edges vs tags. Src: https://nx.dev/docs/guides/enforce-module-boundaries/tag-multiple-dimensions [nx]
- BND-12 Conformance (`@nx/conformance/enforce-project-boundaries`) covers non-TS dependencies but is PAID (Powerpack/Enterprise); never a requirement. Check: `nx.json` `conformance`. Src: https://nx.dev/docs/reference/powerpack/conformance [nx]

## API - public API
- API-01 Each lib exposes one `index.ts` as its public API; consumers import via the lib alias/package name. Check: lib root + import statements. Src: https://nx.dev/docs/kb/enforce-module-boundaries [nx]
- API-02 No deep imports into another lib's internals (relative paths across projects, `@scope/lib/src/...`). Check: grep diff imports; lint. Src: https://nx.dev/docs/kb/enforce-module-boundaries [nx]
- API-03 `index.ts` does not re-export internals wholesale; export only what consumers need. Check: read `index.ts`. Src: https://dev.to/childrentime/barrel-files-why-indexts-re-exports-hurt-tree-shaking-nextjs-dev-memory-and-tsc-2026-3kpm [3p]
- API-04 Prefer many small libs over deep barrels (barrels can hurt tree-shaking, tsc/Jest startup, hide cycles, defeat Angular lazy loading). Check: barrel depth/size. Src: https://dev.to/childrentime/barrel-files-why-indexts-re-exports-hurt-tree-shaking-nextjs-dev-memory-and-tsc-2026-3kpm [3p]
- API-05 Exact lint message for deep imports is not verified; rely on lint pass/fail, not message text. Check: n/a. Src: https://nx.dev/docs/kb/enforce-module-boundaries [unverified]

## TSK - tasks and caching
- TSK-01 Inferred targets come from plugins in `nx.json` `plugins`; precedence low->high: inference, `targetDefaults`, project config. Check: `nx show project <n> --json`. Src: https://nx.dev/docs/concepts/inferred-tasks [nx]
- TSK-02 `namedInputs` define `default`, `production` (default minus tests/config), `sharedGlobals`; tasks reference them. Check: `nx.json`. Src: https://nx.dev/docs/kb/configure-inputs [nx]
- TSK-03 Overriding an input replaces the less specific source entirely; copy the full array before editing. Check: diff of inputs. Src: https://nx.dev/docs/kb/configure-inputs [nx]
- TSK-04 Too few inputs cause wrong cache hits; excluding tests from `production` assumes builds do not read them. Check: target inputs vs what the tool reads. Src: https://nx.dev/docs/kb/configure-inputs [nx]
- TSK-05 Tool versions that affect output are in inputs (`externalDependencies`, runtime inputs). Check: `nx.json` `sharedGlobals`/inputs. Src: https://nx.dev/docs/kb/configure-inputs [nx]
- TSK-06 Cacheable targets declare `outputs`. Check: `targetDefaults`/target `outputs`. Src: https://nx.dev/docs/kb/configure-inputs [unverified]
- TSK-07 `targetDefaults` keyed by target name, glob, or executor; the executor match beats name match (21.x docs: recheck on installed version). Check: key collisions. Src: https://nx.dev/docs/reference/nx-json [nx]
- TSK-08 `sync.applyChanges`/`sync.globalGenerators` configured as intended; run `nx sync` before `affected` in CI. Check: `nx.json`, CI. Src: https://nx.dev/docs/reference/nx-json [nx]

## TS - TypeScript linking
- TS-01 One linking strategy per workspace: package-manager workspaces + TS project references (current `create-nx-workspace` default) OR path aliases. Mixing is unsupported. Check: `tsconfig.base.json` `paths` + `references`. Src: https://nx.dev/docs/kb/typescript-project-linking [nx]
- TS-02 With references: `composite`/`declaration`/`declarationMap` in `tsconfig.base.json`, `paths` unset, `workspace:*` (or `*`) deps. Check: tsconfig, package.json. Src: https://nx.dev/blog/new-nx-experience-for-typescript-monorepos [nx]
- TS-03 With references, `nx sync` keeps them current; `nx sync:check` passes. Check: `nx sync:check` (confirm with `nx sync --help`). Src: https://nx.dev/docs/kb/typescript-project-linking [unverified]
- TS-04 Angular historically lacked project-reference support (Jan 2025 blog); aliases may be correct there. Re-check against the installed Angular/Nx versions. Check: framework version. Src: https://nx.dev/blog/new-nx-experience-for-typescript-monorepos [unverified]

## DEP - dependencies
- DEP-01 A deliberate versioning strategy per workspace (independent per project, or a single root version); mixing is allowed but explicit. Check: root vs project `package.json`. Src: https://nx.dev/docs/kb/dependency-management [nx]
- DEP-02 Version drift is enforced (syncpack, pnpm/yarn catalogs, or `@nx/dependency-checks`). Check: tooling present. Src: https://nx.dev/docs/kb/dependency-management [nx]
- DEP-03 Buildable/publishable libs use `@nx/dependency-checks` (missing, obsolete, mismatched deps; needs up-to-date lockfile; ignores root devDependencies). Check: lint on `**/*.json`. Src: https://nx.dev/docs/kb/dependency-checks [nx]

## GEN - generators
- GEN-01 New projects come from generators, ideally a local plugin in `tools/` that encodes tags/layout. Check: new project vs generator output shape. Src: https://nx.dev/docs/extending-nx/local-generators [nx]
- GEN-02 No legacy "workspace generators". Check: `tools/generators`. Src: https://nx.dev/docs/reference/deprecated/workspace-generators [nx]
- GEN-03 `nx.json` `generators` sets per-generator defaults. Check: `nx.json`. Src: https://nx.dev/docs/reference/nx-json [nx]
- GEN-04 Wiring tags into generator defaults has no official guidance; document the convention instead. Check: n/a. Src: https://nx.dev/docs/extending-nx/local-generators [unverified]

## CI
- CI-01 PR CI uses `nx affected -t <targets>` (selection by task inputs, not `dependsOn`). Check: CI files. Src: https://nx.dev/docs/features/ci-features/affected [nx]
- CI-02 Correct SHAs: `nrwl/nx-set-shas` or `NX_BASE`/`NX_HEAD`; GitHub checkout `fetch-depth: 0`. Check: workflow. Src: https://nx.dev/docs/features/ci-features/affected [nx]
- CI-03 `defaultBase` at top level (`affected.defaultBase` deprecated); lockfile changes affect everything unless `projectsAffectedByDependencyUpdates: "auto"`. Check: `nx.json`. Src: https://nx.dev/docs/features/ci-features/affected [nx]
- CI-04 `nx sync` / `sync:check` runs before `affected`. Check: CI step order. Src: https://nx.dev/docs/reference/nx-json [nx]
- CI-05 `nx release` config lives under `release` in `nx.json`; Nx 22/23 changed defaults (`updateDependents`, `preserveMatchingDependencyRanges`). Check: `nx.json`. Src: https://nx.dev/docs/reference/nx-json [nx]
- CI-06 Nx Cloud (Agents, remote cache, self-healing) is optional and PAID beyond a free tier; do not require it. Check: `nxCloudId`/tokens. Src: https://nx.dev/pricing [nx]
- CI-07 CODEOWNERS entries per scope folder. Check: `.github/CODEOWNERS`. Src: https://nx.dev/docs/kb/folder-structure [nx]

## ANT - anti-patterns
- ANT-01 Splitting things that always change together. Check: lib pairs co-changing in git log. Src: https://nx.dev/docs/kb/project-size [nx]
- ANT-02 Assuming every project must be reusable. Check: libs with one consumer. Src: https://nx.dev/docs/kb/project-size [nx]
- ANT-03 Treating new projects as free (split without a concrete payoff). Check: tiny libs with no boundary/ownership reason. Src: https://nx.dev/docs/kb/project-size [nx]
- ANT-04 One giant project (affected and caching ineffective). Check: project size/fan-in. Src: https://nx.dev/docs/kb/project-size [nx]
- ANT-05 Features implemented inside apps; everything shared from the start; grouping by tech type. Check: app contents, `shared` contents, folder names. Src: https://nx.dev/docs/kb/folder-structure [nx]
- ANT-06 Catch-all `shared`/`common` lib; apps treated as the same layer as libs. Check: `shared` lib breadth, lib->app imports. Src: https://dev.to/abdelaaziz_ouakala/the-shared-library-is-a-lie-fixing-your-nx-monorepo-architecture-3mie [3p]
