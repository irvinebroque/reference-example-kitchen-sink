# NextAuth v4 compatibility bridge

The `next-auth-bridge` is a compatibility adapter between Cloudflare Workers'
Web-platform `Request`/`Response` APIs and NextAuth v4's Node/Next.js-style
request/response API.

## Why it exists

A Worker's `fetch` handler receives a Web-platform
[`Request`](https://developers.cloudflare.com/workers/runtime-apis/request/)
and returns a Web-platform
[`Response`](https://developers.cloudflare.com/workers/runtime-apis/response/).

The public NextAuth v4 API used by this application expects a Next.js API-route
request and response instead. That response has methods such as `status()`,
`setHeader()`, `json()`, and `send()`. See the
[NextAuth 4.24.15 handler source](https://github.com/nextauthjs/next-auth/blob/next-auth%404.24.15/packages/next-auth/src/next/index.ts).

Both APIs describe an HTTP request and response, but they use different
JavaScript shapes. The bridge translates between them.

```text
Cloudflare Request
        |
        v
next-auth-bridge
        |
        v
NextAuth v4
        |
        v
next-auth-bridge
        |
        v
Cloudflare Response
```

Think of the bridge as a USB adapter. It changes the connection shape so that
NextAuth and the Worker can communicate; it does not implement authentication.
Unlike a physical USB adapter, this bridge also parses supported request
bodies, applies a size limit to them, and collects response headers.

## Alternative: use `@auth/core` directly

The Auth.js/NextAuth repository also publishes
[`@auth/core`](https://authjs.dev/reference/core). Its primary entrypoint is
based on Web-standard `Request` and `Response` objects:

```ts
import { Auth, type AuthConfig } from '@auth/core';
import Credentials from '@auth/core/providers/credentials';

function handleAuth(request: Request, env: Env): Promise<Response> {
	const config = {
		basePath: '/api/auth',
		providers: [
			Credentials({
				credentials: {
					username: { label: 'Username', type: 'text' },
					password: { label: 'Password', type: 'password' },
				},
				async authorize(credentials) {
					// Validate unknown credential input before using it.
					return authenticate(credentials, env);
				},
			}),
		],
		secret: env.AUTH_SECRET,
		session: { strategy: 'jwt' },
		trustHost: true,
	} satisfies AuthConfig;

	return Auth(request, config);
}
```

That shape is a more natural fit for a Worker: `Auth()` can receive the
incoming Worker request and return its response without emulating a Next.js API
request or response. The official
[`@auth/core` source](https://github.com/nextauthjs/next-auth/blob/main/packages/core/src/index.ts)
describes direct use, while also marking the package experimental and under
active development.

The two choices solve the same application problem through different public
interfaces:

| Concern | This repository: `next-auth` v4 bridge | Direct `@auth/core` |
| --- | --- | --- |
| Primary reason to choose it | Preserve or demonstrate a pinned NextAuth v4 integration | Prefer the Web-standard API for a new integration |
| HTTP boundary | Translate Worker requests and responses into Next.js-style objects | Pass a Web `Request` to `Auth()` and receive a Web `Response` |
| Package imports | `next-auth` and `next-auth/providers/*` | `@auth/core` and `@auth/core/providers/*` |
| Session loading | Adapt `getServerSession()` and collect its response headers | Invoke the core session action through a small application helper |
| Main maintenance risk | The custom translation must continue matching pinned v4 behavior | The experimental core package and its configuration may change |
| Migration effect | Retains the pinned v4 behavior tested here | Requires retesting cookies, callbacks, redirects, CSRF, and session continuity |

`@auth/core` removes the **request/response compatibility adapter**, but it does
not remove every application-specific wrapper. This application would still
benefit from keeping an auth-service interface with operations equivalent to
`handle()` and `loadSession()`:

- `handle()` can delegate `/api/auth/*` requests directly to `Auth()`.
- `loadSession()` can construct a request for the configured session action,
  call `Auth()`, validate the returned JSON, and return both the session and
  response headers.
- The app response finalizer must continue forwarding refreshed or cleared
  session cookies from that session response.

The term **adapter** is overloaded in Auth.js. The bridge in this directory is
an HTTP compatibility adapter. An Auth.js database adapter is a different
concept: it persists users, accounts, and sessions.

### Migration checklist

To replace this bridge with `@auth/core`:

1. Add `@auth/core` as a direct, pinned dependency. Do not import an optional or
   transitive copy associated with `next-auth`.
2. Port `AuthOptions` to `AuthConfig` and change provider imports to
   `@auth/core/providers/*`.
3. Set `basePath: '/api/auth'`; current `@auth/core` otherwise defaults to
   `/auth`.
4. Replace the Next.js-shaped handler call with `Auth(request, config)`.
5. Replace `getServerSession()` with an application-owned session helper that
   calls the core session endpoint and preserves all returned `Set-Cookie`
   headers.
6. Revalidate credentials input, custom pages, callback and redirect behavior,
   host trust, CSRF handling, secure-cookie behavior, and error responses.
7. Decide whether existing v4 sessions must survive the migration. Do not
   assume cookie names, formats, or defaults are compatible; plan for explicit
   compatibility testing or user re-authentication.
8. Run the Node contracts, workerd tests, app integration tests, and a deployed
   Worker Preview before removing `next-auth`, `next-auth-interop.ts`, or this
   bridge.

The direct core path is not implemented in this repository because that would
stop this example from exercising literal NextAuth v4 compatibility. It is,
however, the first alternative to assess before copying this bridge into a
greenfield Worker.

## What it does

[`next-auth-bridge.ts`](./next-auth-bridge.ts) exposes two operations:

```ts
interface NextAuthBridge {
	handle(request: Request): Promise<Response>;
	loadSession(request: Request): Promise<{
		headers: Headers;
		session: Session | null;
	}>;
}
```

### `handle(request)`

This handles `/api/auth/*` requests such as CSRF-token creation, credential
callbacks, sign-out, and session endpoints.

It:

1. Reads the URL, query parameters, headers, and cookies from the Web
   `Request`.
2. Parses JSON and URL-encoded form bodies.
3. Rejects supported request bodies larger than 32 KiB before fully buffering
   them.
4. Presents NextAuth with the request shape it expects.
5. Collects calls to NextAuth's response methods.
6. Preserves multiple `Set-Cookie` headers.
7. Returns a Web `Response` to the Worker.

For JSON and URL-encoded forms, bodies larger than 32 KiB produce a `413`
response. Malformed JSON produces a `400` response. Other content types are not
parsed or size-limited by this bridge.

### `loadSession(request)`

This asks NextAuth for the session associated with the request's cookies.

It returns both:

- `session`: the authenticated session, or `null`.
- `headers`: headers produced while loading the session.

The headers are important. NextAuth may refresh or clear a session cookie while
loading the session. When those `Set-Cookie` headers are present, the caller
must add them to the application response to preserve that operation.
[`create-app.ts`](../create-app.ts) normally passes them to the response
finalizer. It deliberately omits them while rendering `/auth/signin`.

## What it does not do

The bridge does not:

- Check the username or password.
- Decide which authentication providers are enabled.
- Define session, JWT, redirect, or callback behavior.
- Replace NextAuth.
- Provide a general-purpose Node.js server inside the Worker.

The application-specific authentication configuration lives in
[`auth.ts`](../auth.ts). NextAuth still provides its own default authentication
behavior. The CommonJS package-export handling is isolated in
[`next-auth-interop.ts`](./next-auth-interop.ts).

## Why it is kept separate

The rest of the application uses Web `Request` and `Response` objects directly.
Keeping the translation in this directory prevents NextAuth v4's
Next.js-specific interface from spreading through the Worker.

The bridge is intentionally small and version-specific. The application pins
`next-auth` to `4.24.15`, and
[`next-auth-bridge.spec.ts`](../../../test/unit/next-auth-bridge.spec.ts)
contract-tests sign-in, session loading, cookie propagation, invalid
credentials, sign-out, expiry, body limits, and malformed JSON bodies.

When changing the pinned NextAuth version, run the full test suite and review
this adapter against the new version's request and response behavior.

## Testing

The bridge is covered at three boundaries:

1. `test/unit/next-auth-bridge.spec.ts` runs fast protocol contracts and
   parsing edge cases in Node.
2. `test/workers/next-auth-bridge.spec.ts` imports the production bridge inside
   `workerd` through Cloudflare's Vitest integration, including secure cookies
   and body-size boundaries.
3. `test/unit/app-auth-integration.spec.ts` runs the real bridge through the
   application handler and response finalizer to prove refreshed and cleared
   cookies reach the outgoing response.

Run `pnpm run test:unit` and `pnpm run test:workers` independently, or
`pnpm run test:run` for both layers.

When `NEXTAUTH_URL` is not configured and NextAuth host trust is enabled, the
bridge preserves caller-provided `x-forwarded-host` and `x-forwarded-proto`
headers and only derives missing values from the request URL. The Cloudflare
routing layer is therefore responsible for ensuring those incoming headers
are trustworthy before the bridge uses them to construct callback origins.
NextAuth's configured `NEXTAUTH_URL` continues to take precedence when present.
