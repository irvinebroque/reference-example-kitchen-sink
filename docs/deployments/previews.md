# Preview deployment workflow

Cloudflare Workers Previews are this repository's main pull-request review
environment. Start with the
[Workers Previews guide](https://worker-previews-docs-2.preview.developers.cloudflare.com/workers/previews/get-started/)
and re-check `pnpm exec wrangler preview --help` when updating the pinned
Wrangler prerelease.

## Preview URLs

A pull-request Preview belongs to the app Worker and has two useful URLs:

- The **Branch Preview URL** keeps the same address and points to the latest
  successful deployment for that branch.
- The **immutable Deployment URL** points to one exact build.

Preview variables, secrets, and bindings are separate from production. They are
not inherited automatically. Reusing a Preview name updates the same Preview
and preserves its Branch Preview URL.

The workflow uses the pull request's head branch as the Preview name. Closing
or merging the pull request deletes that Preview and its deployments.

## Staging feature service

The app's `previews` block in `wrangler.jsonc` binds `FEATURE_SERVICE` to:

```text
reference-example-kitchen-sink-statsig-staging
```

A service binding from a Preview invokes the bound Worker's deployed version; it
cannot target another Worker's Preview. Deploy Statsig Worker changes to this
staging Worker before creating or refreshing an app Preview that needs them.

Previews that use the same staging service share that service and its external
data. Keep Preview bindings and credentials pointed at staging or test systems
unless production access is an intentional part of the test.

## Preview authentication

The Preview app sets `AUTH_TRUST_HOST=true`. This allows NextAuth to construct
its origin from each Preview request instead of requiring one static
`NEXTAUTH_URL`.

The compatibility bridge discards caller-provided forwarded-origin headers and
derives `host`, `x-forwarded-host`, and `x-forwarded-proto` from the Worker
`request.url`, including local ports. This supports changing Preview URLs
without trusting arbitrary forwarded headers.

Do not configure a `NEXTAUTH_URL` Preview secret. A stale value can override the
request origin and break sign-in callbacks.

## One-time Cloudflare setup

### 1. Authenticate Wrangler

Authenticate Wrangler locally, or create a CI API token that can manage the app
Worker and its Previews.

The Cloudflare account must also have access to the Worker Previews private
beta. Error `10015` means the feature is not enabled for the account selected by
`CLOUDFLARE_ACCOUNT_ID`.

### 2. Configure and deploy the staging Statsig Worker

Add these repository secrets in GitHub:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `STATSIG_SERVER_SECRET`

Run the **Deploy Statsig staging** workflow once. It builds the generated Vite
Worker and uses `wrangler deploy --secrets-file` so the Worker and its required
secret can be created atomically on the first deployment.

After bootstrap, the same workflow runs from `main` whenever the Statsig Worker
or its deployment configuration changes. Pull requests do not deploy their code
into this shared Worker because concurrent pull requests would overwrite one
another.

### 3. Create the production app Worker

Configure the app secrets and deploy it once:

```sh
pnpm exec wrangler secret put AUTH_SECRET
pnpm exec wrangler secret put DEMO_USERNAME
pnpm exec wrangler secret put DEMO_PASSWORD_HASH
pnpm run deploy:app
```

### 4. Configure Preview settings and secrets

Push the checked-in `previews` configuration, then create the three Preview
secrets separately from production:

```sh
pnpm exec wrangler preview settings update
pnpm exec wrangler preview secret put AUTH_SECRET
pnpm exec wrangler preview secret put DEMO_USERNAME
pnpm exec wrangler preview secret put DEMO_PASSWORD_HASH
```

The pinned Wrangler calls the shared Preview configuration `settings`; the beta
documentation calls it the Preview base configuration. Run
`preview settings update` again after changing the checked-in `previews` block.

### 5. Review GitHub Actions

The workflows are defined in `.github/workflows/preview.yml` and
`.github/workflows/staging.yml`.

### 6. Protect public Preview URLs

Preview and Deployment URLs are public unless you protect them. Consider using
Cloudflare Access for review environments that should not be publicly
available.

## Pull-request workflow

For a same-repository pull request:

1. CI installs dependencies.
2. CI verifies that the shared staging Statsig Worker has a deployment.
3. CI runs type checks, tests, provider-boundary checks, and both Worker builds.
4. `wrangler preview` creates or updates the app Preview for the head branch.
5. CI creates or updates one pull-request comment containing the Branch Preview
   URL.
6. A later successful run updates the same Branch Preview URL.
7. Closing or merging the pull request deletes the Preview.

If a build or deployment fails, the Branch Preview URL continues to point to
the last successful deployment. It does not necessarily represent the latest
pull-request commit.

## Fork pull requests

GitHub does not provide repository secrets to untrusted fork pull-request
workflows. The workflow therefore skips fork pull requests.

Test a fork locally or move the change to a trusted branch before creating a
Preview. Do not switch the workflow to `pull_request_target` and then execute
untrusted pull-request code with deployment credentials.

## Manual Preview lifecycle

Run the same basic lifecycle locally:

```sh
pnpm run check
pnpm run build
pnpm exec wrangler preview --name my-branch
pnpm run smoke:preview-auth https://the-preview-or-deployment-url.example
pnpm exec wrangler preview delete --name my-branch --skip-confirmation
```

The optional authentication smoke test checks readiness, callback origins,
secure cookies, invalid credentials, and anonymous sign-out without using a
valid password.

For branch-specific variables, bindings, or test resources, either update the
checked-in `previews` block or change that individual Preview in the Cloudflare
dashboard.

## Troubleshooting

### Preview reports missing bindings or secrets

Preview configuration is separate from production. Run
`pnpm exec wrangler preview settings update`, list the Preview secrets, and
compare the active Preview settings with `wrangler.jsonc`.

### Preview creation returns error 10015

Worker Previews is not enabled for the Cloudflare account. Confirm that
`CLOUDFLARE_ACCOUNT_ID` selects the intended account and have the private beta
enabled before rerunning the workflow.

### Preview reaches the wrong Statsig Worker

Confirm the Preview's `FEATURE_SERVICE` binding names
`reference-example-kitchen-sink-statsig-staging`. Service bindings from a
Preview target the bound Worker's deployed version, not another Preview.

### Staging feature service is not deployed

Run the **Deploy Statsig staging** GitHub Actions workflow. The Preview workflow
checks this dependency before running the full test and build suite so a missing
bootstrap deployment fails with an actionable error.

### Authentication cookies or callbacks are wrong

Confirm that:

- `AUTH_TRUST_HOST=true` is present in Preview settings;
- the Preview has no stale `NEXTAUTH_URL` secret;
- the request uses HTTPS; and
- `request.url` contains the expected Preview host.

See the [NextAuth v4 compatibility bridge](../../workers/app/compat/README.md)
for the full origin and cookie behavior.
