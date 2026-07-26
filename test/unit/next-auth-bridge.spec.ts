import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import type { AuthOptions } from 'next-auth';
import { describe, expect, it } from 'vitest';
import { createNextAuthBridge } from '../../workers/app/compat/next-auth-bridge';
import { credentialsProvider } from '../../workers/app/compat/next-auth-interop';

const require = createRequire(import.meta.url);
const nextAuthEntry = require.resolve('next-auth');
const nextAuthPackage = JSON.parse(readFileSync(join(dirname(nextAuthEntry), 'package.json'), 'utf8')) as {
	version: string;
};

function contractOptions(): AuthOptions {
	return {
		secret: 'contract-test-secret-at-least-32-bytes',
		useSecureCookies: false,
		session: { strategy: 'jwt' },
		providers: [
			credentialsProvider({
				name: 'Contract credentials',
				credentials: {
					username: { label: 'Username', type: 'text' },
					password: { label: 'Password', type: 'password' },
				},
				async authorize() {
					return null;
				},
			}),
		],
	};
}

describe('NextAuth compatibility capsule', () => {
	it('is contract-tested against the pinned next-auth version', () => {
		expect(nextAuthPackage.version).toBe('4.24.15');
	});

	it('adapts a Fetch request and preserves multiple Set-Cookie headers', async () => {
		process.env.NEXTAUTH_URL = 'http://localhost:3000';
		const request = new Request('http://localhost:3000/api/auth/csrf?callbackUrl=%2F', {
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
});
