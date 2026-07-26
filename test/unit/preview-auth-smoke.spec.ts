import { describe, expect, it, vi } from 'vitest';
import {
	assertSameOriginRedirect,
	CookieJar,
	getSetCookies,
	runPreviewAuthSmoke,
	waitForReadiness,
} from '../../scripts/preview-auth-smoke.mjs';

const origin = 'https://preview.example.test';

function response(body: BodyInit | null, init: ResponseInit & { setCookies?: string[] } = {}): Response {
	const headers = new Headers(init.headers);
	for (const setCookie of init.setCookies ?? []) headers.append('Set-Cookie', setCookie);
	return new Response(body, { ...init, headers });
}

function jsonResponse(value: unknown, init: ResponseInit & { setCookies?: string[] } = {}): Response {
	const headers = new Headers(init.headers);
	headers.set('content-type', 'application/json');
	return response(JSON.stringify(value), { ...init, headers });
}

const csrfCookies = [
	'__Host-next-auth.csrf-token=csrf%7Chash; Path=/; HttpOnly; Secure; SameSite=Lax',
	`__Secure-next-auth.callback-url=${encodeURIComponent(`${origin}/protected`)}; Path=/; HttpOnly; Secure; SameSite=Lax`,
];

function successfulFetch(options: { invalidLocation?: string; onInvalidBody?: (body: URLSearchParams) => void } = {}): typeof fetch {
	return vi.fn<typeof fetch>(async (input, init) => {
		const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
		if (url.pathname === '/health') {
			return jsonResponse(
				{ ok: true },
				{
					headers: {
						'cache-control': 'private, no-store',
						'x-app-version': 'test-version',
					},
					status: 200,
				},
			);
		}
		if (url.pathname === '/api/auth/providers') {
			return jsonResponse(
				{
					credentials: {
						callbackUrl: `${origin}/api/auth/callback/credentials`,
						signinUrl: `${origin}/api/auth/signin/credentials`,
					},
				},
				{ status: 200 },
			);
		}
		if (url.pathname === '/api/auth/csrf') {
			return jsonResponse(
				{ csrfToken: 'csrf-token' },
				{
					setCookies: csrfCookies,
					status: 200,
				},
			);
		}
		if (url.pathname === '/api/auth/callback/credentials') {
			const body = init?.body as URLSearchParams;
			options.onInvalidBody?.(body);
			return response(null, {
				headers: {
					location: options.invalidLocation ?? `${origin}/api/auth/error?error=CredentialsSignin`,
				},
				status: 302,
			});
		}
		if (url.pathname === '/api/auth/signout') {
			return response(null, {
				headers: { location: `${origin}/` },
				setCookies: [
					'__Secure-next-auth.session-token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0; HttpOnly; Secure; SameSite=Lax',
				],
				status: 302,
			});
		}
		throw new Error(`Unexpected test URL: ${url.pathname}`);
	});
}

describe('Preview authentication smoke test', () => {
	it('stores multiple cookies and removes cleared cookies', () => {
		const jar = new CookieJar();
		const headers = new Headers();
		headers.append('Set-Cookie', 'first=one; Path=/; HttpOnly');
		headers.append('Set-Cookie', 'second=two; Path=/; HttpOnly');

		jar.absorb(headers);

		expect(jar.header()).toBe('first=one; second=two');
		expect(jar.has('first')).toBe(true);
		const clearingHeaders = new Headers();
		clearingHeaders.append('Set-Cookie', 'first=; Path=/; Max-Age=0');
		jar.absorb(clearingHeaders);
		expect(jar.header()).toBe('second=two');
	});

	it('reads repeated Set-Cookie headers as distinct values', () => {
		const headers = new Headers();
		headers.append('Set-Cookie', 'first=one; Path=/');
		headers.append('Set-Cookie', 'second=two; Path=/');

		expect(getSetCookies(headers)).toEqual(['first=one; Path=/', 'second=two; Path=/']);
	});

	it('rejects cross-origin redirects without echoing the foreign location', () => {
		const redirect = response(null, {
			headers: { location: 'https://foreign.example/secret-path' },
			status: 302,
		});

		expect(() => assertSameOriginRedirect(redirect, origin, 'test redirect')).toThrow('cross-origin redirect');
		expect(() => assertSameOriginRedirect(redirect, origin, 'test redirect')).not.toThrow('foreign.example');
	});

	it('retries readiness with bounded exponential backoff', async () => {
		const responses = [
			response(null, { status: 503 }),
			response(null, { status: 503 }),
			jsonResponse(
				{ ok: true },
				{
					headers: {
						'cache-control': 'private, no-store',
						'x-app-version': 'test-version',
					},
					status: 200,
				},
			),
		];
		const fetchImplementation = vi.fn<typeof fetch>(async () => responses.shift()!);
		const sleep = vi.fn(async () => undefined);

		await waitForReadiness({
			attempts: 3,
			fetchImplementation,
			origin,
			sleep,
			timeoutMs: 100,
		});

		expect(fetchImplementation).toHaveBeenCalledTimes(3);
		expect(sleep).toHaveBeenNthCalledWith(1, 250);
		expect(sleep).toHaveBeenNthCalledWith(2, 500);
	});

	it('rejects missing provider response data', async () => {
		const fetchImplementation = vi.fn<typeof fetch>(async (input) => {
			const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
			if (url.pathname === '/health') {
				return jsonResponse(
					{ ok: true },
					{
						headers: {
							'cache-control': 'private, no-store',
							'x-app-version': 'test-version',
						},
						status: 200,
					},
				);
			}
			return jsonResponse({ credentials: { signinUrl: 42 } }, { status: 200 });
		});

		await expect(
			runPreviewAuthSmoke({
				fetchImplementation,
				targetUrl: origin,
				timeoutMs: 100,
			}),
		).rejects.toThrow('credentials sign-in URL');
	});

	it('completes the deployed authentication flow without valid credentials', async () => {
		await expect(
			runPreviewAuthSmoke({
				fetchImplementation: successfulFetch(),
				targetUrl: origin,
				timeoutMs: 100,
			}),
		).resolves.toBeUndefined();
	});

	it('never includes submitted secret values in failures', async () => {
		const submittedSecrets: string[] = [];
		const fetchImplementation = successfulFetch({
			invalidLocation: 'https://foreign.example/failure',
			onInvalidBody(body) {
				submittedSecrets.push(body.get('username')!, body.get('password')!);
			},
		});

		let error: unknown;
		try {
			await runPreviewAuthSmoke({
				fetchImplementation,
				targetUrl: origin,
				timeoutMs: 100,
			});
		} catch (caught) {
			error = caught;
		}

		expect(error).toBeInstanceOf(Error);
		for (const secret of submittedSecrets) expect((error as Error).message).not.toContain(secret);
		expect((error as Error).message).not.toContain('foreign.example');
	});
});
