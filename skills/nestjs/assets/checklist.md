# NestJS rule catalogue

Cite IDs in findings. Project conventions override these. Baseline: Nest 12 (verify `@nestjs/core` in `package.json`). `v12+` = applies to Nest 12 only.
Line format: `ID rule. Check: <probe>. Src: <url> [tag]`. Tags: `[nest]` official Nest docs (fetched); `[tool]` official docs of the named tool/TypeScript (fetched); `[3p]` third-party/architecture opinion; `[unverified]` not confirmed against docs/the installed version.

## Layer dependency matrix (from row may depend on column)
| From \ To | interface | application | domain | infrastructure |
|---|---|---|---|---|
| interface (controller, resolver, gateway, DTO) | yes | yes | types only | no |
| application (use case/service, ports) | no | yes | yes | no (via port token) |
| domain (entities, value objects, domain services) | no | no | yes | no |
| infrastructure (repositories, ORM entities, clients, port impls) | no | yes (ports only) | yes | yes |

`*.module.ts` is the composition root of its feature: it may import every layer of its own feature to bind ports to implementations. Cross-feature imports go only through another module's `exports`. Matrix is a hexagonal/clean convention [3p], not Nest-defined; Nest itself only defines module encapsulation (MOD rules).

## MOD - modules
- MOD-01 Feature modules group controllers/providers by domain, not by technical type. Check: folder tree, `@Module` contents. Src: https://docs.nestjs.com/modules [nest]
- MOD-02 A module's `exports` is its public API; other modules inject only exported providers. Check: cross-module injections vs `exports`. Src: https://docs.nestjs.com/modules [nest]
- MOD-03 Export only what consumers need; no wholesale re-export of imported modules unless it is a deliberate facade (e.g. `CoreModule`). Check: `exports` arrays, re-exported modules. Src: https://docs.nestjs.com/modules [nest]
- MOD-04 A provider is declared in exactly one module and shared via `exports`; re-declaring it in `providers` elsewhere creates a second instance. Check: same class in several `providers` arrays. Src: https://docs.nestjs.com/modules [nest]
- MOD-05 `@Global()` used sparingly, registered once (root/core); "making everything global is not a good design decision". Check: grep `@Global(`. Src: https://docs.nestjs.com/modules [nest]
- MOD-06 Dynamic modules follow `register` (per consumer) / `forRoot` (once per app) / `forFeature` (per module on top of root); async variants when options need DI. Check: static method names vs usage. Src: https://docs.nestjs.com/fundamentals/dynamic-modules [nest]
- MOD-07 Configurable dynamic modules use `ConfigurableModuleBuilder` (`MODULE_OPTIONS_TOKEN`, `setClassMethodName`, `setExtras`) instead of hand-written `forRoot`/`forRootAsync`. Check: hand-rolled dynamic module boilerplate. Src: https://docs.nestjs.com/fundamentals/dynamic-modules [nest]
- MOD-08 `forRoot()` is called once; other modules re-export the module class instead of calling `forRoot()` again (each call is a separate instance). Check: repeated `forRoot(` for the same module. Src: https://docs.nestjs.com/modules [nest]

## DI - providers and injection
- DI-01 Constructor injection by default; property injection only when a base class carries the dependency. Check: `@Inject()` on properties. Src: https://docs.nestjs.com/providers [nest]
- DI-02 Default singleton scope; request scope only when required ("strongly recommend using the default singleton scope"). Check: grep `Scope.REQUEST`, `scope:`. Src: https://docs.nestjs.com/fundamentals/injection-scopes [nest]
- DI-03 Request scope bubbles up: every consumer (including controllers) becomes request-scoped; justify each chain. Check: injectors of request-scoped providers. Src: https://docs.nestjs.com/fundamentals/injection-scopes [nest]
- DI-04 Multi-tenant request scope uses durable providers + `ContextIdStrategy`, not plain per-request trees (not ideal for many tenants). Check: tenant-keyed `Scope.REQUEST`. Src: https://docs.nestjs.com/fundamentals/injection-scopes [nest]
- DI-05 Interfaces/ports are injected via a symbol/string token or an abstract class (interfaces are erased at runtime). Check: ports bound with `provide: <token>` + `@Inject(<token>)`. Src: https://docs.nestjs.com/fundamentals/custom-providers [nest]
- DI-06 Tokens live in a dedicated file (e.g. `*.constants.ts`/`*.tokens.ts`) and are shared as the same symbol instance. Check: duplicated string tokens, tokens defined in module files. Src: https://docs.nestjs.com/fundamentals/custom-providers [nest]
- DI-07 Custom providers are exported by token (or full provider object) when consumed elsewhere. Check: `exports` vs injected tokens. Src: https://docs.nestjs.com/fundamentals/custom-providers [nest]
- DI-08 `@Optional()` dependencies have explicit fallbacks; v12 no longer inherits `@Optional()` into a redeclared subclass constructor (`v12+`). Check: `@Optional()` usages, subclasses. Src: https://docs.nestjs.com/migration-guide [nest]
- DI-09 `ModuleRef.get()` is not used for scoped providers (use `resolve()`); `{ strict: false }` lookups are flagged as hidden cross-module coupling. Check: grep `moduleRef.get(`, `strict: false`. Src: https://docs.nestjs.com/fundamentals/module-ref [nest]

