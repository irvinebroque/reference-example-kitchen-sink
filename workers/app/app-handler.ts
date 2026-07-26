import { RouterContextProvider } from 'react-router';
import {
	authContext,
	demoCredentialsContext,
	requestContext,
	type AppMetadata,
	type DemoCredentials,
} from '../../app/context';
import type { NextAuthBridge } from './compat/next-auth-bridge';
import { createFeatureLoader } from './feature-service-client';
import { finalizeAppResponse } from './response';

export interface AppDependencies {
	app: AppMetadata;
	appVersion: string;
	auth: NextAuthBridge;
	demoCredentials: DemoCredentials;
	featureService: Service;
	handleRouterRequest(request: Request, context: RouterContextProvider): Promise<Response>;
}

function errorResponse(error: unknown, appVersion: string): Response {
	console.error(
		JSON.stringify({
			event: 'app_request_error',
			message: error instanceof Error ? error.message : 'Unknown error',
		}),
	);
	return finalizeAppResponse(Response.json({ error: 'internal_server_error' }, { status: 500 }), appVersion);
}

export function createAppHandler(dependencies: AppDependencies): (request: Request) => Promise<Response> {
	return async (request) => {
		try {
			const url = new URL(request.url);
			if (url.pathname === '/health') {
				return finalizeAppResponse(
					Response.json({
						ok: true,
						server: 'react-router-fetch',
						runtime: 'cloudflare-workers',
						appVersion: dependencies.appVersion,
					}),
					dependencies.appVersion,
				);
			}

			if (url.pathname === '/api/auth' || url.pathname.startsWith('/api/auth/')) {
				return finalizeAppResponse(await dependencies.auth.handle(request), dependencies.appVersion);
			}

			const { headers: loadedSessionHeaders, session } = await dependencies.auth.loadSession(request);
			const sessionHeaders = url.pathname === '/auth/signin' ? new Headers() : loadedSessionHeaders;
			const context = new RouterContextProvider();
			context.set(requestContext, {
				app: dependencies.app,
				getFeatures: createFeatureLoader(dependencies.featureService, session?.user),
				session,
			});
			context.set(authContext, dependencies.auth);
			context.set(demoCredentialsContext, dependencies.demoCredentials);
			const response = await dependencies.handleRouterRequest(request, context);
			return finalizeAppResponse(response, dependencies.appVersion, sessionHeaders);
		} catch (error) {
			return errorResponse(error, dependencies.appVersion);
		}
	};
}
