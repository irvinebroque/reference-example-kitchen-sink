# Production release workflow

Deploy the Statsig Worker before the app Worker. This ensures the production app
does not start using a feature-service contract that the bound Statsig Worker
cannot yet satisfy.

## Release order

1. Deploy Statsig Worker changes to the staging environment:

   ```sh
   pnpm run deploy:statsig:staging
   ```

2. Create or update the app Preview.

3. Test authentication, server-side rendering, feature evaluation, cache hits,
   stale responses, and failure paths. If a genuine `reference_gate` usage
   action exists, exercise it in staging and confirm the custom event plus a
   sanitized `statsig_logs_flushed` log.

4. Merge only after the stable Preview URL points to the approved successful
   deployment.

5. If this is the first production deployment of the Statsig Worker, create its
   production secret:

   ```sh
   pnpm exec wrangler secret put STATSIG_SERVER_SECRET \
     --config wrangler.statsig.jsonc \
     --env=""
   ```

6. Deploy the production Statsig Worker:

   ```sh
   pnpm run deploy:statsig
   ```

   Production initially keeps
   `STATSIG_PRODUCT_EVENT_LOGGING_ENABLED=false`.

7. Deploy the production app:

   ```sh
   pnpm run deploy:app
   ```

8. After validating the real production usage action, change
   `STATSIG_PRODUCT_EVENT_LOGGING_ENABLED` to `true` and redeploy the Statsig
   Worker. Do not enable the flag based on a fabricated page-view event.

The combined deployment script follows the same order:

```sh
pnpm run deploy
```

## GitHub Actions

`.github/workflows/deploy.yml` runs on every push to `main` and can also be
started manually. It installs the locked dependencies, runs the full project
check, and then runs `pnpm run deploy`.

Add `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` as repository secrets.
The API token must be able to deploy both Workers.

## Security checklist

Before accepting production credential traffic:

1. Attach the app Worker to a controlled custom domain.
2. Install the narrowly scoped edge rate-limiting rule described in
   [Authentication rate limiting](../security/auth-rate-limiting.md).
3. Apply that rule only to credential callback `POST` requests.
4. Protect Preview URLs separately with Cloudflare Access when they should not
   be public.
5. Keep `STATSIG_SERVER_SECRET` available only to the Statsig Worker.

## Rollback considerations

The app and Statsig Worker deploy independently. When changing their shared
contract, keep the new Statsig Worker compatible with the currently deployed app
until the app deployment succeeds.

Workers Cache is partitioned by Worker version in this repository, so a new
Statsig Worker deployment starts with a new decision cache. The default
isolate-local configuration snapshot is not durable and should not be used as
rollback state. The optional workerd Memory Cache backend is also not durable.
