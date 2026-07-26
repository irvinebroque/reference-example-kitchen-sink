# Credential callback rate limiting

## Current deployment gate

Owner: repository maintainer (`brendan`)

Last verified: July 26, 2026

The configured production Worker name is
`reference-example-kitchen-sink-app`. As of the verification date, it was not
present in the configured Cloudflare account and no custom domain was attached
to that service. `wrangler.jsonc` also contains no production custom-domain
route. A zone-level WAF rate-limiting rule therefore cannot be installed
safely yet: a `workers.dev` hostname is outside a customer-managed zone, and
choosing an unrelated account domain would change the application's production
address.

Production credential authentication is gated on completing the custom-domain
and rule setup below. Do not treat a first `workers.dev` deployment as ready
for public credential traffic.

## Required production configuration

1. Select a controlled custom domain in a Cloudflare zone owned by the
   application team.
2. Attach that exact hostname to
   `reference-example-kitchen-sink-app`.
3. Replace `<production-hostname>` below with the attached hostname and create
   a zone-level WAF rate-limiting rule in the `http_ratelimit` phase:

   ```text
   http.host eq "<production-hostname>"
   and http.request.method eq "POST"
   and http.request.uri.path eq "/api/auth/callback/credentials"
   ```

4. Record the selected values in this table in the same change that creates
   the rule:

   | Setting | Required value |
   | --- | --- |
   | Zone | The zone containing `<production-hostname>` |
   | Hostname | `<production-hostname>` |
   | Counting characteristic | Source IP (`ip.src`) |
   | Threshold | 10 requests |
   | Counting period | 5 minutes (300 seconds), or the closest supported period without making the limit stricter |
   | Initial action | Log where the zone plan supports it; otherwise Managed Challenge with a conservative supported threshold |
   | Enforcement action | Managed Challenge or Block after observation |
   | Mitigation duration | 15 minutes (900 seconds), or the closest supported duration |
   | Owner | Repository maintainer (`brendan`) |
   | Last verified | Date the deployed rule is read back from Cloudflare |

Cloudflare plan capabilities determine which periods, durations, and actions
are available. Do not silently substitute a much stricter setting. Document
any supported-value adjustment and the reason in the table.

## Rollout and verification

1. Create the rule in Log mode when available.
2. Observe several days of production authentication traffic for shared-office,
   VPN, mobile-carrier, and CI false positives.
3. From a disposable client, confirm requests below the threshold reach
   NextAuth normally.
4. Exceed the threshold outside shared CI and confirm the selected challenge or
   block response.
5. Confirm `/api/auth/csrf`, `/api/auth/session`, `/api/auth/signout`, static
   assets, and normal application routes remain unaffected.
6. Enable Managed Challenge or Block after the observation period.
7. Confirm a normal user can retry after the mitigation duration and review the
   result after one week.

Do not add WAF administration permissions to the Preview deployment token.
Protect public Preview and Deployment URLs separately with Cloudflare Access.

## Rollback

Disable the single credential callback rate-limiting rule in the zone WAF
ruleset. Do not broaden or remove application authentication checks, and do not
alter the Preview deployment token. Re-enable the rule only after correcting
the threshold, expression, or action and repeating the controlled verification.
