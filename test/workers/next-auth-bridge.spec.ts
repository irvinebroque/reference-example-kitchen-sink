import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import {
	applySetCookies,
	contractOptions,
	contractOrigin,
	contractUser,
	getCookieAttribute,
	getSessionCookie,
	getSessionSetCookie,
	requestHeaders,
	secureContractOrigin,
	signOut,
	submitCredentials,
	type CookieJar,
} from '../helpers/next-auth-flow';
import { createNextAuthBridge } from '../../workers/app/compat/next-auth-bridge';

function bodyWithByteLength(byteLength: number): Uint8Array {
	const prefix = 'padding=';
	const body = new TextEncoder().encode(`${prefix}${'a'.repeat(byteLength - prefix.length)}`);
	expect(body.byteLength).toBe(byteLength);
	return body;
}

describe('NextAuth bridge in the Workers runtime', () => {
	it('imports under nodejs_compat and returns a Workers Response', async () => {
		expect(env.APP_ID).toBe('reference-app');
		const bridge = createNextAuthBridge(contractOptions());

		const response = await bridge.handle(new Request(`${contractOrigin}/api/auth/csrf`));

		expect(response).toBeInstanceOf(Response);
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({ csrfToken: expect.any(String) });
	});

	it('preserves multiple Set-Cookie headers as individual values', async () => {
		const response = await createNextAuthBridge(contractOptions()).handle(
			new Request(`${contractOrigin}/api/auth/csrf?callbackUrl=%2Fprotected`),
		);

		const setCookies = response.headers.getSetCookie();
		expect(response.status).toBe(200);
		expect(setCookies).toHaveLength(2);
		expect(setCookies[0]).not.toContain(', next-auth.');
		expect(setCookies[1]).not.toContain(', next-auth.');
	});

	it('completes credentials, session refresh, and sign-out flows', async () => {
		const bridge = createNextAuthBridge(contractOptions());
		const cookies: CookieJar = new Map();

		const signInResponse = await submitCredentials(bridge, cookies);

		expect(signInResponse.status).toBe(302);
		expect(signInResponse.headers.get('location')).toBe(`${contractOrigin}/protected`);
		expect(getSessionCookie(cookies)?.[1]).toEqual(expect.any(String));

		const loaded = await bridge.loadSession(
			new Request(`${contractOrigin}/protected`, {
				headers: requestHeaders(cookies),
			}),
		);
		expect(loaded.session?.user).toMatchObject(contractUser);
		const refreshedSessionCookie = getSessionSetCookie(loaded.headers);
		expect(refreshedSessionCookie).toEqual(expect.any(String));
		applySetCookies(cookies, loaded.headers);

		const reloaded = await bridge.loadSession(
			new Request(`${contractOrigin}/protected`, {
				headers: requestHeaders(cookies),
			}),
		);
		expect(reloaded.session?.user).toMatchObject(contractUser);

		const signOutResponse = await signOut(bridge, cookies);
		const clearedSessionCookie = getSessionSetCookie(signOutResponse.headers);
		expect(signOutResponse.status).toBe(302);
		expect(getCookieAttribute(clearedSessionCookie!, 'Max-Age')).toBe('0');
		applySetCookies(cookies, signOutResponse.headers);
		expect(getSessionCookie(cookies)).toBeUndefined();

		const signedOut = await bridge.loadSession(
			new Request(`${contractOrigin}/protected`, {
				headers: requestHeaders(cookies),
			}),
		);
		expect(signedOut.session).toBeNull();
	});

	it('uses secure cookie names and attributes for HTTPS production requests', async () => {
		const bridge = createNextAuthBridge(contractOptions({ useSecureCookies: true }));
		const csrfResponse = await bridge.handle(
			new Request(`${secureContractOrigin}/api/auth/csrf?callbackUrl=%2Fprotected`),
		);
		const csrfCookies = csrfResponse.headers.getSetCookie();

		expect(csrfResponse.status).toBe(200);
		expect(csrfCookies).toHaveLength(2);
		expect(csrfCookies).toEqual(
			expect.arrayContaining([
				expect.stringMatching(/^__Host-next-auth\.csrf-token=.*;\s*Path=\/;\s*HttpOnly;\s*Secure;/),
				expect.stringMatching(/^__Secure-next-auth\.callback-url=.*;\s*Path=\/;\s*HttpOnly;\s*Secure;/),
			]),
		);

		const cookies: CookieJar = new Map();
		const signInResponse = await submitCredentials(bridge, cookies, undefined, '/protected', secureContractOrigin);
		const sessionCookie = getSessionSetCookie(signInResponse.headers);
		expect(sessionCookie).toMatch(/^__Secure-next-auth\.session-token=/);
		expect(sessionCookie).toContain('Secure');
		expect(getSessionCookie(cookies)?.[0]).toBe('__Secure-next-auth.session-token');
	});

	it('enforces supported body limits by encoded byte length', async () => {
		const bridge = createNextAuthBridge(contractOptions());
		const boundaryResponse = await bridge.handle(
			new Request(`${contractOrigin}/api/auth/callback/credentials`, {
				body: bodyWithByteLength(32 * 1024),
				headers: { 'content-type': 'application/x-www-form-urlencoded' },
				method: 'POST',
			}),
		);
		const oversizedResponse = await bridge.handle(
			new Request(`${contractOrigin}/api/auth/callback/credentials`, {
				body: bodyWithByteLength(32 * 1024 + 1),
				headers: { 'content-type': 'application/x-www-form-urlencoded' },
				method: 'POST',
			}),
		);

		expect(boundaryResponse.status).not.toBe(413);
		expect(boundaryResponse.status).toBeLessThan(500);
		expect(oversizedResponse.status).toBe(413);
		expect(await oversizedResponse.json()).toEqual({ error: 'request_too_large' });
	});
});
