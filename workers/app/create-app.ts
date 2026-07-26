import { createRequestHandler, RouterContextProvider, type ServerBuild } from 'react-router';
import { appContext, authContext, demoCredentialsContext, sessionContext, statsigContext, type AppMetadata } from '../../app/context';
import { createAuthService } from './auth';
import { finalizeAppResponse } from './response';
import { StatsigService } from './statsig-client';

const handleReactRouterRequest = createRequestHandler(
	() => import('virtual:react-router/server-build') as Promise<ServerBuild>,
	import.meta.env.MODE,
);

function errorResponse(error: unknown, appVersion: string): Response {
	console.error(
		JSON.stringify({
			event: 'app_request_error',
			message: error instanceof Error ? error.message : 'Unknown error',
		}),
	);
	return finalizeAppResponse(Response.json({ error: 'internal_server_error' }, { status: 500 }), appVersion);
}

export function createApp(env: Env): ExportedHandler<Env> {
	const auth = createAuthService(env);
	const statsig = new StatsigService({
		applicationId: env.APP_ID,
		environment: env.APP_ENVIRONMENT,
		hmacSecret: env.USER_CACHE_HMAC_SECRET,
		service: env.STATSIG_SERVICE,
	});
	const metadata: AppMetadata = {
		applicationId: env.APP_ID,
		environment: env.APP_ENVIRONMENT,
		version: env.APP_VERSION,
		statsigClientKey: env.STATSIG_CLIENT_KEY,
	};

	return {
		async fetch(request) {
			try {
				const url = new URL(request.url);
				if (url.pathname === '/health') {
					return finalizeAppResponse(
						Response.json({
							ok: true,
							server: 'react-router-fetch',
							runtime: 'cloudflare-workers',
							appVersion: env.APP_VERSION,
						}),
						env.APP_VERSION,
					);
				}

				if (url.pathname === '/api/auth' || url.pathname.startsWith('/api/auth/')) {
					return finalizeAppResponse(await auth.handle(request), env.APP_VERSION);
				}

				const { headers: loadedSessionHeaders, session } = await auth.loadSession(request);
				const sessionHeaders = url.pathname === '/auth/signin' ? new Headers() : loadedSessionHeaders;
				const assignment = session?.user?.id
					? await statsig.loadAssignment({
							id: session.user.id,
							email: session.user.email,
						})
					: null;
				const context = new RouterContextProvider();
				context.set(appContext, metadata);
				context.set(authContext, auth);
				context.set(demoCredentialsContext, {
					username: env.DEMO_USERNAME,
					password: env.DEMO_PASSWORD_DISPLAY,
				});
				context.set(sessionContext, session);
				context.set(statsigContext, assignment);
				const response = await handleReactRouterRequest(request, context);
				return finalizeAppResponse(response, env.APP_VERSION, sessionHeaders);
			} catch (error) {
				return errorResponse(error, env.APP_VERSION);
			}
		},
	};
}
