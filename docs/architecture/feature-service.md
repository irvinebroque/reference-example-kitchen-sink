# Statsig feature-service architecture

The application uses the Statsig Worker as one private feature service. The app
sends a signed-in user's ID and optional normalized email, then receives
application-level feature decisions.

The app does not load the Statsig SDK, know the Statsig server secret, or manage
the service's internal cache entrypoint.

## App-facing request

The app calls the service through the `FEATURE_SERVICE` Service Binding:

```ts
FEATURE_SERVICE.fetch(
  new Request("https://feature.internal/v1/decisions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subject: { id, email } }),
  }),
);
```

A Service Binding invokes the Statsig Worker without sending this request over
the public Internet. The hostname is a placeholder used to construct the Web
`Request`.

The gateway accepts this shape:

```ts
{
  subject: {
    id: string;
    email?: string;
  }
}
```

It returns application decisions and diagnostics. The application contract does
not expose Statsig SDK types.

## Entrypoints

The Statsig Worker has three entrypoints:

| Entrypoint | What it does | Workers Cache |
| --- | --- | --- |
| `default` | Reports service health | Disabled |
| `FeatureGatewayEntrypoint` | Validates the request and creates the trusted Statsig user | Disabled |
| `DecisionCacheEntrypoint` | Loads configuration, evaluates decisions, and returns the response | Enabled |

The app binds only to `FeatureGatewayEntrypoint`. After validating the request,
the gateway calls the cached entrypoint through:

```ts
ctx.exports.DecisionCacheEntrypoint({ props: { targetingUser } }).fetch(
  new Request("https://feature-cache.internal/internal/v1/decisions"),
);
```

The gateway therefore runs on every request, while a cache hit can return a
stored decision without running `DecisionCacheEntrypoint` again.

## Why the service uses `fetch()`

[Workers Cache](https://developers.cloudflare.com/workers/cache/) applies to
`fetch()` invocations, including Service Binding calls and calls between
entrypoints through `ctx.exports`.

A custom RPC call such as:

```ts
FEATURE_SERVICE.getDecisions(subject)
```

would bypass Workers Cache. An RPC method could call the same internal cached
`fetch()` entrypoint, but the Fetch-based cache boundary would still be
required. This project uses one HTTP-shaped interface instead of adding an RPC
wrapper around it.

## Request flow

1. The app sends an uncached `POST` to `FeatureGatewayEntrypoint`.
2. The gateway validates the JSON and normalizes the user data.
3. The gateway adds trusted application, tenant, and environment attributes.
4. It passes the resulting Statsig user through `ctx.props` to
   `DecisionCacheEntrypoint`.
5. Workers Cache checks for a response with the same entrypoint, path, Worker
   version, and `ctx.props`.
6. On a miss, the decision entrypoint loads the current Statsig configuration,
   evaluates the application decisions, schedules any enabled exposure flush,
   and returns a cacheable response.
7. On a hit, Workers Cache returns the stored response without running the
   decision entrypoint.

## Cache behavior

The service uses two independent caches.

### Per-user decisions: Workers Cache

The gateway always uses the same internal URL. User IDs and email addresses are
therefore not placed in the cache URL.

The complete normalized Statsig user is passed through `ctx.props`. Workers
Cache includes `ctx.props` in its cache key, so different users receive separate
cached responses even though the internal URL is the same.

Successful decision-endpoint responses use:

```http
Cache-Control: public, max-age={DECISIONS_TTL_SECONDS}, stale-while-revalidate={DECISIONS_STALE_SECONDS}
```

The gateway, health handler, validation errors, and decision-endpoint errors
return `Cache-Control: private, no-store`.

An individual Statsig gate or dynamic-config evaluation can fail without making
the endpoint fail. In that case, the evaluator uses the application's default
value and can still return a normal cacheable response.

Structured evaluation logs include application and configuration diagnostics,
but omit the Statsig user.

### Exposure semantics

`STATSIG_EXPOSURE_LOGGING_ENABLED` enables reporting only when its value is
exactly `true`. The Statsig client then uses `loggingEnabled: "always"` and
allows traffic to the event endpoint. Missing values and all other values keep
SDK logging disabled and prevent Statsig network traffic.

The decision evaluator uses Statsig's automatic exposures from
`checkGate("reference_gate")` and `getDynamicConfig("welcome_config")`. The
application renders both returned decisions on the protected page.

For a successful GET on a decision-cache miss, the decision entrypoint passes
`client.flush()` to `ctx.waitUntil()` after evaluation and response
serialization. The response does not await delivery. Flush failures emit a
structured `statsig_exposure_flush_error` log and do not alter the successful
response.

Workers Cache hits do not run the decision entrypoint and are not additional
exposures. HEAD requests evaluate with exposure logging suppressed and do not
flush. Exposure counts therefore measure evaluated provider decisions, not page
views or confirmed feature use. Actual use should be recorded as a separate
product event.

Email remains available for targeting under the Statsig user's
`privateAttributes.email`. The SDK removes `privateAttributes` before sending
exposure events, so email is not included in exposure payloads.

### Statsig configuration: workerd Memory Cache

The configuration repository downloads Statsig's raw config specs and stores
them in workerd's
[Memory Cache](https://github.com/cloudflare/workerd/blob/main/src/workerd/api/memory-cache.h).
The cache is process-local. Isolates using the same cache ID in one live workerd
process can reuse the stored configuration.

Memory Cache is not durable storage. A process restart can remove its contents,
and entries may expire or be evicted. Do not rely on a deployment preserving the
cache.

Each isolate also retains its most recently initialized Statsig client. If a
refresh fails after that isolate has loaded a valid configuration, it returns
that last-known-good snapshot and marks the response as stale. A new isolate
without a valid snapshot returns an error when both the cache read and refresh
fail.

### When changes become visible

The two caches refresh independently:

- The configuration entry has its own expiration time and may be evicted sooner.
- Decision responses are fresh for `DECISIONS_TTL_SECONDS` and may be served
  stale while Workers Cache refreshes them for up to
  `DECISIONS_STALE_SECONDS`.
- An isolate may continue using its last-known-good configuration when a refresh
  fails.

For these reasons, a Statsig configuration change does not become visible
through every cached decision at one exact moment. This project lets both cache
layers converge through their normal refresh behavior instead of trying to
purge them together.

## Experimental Memory Cache binding

The deployed Statsig Worker attaches the account-level binding grant that
injects its `CACHE` binding:

```jsonc
{
  "unsafe": {
    "bindings": [
      {
        "name": "volatile-cache-test",
        "type": "internal_capability_grants"
      }
    ]
  }
}
```

Local Vite development uses the Wrangler prerelease built by
[cloudflare/workers-sdk#14868](https://github.com/cloudflare/workers-sdk/pull/14868),
and `vite.config.ts` replaces the deployment-only grant with a direct local
`volatile_cache` binding named `CACHE`. Binding grants are not available in
local or remote development.

Wrangler does not currently generate a public type for the binding. The narrow
TypeScript declaration in `types/statsig-config-specs-cache.d.ts` documents the
`read(key, fallback)` API used by the repository.

## Relevant files

- `workers/app/feature-service-client.ts` — app-facing Service Binding client.
- `workers/statsig/gateway-handler.ts` — request validation and normalization.
- `workers/statsig/decision-handler.ts` — decision evaluation and HTTP caching.
- `workers/statsig/config-specs-repository.ts` — configuration caching and
  last-known-good behavior.
- `workers/statsig/decision-evaluator.ts` — Statsig gate and dynamic-config
  evaluation.
- `wrangler.statsig.jsonc` — entrypoint, cache, and Memory Cache configuration.
