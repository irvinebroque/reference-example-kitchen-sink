import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import type { AuthOptions, User } from 'next-auth';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNextAuthBridge, type NextAuthBridge } from '../../workers/app/compat/next-auth-bridge';
import { credentialsProvider } from '../../workers/app/compat/next-auth-interop';

const require = createRequire(import.meta.url);
const nextAuthEntry = require.resolve('next-auth');
const nextAuthPackage = JSON.parse(readFileSync(join(dirname(nextAuthEntry), 'package.json'), 'utf8')) as {
	version: string;
};

const origin = 'http://localhost:3000';
const originalNextAuthUrl = process.env.NEXTAUTH_URL;
const validCredentials = {
	password: 'contract-password',
	username: 'contract-user',
};
const contractUser: User = {
	email: 'contract-user@example.test',
	id: 'contract-user-id',
	name: 'Contract User',
};

type CookieJar = Map<string, string>;

function contractOptions(options: { sessionMaxAge?: number } = {}): AuthOptions {
	return {
		secret: 'contract-test-secret-at-least-32-bytes',
		useSecureCookies: false,
		session: {
			strategy: 'jwt',
			...(options.sessionMaxAge === undefined ? {} : { maxAge: options.sessionMaxAge }),
		},
		...(options.sessionMaxAge === undefined ? {} : { jwt: { maxAge: options.sessionMaxAge } }),
		providers: [
			credentialsProvider({
				name: 'Contract credentials',
				credentials: {
					username: { label: 'Username', type: 'text' },
					password: { label: 'Password', type: 'password' },
				},
				async authorize(credentials) {
					if (credentials?.username !== validCredentials.username || credentials.password !== validCredentials.password) {
						return null;
					}
					return contractUser;
				},
			}),
		],
		callbacks: {
			async jwt({ token, user }) {
				if (user?.id) token.sub = user.id;
				return token;
			},
			async session({ session, token }) {
				if (session.user) session.user.id = token.sub ?? '';
				return session;
			},
		},
	};
}

function requestHeaders(cookies: CookieJar, additionalHeaders: HeadersInit = {}): Headers {
	const headers = new Headers(additionalHeaders);
	if (cookies.size > 0) {
		headers.set('cookie', [...cookies].map(([name, value]) => `${name}=${value}`).join('; '));
	}
	return headers;
}

function applySetCookies(cookies: CookieJar, responseHeaders: Headers): string[] {
	const setCookies = responseHeaders.getSetCookie();
	for (const setCookie of setCookies) {
		const attributeSeparator = setCookie.indexOf(';');
		const pair = attributeSeparator < 0 ? setCookie : setCookie.slice(0, attributeSeparator);
		const separator = pair.indexOf('=');
		if (separator < 0) continue;
		const name = pair.slice(0, separator);
		const value = pair.slice(separator + 1);
		if (value === '' || /;\s*Max-Age=0(?:;|$)/i.test(setCookie)) cookies.delete(name);
		else cookies.set(name, value);
	}
	return setCookies;
}

function getCookieAttribute(setCookie: string, name: string): string | undefined {
	const prefix = `${name.toLowerCase()}=`;
	return setCookie
		.split(';')
		.map((part) => part.trim())
		.find((part) => part.toLowerCase().startsWith(prefix))
		?.slice(prefix.length);
}

function getSessionSetCookie(headers: Headers): string | undefined {
	return headers.getSetCookie().find((cookie) => cookie.startsWith('next-auth.session-token='));
}

async function loadCsrfToken(bridge: NextAuthBridge, cookies: CookieJar, callbackUrl = '/protected'): Promise<string> {
	const response = await bridge.handle(
		new Request(`${origin}/api/auth/csrf?callbackUrl=${encodeURIComponent(callbackUrl)}`, {
			headers: requestHeaders(cookies),
		}),
	);
	expect(response.status).toBe(200);
	applySetCookies(cookies, response.headers);
	const payload = (await response.json()) as { csrfToken?: unknown };
	expect(payload.csrfToken).toEqual(expect.any(String));
	return payload.csrfToken as string;
}

async function submitCredentials(
	bridge: NextAuthBridge,
	cookies: CookieJar,
	credentials: { password: string; username: string },
	callbackUrl = '/protected',
): Promise<Response> {
	const csrfToken = await loadCsrfToken(bridge, cookies, callbackUrl);
	const response = await bridge.handle(
		new Request(`${origin}/api/auth/callback/credentials`, {
			body: new URLSearchParams({
				callbackUrl,
				csrfToken,
				password: credentials.password,
				username: credentials.username,
			}),
			headers: requestHeaders(cookies, {
				'content-type': 'application/x-www-form-urlencoded',
			}),
			method: 'POST',
		}),
	);
	applySetCookies(cookies, response.headers);
	return response;
}

async function signIn(bridge: NextAuthBridge, cookies: CookieJar): Promise<Response> {
	return submitCredentials(bridge, cookies, validCredentials);
}

