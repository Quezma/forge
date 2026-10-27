# Boundaries setup (Setup mode, explicit request only)

Goal: import cycles and layer/feature boundary violations fail lint or CI. Nothing is edited or installed before the user approves the zones and the cycle check.

## Steps
1. Read `package.json` (`@nestjs/core`, eslint version, installed `eslint-plugin-import`/`eslint-plugin-import-x`, `eslint-plugin-boundaries`, `madge`, `dependency-cruiser`, `eslint-import-resolver-typescript`), `tsconfig.json` (`paths`), and the source tree. Nx workspace: stop at app level; workspace boundaries belong to the `nx-monorepo` skill.
2. Detect existing conventions: layer folder names (`domain/`, `application/`, `infrastructure/`, `presentation/`, `ports/`...), feature folders, an existing boundary or cycle rule. Keep and extend them; map to the default layers only where nothing exists.
3. Detect the lint config: flat `eslint.config.{js,mjs,cjs,ts}` or legacy `.eslintrc*`. Edit the one in use; do not migrate between them.
4. Propose and STOP for approval:

   | feature | path | layers present |
   |---------|------|----------------|
   | <name> | src/<feature> | domain, application, infrastructure, interface |

   Plus: the zones (below) adapted to the real folders, the cycle check choice, and any package to install (named, with why). Flag ambiguous folders instead of guessing.
5. After approval (and approved installs only): add the rules as `warn`, add the cycle script, run lint, report violation counts. Do not auto-fix imports.
6. After the violations are fixed (separately), raise rules to `error` and add the cycle script to CI. (Gradual rollout is a recommendation, not tool-sourced.)

## Cycle check (pick one; prefer what is already installed)
- Lint: `import/no-cycle` (eslint-plugin-import or import-x). Ignores `import type`. Expensive on large repos; `maxDepth` hides long cycles and is not recommended by its docs. Src: https://github.com/import-js/eslint-plugin-import/blob/main/docs/rules/no-cycle.md
- Script with madge: `"check:cycles": "madge --circular --extensions ts src"`; add `.madgerc` with `{"detectiveOptions":{"ts":{"skipTypeImports":true}},"tsConfig":"tsconfig.json"}` to ignore type-only edges and resolve `paths`. Exit code on cycles is not documented: verify it fails CI before relying on it. Src: https://github.com/pahen/madge
- Script with dependency-cruiser: `npx dependency-cruiser --init` generates a config with a no-circular rule; validate with `npx dependency-cruiser src` (v13+). Src: https://github.com/sverweij/dependency-cruiser

## Layer zones (`import/no-restricted-paths`, verified option shape)
```js
'import/no-restricted-paths': ['warn', {
  basePath: './src',
  zones: [
    // domain depends on nothing outside domain
    { target: './*/domain', from: ['./*/application', './*/infrastructure', './*/interface'],
      message: 'domain must not import application/infrastructure/interface' },
    // application depends on domain + its own ports only
    { target: './*/application', from: ['./*/infrastructure', './*/interface'],
      message: 'application depends on ports; bind implementations in the module' },
    // interface never touches infrastructure directly
    { target: './*/interface', from: './*/infrastructure',
      message: 'controllers call application services, not repositories' },
  ],
}],
```
- `target`/`from` accept directories or globs; `from` cannot mix both kinds; `except` is relative to `from`. Src: https://github.com/import-js/eslint-plugin-import/blob/main/docs/rules/no-restricted-paths.md
- Glob support for `./*/domain`-style targets: confirm against the installed plugin version before relying on it [unverified]; otherwise list each feature explicitly.
- `*.module.ts` is the composition root and needs an exception to import infrastructure (add it to the zone's `except` or exclude module files via an eslint `files`/`ignores` block).
- Banning framework/ORM imports in domain: `no-restricted-imports` with `patterns: ['@nestjs/*', 'typeorm', '@prisma/client', 'mongoose', '@mikro-orm/*', 'sequelize']` in a `files: ['src/**/domain/**']` block (ESLint core rule) [unverified option set; check ESLint docs].
- Feature-to-feature: allow importing only another feature's module file/public contract; ban deep paths. Express as additional zones or with `eslint-plugin-boundaries`.

## eslint-plugin-boundaries (alternative, richer element model)
- Elements are declared in `settings['boundaries/elements']` (`type`, `pattern`); the README shows rule `boundaries/dependencies` with `default: 'disallow'` and `policies` of `allow`/`disallow`. Src: https://github.com/javierbrea/eslint-plugin-boundaries
- Older releases used `boundaries/element-types`; the rule name, `capture` support, and the TypeScript resolver requirement depend on the installed major [unverified]: read the installed version's docs before writing config.

## Verify
- Project lint script (no `--fix`); report counts per rule.
- Cycle script; confirm it exits non-zero on a cycle before adding it to CI.
- `npx tsc --noEmit` still passes.
