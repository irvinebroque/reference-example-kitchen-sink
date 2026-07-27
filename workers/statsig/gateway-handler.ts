import {
	featureServiceEventRequestSchema,
	featureServiceRequestSchema,
} from '../../shared/feature-contract';
import type { ConfigSpecsRepository } from './config-specs-repository';
import type { DecisionCacheProps } from './decision-handler';
import { logUnexpectedStatsigFlushError } from './flush-observer';
import { noStoreJson } from './responses';
import { createStatsigUser } from './statsig-user';

interface DecisionEntrypoint {
	fetch(request: Request): Promise<Response>;
}

export interface DecisionEntrypointFactory {
	(options: { props: DecisionCacheProps }): DecisionEntrypoint;
}

type GatewayRepository = Pick<ConfigSpecsRepository, 'get'>;
type BackgroundTaskScheduler = (promise: Promise<unknown>) => void;

export interface GatewayDependencies {
	decisionEntrypoint: DecisionEntrypointFactory;
	repository: GatewayRepository;
	scheduleBackgroundTask: BackgroundTaskScheduler;
}

function fixedMetadata(env: StatsigEnv): Record<string, string> {
	return {
		applicationId: env.APP_ID,
		environment: env.APP_ENVIRONMENT,
		tenantId: env.TENANT_ID,
	};
}

async function handleDecisionGatewayRequest(
	request: Request,
	env: StatsigEnv,
	decisionEntrypoint: DecisionEntrypointFactory,
): Promise<Response> {
	let payload: unknown;
	try {
		payload = await request.json();
	} catch {
		return noStoreJson({ error: 'invalid_json' }, { status: 400 });
	}

	const parsed = featureServiceRequestSchema.safeParse(payload);
	if (!parsed.success) {
		return noStoreJson({ error: 'invalid_subject' }, { status: 400 });
	}

	const targetingUser = createStatsigUser(parsed.data.subject, env);
	const internalRequest = new Request('https://feature-cache.internal/internal/v1/decisions', {
		headers: { Accept: 'application/json' },
		method: 'GET',
	});
	return decisionEntrypoint({ props: { targetingUser } }).fetch(internalRequest);
}

async function handleProductEventRequest(
	request: Request,
	env: StatsigEnv,
	repository: GatewayRepository,
	scheduleBackgroundTask: BackgroundTaskScheduler,
): Promise<Response> {
	let payload: unknown;
	try {
		payload = await request.json();
	} catch {
		return noStoreJson({ error: 'invalid_json' }, { status: 400 });
	}

	const parsed = featureServiceEventRequestSchema.safeParse(payload);
	if (!parsed.success) {
		return noStoreJson({ error: 'invalid_event' }, { status: 400 });
	}
	if (env.STATSIG_PRODUCT_EVENT_LOGGING_ENABLED !== 'true') {
		return new Response(null, { status: 202 });
	}

	try {
		const eventRequest = parsed.data;
		const targetingUser = createStatsigUser(eventRequest.subject, env);
		const snapshot = await repository.get();
		snapshot.client.logEvent(eventRequest.event, targetingUser, undefined, fixedMetadata(env));
		scheduleBackgroundTask(snapshot.client.flush().catch(logUnexpectedStatsigFlushError));
		return new Response(null, { status: 202 });
	} catch (error) {
		console.error(
			JSON.stringify({
				event: 'statsig_product_event_error',
				errorType: error instanceof Error ? error.name : 'UnknownError',
			}),
		);
		return noStoreJson({ error: 'event_logging_failed' }, { status: 503 });
	}
}

export async function handleGatewayRequest(
	request: Request,
	env: StatsigEnv,
	{ decisionEntrypoint, repository, scheduleBackgroundTask }: GatewayDependencies,
): Promise<Response> {
	const url = new URL(request.url);
	if (url.pathname !== '/v1/decisions' && url.pathname !== '/v1/events/reference-gate-used') {
		return noStoreJson({ error: 'not_found' }, { status: 404 });
	}
	if (request.method !== 'POST') {
		return noStoreJson({ error: 'method_not_allowed' }, { status: 405 });
	}
	if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
		return noStoreJson({ error: 'unsupported_media_type' }, { status: 415 });
	}
	if (url.pathname === '/v1/events/reference-gate-used') {
		return handleProductEventRequest(request, env, repository, scheduleBackgroundTask);
	}
	return handleDecisionGatewayRequest(request, env, decisionEntrypoint);
}
