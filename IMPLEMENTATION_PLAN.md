# Reference App Implementation Plan

**Research date:** July 26, 2026
**Status:** Implemented in this repository, except for the explicitly blocked
Wrangler/workerd MemoryCache prerequisite and the documented incremental
`ServerResponse.write()` limitation in the current `httpServerHandler` path.

## Objective

Build a two-Worker reference application that demonstrates:

- React Router SSR on Vite 8.
- The Cloudflare Vite plugin as the only Vite-to-Workers integration.
- Express as the application HTTP server, bridged to Workers with
  `httpServerHandler`.
- Authentication using the literal `next-auth` package through a small
  Express-to-NextAuth request/response adapter.
- One server-side Statsig lookup for every authenticated SSR request.
- A private Statsig evaluator Worker reached through a Service Binding.
- **Workers Cache**, not the Workers Cache API (`caches.default`).
- Volatile Cache / workerd `MemoryCache` as the evaluator's process-local
  ruleset layer.
- The new branch-based Workers Previews workflow.

The finished app should make the architecture and cache behavior visible, not
just hide them behind abstractions.

## Non-negotiable constraints

1. Use [`@cloudflare/vite-plugin`](https://developers.cloudflare.com/workers/vite-plugin/).
2. Use [Workers Cache](https://dlapid-workerscache.preview.developers.cloudflare.com/workers/cache/).
3. Do not call `caches.default`, `caches.open()`, or any other
   [Workers Cache API](https://developers.cloudflare.com/workers/runtime-apis/cache/)
   surface.
4. Do not use Statsig's Cloudflare integration or
   `@statsig/serverless-client/cloudflare`.
5. Run the application through Express and
   [`httpServerHandler`](https://developers.cloudflare.com/workers/runtime-apis/nodejs/http/#httpserverhandler).
6. Keep the approximately 30 MB Statsig ruleset out of the application Worker.
7. Return only the current user's approximately 30 KB assignments/bootstrap
   payload to the application Worker.
8. Configure and demonstrate
   [Workers Previews](https://worker-previews-docs-2.preview.developers.cloudflare.com/workers/previews/).

## Research findings that affect the design

### Supported toolchain

Versions observed on npm on July 26, 2026:

| Package                              | Current version | Plan                                                                                                                    |
| ------------------------------------ | --------------: | ----------------------------------------------------------------------------------------------------------------------- |
| `vite`                               |           8.1.5 | Use Vite 8                                                                                                              |
| `@cloudflare/vite-plugin`            |          1.47.0 | Use current compatible release                                                                                          |
| `react-router` and `@react-router/*` |           8.3.0 | Prefer one aligned React Router 8 version                                                                               |
| `react` / `react-dom`                |          19.2.8 | Use matching stable versions                                                                                            |
| `express`                            |           5.2.1 | Prefer Express 4.22.x initially for the supplied dependency target and adapter stability; validate Express 5 separately |
| `next-auth`                          |         4.24.15 | Required literal package; adapt its API-handler interface to Express                                                    |
| `@statsig/js-client`                 |          3.33.3 | Select and pin a compatible client version for bootstrap wire-protocol tests                                            |

Cloudflare's current React Router guide officially supports React Router 8 and
SSR with the Vite plugin. The Cloudflare starter config places
`cloudflare({ viteEnvironment: { name: "ssr" } })` before `reactRouter()`.

### Express and React Router

`@react-router/express` exposes `createRequestHandler({ build,
getLoadContext, mode })`. Its current peer range supports Express 4.22.x and
Express 5. The proposed Worker entrypoint is therefore:

1. Create an Express app.
2. Mount NextAuth endpoints and session middleware.
3. Mount API/health endpoints.
4. Mount `@react-router/express` as the final handler.
5. Call `app.listen(port)`.
6. Export `httpServerHandler({ port })`.

This differs from Cloudflare's default React Router template, which directly
uses React Router's Fetch API adapter. A build-and-runtime spike must prove the
Express adapter works with `virtual:react-router/server-build` before the rest
of the app is built.

Local reference note: `~/src/chatgpt-repro` was inspected on July 26, 2026.
Its current `main` branch does not contain a `next-auth` dependency or any
NextAuth usage. It does provide the desired outer Express/React Router pattern
in `server/index.ts`: Vite middleware plus
`virtual:react-router/server-build` in development, and the built React Router
server module in production. Reuse that server shape, then insert the NextAuth
middleware before the React Router request handler.

### Literal `next-auth` package integration

The implementation must use the literal `next-auth` v4 package, not
`@auth/express`.

`next-auth` is published as a Next.js integration, but its API-handler path
accepts the same core request and response capabilities that can be supplied by
an Express adapter:

- Request: method, headers, cookies, parsed body, query, and a
  `query.nextauth` action/provider tuple.
- Response: `status()`, `setHeader()`, `json()`, `send()`, and `end()`.

Mount the adapter at `/api/auth/*`, because NextAuth's route model expects
paths such as:

```text
/api/auth/signin
/api/auth/callback/credentials
/api/auth/session
/api/auth/csrf
/api/auth/signout
```

Use `NextAuth(reqAdapter, resAdapter, authOptions)` for the auth endpoints and
`getServerSession(reqAdapter, resAdapter, authOptions)` for SSR session
loading. Do not import the unexported `next-auth/core` deep path.

The package declares `next` as a peer dependency even though the selected
API-handler path does not call Next.js runtime APIs. Phase 0 must determine the
cleanest reproducible install:

1. install the compatible `next` peer but ensure it is not bundled into either
   Worker, or
2. document a package-manager peer override if the repository policy permits
   one.

The example will use the built-in Credentials provider with JWT sessions and
no database. It will expose one demonstration username/password supplied by
secrets. This is intentionally a runtime compatibility example, not a
production password-auth system.

### Workers Cache behavior

Workers Cache:

- Runs in front of a Worker's `fetch()` entrypoint.
- Applies to Service Binding `fetch()` calls.
- Supports only `GET` and `HEAD`.
- Uses response `Cache-Control` headers.
- Is tiered and performs request collapsing.
- Keys by target entrypoint, path/query, Worker version by default, and relevant
  invocation context.
- Does not include arbitrary request headers, cookies, authorization, host, or
  request body in the default key.
- Bypasses custom RPC methods, so the application must call the Statsig Worker
  with Service Binding `fetch()`, not an RPC method.
- Treats a `200` without `Cache-Control` as cacheable by heuristic default.
  Every dynamic or sensitive endpoint must therefore explicitly return
  `Cache-Control: private, no-store`.

The Statsig Worker will expose a named `EvaluationEntrypoint` with Workers
Cache enabled. Its default health/admin entrypoint and the application Worker's
entrypoint will have Workers Cache disabled. The application Service Binding
will target `EvaluationEntrypoint` explicitly.

### Volatile Cache status

The public workerd source contains a `MemoryCache` binding with:

- `env.CACHE.read(key, fallback)`.
- Optional absolute expiration.
- LRU eviction.
- V8-serializable values.
- Coalesced concurrent fallback calls for the same key.
- Configurable key, value, and total-size limits in workerd configuration.

However, as of July 26, 2026, the installed Wrangler 4.114.0 configuration
schema does **not** expose a public `memory_cache`/`volatile_cache` binding.
The workerd Cap'n Proto schema and the generated Miniflare workerd schema
already contain `memoryCache`, but workers-sdk has no Wrangler configuration,
binding conversion, deployment serialization, or generated user-facing type
for it.

This likely requires a workers-sdk/Wrangler PR. Before implementing that PR,
confirm the production Workers upload API accepts the binding and obtain the
canonical wire binding type/field names from the runtime/product team. Local
workerd support alone does not prove that deployed Workers can receive the
binding.

Expected workers-sdk PR scope:

- Wrangler config schema and TypeScript config types.
- Validation/normalization for cache IDs and limits.
- Conversion into the Miniflare/workerd `memoryCache` binding.
- Deployment metadata serialization.
- `wrangler types` output for `read()` and its fallback result.
- Cloudflare Vite plugin passthrough through the normal Wrangler config path.
- Local-development, dry-run, deployment, Preview, and type-generation tests.
- Public documentation for configuration, API, limits, and availability.

The workers-sdk repository is already cloned locally at
`~/src/workers-sdk` (`/Users/brendan/src/workers-sdk`) for this work.

Until that is supported, implement the application-side cache behind a narrow
interface but do not invent a Wrangler field or rely on `unsafe.bindings`
without an approved production binding schema.

### Ruleset representation and memory

Caching the raw approximately 30 MB JSON ruleset is not prohibited. If higher
isolate and Volatile Cache limits are available, start with the simplest
correct representation and measure it before adding partitioning.

The concern is transient and repeated memory amplification, not merely the
configured Volatile Cache capacity:

- MemoryCache stores a V8-serialized byte representation and deserializes a new
  JavaScript value into the receiving isolate on every `read()`.
- A refresh fallback temporarily holds the fetched response, decoded string or
  bytes, parsed object graph, normalized evaluator model, and serialized cache
  value at overlapping points.
- `JSON.parse()` can retain the approximately 30 MB source string while
  creating a substantially larger object graph.
- Concurrent isolates can each hold their own deserialized/compiled evaluator
  while sharing the process-level MemoryCache bytes.
- Large values increase serialization/deserialization CPU, garbage collection
  pressure, and refresh latency even when hard memory limits are raised.
- `maxValueSize` and `maxTotalValueSize` apply to the serialized value and must
  be configured above the measured representation size.

Phase 0 should compare three representations using the real ruleset:

1. raw JSON string/bytes in Volatile Cache, parsed and compiled once per
   isolate;
2. a normalized serializable evaluator model in Volatile Cache; and
3. compressed ruleset bytes in Volatile Cache, decompressed on isolate load.

The recommended initial implementation is option 1 because it is easiest to
validate against the source and Workers Cache should prevent most users from
reaching evaluator code. Keep an immutable module-level compiled evaluator,
keyed by ruleset generation, so a warm isolate does not deserialize and parse
the 30 MB value on every per-user Workers Cache miss.

If raised memory limits make option 1 comfortably safe, retain it. Normalize,
compress, or partition only when measurements show a material benefit.
Document the required isolate-memory, Volatile Cache value-size, and total-size
limits as deployment prerequisites.

### Custom Statsig evaluator

Do not use a Statsig server-side evaluator/runtime SDK in the Statsig Worker,
including `statsig-node`, `@statsig/statsig-node-core`, or the forbidden
Cloudflare integration. Using the browser `@statsig/js-client` to consume and
verify the generated bootstrap payload is in scope.

Build a small, typed evaluator in the Statsig Worker that:

1. downloads `download_config_specs` directly from Statsig using the server
   secret;
2. validates and normalizes the JSON into a compact internal model;
3. resolves segments and ID-list-backed conditions needed by the target gates;
4. evaluates gate rules for one canonical user;
5. emits the Statsig client bootstrap/initialize wire protocol for that user;
   and
6. performs no exposure logging in the first version.

The wire-protocol target should be the response accepted by the selected
`@statsig/js-client` bootstrap initialization path, matching Statsig's
server-generated initialize response. At minimum, reproduce the applicable
top-level fields and item shapes for:

- `feature_gates`;
- `dynamic_configs`;
- `layer_configs`;
- `has_updates`;
- `generator`;
- `sdkInfo`;
- `evaluated_keys`;
- `hash_used`;
- the evaluated `user`; and
- rule, group, ID-type, secondary-exposure, experiment, and explicit-parameter
  metadata present in the source response.

Containers that are valid but unused in the reference ruleset should still be
present in the correct wire shape, typically as empty objects. Hashing and
name-key behavior must match the selected client SDK configuration.

This expands the response-format scope, but it does not require exposure-event
delivery or support for Statsig constructs absent from the actual ruleset.
Do not claim full Statsig SDK compatibility unless conformance tests prove it.
Start by inventorying the operators, condition types, segments, ID lists,
rollouts, and config formats present in the real 30 MB ruleset. Implement that
explicit evaluation compatibility envelope and fail closed or return
documented defaults for unknown constructs.

Use captured ruleset fixtures and golden user-assignment fixtures as the
behavioral contract. Where possible, generate expected outputs outside the
Worker with an official Statsig implementation, then compare the custom
evaluator against them without shipping that SDK in the application. Also feed
the generated response into the selected Statsig browser client in an
integration test and verify that it initializes without a network request and
returns the expected gates/configs.

### Preview limitation

A Service Binding configured on a Worker Preview always targets the bound
Worker's **production deployment**. It cannot target another Worker's Preview.

Therefore:

- Production app -> production Statsig evaluator Worker.
- App Previews -> production deployment of a separate staging Statsig
  evaluator Worker.
- Changes to the evaluator must be deployed compatibly to staging before an app
  Preview can test them end to end.

This limitation must be documented in the reference app and CI workflow.

## Proposed architecture

```mermaid
flowchart LR
    Browser["Browser"]
    App["Application Worker<br/>Express + NextAuth + React Router SSR"]
    WorkerCache["Workers Cache<br/>owned by Statsig Worker"]
    StatsigWorker["Statsig evaluator Worker"]
    Volatile["Volatile Cache / MemoryCache<br/>ruleset + refresh coalescing"]
    Statsig["Statsig source of truth"]

    Browser --> App
    App -->|"Service Binding GET<br/>opaque per-user cache key"| WorkerCache
    WorkerCache -->|"HIT: ~30 KB payload"| App
    WorkerCache -->|"MISS"| StatsigWorker
    StatsigWorker --> Volatile
    Volatile -->|"fresh ruleset"| StatsigWorker
    Volatile -->|"expired/missing: one fallback"| Statsig
    StatsigWorker -->|"Cache-Control response"| WorkerCache
    App -->|"SSR HTML + bootstrapped assignments"| Browser
```

## Repository layout

```text
app/
  entry.client.tsx
  entry.server.tsx
  root.tsx
  routes.ts
  routes/
workers/
  app/
    server.ts
    auth.ts
    statsig-client.ts
  statsig/
    index.ts
    evaluator.ts
    ruleset-cache.ts
    user-key.ts
    schemas.ts
wrangler.jsonc
wrangler.statsig.jsonc
vite.config.ts
react-router.config.ts
test/
  unit/
  integration/
  e2e/
```

Keep the two Workers in one repository, but deploy them independently.

## Request design

### Application request

1. Express receives the request through `httpServerHandler`.
2. The Express adapter sends `/api/auth/*` requests into `next-auth`.
3. Session middleware calls `getServerSession()` once through the same adapter
   and stores the result in `res.locals`.
4. For an authenticated SSR request, construct a minimal Statsig user:
   - stable user ID;
   - normalized email when targeting requires it;
   - application/tenant ID;
   - explicit environment tier;
   - only approved custom attributes.
5. Canonicalize that user object and compute a keyed HMAC-SHA-256 cache key.
6. Send one Service Binding `GET` to a path such as:

   ```text
   /v1/bootstrap/<application-id>/<hmac>
   ```

7. Send the canonical user object in an internal header. The path HMAC, not the
   header, partitions Workers Cache. Never put raw email addresses in URLs.
8. Validate the response with Zod.
9. Put the assignments/bootstrap payload in React Router load context.
10. Render it into the document as safely escaped JSON for client bootstrap.

The application must not forward the browser's `Authorization` or `Cookie`
headers to the Statsig Worker because they can force cache bypass and are not
needed across the private binding.

### Statsig cache hit

Workers Cache returns the stored per-user response without invoking the
Statsig Worker. The response should include:

```http
Cache-Control: public, max-age=<short TTL>, stale-while-revalidate=<window>
Content-Type: application/json
Cache-Tag: statsig-app-<application-id>
```

Start with a short TTL such as 60 seconds and tune only after measuring
freshness requirements. Keep `cross_version_cache` disabled initially so a new
evaluator deployment receives a fresh cache namespace.

### Statsig cache miss

1. Validate method, path, internal user header, application ID, and HMAC.
2. Read the latest ruleset through the Volatile Cache abstraction.
3. On a Volatile Cache hit, evaluate immediately.
4. On a miss/expiry, use `read(key, fallback)` so only one request fetches and
   installs the ruleset while concurrent requests coalesce.
5. Evaluate the supported Statsig gate/config rules against the canonical
   user.
6. Serialize only that user's assignments/bootstrap result.
7. Return cacheable headers so Workers Cache stores the result.
8. Use explicit error responses with `Cache-Control: private, no-store`.

## Ruleset refresh model

Do not model a Worker as a permanently running process. A continuously polling
module-level loop is not reliable when no requests are executing.

Use:

- TTL-based lazy refresh through Volatile Cache as the correctness path.
- An optional production Cron Trigger to warm/refresh the ruleset.
- Last-known-good data when a refresh fails, if the supported Volatile Cache
  and Statsig adapter APIs allow it.
- A ruleset generation/version in logs and response diagnostics.

Cron triggers target production, not Previews. Preview testing must include a
manual refresh endpoint protected by a secret or a staging-only short TTL.

## Configuration outline

### Application Worker

- `main`: Express Worker entrypoint.
- `compatibility_date`: current implementation date.
- `compatibility_flags`: `nodejs_compat`.
- `assets.directory`: React Router client build.
- Service Binding `STATSIG_SERVICE`.
- Required secrets:
  - `AUTH_SECRET`;
  - `DEMO_USERNAME`;
  - a password hash or demonstration password secret;
  - user-cache-key HMAC secret.
- Explicitly disable Workers Cache for the application entrypoint.
- `previews.services` points to the staging evaluator Worker.
- `previews.vars` sets environment to `preview`.

After binding changes, run `wrangler types` and use the generated `Env` types.

### Statsig Worker

- No public route and `workers_dev: false` unless a temporary test endpoint is
  intentionally enabled.
- A named `EvaluationEntrypoint` containing the cacheable `fetch()` handler.
- Service Bindings target `EvaluationEntrypoint`, not the default export.
- Workers Cache enabled only for `EvaluationEntrypoint`; default health/admin
  entrypoint caching disabled.
- `cross_version_cache: false` initially.
- Statsig server secret and optional client SDK key as secrets.
- Volatile Cache binding once the supported configuration is available.
- Structured observability enabled.
- Staging and production are separate Worker services.

## Workers Previews plan

1. Add a `previews` block to the application Wrangler config.
2. Keep Preview secrets out of Git:

   ```sh
   npx wrangler preview base-config secret put AUTH_SECRET
   npx wrangler preview base-config secret put DEMO_USERNAME
   npx wrangler preview base-config secret put DEMO_PASSWORD_HASH
   npx wrangler preview base-config secret put USER_CACHE_HMAC_SECRET
   ```

3. Push the base Preview configuration:

   ```sh
   npx wrangler preview base-config push
   ```

4. Create/update a branch Preview:

   ```sh
   npx wrangler preview
   ```

5. Add a CI Preview job using `cloudflare/wrangler-action` and the `preview`
   command.
6. Protect public Preview URLs with Cloudflare Access.
7. Prefer a dedicated Preview custom domain such as
   `<branch>.previews.example.com`.
8. Use Preview-specific demonstration credentials.
9. Document cleanup limits: current Preview docs specify 10 active Previews per
   Worker on Free and 100 on paid plans, with 100 deployments per Preview.

## Implementation phases

### Prerequisite: workers-sdk/Wrangler MemoryCache support

This is a prerequisite workstream, not an application feature:

- [ ] Confirm the production Workers upload API supports MemoryCache.
- [ ] Obtain the canonical deployment binding schema and generated runtime
      type.
- [ ] Implement and land first-class workers-sdk/Wrangler support in
      `~/src/workers-sdk`.
- [ ] Cover Wrangler configuration, validation, local workerd conversion,
      deploy serialization, `wrangler types`, Previews, and the Cloudflare Vite
      plugin.
- [ ] Publish or link supported configuration/API documentation.
- [ ] Upgrade this reference app to a workers-sdk/Wrangler version containing
      that support.

Exit criterion: a minimal Worker can use the MemoryCache binding in local Vite
development, `wrangler deploy --dry-run`, a real deployment, and a Worker
Preview without `unsafe.bindings` or hand-written environment types.

### Phase 0: compatibility spikes

- [ ] Build Vite 8 + React Router + Cloudflare Vite plugin.
- [ ] Replace the default Fetch adapter with Express +
      `@react-router/express` + `httpServerHandler`.
- [ ] Confirm local HMR, SSR streaming, form actions, redirects, errors, and
      static assets.
- [ ] Bundle the literal `next-auth` package without bundling unused Next.js
      runtime code.
- [ ] Complete Credentials-provider sign-in, session, CSRF, and sign-out flows
      through the Express adapter.
- [ ] Decide and document how the `next` peer dependency is installed.
- [ ] Fetch a real Statsig ruleset and inventory every construct that must be
      supported by the custom evaluator.
- [ ] Generate golden user-assignment fixtures from an official Statsig
      implementation outside the Worker.
- [ ] Reproduce the Statsig bootstrap wire response and initialize the selected
      browser client from it without a network request.
- [ ] Run memory/CPU spikes for all three ruleset representations with a
      representative 30 MB ruleset and the intended raised limits.

Exit criterion: all required libraries run in workerd and the Volatile Cache
binding is supported through Wrangler. The custom evaluator's output is
accepted by the selected Statsig browser client and matches golden fixtures.

### Phase 1: application shell

- [ ] Scaffold React Router framework mode with SSR.
- [ ] Configure Vite plugin with `viteEnvironment: { name: "ssr" }`.
- [ ] Add file-system routes if desired through `@react-router/fs-routes`.
- [ ] Add Express health and diagnostics endpoints.
- [ ] Add React Router pages showing session, gate values, and cache metadata.
- [ ] Return `private, no-store` from authenticated app/API responses.

### Phase 2: authentication

- [ ] Configure `next-auth/providers/credentials`.
- [ ] Set `app.set("trust proxy", true)`.
- [ ] Implement a minimal Express/NextApi request-response adapter.
- [ ] Mount `/api/auth/*` before React Router.
- [ ] Add one session middleware pass per request.
- [ ] Add protected and public route examples.
- [ ] Use JWT sessions with no database adapter.
- [ ] Compare username/password values using a password hash or timing-safe
      secret comparison.
- [ ] Test secure cookies, CSRF, credentials callback, logout, and Preview
      domains.

### Phase 3: evaluator Worker

- [ ] Define Zod schemas for internal request and response contracts.
- [ ] Add canonical user serialization and HMAC key verification.
- [ ] Define the supported Statsig ruleset schema and normalized evaluator
      model.
- [ ] Implement the Volatile Cache-backed ruleset repository.
- [ ] Fetch and validate rulesets from the source of truth.
- [ ] Evaluate the current user and produce the Statsig bootstrap/initialize
      wire payload.
- [ ] Match required hashing, metadata, and empty-container behavior.
- [ ] Add segment, ID-list, rollout, and operator conformance tests for every
      construct present in the production-shaped fixture.
- [ ] Reject or default unknown constructs explicitly.
- [ ] Add bounded timeouts and last-known-good behavior.
- [ ] Add structured logs without raw email, cookies, tokens, or rulesets.

### Phase 4: Service Binding and Workers Cache

- [ ] Add `STATSIG_SERVICE` to the application Worker.
- [ ] Use exactly one awaited binding `fetch()` per authenticated SSR request.
- [ ] Point the Service Binding at the named `EvaluationEntrypoint`.
- [ ] Enable Workers Cache only on `EvaluationEntrypoint`.
- [ ] Confirm default health/admin entrypoint requests always execute and are
      never served from Workers Cache.
- [ ] Set explicit `Cache-Control` on every evaluator response.
- [ ] Verify `MISS`, `HIT`, expiry, stale revalidation, and request collapse.
- [ ] Confirm the second request does not invoke evaluator code.
- [ ] Add cache tags and an authenticated purge/refresh operation if needed.
- [ ] Add a lint/test guard banning `caches.default` and `caches.open`.

### Phase 5: Previews and deployment

- [ ] Deploy staging evaluator Worker first.
- [ ] Bind app Previews to the staging evaluator production deployment.
- [ ] Deploy production evaluator before production app.
- [ ] Add Preview base config and secrets.
- [ ] Add PR Preview CI and Cloudflare Access.
- [ ] Document the cross-Worker Preview limitation and deployment order.

### Phase 6: observability and documentation

- [ ] Log cache outcome, evaluator duration, ruleset generation, payload size,
      and anonymous user-key prefix.
- [ ] Add a demo diagnostics panel showing:
  - app deployment/version;
  - evaluator deployment/version;
  - Workers Cache status;
  - ruleset generation;
  - payload bytes;
  - enabled sample gates.
- [ ] Add architecture, local setup, deployment, Preview, and troubleshooting
      documentation.

## Test plan

### Unit

- Canonical user serialization is stable across object key order.
- HMAC changes when any targeting input changes.
- Raw email never appears in URL/cache key/log fixtures.
- Request/response schemas reject malformed data.
- Ruleset adapter honors expiry and last-known-good behavior.
- Gate evaluation matches Statsig fixture expectations.
- Unknown Statsig operators cannot silently produce an assignment.
- Bootstrap response hashing and wire fields match golden Statsig responses.
- The NextAuth adapter preserves multiple `Set-Cookie` headers.

### Integration

- Express -> NextAuth adapter -> React Router middleware order.
- One Statsig Service Binding call per SSR request.
- Anonymous requests follow the documented default path.
- Workers Cache hit returns the identical bootstrap payload.
- Different user/app/context hashes do not share entries.
- Concurrent misses cause one ruleset fallback/evaluation fill.
- The generated bootstrap payload initializes the selected Statsig browser
  client without a network request.
- Errors and authenticated app responses are not cached.
- No Cache API globals are used.

### End to end

- Credentials login/logout on local, Preview, and production URLs.
- SSR and client hydration use the same gate assignments with no flicker.
- Preview app uses staging evaluator, never production evaluator.
- New evaluator deployment starts with a cold Workers Cache by default.
- Ruleset refresh changes assignments within the promised freshness window.

### Performance and limits

Measure with a realistic 30 MB ruleset:

- Worker startup time.
- Bundle gzip size.
- Peak isolate memory against the configured limit, including any approved
  raised limit.
- Peak process-level Volatile Cache memory.
- Transient memory during fetch, parse, normalization, serialization, and
  deserialization.
- Ruleset parse/evaluation CPU.
- Volatile Cache serialized value and total sizes.
- Warm-isolate module-level evaluator reuse.
- Cold Workers Cache latency.
- Warm Workers Cache latency.
- Bootstrap response size around the expected 30 KB.

Choose and document explicit memory headroom rather than merely fitting below
the hard limit. If raised limits make raw JSON safe with acceptable CPU and GC
behavior, raw JSON is an acceptable design. Otherwise, normalize, compress, or
partition the ruleset by application/gate/segment.

## Security and privacy requirements

- The Statsig Worker must not be publicly routable.
- Use a keyed hash, not raw email or a plain hash, in cache paths.
- Rotate the HMAC key with a version prefix to avoid ambiguous cache entries.
- Do not forward browser credentials over the Service Binding.
- Minimize Statsig user attributes.
- Do not log rulesets, bootstrap bodies, credentials, cookies, or email.
- Validate the internal request even though the binding is private.
- Use `crypto.subtle` for HMAC and constant-time verification where applicable.
- Set explicit cache headers everywhere; never rely on heuristic caching.
- Protect Preview URLs with Access and use non-production demonstration
  credentials.

## Main risks and decisions

| Risk/decision                                                                  | Mitigation                                                                                  |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| Volatile Cache lacks public Wrangler configuration                             | Treat first-class workers-sdk/Wrangler support as a prerequisite                            |
| 30 MB ruleset creates transient copies and GC/CPU pressure                     | Benchmark raw, normalized, and compressed forms under the intended raised limits            |
| Custom Statsig evaluator or bootstrap response diverges from Statsig semantics | Run golden evaluator and wire-protocol tests plus real browser-client bootstrap tests       |
| `next-auth` is Next.js-oriented and requires a peer                            | Narrow Express adapter, exact pin, peer-install decision, and end-to-end auth tests         |
| Express adapter is not Cloudflare's default React Router path                  | Prove SSR, streaming, actions, assets, and HMR before feature work                          |
| Preview cannot bind another Worker Preview                                     | Use a separately deployed staging evaluator service                                         |
| User-specific cache leakage                                                    | HMAC-derived path key, strict canonicalization, contract tests, no header-only partitioning |
| Stale flags after ruleset update                                               | Short initial TTL, generation metrics, purge/refresh path, documented freshness SLO         |
| Exposure events are omitted                                                    | State this explicitly in the demo and keep the response contract extensible                 |

## Definition of done

- The app runs locally with one Vite command and both Workers available.
- Express is the application server and React Router performs SSR.
- Authentication works through the literal `next-auth` package and the
  repository's Express adapter.
- Each authenticated SSR request performs one Statsig Service Binding fetch.
- Warm requests are served by Workers Cache without running evaluator code.
- Cache misses evaluate with a ruleset supplied through Volatile Cache.
- The returned payload reproduces the selected Statsig bootstrap/initialize
  wire protocol and initializes the browser client without another network
  request.
- Workers Cache applies only to the named Statsig evaluation entrypoint.
- No Cache API usage exists.
- The application Worker never receives or parses the full ruleset.
- Previews use Preview-specific secrets/config and the staging evaluator.
- Tests prove user cache isolation, auth behavior, cache behavior, and SSR
  hydration consistency.
- Documentation clearly labels experimental APIs and the Preview
  Service-Binding limitation.

## Primary sources

- [Cloudflare Vite plugin](https://developers.cloudflare.com/workers/vite-plugin/)
- [Vite plugin API and auxiliary Workers](https://developers.cloudflare.com/workers/vite-plugin/reference/api/)
- [Cloudflare React Router guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/react-router/)
- [Developing multiple Workers](https://developers.cloudflare.com/workers/local-development/multi-workers/)
- [Express on Workers tutorial](https://developers.cloudflare.com/workers/tutorials/deploy-an-express-app/)
- [`node:http` and `httpServerHandler`](https://developers.cloudflare.com/workers/runtime-apis/nodejs/http/#httpserverhandler)
- [Service Bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/)
- [Workers Cache preview docs](https://dlapid-workerscache.preview.developers.cloudflare.com/workers/cache/)
- [Workers Cache keys](https://dlapid-workerscache.preview.developers.cloudflare.com/workers/cache/cache-keys/)
- [Workers Cache configuration](https://dlapid-workerscache.preview.developers.cloudflare.com/workers/cache/configuration/)
- [Workers Cache limitations](https://dlapid-workerscache.preview.developers.cloudflare.com/workers/cache/limitations/)
- [Workers Previews](https://worker-previews-docs-2.preview.developers.cloudflare.com/workers/previews/)
- [Preview configuration](https://worker-previews-docs-2.preview.developers.cloudflare.com/workers/previews/configuration/)
- [Preview binding behavior](https://worker-previews-docs-2.preview.developers.cloudflare.com/workers/previews/resources/bindings/)
- [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- [`next-auth` package](https://www.npmjs.com/package/next-auth)
- [NextAuth v4 source](https://github.com/nextauthjs/next-auth/tree/v4)
- [`@react-router/express`](https://www.npmjs.com/package/@react-router/express)
- [Statsig client bootstrap initialization](https://docs.statsig.com/client/concepts/initialize/#2-bootstrap-initialization)
- [Statsig server-generated bootstrap implementation reference](https://github.com/statsig-io/node-js-server-sdk/blob/main/src/Evaluator.ts)
- [workerd MemoryCache sample](https://github.com/cloudflare/workerd/tree/main/samples/memory-cache)
- [workerd MemoryCache tests](https://github.com/cloudflare/workerd/blob/main/src/workerd/api/tests/memory-cache-test.js)
- [workers-sdk generated MemoryCache schema](https://github.com/cloudflare/workers-sdk/blob/main/packages/miniflare/src/runtime/config/workerd.ts)

Local implementation reference:
`/Users/brendan/src/chatgpt-repro/server/index.ts`.
