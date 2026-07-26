# Implementation plan

## Objective

Keep the deployable two-Worker reference architecture while using Statsig's
official evaluation implementation and isolating unavoidable Node/Express
compatibility code.

## Architecture

```mermaid
flowchart LR
    Browser --> App["App Worker\nExpress + NextAuth + React Router"]
    App -->|"HMAC-keyed GET"| WC["Workers Cache"]
    WC --> Evaluator["Evaluator Worker"]
    Evaluator --> VC["Volatile Cache\nraw config specs"]
    Evaluator --> SDK["Official StatsigServerlessClient\none per generation"]
    SDK --> Bootstrap["Official initialize response"]
```

The application demonstrates:

- Express on Workers through `httpServerHandler`.
- Literal `next-auth` 4.24.15.
- React Router framework-mode SSR.
- A private Service Binding.
- Workers Cache on the evaluator entrypoint only.
- Volatile Cache for large raw Statsig config specs.
- Official Statsig gate, config, experiment, and layer evaluation.
- Browser bootstrap initialization with all Statsig network traffic disabled.
- HMAC-partitioned per-user bootstrap caching.

## Statsig evaluator

The evaluator imports `StatsigServerlessClient` from the root
`@statsig/serverless-client` package. It does not use the Cloudflare wrapper,
`handleWithStatsig`, `StatsigCloudflareClient.initializeFromKV()`, or KV.

The ruleset repository:

1. Fetches `download_config_specs` with the server secret.
2. Stores `{ rawJson, expiresAt }` in the Volatile Cache binding.
3. Reads the config generation from the top-level `time` field.
4. Creates one isolate-local `StatsigServerlessClient` for that generation.
5. Calls the public data adapter's `setData(rawJson)` and `initializeSync()`.
6. Retains the initialized client, generation, and expiry, but not `rawJson`, in
   the runtime snapshot.
7. Reuses the client until the absolute cached expiry.
8. Replaces the client when the generation changes.
9. Falls back to the last-known-good client when a TTL reload fails.

Evaluation calls:

```ts
client.getClientInitializeResponse(user, {
	clientSDKKey: env.STATSIG_CLIENT_KEY,
	hash: 'none',
});
```

The result is passed through a permissive wire-contract validator that
preserves official response fields and is returned to the application Worker.

## Ruleset expiry and invalidation

Normal freshness is lazy TTL expiry. There is no periodic refresh cron and no
endpoint that claims to refresh while serving an older cached value.

`POST /admin/invalidate` requires `INVALIDATION_SECRET` and performs two
repository invalidations: it deletes the Volatile Cache ruleset key and clears
the isolate-local snapshot. The next evaluator
invocation after the per-user Workers Cache entry expires downloads and
initializes the current ruleset. Bootstrap entries continue to obey their
declared Workers Cache TTL and stale window.

## Browser integration

The browser uses only the public `@statsig/js-client` API:

```ts
const client = new StatsigClient(clientKey, user, {
	loggingEnabled: 'disabled',
	networkConfig: { preventAllNetworkTraffic: true },
});

client.dataAdapter.setData(JSON.stringify(bootstrap));
client.initializeSync();
```

No `@statsig/js-client/src/*` import is used.

## NextAuth compatibility capsule

`workers/app/compat/next-auth-bridge.ts` exposes a bridge with only:

```ts
interface NextAuthBridge {
	endpointHandler: RequestHandler;
	loadSession(req: Request, res: Response): Promise<Session | null>;
}
```

The capsule:

- Resolves the CommonJS exports once at module initialization through one typed,
  single-level interop helper.
- Constructs a separate explicit NextAuth request object.
- Never mutates the Express request.
- Explicitly binds response methods.
- Preserves array-valued `Set-Cookie` headers.
- Is contract-tested against the exact pinned `next-auth` 4.24.15 package.

The unrelated workerd compatibility experiments live separately in
`workers/app/compat/`:

- `depd-workerd.cjs` avoids dynamic code generation in Express's `depd`.
- `react-router-response.ts` buffers React Router responses until the workerd
  Node HTTP streaming issue is fixed.

Express routes mounted before React Router retain normal response behavior. The
standalone streaming reproduction remains independently testable in
`repro/http-server-streaming/`.

## Configuration

The application Worker and evaluator Worker use the same `APP_ID` and
`STATSIG_CLIENT_KEY`. The evaluator additionally requires:

- `STATSIG_SERVER_SECRET`
- `USER_CACHE_HMAC_SECRET`
- `INVALIDATION_SECRET`

The Volatile Cache binding remains experimental and is configured with a
64 MiB maximum value and 128 MiB total capacity for the representative 30 MB
ruleset. Workers KV is intentionally not used because its documented value
limit is 25 MiB. `package.json` overrides the Vite plugin's Miniflare dependency
to the same workers-sdk PR build as Wrangler so the binding is present during
multi-Worker Vite development.

## Verification

The implementation is complete when all of these pass:

```sh
npm run cf-typegen
npm run check
npm run build
npx wrangler deploy --dry-run
npx wrangler deploy --dry-run --config wrangler.statsig.jsonc
```

Tests cover official server-side evaluation, browser bootstrap initialization,
absolute TTL behavior, generation replacement, stale fallback, explicit
invalidation, HMAC cache keys, the pinned NextAuth bridge contract, multiple
`Set-Cookie` headers, and the buffered React Router response workaround.
