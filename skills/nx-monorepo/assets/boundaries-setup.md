# Boundaries setup (Setup mode, explicit request only)

Goal: every project has `scope:*` and `type:*` tags and `@nx/enforce-module-boundaries` enforces them. Nothing is edited before the user approves the tag map.

## Steps
1. `nx report` (version). `nx show projects`. For each project: `nx show project <name> --json` to read current `tags`, `root`, `projectType`.
2. Detect existing conventions: current tags, type names, folder grouping, an existing `@nx/enforce-module-boundaries` config. Keep and extend them; map to the default types only where nothing exists.
3. Propose the tag map and STOP for approval:

   | project | root | scope | type |
   |---------|------|-------|------|
   | <name> | <path> | scope:<domain\|shared> | type:<app\|feature\|ui\|data-access\|util> |

   Also propose the `depConstraints` (below), adapted to the real scopes. Flag projects whose scope/type is ambiguous instead of guessing.
4. After approval, add tags: `project.json` `"tags": [...]`, or the `nx` block of `package.json` (`"nx": {"tags": [...]}`), whichever the project already uses.
5. Detect the lint config: flat `eslint.config.{js,mjs,cjs,ts}` or legacy `.eslintrc*`. Add the rule to the one in use; do not migrate between them.
6. Verify: `nx run-many -t lint` (and `nx show project <name> --json` for a sample). Report violations; do not auto-fix imports.
7. Introduce gradually: start with `warn`, fix the violations, then raise to `error`. (Recommendation, not Nx-sourced.)

## Rule (adapted from https://nx.dev/docs/guides/enforce-module-boundaries/tag-multiple-dimensions)
```js
'@nx/enforce-module-boundaries': ['error', {
  enforceBuildableLibDependency: true,
  banTransitiveDependencies: true,
  allow: [],
  depConstraints: [
    { sourceTag: 'scope:shared', onlyDependOnLibsWithTags: ['scope:shared'] },
    { sourceTag: 'scope:booking', onlyDependOnLibsWithTags: ['scope:shared', 'scope:booking'] },
    { sourceTag: 'scope:checkin', onlyDependOnLibsWithTags: ['scope:shared', 'scope:checkin'] },
    { sourceTag: 'type:app', onlyDependOnLibsWithTags: ['type:feature','type:ui','type:data-access','type:util'] },
    { sourceTag: 'type:feature', onlyDependOnLibsWithTags: ['type:ui','type:data-access','type:util'] },
    { sourceTag: 'type:ui', onlyDependOnLibsWithTags: ['type:ui','type:util'] },
    { sourceTag: 'type:data-access', onlyDependOnLibsWithTags: ['type:data-access','type:util'] },
    { sourceTag: 'type:util', onlyDependOnLibsWithTags: ['type:util'] },
    { sourceTag: 'scope:booking', notDependOnLibsWithTags: ['scope:checkin'] }
  ]
}]
```
- `booking`/`checkin` are example scopes; replace with the workspace's domains (one `scope:<domain>` entry each).
- The `data-access` entry is an extension of Nx's example, not from the Nx page.
- Matching constraints combine with AND. `onlyDependOnLibsWithTags` checks direct deps; `notDependOnLibsWithTags` checks the whole transitive tree.
- Untagged projects can depend on nothing unless a constraint allows `*`: tag every project.
- There is no `allowCircularDependencies` option; project cycles are always errors (`allowCircularSelfDependency`, `ignoredCircularDependencies` exist for exceptions).
- Tag matchers: exact, `*`, glob (`scope:*`), regex (`"/^scope.*/"`).
- Banning external packages per tag: `allowedExternalImports` / `bannedExternalImports` in a constraint.
- Do not enable `checkNestedExternalImports` or other options without reading `nx` docs for the installed version.
