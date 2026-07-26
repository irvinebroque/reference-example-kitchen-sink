import { createRequestHandler, type ServerBuild } from 'react-router';
import type { AppMetadata } from '../../app/context';
import { createAppHandler } from './app-handler';
import { createAuthService } from './auth';

const handleReactRouterRequest = createRequestHandler(
	() => import('virtual:react-router/server-build') as Promise<ServerBuild>,
	import.meta.env.MODE,
);

export function createApp(env: Env): ExportedHandler<Env> {
	const auth = createAuthService(env);
	const metadata: AppMetadata = {
		applicationId: env.APP_ID,
		environment: env.APP_ENVIRONMENT,
		version: env.APP_VERSION,
	};
	const handleRequest = createAppHandler({
		app: metadata,
		appVersion: env.APP_VERSION,
		auth,
		demoCredentials: {
			username: env.DEMO_USERNAME,
			password: env.DEMO_PASSWORD_DISPLAY,
		},
		featureService: env.FEATURE_SERVICE,
		handleRouterRequest: handleReactRouterRequest,
	});

	return {
		fetch(request) {
			return handleRequest(request);
		},
	};
}
