# Web application / API security catalogue

Cite IDs in findings. Line format: `ID (severity) rule. Map: OWASP/ASVS/CWE. Src: url [tag]`. Severity is the default; the brief's definitions decide. Project conventions and documented tenancy rules override these.
Mapping bases: OWASP Top 10:2025 (A01 Broken Access Control, A02 Security Misconfiguration, A03 Software Supply Chain Failures, A04 Cryptographic Failures, A05 Injection, A06 Insecure Design, A07 Authentication Failures, A08 Software or Data Integrity Failures, A09 Security Logging and Alerting Failures, A10 Mishandling of Exceptional Conditions); OWASP API Security Top 10:2023 (API1..API10); OWASP ASVS 5.0.0 chapters V1 Encoding and Sanitization, V2 Validation and Business Logic, V3 Web Frontend Security, V4 API and Web Service, V5 File Handling, V6 Authentication, V7 Session Management, V8 Authorization, V9 Self-contained Tokens, V10 OAuth and OIDC, V11 Cryptography, V12 Secure Communication, V13 Configuration, V14 Data Protection, V15 Secure Coding and Architecture, V16 Security Logging and Error Handling, V17 WebRTC.
Src shorthand: `CS:` = https://cheatsheetseries.owasp.org/cheatsheets/ ; `API:` = https://api-security.owasp.org/editions/2023/en/ ; `T10:` = https://top10.owasp.org/2025/ ; `CWE:n` = https://cwe.mitre.org/data/definitions/n.html. Tags: `[doc]` primary source fetched/listed by the verifying agent, `[3p]` third-party, `[unverified]` not fetched.
Generic tenancy rules (TEN-*) apply only when the project documents none; documented project rules replace them.

