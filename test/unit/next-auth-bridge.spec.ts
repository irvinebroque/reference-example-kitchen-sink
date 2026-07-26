import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	applySetCookies,
	contractOptions,
	contractOrigin,
	contractUser,
	getCookieAttribute,
	getSessionCookie,
	getSessionSetCookie,
	loadCsrfToken,
	requestHeaders,
	signOut,
	submitCredentials,
	submitJsonCredentials,
	validCredentials,
	type ContractAuthorizeRequest,
	type CookieJar,
} from '../helpers/next-auth-flow';
import { createNextAuthBridge } from '../../workers/app/compat/next-auth-bridge';

const require = createRequire(import.meta.url);
const nextAuthEntry = require.resolve('next-auth');
const nextAuthPackage = JSON.parse(readFileSync(join(dirname(nextAuthEntry), 'package.json'), 'utf8')) as {
	version: string;
};

const originalAuthTrustHost = process.env.AUTH_TRUST_HOST;
const originalNextAuthUrl = process.env.NEXTAUTH_URL;

function bodyWithByteLength(byteLength: number): string {
	const prefix = 'padding=';
	const body = `${prefix}${'a'.repeat(byteLength - prefix.length)}`;
	expect(new TextEncoder().encode(body)).toHaveLength(byteLength);
	return body;
}

