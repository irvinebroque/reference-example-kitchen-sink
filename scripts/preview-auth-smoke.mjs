const DEFAULT_ATTEMPTS = 5;
const DEFAULT_TIMEOUT_MS = 10_000;
const INVALID_USERNAME = 'preview-smoke-invalid-user';
const INVALID_PASSWORD = 'preview-smoke-invalid-password';
const FOREIGN_CALLBACK_URL = 'https://attacker.invalid/preview-auth-smoke';
const SESSION_COOKIE_NAME = /^__Secure-next-auth\.session-token$/;

function fail(message) {
	throw new Error(`Preview authentication smoke test failed: ${message}`);
}

function normalizePositiveInteger(value, fallback, name) {
	if (value === undefined || value === '') return fallback;
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed <= 0) fail(`${name} must be a positive integer`);
	return parsed;
}

function targetOrigin(targetUrl) {
	let url;
	try {
		url = new URL(targetUrl);
	} catch {
		fail('target must be an absolute URL');
	}
	if (url.protocol !== 'https:') fail('target must use HTTPS');
	if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
		fail('target must contain only an HTTPS origin');
	}
	return url.origin;
}

export function getSetCookies(headers) {
	if (typeof headers.getSetCookie !== 'function') fail('runtime does not support Headers.getSetCookie()');
	return headers.getSetCookie();
}

function parseSetCookie(setCookie) {
	const parts = setCookie.split(';').map((part) => part.trim());
	const separator = parts[0].indexOf('=');
	if (separator < 1) fail('received a malformed Set-Cookie header');
	const attributes = new Map();
	for (const attribute of parts.slice(1)) {
		const attributeSeparator = attribute.indexOf('=');
		const name = (attributeSeparator < 0 ? attribute : attribute.slice(0, attributeSeparator)).toLowerCase();
		const value = attributeSeparator < 0 ? true : attribute.slice(attributeSeparator + 1);
		attributes.set(name, value);
	}
	return {
		attributes,
		name: parts[0].slice(0, separator),
		value: parts[0].slice(separator + 1),
	};
}

export class CookieJar {
	#cookies = new Map();

	absorb(headers) {
		for (const setCookie of getSetCookies(headers)) {
			const cookie = parseSetCookie(setCookie);
			if (cookie.value === '' || cookie.attributes.get('max-age') === '0') this.#cookies.delete(cookie.name);
			else this.#cookies.set(cookie.name, cookie.value);
		}
	}