## TEN — tenancy & isolation (multi-tenant projects only)
- TEN-01 (major) Multi-tenant project with no documented tenancy rules (AGENTS.md/CLAUDE.md/docs/ADR). Finding asks to document them; audit falls back to TEN-02..TEN-16. Map: A06, V8, V15. Src: CS:Multi_Tenant_Security_Cheat_Sheet.html [doc]
- TEN-02 (blocker) Tenant derived from client input (body, query, path, header, JWT claim not verified server-side) without checking the principal's membership in that tenant. Map: A01, API1, V8, CWE-639. Src: CS:Multi_Tenant_Security_Cheat_Sheet.html [doc]
- TEN-03 (blocker) New/changed query on a tenant-owned table lacks the tenant predicate or scoping helper/policy the project mandates (read, update, delete, count, aggregate, join). Map: A01, API1, V8, CWE-639. Src: CS:Multi_Tenant_Security_Cheat_Sheet.html [doc]
- TEN-04 (blocker) Lookup by id alone (`get(id)`, `findUnique({id})`, `Repo.get`) on a tenant-owned resource; a guessed id from another tenant returns/changes data. Map: A01, API1, CWE-639. Src: CS:Insecure_Direct_Object_Reference_Prevention_Cheat_Sheet.html [doc]
- TEN-05 (blocker) Row-level security absent, not `FORCE`d, or bypassed (superuser/`BYPASSRLS` role serving requests) where the project relies on RLS; missing tenant context does not fail closed. Map: A01, V8. Src: CS:Multi_Tenant_Security_Cheat_Sheet.html [doc]
- TEN-06 (major) Tenant context stored in session-level DB setting on a pooled connection instead of per transaction (`SET LOCAL`), leaking across requests. Map: A01, V8. Src: CS:Multi_Tenant_Security_Cheat_Sheet.html [doc]
- TEN-07 (blocker) New table/column holding tenant data lacks tenant key, index on it, FK, or policy per project convention; migration backfills without tenant. Map: A06, V15. Src: CS:Multi_Tenant_Security_Cheat_Sheet.html [doc]
- TEN-08 (blocker) Background job/queue message/cron/event handler runs without re-establishing and re-authorizing tenant context (tenant from payload not verified, or none). Map: A01, V8, V15. Src: CS:Multi_Tenant_Security_Cheat_Sheet.html [doc]
- TEN-09 (major) Cache key (HTTP, in-memory, Redis, memoization) for tenant-variant data lacks tenant id; global namespace used for tenant data; cached value returned before authz. Map: A01, V14, CWE-200. Src: CS:Multi_Tenant_Security_Cheat_Sheet.html [doc]
- TEN-10 (blocker) File/object storage path, bucket, or signed URL not tenant-scoped, or served/signed without authorizing the object against the caller's tenant. Map: A01, V5, CWE-22. Src: CS:Multi_Tenant_Security_Cheat_Sheet.html [doc]
- TEN-11 (major) Search index/vector store/analytics query not filtered by tenant, or filter built from client input. Map: A01, V8, CWE-200. Src: CS:Multi_Tenant_Security_Cheat_Sheet.html [doc]
- TEN-12 (blocker) Export/report/bulk endpoint, webhook delivery, email, or notification can include other tenants' rows (join, aggregate, "all" scope). Map: A01, API1, CWE-200. Src: CS:Multi_Tenant_Security_Cheat_Sheet.html [doc]
- TEN-13 (major) Admin/support/superuser path crosses tenants without explicit authorization, impersonation audit, or per-tenant consent as the project defines. Map: A01, API5, V8. Src: CS:Multi_Tenant_Security_Cheat_Sheet.html [doc]
- TEN-14 (minor) Log line, metric label, error message, or trace omits tenant id where project requires it, or exposes another tenant's identifiers/data. Map: A09, V16. Src: CS:Multi_Tenant_Security_Cheat_Sheet.html [doc]
- TEN-15 (major) Rate limit/quota is global only; one tenant can exhaust shared resource (noisy neighbor). Map: API4, V2. Src: CS:Multi_Tenant_Security_Cheat_Sheet.html [doc]
- TEN-16 (major) Tenant-scoped API credentials/invites/sessions: stored in plaintext, low entropy, not revoked at offboarding, or valid across tenants. Map: A07, V6, V7. Src: CS:Multi_Tenant_Security_Cheat_Sheet.html [doc]
- TEN-17 (major) No negative test proves cross-tenant access is denied for the new endpoint/query (tenant A principal, tenant B id). Map: A01, V8. Src: CS:Multi_Tenant_Security_Cheat_Sheet.html [doc]

## AUTHZ — access control
- AUTHZ-01 (blocker) New route/handler/mutation/channel/job-trigger has no authentication or authorization check (deny-by-default violated). Map: A01, API5, V8, CWE-862. Src: CS:Authorization_Cheat_Sheet.html [doc]
- AUTHZ-02 (blocker) Object-level authorization missing: resource fetched by client-supplied id without checking the caller may access that object (IDOR/BOLA). Map: A01, API1, V8, CWE-639. Src: CS:Insecure_Direct_Object_Reference_Prevention_Cheat_Sheet.html [doc]
- AUTHZ-03 (blocker) Function-level authorization missing: privileged action/admin route reachable by lower role (BFLA); role check only in UI. Map: A01, API5, V8, CWE-863. Src: API:0xa5-broken-function-level-authorization/ [doc]
- AUTHZ-04 (major) Mass assignment: request body bound straight to model/changeset/DTO including privileged fields (role, tenant_id, owner_id, is_admin, price). Use allow-lists. Map: A01, API3, V2, CWE-915. Src: CS:Mass_Assignment_Cheat_Sheet.html [doc]
- AUTHZ-05 (major) Response returns object properties the caller may not read (excessive data exposure, API3); serializer is not an allow-list. Map: A01, API3, V14, CWE-213. Src: API:0xa3-broken-object-property-level-authorization/ [doc]
- AUTHZ-06 (major) Authorization decided per request path but not per object state/transition (approve own request, skip workflow step); sensitive business flow lacks guard. Map: A06, API6, V2. Src: API:0xa6-unrestricted-access-to-sensitive-business-flows/ [doc]
- AUTHZ-07 (major) Authorization check after the side effect, or on a different object than the one acted on (TOCTOU, wrong id checked). Map: A01, V8, CWE-863. Src: CS:Authorization_Cheat_Sheet.html [doc]