describe('NextAuth compatibility capsule', () => {
	beforeEach(() => {
		process.env.NEXTAUTH_URL = contractOrigin;
	});

	afterEach(() => {
		if (originalAuthTrustHost === undefined) Reflect.deleteProperty(process.env, 'AUTH_TRUST_HOST');
		else process.env.AUTH_TRUST_HOST = originalAuthTrustHost;
		if (originalNextAuthUrl === undefined) Reflect.deleteProperty(process.env, 'NEXTAUTH_URL');
		else process.env.NEXTAUTH_URL = originalNextAuthUrl;
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it('is contract-tested against the pinned next-auth version', () => {
		expect(nextAuthPackage.version).toBe('4.24.15');
	});

	it('adapts a Fetch request and preserves multiple Set-Cookie headers', async () => {
		const request = new Request(`${contractOrigin}/api/auth/csrf?callbackUrl=%2F`, {
			headers: { cookie: 'existing=value' },
		});

		const response = await createNextAuthBridge(contractOptions()).handle(request);

		expect(response.status).toBe(200);
		expect(response.headers.getSetCookie()).toHaveLength(2);
		expect(await response.json()).toMatchObject({ csrfToken: expect.any(String) });
		expect(request.url).toBe('http://localhost:3000/api/auth/csrf?callbackUrl=%2F');
	});

	it('rejects oversized endpoint bodies before buffering them', async () => {
		const request = new Request(`${contractOrigin}/api/auth/callback/credentials`, {
			body: `username=${'a'.repeat(33 * 1024)}`,
			headers: { 'content-type': 'application/x-www-form-urlencoded' },
			method: 'POST',
		});

		const response = await createNextAuthBridge(contractOptions()).handle(request);

		expect(response.status).toBe(413);
		expect(await response.json()).toEqual({ error: 'request_too_large' });
	});

	it('returns a client error for malformed JSON bodies', async () => {
		const request = new Request(`${contractOrigin}/api/auth/callback/credentials`, {
			body: '{',
			headers: { 'content-type': 'application/json' },
			method: 'POST',
		});

		const response = await createNextAuthBridge(contractOptions()).handle(request);

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ error: 'invalid_request_body' });
	});

	it('signs in with valid credentials and issues a session cookie', async () => {
		const bridge = createNextAuthBridge(contractOptions());
		const cookies: CookieJar = new Map();

		const response = await submitCredentials(bridge, cookies);

		expect(response.status).toBe(302);
		expect(response.headers.get('location')).toBe(`${contractOrigin}/protected`);
		expect(getSessionSetCookie(response.headers)).toMatch(/^next-auth\.session-token=.+;\s*Path=\//);
		expect(getSessionCookie(cookies)?.[1]).toEqual(expect.any(String));
	});

	it('retrieves the authenticated session from the issued cookie', async () => {
		const bridge = createNextAuthBridge(contractOptions());
		const cookies: CookieJar = new Map();
		await submitCredentials(bridge, cookies);

		const { session } = await bridge.loadSession(
			new Request(`${contractOrigin}/protected`, {
				headers: requestHeaders(cookies),
			}),
		);

		expect(session).toMatchObject({
			user: contractUser,
		});
		expect(new Date(session?.expires ?? Number.NaN).getTime()).toBeGreaterThan(Date.now());
	});

	it('returns a refreshed session cookie for propagation to the application response', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-07-26T12:00:00.000Z'));
		const bridge = createNextAuthBridge(contractOptions({ sessionMaxAge: 60 }));
		const cookies: CookieJar = new Map();
		await submitCredentials(bridge, cookies);
		const initialSessionCookie = getSessionCookie(cookies)?.[1];
		vi.setSystemTime(new Date('2026-07-26T12:00:30.000Z'));

		const { headers, session } = await bridge.loadSession(
			new Request(`${contractOrigin}/protected`, {
				headers: requestHeaders(cookies),
			}),
		);

		const refreshedSetCookie = getSessionSetCookie(headers);
		expect(refreshedSetCookie).toEqual(expect.any(String));
		expect(getCookieAttribute(refreshedSetCookie!, 'Expires')).toBe('Sun, 26 Jul 2026 12:01:30 GMT');
		expect(session?.expires).toBe('2026-07-26T12:01:30.000Z');
		applySetCookies(cookies, headers);
		expect(getSessionCookie(cookies)?.[1]).not.toBe(initialSessionCookie);

		const { session: propagatedSession } = await bridge.loadSession(
			new Request(`${contractOrigin}/protected`, {
				headers: requestHeaders(cookies),
			}),
		);
		expect(propagatedSession?.user).toMatchObject(contractUser);
	});

	it('rejects invalid credentials without issuing a session', async () => {
		const bridge = createNextAuthBridge(contractOptions());
		const cookies: CookieJar = new Map();

		const response = await submitCredentials(bridge, cookies, {
			password: 'incorrect-password',
			username: validCredentials.username,
		});

		expect(response.status).toBe(302);
		expect(response.headers.get('location')).toBe(
			`${contractOrigin}/api/auth/error?error=CredentialsSignin&provider=credentials`,
		);
		expect(getSessionSetCookie(response.headers)).toBeUndefined();
		expect(getSessionCookie(cookies)).toBeUndefined();
		const { session } = await bridge.loadSession(
			new Request(`${contractOrigin}/protected`, {
				headers: requestHeaders(cookies),
			}),
		);
		expect(session).toBeNull();
	});

	it('signs out and clears the authenticated session cookie', async () => {
		const bridge = createNextAuthBridge(contractOptions());
		const cookies: CookieJar = new Map();
		await submitCredentials(bridge, cookies);

		const response = await signOut(bridge, cookies);

		const clearedSessionCookie = getSessionSetCookie(response.headers);
		expect(response.status).toBe(302);
		expect(response.headers.get('location')).toBe(`${contractOrigin}/`);
		expect(clearedSessionCookie).toContain('next-auth.session-token=');
		expect(getCookieAttribute(clearedSessionCookie!, 'Max-Age')).toBe('0');
		applySetCookies(cookies, response.headers);
		expect(getSessionCookie(cookies)).toBeUndefined();
		const { session } = await bridge.loadSession(
			new Request(`${contractOrigin}/protected`, {
				headers: requestHeaders(cookies),
			}),
		);
		expect(session).toBeNull();
	});

	it('rejects an expired JWT session and clears its cookie', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-07-26T12:00:00.000Z'));
		const bridge = createNextAuthBridge(contractOptions({ sessionMaxAge: 60 }));
		const cookies: CookieJar = new Map();
		await submitCredentials(bridge, cookies);
		vi.setSystemTime(new Date('2026-07-26T12:01:16.000Z'));
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

		const { headers, session } = await bridge.loadSession(
			new Request(`${contractOrigin}/protected`, {
				headers: requestHeaders(cookies),
			}),
		);

		expect(session).toBeNull();
		const clearedSessionCookie = getSessionSetCookie(headers);
		expect(clearedSessionCookie).toContain('next-auth.session-token=');
		expect(getCookieAttribute(clearedSessionCookie!, 'Max-Age')).toBe('0');
		expect(consoleError).toHaveBeenCalled();
	});

	it('authenticates valid JSON credentials', async () => {
		const bridge = createNextAuthBridge(contractOptions());
		const cookies: CookieJar = new Map();

		const response = await submitJsonCredentials(bridge, cookies);

		expect(response.status).toBe(302);
		expect(response.headers.get('location')).toBe(`${contractOrigin}/protected`);
		expect(getSessionCookie(cookies)?.[1]).toEqual(expect.any(String));
	});

	it('accepts a supported body at the exact 32 KiB boundary', async () => {
		const response = await createNextAuthBridge(contractOptions()).handle(
			new Request(`${contractOrigin}/api/auth/callback/credentials`, {
				body: bodyWithByteLength(32 * 1024),
				headers: { 'content-type': 'application/x-www-form-urlencoded' },
				method: 'POST',
			}),
		);

		expect(response.status).not.toBe(413);
		expect(response.status).toBeLessThan(500);
	});

	it('rejects a supported body one byte over the 32 KiB boundary', async () => {
		const response = await createNextAuthBridge(contractOptions()).handle(
			new Request(`${contractOrigin}/api/auth/callback/credentials`, {
				body: bodyWithByteLength(32 * 1024 + 1),
				headers: { 'content-type': 'application/x-www-form-urlencoded' },
				method: 'POST',
			}),
		);

		expect(response.status).toBe(413);
		expect(await response.json()).toEqual({ error: 'request_too_large' });
	});

	it('returns a defined non-server-error response for the exact auth base path', async () => {
		const response = await createNextAuthBridge(contractOptions()).handle(new Request(`${contractOrigin}/api/auth`));

		expect(response.status).toBeGreaterThanOrEqual(200);
		expect(response.status).toBeLessThan(500);
	});

	it('returns a controlled client error for malformed encoded auth paths', async () => {
		const response = await createNextAuthBridge(contractOptions()).handle(
			new Request(`${contractOrigin}/api/auth/%E0%A4%A`),
		);

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ error: 'invalid_auth_path' });
	});

	it('preserves every value from repeated query parameters', async () => {
		let authorizeRequest: ContractAuthorizeRequest | undefined;
		const bridge = createNextAuthBridge(
			contractOptions({
				onAuthorizeRequest(request) {
					authorizeRequest = request;
				},
			}),
		);
		const cookies: CookieJar = new Map();
		const csrfToken = await loadCsrfToken(bridge, cookies);
		const url = new URL('/api/auth/callback/credentials?scope=one&scope=two', contractOrigin);

		const response = await bridge.handle(
			new Request(url, {
				body: new URLSearchParams({
					callbackUrl: '/protected',
					csrfToken,
					...validCredentials,
				}),
				headers: requestHeaders(cookies, {
					'content-type': 'application/x-www-form-urlencoded',
				}),
				method: 'POST',
			}),
		);

		expect(response.status).toBe(302);
		expect(authorizeRequest?.query.scope).toEqual(['one', 'two']);
	});

	it('keeps equals signs inside cookie values', async () => {
		const bridge = createNextAuthBridge(contractOptions());
		const callbackUrl = `${contractOrigin}/after-signout?token=a=b`;
		const cookies: CookieJar = new Map([['next-auth.callback-url', callbackUrl]]);

		const response = await signOut(bridge, cookies, null);

		expect(response.status).toBe(302);
		expect(response.headers.get('location')).toBe(callbackUrl);
	});

	it('decodes percent-encoded cookie values consistently', async () => {
		const bridge = createNextAuthBridge(contractOptions());
		const callbackUrl = `${contractOrigin}/after-signout?token=a=b`;
		const cookies: CookieJar = new Map([['next-auth.callback-url', encodeURIComponent(callbackUrl)]]);

		const response = await signOut(bridge, cookies, null);

		expect(response.status).toBe(302);
		expect(response.headers.get('location')).toBe(callbackUrl);
	});

	it('does not parse or size-limit unsupported content types', async () => {
		const response = await createNextAuthBridge(contractOptions()).handle(
			new Request(`${contractOrigin}/api/auth/callback/credentials`, {
				body: 'x'.repeat(32 * 1024 + 1),
				headers: { 'content-type': 'text/plain' },
				method: 'POST',
			}),
		);

		expect(response.status).not.toBe(413);
		expect(response.status).toBeLessThan(500);
	});

	it('derives HTTPS callback URLs from the request when forwarded headers are absent', async () => {
		Reflect.deleteProperty(process.env, 'NEXTAUTH_URL');
		process.env.AUTH_TRUST_HOST = 'true';
		const response = await createNextAuthBridge(contractOptions()).handle(
			new Request('https://auth.example.test/api/auth/providers'),
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			credentials: {
				callbackUrl: 'https://auth.example.test/api/auth/callback/credentials',
				signinUrl: 'https://auth.example.test/api/auth/signin/credentials',
			},
		});
	});

	it('rejects caller-provided forwarded origin headers', async () => {
		Reflect.deleteProperty(process.env, 'NEXTAUTH_URL');
		process.env.AUTH_TRUST_HOST = 'true';
		const response = await createNextAuthBridge(contractOptions()).handle(
			new Request('https://preview.example.test/api/auth/providers', {
				headers: {
					'x-forwarded-host': 'attacker.example',
					'x-forwarded-proto': 'http',
				},
			}),
		);

		expect(response.status).toBe(200);
		const payload = await response.json();
		expect(payload).toMatchObject({
			credentials: {
				callbackUrl: 'https://preview.example.test/api/auth/callback/credentials',
				signinUrl: 'https://preview.example.test/api/auth/signin/credentials',
			},
		});
		expect(JSON.stringify(payload)).not.toContain('attacker.example');
	});

	it('canonicalizes the forwarded protocol from an HTTPS request URL', async () => {
		Reflect.deleteProperty(process.env, 'NEXTAUTH_URL');
		process.env.AUTH_TRUST_HOST = 'true';
		const response = await createNextAuthBridge(contractOptions()).handle(
			new Request('https://preview.example.test/api/auth/providers', {
				headers: { 'x-forwarded-proto': 'http' },
			}),
		);

		expect(response.status).toBe(200);
		const payload = (await response.json()) as {
			credentials: { callbackUrl: string; signinUrl: string };
		};
		expect(payload.credentials.callbackUrl).toMatch(/^https:\/\//);
		expect(payload.credentials.signinUrl).toMatch(/^https:\/\//);
	});

	it('preserves the request URL port in the canonical origin', async () => {
		Reflect.deleteProperty(process.env, 'NEXTAUTH_URL');
		process.env.AUTH_TRUST_HOST = 'true';
		const response = await createNextAuthBridge(contractOptions()).handle(
			new Request('http://localhost:8787/api/auth/providers'),
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			credentials: {
				callbackUrl: 'http://localhost:8787/api/auth/callback/credentials',
				signinUrl: 'http://localhost:8787/api/auth/signin/credentials',
			},
		});
	});
});