## CYC - circular dependencies
- CYC-01 No module import cycles (A imports B imports A). Check: module graph from `imports` arrays; madge. Src: https://docs.nestjs.com/fundamentals/circular-dependency [nest]
- CYC-02 No file-level import cycles in `src/`. Check: `npx madge --circular --extensions ts src` or `import/no-cycle`. Src: https://github.com/pahen/madge [tool]
- CYC-03 No barrel `index.ts` for modules/providers; never import a barrel from inside its own directory. Check: `index.ts` re-exporting `*.module`/`*.service`; same-dir barrel imports. Src: https://docs.nestjs.com/fundamentals/circular-dependency [nest]
- CYC-04 `forwardRef()` is a smell: order of instantiation becomes indeterminate and request-scoped cycles can yield `undefined`. Any new `forwardRef` is a finding. Check: grep `forwardRef(`. Src: https://docs.nestjs.com/fundamentals/circular-dependency [nest]
- CYC-05 Cycle fix = restructure: extract the shared provider into a lower-level module, or invert via port token (DI-05), or decouple via events (CYC-06). Check: cycle-fix diffs. Src: https://docs.nestjs.com/fundamentals/circular-dependency [3p]
- CYC-06 Reactions to another domain's state change use events (`@nestjs/event-emitter` `@OnEvent`, or CQRS `EventBus`) instead of a back-reference. Check: bidirectional service calls between modules. Src: https://docs.nestjs.com/techniques/events [nest]
- CYC-07 A cycle check runs in CI or lint (madge/dependency-cruiser script or `import/no-cycle`). Check: `package.json` scripts, eslint config, CI. Src: https://github.com/import-js/eslint-plugin-import/blob/main/docs/rules/no-cycle.md [tool]
- CYC-08 `import/no-cycle` ignores `import type`; type-only cycles are allowed but runtime cycles are not. madge needs `detectiveOptions.ts.skipTypeImports` to match. Check: `.madgerc`, cycle reports listing type-only edges. Src: https://github.com/pahen/madge [tool]

## LAY - layering and boundaries
- LAY-01 Controllers are thin: parse/validate input, call one application service/use case, map output. No ORM/repository calls, no business rules. Check: controller bodies, repository injections in controllers. Src: https://docs.nestjs.com/controllers [3p]
- LAY-02 Domain code imports neither `@nestjs/*` nor ORM packages (`typeorm`, `@prisma/client`, `mongoose`, `@mikro-orm/*`, `sequelize`). Check: grep imports in domain folders. Src: https://docs.nestjs.com/recipes/cqrs [3p]
- LAY-03 Dependencies point inward per the matrix; application depends on ports, infrastructure implements them. Check: imports vs matrix. Src: https://docs.nestjs.com/fundamentals/custom-providers [3p]
- LAY-04 Request/response DTOs are separate from persistence/domain entities; entities are not returned raw or bound to `@Body()`. Check: `@Body()` types, controller return types. Src: https://docs.nestjs.com/techniques/serialization [3p]
- LAY-05 No imports of another feature's non-exported files (deep relative paths into `../other-feature/...`). Check: grep cross-feature relative imports vs that module's `exports`. Src: https://docs.nestjs.com/modules [3p]
- LAY-06 Layer/feature boundaries enforced by lint (`import/no-restricted-paths` zones or `eslint-plugin-boundaries`). Check: eslint config. Src: https://github.com/import-js/eslint-plugin-import/blob/main/docs/rules/no-restricted-paths.md [tool]

