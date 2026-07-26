# Feature service encapsulation

## Objective

Encapsulate Statsig behind a vendor-neutral feature service so the application
and browser know only typed application decisions.

## Implemented architecture

- `shared/feature-contract.ts` defines neutral subjects, decisions, diagnostics,
  and snapshots.
- `workers/app/feature-service-client.ts` makes one credential-free service
  request per authenticated SSR request.
- `FeatureGatewayEntrypoint` validates and normalizes the subject, constructs
  the trusted provider user, and creates the evaluator-only HMAC cache key.
- `DecisionCacheEntrypoint` owns the cacheable `GET`, configuration loading,
  server-side evaluation, and application mapping.
- The default evaluator entrypoint owns health and authenticated invalidation.
- Browser bootstrap code and `@statsig/js-client` have been removed.

## Entrypoints

| Entrypoint | Purpose | Cache |
| --- | --- | --- |
| `default` | Health/admin | Disabled |
| `FeatureGatewayEntrypoint` | Validation and normalization | Disabled |
| `DecisionCacheEntrypoint` | Per-user decisions | Enabled |

## Security and cache properties

- The app has no provider key or user-cache HMAC secret.
- The internal cache URL contains no user ID or email.
- The HMAC covers the full normalized provider user, including trusted
  application, environment, and tenant fields.
- Cookies and authorization headers are not forwarded across either private
  feature-service hop.
- Provider evaluation failures use safe application defaults where possible.
- Complete configuration-loading failure returns `503`.
- Invalidation clears configuration state and purges decision cache tags from
  the entrypoint that owns them.

## Verification

```sh
npm run cf-typegen
npm run check
npm run build
npx wrangler deploy --dry-run
npx wrangler deploy --dry-run --config wrangler.statsig.jsonc
```
