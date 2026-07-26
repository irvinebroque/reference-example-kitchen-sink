# Cloudflare Workers

STOP. Your knowledge of Cloudflare Workers APIs and limits may be outdated. Always retrieve current documentation before any Workers, KV, R2, D1, Durable Objects, Queues, Vectorize, AI, or Agents SDK task.

## Docs

- https://developers.cloudflare.com/workers/
- MCP: `https://docs.mcp.cloudflare.com/mcp`

For all limits and quotas, retrieve from the product's `/platform/limits/` page. eg. `/workers/platform/limits`

## Commands

| Command | Purpose |
|---------|---------|
| `pnpm exec wrangler dev` | Local development |
| `pnpm exec wrangler deploy` | Deploy to Cloudflare |
| `pnpm exec wrangler types` | Generate TypeScript types |

Run `wrangler types` after changing bindings in wrangler.jsonc.

## Zod schema compilation

Production and test builds compile the Zod contracts listed in
`zod-compiler.config.ts`. Keep allowlisted schema modules pure: no I/O,
environment validation, client initialization, or other module-scope side
effects. Add new runtime schema modules to the strict allowlist and keep
`output: "bag"` plus `stripUnknownKeys: true` unless the architecture decision
is intentionally revisited. Run `pnpm run check:zod-compiler` after changing
schemas. Never deploy `wrangler.statsig.jsonc` directly; use the repository
deployment scripts so the generated Vite Worker is deployed.

## Node.js Compatibility

https://developers.cloudflare.com/workers/runtime-apis/nodejs/

## Errors

- **Error 1102** (CPU/Memory exceeded): Retrieve limits from `/workers/platform/limits/`
- **All errors**: https://developers.cloudflare.com/workers/observability/errors/

## Product Docs

Retrieve API references and limits from:
`/kv/` · `/r2/` · `/d1/` · `/durable-objects/` · `/queues/` · `/vectorize/` · `/workers-ai/` · `/agents/`

## Best Practices (conditional)

If the application uses Durable Objects or Workflows, refer to the relevant best practices:

- Durable Objects: https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/
- Workflows: https://developers.cloudflare.com/workflows/build/rules-of-workflows/