## VAL - validation and serialization
- VAL-01 Global validation at the app level (`useGlobalPipes(new ValidationPipe(...))` or `APP_PIPE`). Check: `main.ts`, `APP_PIPE`. Src: https://docs.nestjs.com/techniques/validation [nest]
- VAL-02 `whitelist: true` + `forbidNonWhitelisted: true` (reject unknown props); `transform: true` for typed DTO instances. Check: ValidationPipe options. Src: https://docs.nestjs.com/techniques/validation [nest]
- VAL-03 Every `@Body()`/`@Query()`/`@Param()` DTO has validation decorators (or a schema); no `any`/plain object bodies. Check: DTO classes without decorators. Src: https://docs.nestjs.com/techniques/validation [nest]
- VAL-04 Standard Schema alternative (Zod/Valibot/ArkType) via `schema` option + `StandardSchemaValidationPipe` is valid (`v12+`); one validation approach per app. Check: mixed class-validator + schema pipes. Src: https://docs.nestjs.com/migration-guide [nest]
- VAL-05 Sensitive fields hidden via `ClassSerializerInterceptor` + `@Exclude()` (handler must return class instances, not wrapped plain objects) or `StandardSchemaSerializerInterceptor` allowlist (`v12+`). Check: password/secret fields in responses; `{ user }` wrappers. Src: https://docs.nestjs.com/techniques/serialization [nest]
- VAL-06 Hybrid apps: global pipes/guards/filters do not reach connected microservices unless `inheritAppConfig: true`. Check: `connectMicroservice(` options. Src: https://docs.nestjs.com/faq/hybrid-application [nest]

## ERR - exceptions
- ERR-01 Throw built-in `HttpException` subclasses (`NotFoundException`, ...) from interface/application; domain throws domain errors mapped by a filter. Check: `throw new Error` in controllers; `HttpException` in domain. Src: https://docs.nestjs.com/exception-filters [nest]
- ERR-02 Global filters registered via `APP_FILTER` when they need DI (`useGlobalFilters` cannot inject). Check: `useGlobalFilters(` with constructor deps. Src: https://docs.nestjs.com/exception-filters [nest]
- ERR-03 Catch-all filters use `HttpAdapterHost` (adapter-agnostic), not raw Express/Fastify objects. Check: `@Catch()` filters importing `express`. Src: https://docs.nestjs.com/exception-filters [nest]
- ERR-04 Internal errors are not leaked: attach inner errors via `cause` (never serialized), keep generic 500 bodies. Check: stack/message of unknown errors in responses. Src: https://docs.nestjs.com/exception-filters [nest]

## CFG - configuration
- CFG-01 Config via `@nestjs/config` `ConfigService`, not `process.env` scattered through code. Check: grep `process.env` outside config files/`main.ts`. Src: https://docs.nestjs.com/techniques/configuration [nest]
- CFG-02 Env validated at startup (`validationSchema` or `validate`); Standard Schema (Zod etc.) accepted `v12+`, Joi needs v18+ with options under `validationOptions.libraryOptions` (`v12+`). Check: `ConfigModule.forRoot` options. Src: https://docs.nestjs.com/migration-guide [nest]
- CFG-03 Namespaced config via `registerAs()` and injected with `ConfigType<typeof x>`/`x.KEY`; `forFeature()` in feature modules. Check: flat untyped `get('FOO')`. Src: https://docs.nestjs.com/techniques/configuration [nest]
- CFG-04 Required values read with `getOrThrow()` or a typed `ConfigService<Env, true>`; `isGlobal`/`cache` set deliberately. Check: `get()` without default for required keys. Src: https://docs.nestjs.com/techniques/configuration [nest]
- CFG-05 Dynamic modules needing config use `forRootAsync({ useFactory, inject: [ConfigService] })` or `asProvider()`. Check: `forRoot(` reading `process.env`. Src: https://docs.nestjs.com/techniques/configuration [nest]

