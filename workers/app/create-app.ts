import { createRequestHandler } from '@react-router/express';
import express, { type ErrorRequestHandler } from 'express';
import { RouterContextProvider, type ServerBuild } from 'react-router';
import { appContext, sessionContext, statsigContext, type AppMetadata } from '../../app/context';
import { createAuthService } from './auth';
import { bufferReactRouterResponses } from './compat/react-router-response';
import { createRequestContextMiddleware } from './request-context';
import { StatsigService } from './statsig-client';

export function createApp(env: Env): express.Express {
	const app = express();
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

	app.disable('x-powered-by');
	app.set('trust proxy', true);
	app.use((_request, response, next) => {
		response.setHeader('Cache-Control', 'private, no-store');
		response.setHeader('X-App-Version', env.APP_VERSION);
		next();
	});

	app.get('/health', (_request, response) => {
		response.json({
			ok: true,
			server: 'express',
			runtime: 'cloudflare-workers',
			appVersion: env.APP_VERSION,
		});
	});

	app.use('/api/auth', express.urlencoded({ extended: false, limit: '32kb' }), express.json({ limit: '32kb' }));
	app.all('/api/auth/*', auth.endpointHandler);
	app.use(createRequestContextMiddleware(auth, statsig));
	app.use(
		bufferReactRouterResponses(
			createRequestHandler({
				build: () => import('virtual:react-router/server-build') as Promise<ServerBuild>,
				getLoadContext(_request, response) {
					const context = new RouterContextProvider();
					context.set(appContext, metadata);
					context.set(sessionContext, response.locals.session);
					context.set(statsigContext, response.locals.statsig);
					return context;
				},
			}),
		),
	);

	const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
		console.error(
			JSON.stringify({
				event: 'app_request_error',
				message: error instanceof Error ? error.message : 'Unknown error',
			}),
		);
		if (!response.headersSent) response.status(500).json({ error: 'internal_server_error' });
	};
	app.use(errorHandler);
	return app;
}
