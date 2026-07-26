import type { AuthOptions, User } from 'next-auth';
import type { NextAuthBridge } from '../../workers/app/compat/next-auth-bridge';
import { credentialsProvider } from '../../workers/app/compat/next-auth-interop';

export const contractOrigin = 'http://localhost:3000';
export const secureContractOrigin = 'https://auth.example.test';
export const validCredentials = {
	password: 'contract-password',
	username: 'contract-user',
};
export const contractUser: User = {
	email: 'contract-user@example.test',
	id: 'contract-user-id',
	name: 'Contract User',
};

export type CookieJar = Map<string, string>;
export type AuthEndpoint = Pick<NextAuthBridge, 'handle'>;

export interface ContractAuthorizeRequest {
	query: Record<string, string | string[]>;
}

export interface ContractOptions {
	onAuthorizeRequest?(request: ContractAuthorizeRequest): void;
	sessionMaxAge?: number;
	useSecureCookies?: boolean;
}

export function contractOptions(options: ContractOptions = {}): AuthOptions {
	return {
		secret: 'contract-test-secret-at-least-32-bytes',
		useSecureCookies: options.useSecureCookies ?? false,
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
				async authorize(credentials, request) {
					options.onAuthorizeRequest?.({
						query: request.query as Record<string, string | string[]>,
					});
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

export function requestHeaders(cookies: CookieJar, additionalHeaders: HeadersInit = {}): Headers {
	const headers = new Headers(additionalHeaders);
	if (cookies.size > 0) {
		headers.set('cookie', [...cookies].map(([name, value]) => `${name}=${value}`).join('; '));
	}
	return headers;
}

export function applySetCookies(cookies: CookieJar, responseHeaders: Headers): string[] {
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

export function getCookieAttribute(setCookie: string, name: string): string | undefined {
	const prefix = `${name.toLowerCase()}=`;
	return setCookie
		.split(';')
		.map((part) => part.trim())
		.find((part) => part.toLowerCase().startsWith(prefix))
		?.slice(prefix.length);
}

export function getSessionSetCookie(headers: Headers): string | undefined {
	return headers.getSetCookie().find((cookie) => /^(?:__Secure-)?next-auth\.session-token=/.test(cookie));
}

export function getSessionCookie(cookies: CookieJar): [string, string] | undefined {
	return [...cookies].find(([name]) => /^(?:__Secure-)?next-auth\.session-token$/.test(name));
}

export async function loadCsrfToken(
	endpoint: AuthEndpoint,
	cookies: CookieJar,
	callbackUrl: string | null = '/protected',
	origin = contractOrigin,
): Promise<string> {
	const url = new URL('/api/auth/csrf', origin);
	if (callbackUrl !== null) url.searchParams.set('callbackUrl', callbackUrl);
	const response = await endpoint.handle(
		new Request(url, {
			headers: requestHeaders(cookies),
		}),
	);
	if (response.status !== 200) throw new Error(`CSRF request failed with status ${response.status}`);
	applySetCookies(cookies, response.headers);
	const payload = (await response.json()) as { csrfToken?: unknown };
	if (typeof payload.csrfToken !== 'string') throw new TypeError('CSRF response did not contain a token');
	return payload.csrfToken;
}

export async function submitCredentials(
	endpoint: AuthEndpoint,
	cookies: CookieJar,
	credentials = validCredentials,
	callbackUrl = '/protected',
	origin = contractOrigin,
): Promise<Response> {
	const csrfToken = await loadCsrfToken(endpoint, cookies, callbackUrl, origin);
	const response = await endpoint.handle(
		new Request(new URL('/api/auth/callback/credentials', origin), {
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

export async function submitJsonCredentials(
	endpoint: AuthEndpoint,
	cookies: CookieJar,
	credentials = validCredentials,
	callbackUrl = '/protected',
	origin = contractOrigin,
): Promise<Response> {
	const csrfToken = await loadCsrfToken(endpoint, cookies, callbackUrl, origin);
	const response = await endpoint.handle(
		new Request(new URL('/api/auth/callback/credentials', origin), {
			body: JSON.stringify({
				callbackUrl,
				csrfToken,
				password: credentials.password,
				username: credentials.username,
			}),
			headers: requestHeaders(cookies, {
				'content-type': 'application/json',
			}),
			method: 'POST',
		}),
	);
	applySetCookies(cookies, response.headers);
	return response;
}

export async function signOut(
	endpoint: AuthEndpoint,
	cookies: CookieJar,
	callbackUrl: string | null = '/',
	origin = contractOrigin,
): Promise<Response> {
	const csrfToken = await loadCsrfToken(endpoint, cookies, callbackUrl, origin);
	const body = new URLSearchParams({ csrfToken });
	if (callbackUrl !== null) body.set('callbackUrl', callbackUrl);
	return endpoint.handle(
		new Request(new URL('/api/auth/signout', origin), {
			body,
			headers: requestHeaders(cookies, {
				'content-type': 'application/x-www-form-urlencoded',
			}),
			method: 'POST',
		}),
	);
}
