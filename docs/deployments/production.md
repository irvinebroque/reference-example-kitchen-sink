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
   stale responses, and failure paths.

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

7. Deploy the production app:

   ```sh
   pnpm run deploy:app
   ```

The combined deployment script follows the same order:

```sh
pnpm run deploy
```

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
Statsig Worker deployment starts with a new decision cache. The process-local
Memory Cache is not durable and should not be used as rollback state.