## AUTHN — authentication, sessions, tokens
- AUTHN-01 (blocker) Password stored plaintext or with fast/unsalted hash (MD5, SHA-*, no per-user salt); not argon2id/scrypt/bcrypt/PBKDF2. Map: A04, A07, V6, CWE-916. Src: CS:Password_Storage_Cheat_Sheet.html [doc]
- AUTHN-02 (major) Login, reset, MFA, or token endpoint has no throttling/lockout; credential stuffing and brute force possible. Map: A07, API2, V6, CWE-307. Src: CS:Authentication_Cheat_Sheet.html [unverified]
- AUTHN-03 (major) Password reset/invite/verify token guessable, reusable, non-expiring, stored plaintext, or leaks account existence. Map: A07, V6, CWE-640. Src: CS:Forgot_Password_Cheat_Sheet.html [unverified]
- AUTHN-04 (blocker) Session id not regenerated on login/privilege change, not invalidated on logout/password change, or predictable. Map: A07, V7, CWE-384. Src: CS:Session_Management_Cheat_Sheet.html [doc]
- AUTHN-05 (blocker) JWT accepted without signature verification, with `alg: none`/algorithm confusion, without `exp`/`aud`/`iss` checks, or signed with weak/hardcoded key. Map: A07, API2, V9, CWE-347. Src: CS:JSON_Web_Token_Cheat_Sheet.html [doc]
- AUTHN-07 (major) Sensitive action (email/password change, payment, role grant) lacks re-authentication or MFA step where the project requires it. Map: A07, V6, CWE-306. Src: CS:Authentication_Cheat_Sheet.html [unverified]
- AUTHN-08 (major) OAuth/OIDC flow missing `state`/PKCE/nonce, redirect_uri not exact-match, or ID token not validated. Map: A07, V10, CWE-352. Src: CS:OAuth2_Cheat_Sheet.html [unverified]

## INJ — injection & output encoding
- INJ-01 (blocker) SQL built by string concatenation/interpolation with request data (incl. `ORDER BY`, column, table names, raw fragments). Use bound parameters and allow-lists. Map: A05, V1, CWE-89. Src: CS:SQL_Injection_Prevention_Cheat_Sheet.html [doc]
- INJ-02 (blocker) NoSQL/ORM operator injection: client object passed as query filter (`{$ne:..}`, `where: req.body`). Map: A05, V1, CWE-943. Src: CS:Injection_Prevention_Cheat_Sheet.html [unverified]
- INJ-03 (blocker) OS command built from request data or shell invoked with interpolated args. Use arg arrays, no shell. Map: A05, V1, CWE-78. Src: CS:OS_Command_Injection_Defense_Cheat_Sheet.html [unverified]
- INJ-04 (blocker) Dynamic code/template evaluation of user data (`eval`, server-side template injection, expression language). Map: A05, V1, CWE-94. Src: CS:Injection_Prevention_Cheat_Sheet.html [unverified]
- INJ-05 (major) Untrusted data rendered unescaped into HTML/JS/URL/CSS (`dangerouslySetInnerHTML`, `raw/1`, `|safe`, `v-html`, `innerHTML`). Map: A05, V1, V3, CWE-79. Src: CS:Cross_Site_Scripting_Prevention_Cheat_Sheet.html [doc]

