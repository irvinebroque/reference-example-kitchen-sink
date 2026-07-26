import {
	parseTargetingUserHeader,
	type EvaluatorServiceResponse,
	type TargetingUser,
} from '../../shared/statsig-contract';
import { verifyUserCacheKey } from '../../shared/user-cache-key';
import { noStoreJson, positiveNumberSetting } from './responses';
import type { RulesetRepository } from './ruleset-cache';

interface EvaluationRoute {
	applicationId: string;
	cacheKey: string;
}

function parseEvaluationRoute(request: Request): EvaluationRoute | undefined {
	const match = /^\/v1\/bootstrap\/([^/]+)\/(v1_[a-f0-9]{64})$/.exec(new URL(request.url).pathname);
	if (!match) return undefined;
	return {
		applicationId: decodeURIComponent(match[1] ?? ''),
		cacheKey: match[2] ?? '',
	};
}

async function readVerifiedUser(request: Request, route: EvaluationRoute, hmacSecret: string): Promise<TargetingUser | Response> {
	const header = request.headers.get('x-statsig-user');
	if (!header) return noStoreJson({ error: 'missing_user' }, { status: 400 });

	let user: TargetingUser;
	try {
		user = parseTargetingUserHeader(header);
	} catch {
		return noStoreJson({ error: 'invalid_user' }, { status: 400 });
	}
	if (user.custom?.applicationId !== route.applicationId) {
		return noStoreJson({ error: 'application_mismatch' }, { status: 400 });
	}
	if (!(await verifyUserCacheKey(user, hmacSecret, route.cacheKey))) {
		return noStoreJson({ error: 'invalid_cache_key' }, { status: 403 });
	}
	return user;
}

export async function handleEvaluationRequest(request: Request, env: StatsigEnv, repository: RulesetRepository): Promise<Response> {
	const startedAt = performance.now();
	if (request.method !== 'GET' && request.method !== 'HEAD') {
		return noStoreJson({ error: 'method_not_allowed' }, { status: 405 });
	}

	const route = parseEvaluationRoute(request);
	if (!route) return noStoreJson({ error: 'not_found' }, { status: 404 });
	if (route.applicationId !== env.APP_ID) {
		return noStoreJson({ error: 'application_not_found' }, { status: 404 });
	}

	const user = await readVerifiedUser(request, route, env.USER_CACHE_HMAC_SECRET);
	if (user instanceof Response) return user;

	try {
		const snapshot = await repository.get();
		const initializeResponse = snapshot.client.getClientInitializeResponse(user, {
			clientSDKKey: env.STATSIG_CLIENT_KEY,
			hash: 'none',
		});
		if (!initializeResponse) {
			throw new Error('Statsig client is not initialized');
		}
		const bootstrapBytes = new TextEncoder().encode(JSON.stringify(initializeResponse)).byteLength;
		const serviceResponse = {
			bootstrap: initializeResponse,
			diagnostics: {
				evaluatorVersion: env.EVALUATOR_VERSION,
				rulesetGeneration: snapshot.generation,
				rulesetStale: snapshot.stale,
				evaluatorDurationMs: Math.round(performance.now() - startedAt),
				payloadBytes: bootstrapBytes,
			},
		} satisfies EvaluatorServiceResponse;
		const body = JSON.stringify(serviceResponse);
		console.log(
			JSON.stringify({
				event: 'statsig_evaluation',
				applicationId: route.applicationId,
				userKeyPrefix: route.cacheKey.slice(0, 11),
				rulesetGeneration: snapshot.generation,
				payloadBytes: new TextEncoder().encode(body).byteLength,
				durationMs: Math.round(performance.now() - startedAt),
			}),
		);
		return new Response(request.method === 'HEAD' ? null : body, {
			headers: {
				'Cache-Control': `public, max-age=${positiveNumberSetting(env.BOOTSTRAP_TTL_SECONDS, 60)}, stale-while-revalidate=${positiveNumberSetting(env.BOOTSTRAP_STALE_SECONDS, 300)}`,
				'Cache-Tag': `statsig-app-${route.applicationId}`,
				'Content-Type': 'application/json; charset=utf-8',
				'X-Evaluator-Version': env.EVALUATOR_VERSION,
				'X-Ruleset-Generation': snapshot.generation,
			},
		});
	} catch (error) {
		console.error(
			JSON.stringify({
				event: 'statsig_evaluation_error',
				applicationId: route.applicationId,
				userKeyPrefix: route.cacheKey.slice(0, 11),
				message: error instanceof Error ? error.message : 'Unknown error',
			}),
		);
		return noStoreJson({ error: 'evaluation_failed' }, { status: 503 });
	}
}