	header() {
		return [...this.#cookies].map(([name, value]) => `${name}=${value}`).join('; ');
	}

	has(name) {
		return this.#cookies.has(name);
	}
}

function cookieHeaders(jar, additionalHeaders = {}) {
	const headers = new Headers(additionalHeaders);
	const cookie = jar.header();
	if (cookie) headers.set('cookie', cookie);
	return headers;
}

function assertStatus(response, expected, label) {
	if (response.status !== expected) fail(`${label} returned an unexpected status`);
}

async function readJsonObject(response, label) {
	let value;
	try {
		value = await response.json();
	} catch {
		fail(`${label} returned malformed JSON`);
	}
	if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(`${label} returned malformed JSON`);
	return value;
}

function assertPrivateVersioned(response, label) {
	if (response.headers.get('cache-control') !== 'private, no-store') fail(`${label} is not private and non-cacheable`);
	if (!response.headers.get('x-app-version')) fail(`${label} is missing X-App-Version`);
}

export function assertSameOriginRedirect(response, origin, label) {
	if (response.status < 300 || response.status >= 400) fail(`${label} did not return a redirect`);
	const location = response.headers.get('location');
	if (!location) fail(`${label} omitted its redirect location`);
	let redirect;
	try {
		redirect = new URL(location, origin);
	} catch {
		fail(`${label} returned a malformed redirect`);
	}
	if (redirect.origin !== origin) fail(`${label} attempted a cross-origin redirect`);
	return redirect;
}

function assertSecureCookie(cookie, expectedName) {
	if (cookie.name !== expectedName) fail('secure CSRF response returned an unexpected cookie');
	if (!cookie.attributes.has('secure')) fail(`${expectedName} is missing Secure`);
	if (!cookie.attributes.has('httponly')) fail(`${expectedName} is missing HttpOnly`);
	if (String(cookie.attributes.get('samesite')).toLowerCase() !== 'lax') fail(`${expectedName} is missing SameSite=Lax`);
	if (cookie.attributes.get('path') !== '/') fail(`${expectedName} is missing Path=/`);
}

async function request(fetchImplementation, url, options, timeoutMs) {
	return fetchImplementation(url, {
		...options,
		signal: options?.signal ?? AbortSignal.timeout(timeoutMs),
	});
}

export async function waitForReadiness({
	attempts = DEFAULT_ATTEMPTS,
	fetchImplementation = fetch,
	origin,
	sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
	timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
	let delay = 250;
	for (let attempt = 1; attempt <= attempts; attempt += 1) {
		try {
			const response = await request(fetchImplementation, new URL('/health', origin), { redirect: 'manual' }, timeoutMs);
			if (response.status === 200) {
				const payload = await readJsonObject(response, 'readiness endpoint');
				if (payload.ok === true) {
					assertPrivateVersioned(response, 'readiness endpoint');
					return;
				}
			}
		} catch {
			// Retry readiness failures without including response or network details.
		}
		if (attempt < attempts) {
			await sleep(delay);
			delay = Math.min(delay * 2, 2_000);
		}
	}
	fail('readiness did not succeed within the configured attempts');
}

async function loadCsrf(fetchImplementation, origin, jar, timeoutMs, callbackUrl) {
	const url = new URL('/api/auth/csrf', origin);
	url.searchParams.set('callbackUrl', callbackUrl);
	const response = await request(
		fetchImplementation,
		url,
		{ headers: cookieHeaders(jar), redirect: 'manual' },
		timeoutMs,
	);
	assertStatus(response, 200, 'CSRF endpoint');
	const setCookies = getSetCookies(response.headers);
	jar.absorb(response.headers);
	const payload = await readJsonObject(response, 'CSRF endpoint');
	if (typeof payload.csrfToken !== 'string' || payload.csrfToken.length === 0) {
		fail('CSRF endpoint omitted its token');
	}
	return { csrfToken: payload.csrfToken, setCookies };
}

export async function runPreviewAuthSmoke({
	attempts = DEFAULT_ATTEMPTS,
	fetchImplementation = fetch,
	sleep,
	targetUrl,
	timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
	const origin = targetOrigin(targetUrl);
	await waitForReadiness({ attempts, fetchImplementation, origin, sleep, timeoutMs });

	const providersResponse = await request(
		fetchImplementation,
		new URL('/api/auth/providers', origin),
		{ redirect: 'manual' },
		timeoutMs,
	);
	assertStatus(providersResponse, 200, 'providers endpoint');
	const providers = await readJsonObject(providersResponse, 'providers endpoint');
	const credentials = providers.credentials;
	if (credentials === null || typeof credentials !== 'object' || Array.isArray(credentials)) {
		fail('providers endpoint omitted the credentials provider');
	}
	if (credentials.signinUrl !== `${origin}/api/auth/signin/credentials`) {
		fail('credentials sign-in URL does not use the tested origin');
	}
	if (credentials.callbackUrl !== `${origin}/api/auth/callback/credentials`) {
		fail('credentials callback URL does not use the tested origin');
	}

	const credentialsJar = new CookieJar();
	const { csrfToken, setCookies: csrfSetCookies } = await loadCsrf(
		fetchImplementation,
		origin,
		credentialsJar,
		timeoutMs,
		'/protected',
	);
	if (csrfSetCookies.length !== 2) fail('CSRF endpoint did not return exactly two cookies');
	const parsedCsrfCookies = csrfSetCookies.map(parseSetCookie);
	if (new Set(parsedCsrfCookies.map((cookie) => cookie.name)).size !== 2) {
		fail('CSRF endpoint returned duplicate cookie names');
	}
	const csrfCookie = parsedCsrfCookies.find((cookie) => cookie.name === '__Host-next-auth.csrf-token');
	const callbackCookie = parsedCsrfCookies.find((cookie) => cookie.name === '__Secure-next-auth.callback-url');
	if (!csrfCookie || !callbackCookie) fail('CSRF endpoint did not use secure NextAuth cookie names');
	assertSecureCookie(csrfCookie, '__Host-next-auth.csrf-token');
	assertSecureCookie(callbackCookie, '__Secure-next-auth.callback-url');
	let callbackUrl;
	try {
		callbackUrl = new URL(decodeURIComponent(callbackCookie.value));
	} catch {
		fail('callback cookie contains a malformed URL');
	}
	if (callbackUrl.origin !== origin) fail('callback cookie does not use the tested origin');

	const invalidCredentialsResponse = await request(
		fetchImplementation,
		new URL('/api/auth/callback/credentials', origin),
		{
			body: new URLSearchParams({
				callbackUrl: FOREIGN_CALLBACK_URL,
				csrfToken,
				password: INVALID_PASSWORD,
				username: INVALID_USERNAME,
			}),
			headers: cookieHeaders(credentialsJar, {
				'content-type': 'application/x-www-form-urlencoded',
			}),
			method: 'POST',
			redirect: 'manual',
		},
		timeoutMs,
	);
	assertSameOriginRedirect(invalidCredentialsResponse, origin, 'invalid credentials callback');
	if (getSetCookies(invalidCredentialsResponse.headers).some((value) => SESSION_COOKIE_NAME.test(parseSetCookie(value).name))) {
		fail('invalid credentials issued a session cookie');
	}

	const signOutJar = new CookieJar();
	const { csrfToken: signOutCsrfToken } = await loadCsrf(
		fetchImplementation,
		origin,
		signOutJar,
		timeoutMs,
		'/',
	);
	const signOutResponse = await request(
		fetchImplementation,
		new URL('/api/auth/signout', origin),
		{
			body: new URLSearchParams({
				callbackUrl: FOREIGN_CALLBACK_URL,
				csrfToken: signOutCsrfToken,
			}),
			headers: cookieHeaders(signOutJar, {
				'content-type': 'application/x-www-form-urlencoded',
			}),
			method: 'POST',
			redirect: 'manual',
		},
		timeoutMs,
	);
	assertSameOriginRedirect(signOutResponse, origin, 'anonymous sign-out');
	const clearedSessionCookie = getSetCookies(signOutResponse.headers)
		.map(parseSetCookie)
		.find((cookie) => SESSION_COOKIE_NAME.test(cookie.name));
	if (!clearedSessionCookie) fail('anonymous sign-out did not clear the secure session cookie');
	if (clearedSessionCookie.attributes.get('max-age') !== '0') {
		fail('anonymous sign-out session cookie is missing Max-Age=0');
	}
	if (!clearedSessionCookie.attributes.has('secure')) {
		fail('anonymous sign-out session cookie is missing Secure');
	}
}

export function smokeConfiguration(environment = process.env) {
	return {
		attempts: normalizePositiveInteger(environment.SMOKE_ATTEMPTS, DEFAULT_ATTEMPTS, 'SMOKE_ATTEMPTS'),
		timeoutMs: normalizePositiveInteger(environment.SMOKE_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 'SMOKE_TIMEOUT_MS'),
	};
}
