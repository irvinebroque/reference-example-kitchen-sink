# Build-time Zod schema compilation

## Decision

Production Worker builds and the main test suites compile selected Zod schemas
with `zod-compiler`. Source code still uses ordinary Zod.

`zod-compiler.config.ts` uses:

- `schemas: "auto"`
- `output: "bag"`
- `stripUnknownKeys: true`
- a strict allowlist of contract modules

Compiling at build time reduces the schema code and initialization work shipped
to Workers. This helps avoid expensive global-scope work during
[Worker startup](https://developers.cloudflare.com/workers/platform/limits/#worker-startup-time).

## Why this matters on Workers

A top-level `z.object()` builds a graph of JavaScript schema objects when each
Worker isolate starts. Before the isolate can handle a request, it must:

1. parse the bundled Zod implementation and schema definitions; and
2. run every schema constructor in global scope.

The isolate then keeps that schema graph in memory. Large schemas therefore add
both startup work and retained memory, even though most requests only need the
resulting validation functions.

`zod-compiler` moves that construction to build time. The Worker receives
smaller validator bags instead of rebuilding the full Zod object graph at
startup.

## Rules

Allowlisted contract modules must be pure. They may define and export schemas,
but must not perform I/O, validate environment variables, initialize clients, or
run other application logic at module scope.

Compiled bags support the validation methods used by this project, including
`parse()` and `safeParse()`. Do not depend on Zod introspection such as `.shape`,
`._zod`, `instanceof ZodObject`, registries, or JSON Schema conversion.

`stripUnknownKeys: true` preserves the default `z.object()` behavior of removing
unknown properties.

## Development and tests

Normal development uses raw Zod. Production builds and the main Vitest suites
use compiled schemas. A separate fallback suite checks that raw Zod and compiled
schemas behave the same.

## Changing schemas

1. Put runtime schemas in a pure contract module.
2. Export each schema root that should be compiled.
3. Add new modules to the allowlist in `zod-compiler.config.ts`.
4. Add or update compiled and fallback behavior tests.
5. Run:

   ```sh
   pnpm run check:zod-compiler
   pnpm run check
   pnpm run build
   ```

Keep compiler coverage at 100%.

## Deployment

Use the repository deployment scripts so Cloudflare deploys the generated Vite
Worker:

```sh
pnpm run deploy:statsig
pnpm run deploy:statsig:staging
pnpm run deploy:app
pnpm run deploy
```

Do not deploy `wrangler.statsig.jsonc` directly. That bypasses schema
compilation.