## SEC - security
- SEC-01 Security headers: `helmet` (Express), `@fastify/helmet` (Fastify), or `app.useSecurityHeaders()` (`v12+`), registered before other `app.use()`/routes. Check: `main.ts` order. Src: https://docs.nestjs.com/security/helmet [nest]
- SEC-02 CORS configured explicitly (origins, `methods`); Fastify defaults reject cross-origin PUT/PATCH/DELETE. Check: `enableCors(`/`cors:` options. Src: https://docs.nestjs.com/security/cors [nest]
- SEC-03 Rate limiting with `@nestjs/throttler` (`ThrottlerGuard` as `APP_GUARD`); shared storage for multi-instance; trust-proxy configured behind a proxy. Check: `ThrottlerModule`, `trust proxy`. Src: https://docs.nestjs.com/security/rate-limiting [nest]
- SEC-04 Authn/authz in guards (global `APP_GUARD` + public-route metadata), roles via `Reflector.createDecorator`; no auth checks inside controllers/services. Check: manual role checks in handlers. Src: https://docs.nestjs.com/guards [nest]
- SEC-05 No secrets in code or committed `.env`; secrets come from env/secret store via config. Check: grep keys/tokens/passwords literals, `.gitignore`. Src: https://docs.nestjs.com/techniques/configuration [unverified]

## LIFE - lifecycle
- LIFE-01 `app.enableShutdownHooks()` enabled when the app holds resources (DB, queues) or runs in containers; off by default due to listener cost. Check: `main.ts`. Src: https://docs.nestjs.com/fundamentals/lifecycle-events [nest]
- LIFE-02 Resource setup/teardown in `onModuleInit`/`onModuleDestroy`/`onApplicationShutdown`, not in constructors; request-scoped classes get no hooks. Check: async work in constructors; hooks on request-scoped classes. Src: https://docs.nestjs.com/fundamentals/lifecycle-events [nest]
- LIFE-03 No code assumes hook order across modules (v12 runs hooks by hierarchy level, `v12+`). Check: init logic depending on another module's hook. Src: https://docs.nestjs.com/migration-guide [nest]
- LIFE-04 Events are not emitted before listeners exist (registered in `onApplicationBootstrap`); await `EventEmitterReadinessWatcher.waitUntilReady()`. Check: `emit(` in constructors/`onModuleInit`. Src: https://docs.nestjs.com/techniques/events [nest]

## TST - testing
- TST-01 DI-dependent units tested with `Test.createTestingModule(...).compile()`; plain logic tested in isolation. Check: spec setup. Src: https://docs.nestjs.com/fundamentals/testing [nest]
- TST-02 Replace real dependencies with `overrideProvider()`/`useMocker()`; mock ports (tokens), not internals of the unit under test. Check: specs mocking private methods or the SUT's own collaborators' internals. Src: https://docs.nestjs.com/fundamentals/testing [nest]
- TST-03 e2e via `createNestApplication()` + `app.init()` + supertest (`app.inject()` on Fastify), closed in `afterAll`. Check: `test/*.e2e-spec.ts`. Src: https://docs.nestjs.com/fundamentals/testing [nest]
- TST-04 Global enhancers made overridable (`APP_GUARD` with `useExisting`). Check: e2e tests disabling auth by hacks. Src: https://docs.nestjs.com/fundamentals/testing [nest]
- TST-05 Unit specs colocated `*.spec.ts`; e2e in `test/` as `*.e2e-spec.ts`. Check: file layout. Src: https://docs.nestjs.com/fundamentals/testing [nest]

## OBS - logging and health
- OBS-01 Use Nest `Logger` (`new Logger(Cls.name)`) or a `LoggerService` impl; no bare `console.log` in app code. Check: grep `console.log` in `src/`. Src: https://docs.nestjs.com/techniques/logger [nest]
- OBS-02 Production logs as JSON to stdout (`ConsoleLogger({ json: true })`, or Pino/Winston); custom logger attached with `bufferLogs` + `app.useLogger()`. Check: `main.ts`. Src: https://docs.nestjs.com/techniques/logger [nest]
- OBS-03 Health/readiness endpoint with `@nestjs/terminus`; custom indicators use `HealthIndicatorService` (legacy `HealthIndicator`/`HealthCheckError` removed `v12+`). Check: health module, indicator classes. Src: https://docs.nestjs.com/recipes/terminus [nest]
- OBS-04 Terminus `gracefulShutdownTimeoutMs` set when behind an orchestrator; requires shutdown hooks (LIFE-01). Check: `TerminusModule.forRoot` options. Src: https://docs.nestjs.com/recipes/terminus [nest]

