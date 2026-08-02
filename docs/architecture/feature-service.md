# Statsig feature-service architecture

The application uses the Statsig Worker as one private feature service. The app
sends a signed-in user's ID and optional normalized email, then receives
application-level feature decisions.

The app does not load the Statsig SDK, know the Statsig server secret, or manage
the service's internal cache entrypoint.

## App-facing requests

The app calls the service through the `FEATURE_SERVICE` Service Binding. Feature
decisions use:

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

The same gateway accepts product events at
`POST /v1/events/reference-gate-used`:

```ts
{
  event: "reference_gate_used",
  subject: {
    id: string;
    email?: string;
  }
}
```

No other event name and no caller-provided metadata are accepted. The gateway
returns `202` after scheduling any enabled Statsig flush. The app reporter
awaits that acceptance response but catches and sanitizes all failures so event
reporting cannot fail the feature action.

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

Product events are handled directly by `FeatureGatewayEntrypoint`; they do not
use Workers Cache, create another entrypoint, or issue an internal request.

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

### Product-event semantics

`STATSIG_PRODUCT_EVENT_LOGGING_ENABLED` controls the
`reference_gate_used` event independently from gate exposures. Local
development and production initially set it to `false`; staging sets it to
`true`. The Statsig client enables network logging when either the exposure flag
or the product-event flag is enabled.

After validating an enabled event, the gateway creates the trusted Statsig user
and fixed application, environment, and tenant metadata. It calls
`client.logEvent()`, passes `client.flush()` to `ctx.waitUntil()`, and returns
`202` without waiting for network delivery. Disabled reporting still validates
the request and returns `202`, but does not load configuration, log, or flush.

One SDK observer records `statsig_logs_flushed` with only the batch size and
records `statsig_flush_network_error` with only the error type. Rejected flush
promises retain a separate sanitized unexpected-error catch. No observer logs
event contents or request arguments.

The app has no current feature action that consumes `reference_gate`, so the
reporter is not attached to page rendering or another fabricated source.

### Statsig configuration: isolate-local memory

The configuration repository downloads Statsig's raw config specs and retains
the initialized client in module scope. `CONFIG_SPECS_CACHE_BACKEND=isolate` is
the default and needs no additional binding. Each isolate keeps its own copy;
the copy disappears whenever that isolate is evicted.

If a refresh fails after an isolate has loaded a valid configuration, the
repository returns that last-known-good snapshot and marks the response as
stale. A new isolate without a valid snapshot returns an error when its first
download fails.

The optional `workerd-memory-cache` backend stores the downloaded raw config in
workerd's
[Memory Cache](https://github.com/cloudflare/workerd/blob/main/src/workerd/api/memory-cache.h).
Isolates using the same cache ID in one live workerd process can then reuse the
configuration and coalesce concurrent misses. Memory Cache is still not durable:
a process restart can remove entries, and entries may expire or be evicted.

### When changes become visible

The two caches refresh independently:

- The isolate-local configuration has its own expiration time. With the optional
  Memory Cache backend, its shared entry may also be evicted sooner.
- Decision responses are fresh for `DECISIONS_TTL_SECONDS` and may be served
  stale while Workers Cache refreshes them for up to
  `DECISIONS_STALE_SECONDS`.
- An isolate may continue using its last-known-good configuration when a refresh
  fails.

For these reasons, a Statsig configuration change does not become visible
through every cached decision at one exact moment. This project lets both cache
layers converge through their normal refresh behavior instead of trying to
purge them together.

## Optional Memory Cache binding

The default repository configuration does not attach a volatile cache binding.
To opt a deployment into `CONFIG_SPECS_CACHE_BACKEND=workerd-memory-cache`,
attach the account-level binding grant that injects `CACHE`:

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

The Worker fails explicitly if the backend is selected without `CACHE`. It must
not also upload a direct `volatile_cache` binding when the deployment grant
injects that binding.

Binding grants are not available in local or remote development. Local coverage
therefore requires tooling that supports a direct `volatile_cache` binding named
`CACHE`. The draft
[cloudflare/workers-sdk#14868](https://github.com/cloudflare/workers-sdk/pull/14868)
documents the current prerelease configuration; the default local setup does not
depend on it.

Wrangler does not currently generate a public type for the binding. The narrow
TypeScript declaration in `types/statsig-config-specs-cache.d.ts` documents the
optional `read(key, fallback)` API used by the repository.

## Relevant files

- `workers/app/feature-service-client.ts` — app-facing Service Binding client.
- `workers/statsig/gateway-handler.ts` — request validation and normalization.
- `workers/app/product-event-client.ts` — best-effort private event reporter.
- `workers/statsig/flush-observer.ts` — sanitized SDK flush logs.
- `workers/statsig/decision-handler.ts` — decision evaluation and HTTP caching.
- `workers/statsig/config-specs-repository.ts` — configuration caching and
  last-known-good behavior.
- `workers/statsig/decision-evaluator.ts` — Statsig gate and dynamic-config
  evaluation.
- `wrangler.statsig.jsonc` — entrypoint, cache-backend, and Workers Cache configuration.