## INPUT — validation, deserialization, uploads
- INPUT-01 (major) No server-side validation of type, length, range, format on new request fields (client validation only); validation not at the trust boundary. Map: A05, A06, V2, CWE-20. Src: CS:Input_Validation_Cheat_Sheet.html [doc]
- INPUT-02 (blocker) Unsafe deserialization of untrusted data (pickle, Java ObjectInputStream, YAML load, `:erlang.binary_to_term` without `:safe`, node-serialize). Map: A08, V1, CWE-502. Src: CS:Deserialization_Cheat_Sheet.html [doc]
- INPUT-03 (blocker) File path built from client input without canonicalization and base-dir check (path traversal, zip-slip on archives). Map: A01, V5, CWE-22. Src: CS:File_Upload_Cheat_Sheet.html [doc]
- INPUT-04 (major) Upload accepts by client MIME/extension only; no content sniffing, size cap, filename regeneration, or storage outside web root/with non-executable type. Map: A06, V5, CWE-434. Src: CS:File_Upload_Cheat_Sheet.html [doc]
- INPUT-06 (major) Regex built from user input or catastrophic-backtracking pattern on request-sized data (ReDoS). Map: A05, V1, CWE-1333. Src: CS:Input_Validation_Cheat_Sheet.html [doc]

## SSRF — server-side request forgery
- SSRF-01 (blocker) Server fetches a URL/host from client input (webhook target, image fetch, import, preview) without allow-list. Map: A01, API7, V1, CWE-918. Src: CS:Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html [doc]
- SSRF-02 (major) URL allow-list checked on the string but not on the resolved IP (DNS rebinding, redirects followed, link-local/metadata `169.254.169.254`, private ranges). Map: A01, API7, CWE-918. Src: CS:Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html [doc]
- SSRF-03 (major) Outbound response from a third-party API trusted without validation, size/time limits, or schema check (unsafe consumption). Map: API10, V4. Src: API:0xaa-unsafe-consumption-of-apis/ [doc]

## CRYPTO — transport, hashing, randomness, secrets
- CRYPTO-01 (blocker) Secret, key, token, or credential committed in source, config, fixtures, or logs (redact to 4 chars in the report). Map: A04, A02, V13, CWE-798. Src: CS:Secrets_Management_Cheat_Sheet.html [unverified]
- CRYPTO-02 (major) Security token, id, reset code, or nonce from non-CSPRNG (`Math.random`, `rand`, time-based). Map: A04, V11, CWE-338. Src: CS:Cryptographic_Storage_Cheat_Sheet.html [unverified]
- CRYPTO-03 (major) Broken or weak algorithm/mode (MD5/SHA-1 for security, DES, RC4, ECB, static IV, homegrown crypto). Map: A04, V11, CWE-327. Src: CS:Cryptographic_Storage_Cheat_Sheet.html [unverified]
- CRYPTO-04 (major) TLS verification disabled (`verify=False`, `rejectUnauthorized:false`, `InsecureSkipVerify`), HTTP used for sensitive traffic, or HSTS missing on new origin. Map: A04, V12, CWE-295. Src: CS:Transport_Layer_Security_Cheat_Sheet.html [unverified]

## CONF — configuration, headers, CSRF, cookies
- CONF-01 (blocker) State-changing endpoint on cookie/session auth lacks CSRF protection (token or SameSite+origin check). Map: A01, V3, CWE-352. Src: CS:Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html [doc]
- CONF-02 (major) Session/auth cookie missing `HttpOnly`, `Secure`, or `SameSite`; overly broad `Domain`. Map: A02, V3, V7, CWE-614. Src: CS:Session_Management_Cheat_Sheet.html [doc]
- CONF-03 (major) CORS reflects arbitrary `Origin` or uses `*` with credentials; allow-list absent. Map: A02, API8, V3, CWE-942. Src: CS:REST_Security_Cheat_Sheet.html [doc]
- CONF-05 (blocker) Debug mode, stack traces, GraphQL introspection/playground, admin console, or default credentials enabled in production config. Map: A02, API8, V13, CWE-489. Src: CS:REST_Security_Cheat_Sheet.html [doc]
- CONF-06 (major) New/undocumented endpoint, old API version, or internal route exposed without inventory/owner (shadow API). Map: API9, A02. Src: API:0xa9-improper-inventory-management/ [doc]