## PERF - performance
- PERF-01 Fastify adapter considered when throughput matters (about 2x Express benchmarks); Express-only middleware/recipes then need Fastify equivalents; listen on `0.0.0.0` in containers. Check: adapter, Express-specific imports. Src: https://docs.nestjs.com/techniques/performance [nest]
- PERF-02 Response caching via `@nestjs/cache-manager` `CacheInterceptor` (GET only); per-user responses keyed with `trackBy()`; not with GraphQL. Check: cache usage. Src: https://docs.nestjs.com/techniques/caching [nest]
- PERF-03 Compression offloaded to the reverse proxy for high-traffic production; in-app compression otherwise. Check: `compression`/`@fastify/compress` vs proxy setup. Src: https://docs.nestjs.com/techniques/compression [nest]

## TS - TypeScript
- TS-01 `strict` (or at least `strictNullChecks`) on; `strictPropertyInitialization` defaults on with `strict`, so DTO props use `!` or initializers deliberately. Check: `tsconfig.json`, DTO declarations. Src: https://www.typescriptlang.org/tsconfig/#strictPropertyInitialization [tool]
- TS-02 `experimentalDecorators` + `emitDecoratorMetadata` enabled (Nest DI reads constructor param types). Check: `tsconfig.json`. Src: https://www.typescriptlang.org/tsconfig/#emitDecoratorMetadata [unverified]
- TS-03 No `any` in exported/public signatures (services, DTOs, module APIs). Check: grep `: any` in exported members. Src: https://typescript-eslint.io/rules/no-explicit-any/ [unverified]
- TS-04 Toolchain matches v12 requirements: Node 20.19+/22.12+ runtime, TypeScript 6 for `@nestjs/schematics` 12, ESM migration optional (`v12+`). Check: `engines`, `typescript` version. Src: https://docs.nestjs.com/migration-guide [nest]

## FEAT - Nest features to suggest when they fit (never speculatively)
- FEAT-01 CQRS (`@nestjs/cqrs`) for large/complex domains with distinct read/write needs; plain service/repository is sufficient for small/medium apps. Event handler errors are not caught by filters. Check: domain complexity vs CQRS use. Src: https://docs.nestjs.com/recipes/cqrs [nest]
- FEAT-02 Queues (`@nestjs/bullmq`) for burst smoothing and CPU-heavy work off the request path. Check: long synchronous work in handlers. Src: https://docs.nestjs.com/techniques/queues [nest]
- FEAT-03 Events (`@nestjs/event-emitter`) for in-process decoupling between modules (see CYC-06). Check: fan-out calls after state changes. Src: https://docs.nestjs.com/techniques/events [nest]
- FEAT-04 OpenAPI via `@nestjs/swagger` with the CLI plugin (`.dto.ts`/`.entity.ts` suffixes, mapped types from `@nestjs/swagger`); runtime validation still via class-validator. Check: `nest-cli.json` plugins, hand-written `@ApiProperty` everywhere. Src: https://docs.nestjs.com/openapi/cli-plugin [nest]
- FEAT-05 API versioning via `enableVersioning` (URI/header/media type/custom) with `defaultVersion`. Check: hand-rolled `/v1` prefixes. Src: https://docs.nestjs.com/techniques/versioning [nest]
- FEAT-06 Interceptors for cross-cutting response concerns (mapping, timing, caching); custom param decorators instead of repeated `@Req()` digging. Check: duplicated logic across handlers. Src: https://docs.nestjs.com/interceptors [unverified]
- FEAT-07 Scheduling (`@nestjs/schedule`) instead of ad-hoc `setInterval`; microservice transports for inter-service messaging. Check: `setInterval(`/`setTimeout(` loops. Src: https://docs.nestjs.com/techniques/task-scheduling [unverified]

## ANT - anti-patterns
- ANT-01 God module (one module owning most providers) or `SharedModule` catch-all imported everywhere. Check: providers per module, fan-in of shared module. Src: https://docs.nestjs.com/modules [3p]
- ANT-02 Business logic in controllers, guards, or interceptors. Check: branching domain rules outside application/domain. Src: https://docs.nestjs.com/guards [3p]
- ANT-03 `@Res()` used without need (routes injecting the native response cannot use `CacheInterceptor`; bypasses standard response handling). Check: grep `@Res()`. Src: https://docs.nestjs.com/techniques/caching [nest]
- ANT-04 Repositories/ORM entities leaking into controllers or across features. Check: ORM imports in `*.controller.ts`, other features. Src: https://docs.nestjs.com/techniques/serialization [3p]
