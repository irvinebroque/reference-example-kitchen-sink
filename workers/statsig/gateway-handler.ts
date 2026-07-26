import { featureServiceRequestSchema } from '../../shared/feature-contract';
import type { DecisionCacheProps } from './decision-handler';
import { noStoreJson } from './responses';
import { createStatsigUser } from './statsig-user';

interface DecisionEntrypoint {
	fetch(request: Request): Promise<Response>;
}

export interface DecisionEntrypointFactory {
	(options: { props: DecisionCacheProps }): DecisionEntrypoint;
}

export async function handleGatewayRequest(
	request: Request,
	env: StatsigEnv,
	decisionEntrypoint: DecisionEntrypointFactory,
): Promise<Response> {
	const url = new URL(request.url);
	if (url.pathname !== '/v1/decisions') {
		return noStoreJson({ error: 'not_found' }, { status: 404 });
	}
	if (request.method !== 'POST') {
		return noStoreJson({ error: 'method_not_allowed' }, { status: 405 });
	}
	if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
		return noStoreJson({ error: 'unsupported_media_type' }, { status: 415 });
	}

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
