import { env } from 'cloudflare:workers';
import { httpServerHandler } from 'cloudflare:node';
import { createRequestHandler } from '@react-router/express';
import express, { type ErrorRequestHandler, type RequestHandler } from 'express';
import { Buffer } from 'node:buffer';
import { RouterContextProvider, type ServerBuild } from 'react-router';
import { appContext, sessionContext, statsigContext, type AppMetadata } from '../../app/context';
import { createNextAuthHandler, loadSession } from './auth';
import { createCanonicalUser, loadStatsigAssignment, type StatsigAssignment } from './statsig-client';
import { expressServer, setExpressRequestHandler } from './express-listener';

declare global {
	namespace Express {
		interface Locals {
			session: Awaited<ReturnType<typeof loadSession>>;
			statsig: StatsigAssignment | null;
		}
	}
}

const app = express();
const runtimeEnv = env as Env;

app.disable('x-powered-by');
app.set('trust proxy', true);

app.use((_request, response, next) => {
	response.setHeader('Cache-Control', 'private, no-store');
	response.setHeader('X-App-Version', runtimeEnv.APP_VERSION);
	next();
});

app.get('/health', (_request, response) => {
	response.json({
		ok: true,
		server: 'express',
		runtime: 'cloudflare-workers',
		appVersion: runtimeEnv.APP_VERSION,
	});
});

app.use('/api/auth', express.urlencoded({ extended: false, limit: '32kb' }), express.json({ limit: '32kb' }));
app.all('/api/auth/*', createNextAuthHandler(runtimeEnv));

const sessionMiddleware: RequestHandler = async (request, response, next) => {
	try {
		response.locals.session = await loadSession(request, response, runtimeEnv);
		response.locals.statsig = null;
		if (response.locals.session?.user?.id) {
			const user = createCanonicalUser(
				{
					id: response.locals.session.user.id,
					email: response.locals.session.user.email,
				},
				runtimeEnv,
			);
			response.locals.statsig = await loadStatsigAssignment(user, runtimeEnv);
		}
		next();
	} catch (error) {
		next(error);
	}
};
app.use(sessionMiddleware);

const appMetadata: AppMetadata = {
	applicationId: runtimeEnv.APP_ID,
	environment: runtimeEnv.APP_ENVIRONMENT,
	version: runtimeEnv.APP_VERSION,
	statsigClientKey: runtimeEnv.STATSIG_CLIENT_KEY,
};

const httpServerHandlerBodyBridge: RequestHandler = (_request, response, next) => {
	const chunks: Buffer[] = [];
	const end = response.end.bind(response);
	response.write = ((chunk: unknown, encoding?: BufferEncoding) => {
		if (chunk !== undefined && chunk !== null) {
			chunks.push(Buffer.isBuffer(chunk) ? chunk : chunk instanceof Uint8Array ? Buffer.from(chunk) : Buffer.from(String(chunk), encoding));
		}
		return true;
	}) as typeof response.write;
	response.end = ((chunk?: unknown, encodingOrCallback?: BufferEncoding | (() => void), callback?: () => void) => {
		if (chunk !== undefined && chunk !== null) {
			chunks.push(
				Buffer.isBuffer(chunk)
					? chunk
					: chunk instanceof Uint8Array
						? Buffer.from(chunk)
						: Buffer.from(String(chunk), typeof encodingOrCallback === 'string' ? encodingOrCallback : undefined),
			);
		}
		const completion = typeof encodingOrCallback === 'function' ? encodingOrCallback : callback;
		return end(Buffer.concat(chunks), completion);
	}) as typeof response.end;
	next();
};
app.use(httpServerHandlerBodyBridge);

app.use(
	createRequestHandler({
		build: () => import('virtual:react-router/server-build') as Promise<ServerBuild>,
		getLoadContext(_request, response) {
			const context = new RouterContextProvider();
			context.set(appContext, appMetadata);
			context.set(sessionContext, response.locals.session);
			context.set(statsigContext, response.locals.statsig);
			return context;
		},
	}),
);

const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
	console.error(
		JSON.stringify({
			event: 'app_request_error',
			message: error instanceof Error ? error.message : 'Unknown error',
		}),
	);
	if (!response.headersSent) {
		response.status(500).json({ error: 'internal_server_error' });
	}
};
app.use(errorHandler);

setExpressRequestHandler(app);

export default httpServerHandler({ port: 3000 });