## DATA — data exposure & protection
- DATA-01 (major) PII/secret/token written to logs, analytics, error trackers, or URLs. Map: A09, V14, V16, CWE-532. Src: CS:Logging_Cheat_Sheet.html [doc]
- DATA-02 (major) Response over-fetches: whole entity/row serialized (password hash, internal flags, other users' fields) instead of an explicit DTO. Map: API3, A01, V14, CWE-200. Src: API:0xa3-broken-object-property-level-authorization/ [doc]
- DATA-03 (major) Sensitive data stored unencrypted where the project requires encryption at rest, or returned unmasked. Map: A04, V14, CWE-311. Src: CS:Cryptographic_Storage_Cheat_Sheet.html [unverified]

## RATE — resource exhaustion
- RATE-01 (major) List/search endpoint without pagination or a server-enforced max page size; client `limit` trusted. Map: API4, V4, CWE-770. Src: API:0xa4-unrestricted-resource-consumption/ [doc]
- RATE-02 (major) No rate limit/throttle on expensive, costly (SMS, email, AI), or abuse-prone endpoint (signup, search, export). Map: API4, API6, V2, CWE-770. Src: API:0xa4-unrestricted-resource-consumption/ [doc]
- RATE-03 (major) Unbounded work per request: huge batch, GraphQL depth/complexity, unbounded fan-out or retries, large file processing in the request thread. Map: API4, V4, CWE-400. Src: CS:GraphQL_Cheat_Sheet.html [unverified]

## SUPPLY — dependencies & integrity
- SUPPLY-01 (major) Diff adds/upgrades a dependency without lockfile update, or lockfile not committed; unpinned (`latest`, `*`, git branch) versions. Map: A03, V15, CWE-1357. Src: CS:Vulnerable_Dependency_Management_Cheat_Sheet.html [unverified]
- SUPPLY-02 (major) New dependency is unmaintained, typosquat-like, or unrelated to its stated purpose (name, owner, last release); flag for human check, never claim a CVE without a tool result. Map: A03, V15. Src: T10:A03_2025-Software_Supply_Chain_Failures/ [unverified]
- SUPPLY-03 (major) Install/build scripts or CI steps fetch and execute remote code (`curl | sh`), unpinned actions, or secrets exposed to untrusted PR code. Map: A03, A08, V15, CWE-829. Src: CS:CI_CD_Security_Cheat_Sheet.html [unverified]

## LOG — security logging & alerting
- LOG-01 (major) Security-relevant events (login success/failure, authz denial, privilege change, tenant switch, admin action) not logged on new code paths. Map: A09, V16, CWE-778. Src: CS:Logging_Cheat_Sheet.html [doc]
- LOG-02 (major) Log entry built from unsanitized input (log forging) or includes secrets/PII. Map: A09, V16, CWE-117. Src: CS:Logging_Cheat_Sheet.html [doc]
- LOG-04 (minor) Repeated denials (cross-tenant attempts, auth failures) emit no signal the project can alert on. Map: A09, V16. Src: CS:Logging_Cheat_Sheet.html [doc]

## ERR — exceptional conditions
- ERR-01 (blocker) Authn/authz/tenant check fails open: exception, timeout, or missing context ends in allow or unscoped query. Map: A10, A01, V16, CWE-636. Src: CS:Error_Handling_Cheat_Sheet.html [doc]
- ERR-02 (major) Error response leaks stack trace, SQL, paths, framework versions, or existence of other tenants' objects (403 vs 404 inconsistent with project rule). Map: A10, A02, V16, CWE-209. Src: CS:Error_Handling_Cheat_Sheet.html [doc]
- ERR-03 (major) Catch-all swallows errors on a security or data-integrity path (empty `rescue`/`catch`), leaving partial state or skipping a check. Map: A10, V16, CWE-755. Src: CS:Error_Handling_Cheat_Sheet.html [doc]
- ERR-04 (major) Multi-step write without transaction/rollback; failure mid-way leaves privilege, ownership, or balance inconsistent. Map: A10, A06, V2, CWE-662. Src: T10:A10_2025-Mishandling_of_Exceptional_Conditions/ [unverified]