describe('NextAuth compatibility capsule', () => {
	beforeEach(() => {
		process.env.NEXTAUTH_URL = origin;
	});

	afterEach(() => {
		if (originalNextAuthUrl === undefined) delete process.env.NEXTAUTH_URL;
		else process.env.NEXTAUTH_URL = originalNextAuthUrl;
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it('is contract-tested against the pinned next-auth version', () => {
		expect(nextAuthPackage.version).toBe('4.24.15');
	});

	it('adapts a Fetch request and preserves multiple Set-Cookie headers', async () => {
		const request = new Request(`${origin}/api/auth/csrf?callbackUrl=%2F`, {
			headers: { cookie: 'existing=value' },
		});

		const response = await createNextAuthBridge(contractOptions()).handle(request);

		expect(response.status).toBe(200);
		expect(response.headers.getSetCookie()).toHaveLength(2);
		expect(await response.json()).toMatchObject({ csrfToken: expect.any(String) });
		expect(request.url).toBe('http://localhost:3000/api/auth/csrf?callbackUrl=%2F');
	});

	it('rejects oversized endpoint bodies before buffering them', async () => {
		const request = new Request('http://localhost:3000/api/auth/callback/credentials', {
			body: `username=${'a'.repeat(33 * 1024)}`,
			headers: { 'content-type': 'application/x-www-form-urlencoded' },
			method: 'POST',
		});

		const response = await createNextAuthBridge(contractOptions()).handle(request);

		expect(response.status).toBe(413);
		expect(await response.json()).toEqual({ error: 'request_too_large' });
	});

	it('returns a client error for malformed JSON bodies', async () => {
		const request = new Request('http://localhost:3000/api/auth/callback/credentials', {
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

		const response = await signIn(bridge, cookies);

		expect(response.status).toBe(302);
		expect(response.headers.get('location')).toBe(`${origin}/protected`);
		expect(getSessionSetCookie(response.headers)).toMatch(/^next-auth\.session-token=.+;\s*Path=\//);
		expect(cookies.get('next-auth.session-token')).toEqual(expect.any(String));
	});

	it('retrieves the authenticated session from the issued cookie', async () => {
		const bridge = createNextAuthBridge(contractOptions());
		const cookies: CookieJar = new Map();
		await signIn(bridge, cookies);

		const { session } = await bridge.loadSession(
			new Request(`${origin}/protected`, {
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
		await signIn(bridge, cookies);
		const initialSessionCookie = cookies.get('next-auth.session-token');
		vi.setSystemTime(new Date('2026-07-26T12:00:30.000Z'));

		const { headers, session } = await bridge.loadSession(
			new Request(`${origin}/protected`, {
				headers: requestHeaders(cookies),
			}),
		);

		const refreshedSetCookie = getSessionSetCookie(headers);
		expect(refreshedSetCookie).toEqual(expect.any(String));
		expect(getCookieAttribute(refreshedSetCookie!, 'Expires')).toBe('Sun, 26 Jul 2026 12:01:30 GMT');
		expect(session?.expires).toBe('2026-07-26T12:01:30.000Z');
		applySetCookies(cookies, headers);
		expect(cookies.get('next-auth.session-token')).not.toBe(initialSessionCookie);

		const { session: propagatedSession } = await bridge.loadSession(
			new Request(`${origin}/protected`, {
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
		expect(response.headers.get('location')).toBe(`${origin}/api/auth/error?error=CredentialsSignin&provider=credentials`);
		expect(getSessionSetCookie(response.headers)).toBeUndefined();
		expect(cookies.has('next-auth.session-token')).toBe(false);
		const { session } = await bridge.loadSession(
			new Request(`${origin}/protected`, {
				headers: requestHeaders(cookies),
			}),
		);
		expect(session).toBeNull();
	});

	it('signs out and clears the authenticated session cookie', async () => {
		const bridge = createNextAuthBridge(contractOptions());
		const cookies: CookieJar = new Map();
		await signIn(bridge, cookies);
		const csrfToken = await loadCsrfToken(bridge, cookies, '/');

		const response = await bridge.handle(
			new Request(`${origin}/api/auth/signout`, {
				body: new URLSearchParams({
					callbackUrl: '/',
					csrfToken,
				}),
				headers: requestHeaders(cookies, {
					'content-type': 'application/x-www-form-urlencoded',
				}),
				method: 'POST',
			}),
		);

		const clearedSessionCookie = getSessionSetCookie(response.headers);
		expect(response.status).toBe(302);
		expect(response.headers.get('location')).toBe(`${origin}/`);
		expect(clearedSessionCookie).toContain('next-auth.session-token=');
		expect(getCookieAttribute(clearedSessionCookie!, 'Max-Age')).toBe('0');
		applySetCookies(cookies, response.headers);
		expect(cookies.has('next-auth.session-token')).toBe(false);
		const { session } = await bridge.loadSession(
			new Request(`${origin}/protected`, {
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
		await signIn(bridge, cookies);
		vi.setSystemTime(new Date('2026-07-26T12:01:16.000Z'));
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

		const { headers, session } = await bridge.loadSession(
			new Request(`${origin}/protected`, {
				headers: requestHeaders(cookies),
			}),
		);

		expect(session).toBeNull();
		const clearedSessionCookie = getSessionSetCookie(headers);
		expect(clearedSessionCookie).toContain('next-auth.session-token=');
		expect(getCookieAttribute(clearedSessionCookie!, 'Max-Age')).toBe('0');
		expect(consoleError).toHaveBeenCalled();
	});
});
