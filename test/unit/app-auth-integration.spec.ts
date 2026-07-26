import type { RouterContextProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { requestContext } from '../../app/context';
import {
	applySetCookies,
	contractOptions,
	contractOrigin,
	contractUser,
	getCookieAttribute,
	getSessionSetCookie,
	requestHeaders,
	signOut,
	submitCredentials,
	type AuthEndpoint,
	type CookieJar,
} from '../helpers/next-auth-flow';
import { createAppHandler } from '../../workers/app/app-handler';
import { createNextAuthBridge, type NextAuthBridge } from '../../workers/app/compat/next-auth-bridge';

const appVersion = 'app-auth-test-version';

function createFeatureServiceStub(): Service {
	return {
		connect() {
			throw new Error('Feature service connect was not expected');
		},
		fetch() {
			throw new Error('Feature service fetch was not expected');
		},
	};
}

function createTestApp(auth: NextAuthBridge): {
	authEndpoint: AuthEndpoint;
	handleRequest(request: Request): Promise<Response>;
	routerHandler: ReturnType<typeof vi.fn<(request: Request, context: RouterContextProvider) => Promise<Response>>>;
} {
	const routerHandler = vi.fn(async (_request: Request, context: RouterContextProvider) => {
		const session = context.get(requestContext).session;
		return Response.json({ session });
	});
	const handleRequest = createAppHandler({
		app: {
			applicationId: 'contract-app',
			environment: 'test',
			version: appVersion,
		},
		appVersion,
		auth,
		demoCredentials: {
			username: 'demo',
			password: 'display-only',
		},
		featureService: createFeatureServiceStub(),
		handleRouterRequest: routerHandler,
	});
	return {
		authEndpoint: { handle: handleRequest },
		handleRequest,
		routerHandler,
	};
}

describe('application authentication response propagation', () => {
	it('finalizes auth endpoint responses without collapsing NextAuth cookies', async () => {
		const { handleRequest } = createTestApp(createNextAuthBridge(contractOptions()));

		const response = await handleRequest(new Request(`${contractOrigin}/api/auth/csrf?callbackUrl=%2Fprotected`));

		expect(response.status).toBe(200);
		expect(response.headers.getSetCookie()).toHaveLength(2);
		expect(response.headers.get('cache-control')).toBe('private, no-store');
		expect(response.headers.get('x-app-version')).toBe(appVersion);
		expect(await response.json()).toMatchObject({ csrfToken: expect.any(String) });
	});

	it('propagates refreshed session cookies through the final route response', async () => {
		const auth = createNextAuthBridge(contractOptions());
		const { authEndpoint, handleRequest } = createTestApp(auth);
		const cookies: CookieJar = new Map();
		await submitCredentials(authEndpoint, cookies);

		const response = await handleRequest(
			new Request(`${contractOrigin}/protected`, {
				headers: requestHeaders(cookies),
			}),
		);

		const refreshedSessionCookie = getSessionSetCookie(response.headers);
		expect(response.status).toBe(200);
		expect(refreshedSessionCookie).toEqual(expect.any(String));
		expect(await response.json()).toMatchObject({ session: { user: contractUser } });
		applySetCookies(cookies, response.headers);

		const { session } = await auth.loadSession(
			new Request(`${contractOrigin}/protected`, {
				headers: requestHeaders(cookies),
			}),
		);
		expect(session?.user).toMatchObject(contractUser);
	});

	it('deliberately omits loaded session headers from the sign-in page response', async () => {
		const auth = createNextAuthBridge(contractOptions());
		const { authEndpoint, handleRequest, routerHandler } = createTestApp(auth);
		const cookies: CookieJar = new Map();
		await submitCredentials(authEndpoint, cookies);

		const response = await handleRequest(
			new Request(`${contractOrigin}/auth/signin`, {
				headers: requestHeaders(cookies),
			}),
		);

		expect(response.status).toBe(200);
		expect(response.headers.getSetCookie()).toEqual([]);
		expect(await response.json()).toMatchObject({ session: { user: contractUser } });
		expect(routerHandler).toHaveBeenCalledOnce();
	});

	it('propagates the session-clearing cookie through the final sign-out response', async () => {
		const auth = createNextAuthBridge(contractOptions());
		const { authEndpoint } = createTestApp(auth);
		const cookies: CookieJar = new Map();
		await submitCredentials(authEndpoint, cookies);

		const response = await signOut(authEndpoint, cookies);

		const clearedSessionCookie = getSessionSetCookie(response.headers);
		expect(response.status).toBe(302);
		expect(response.headers.get('location')).toBe(`${contractOrigin}/`);
		expect(getCookieAttribute(clearedSessionCookie!, 'Max-Age')).toBe('0');
		expect(response.headers.get('cache-control')).toBe('private, no-store');
		expect(response.headers.get('x-app-version')).toBe(appVersion);
		applySetCookies(cookies, response.headers);

		const { session } = await auth.loadSession(
			new Request(`${contractOrigin}/protected`, {
				headers: requestHeaders(cookies),
			}),
		);
		expect(session).toBeNull();
	});
});
