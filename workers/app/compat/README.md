# NextAuth bridge

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
