import type { FeatureServiceResponse } from '../../shared/feature-contract';
import type { ConfigSpecsRepository } from './config-specs-repository';
import { evaluateApplicationDecisions } from './decision-evaluator';
import { noStoreJson, positiveNumberSetting } from './responses';
import { parseTargetingUserHeader, type TargetingUser } from './statsig-user';
import { verifyUserCacheKey } from './user-cache-key';

type DecisionRepository = Pick<ConfigSpecsRepository, 'get'>;

interface DecisionRoute {
	applicationId: string;
	cacheKey: string;
}

function parseDecisionRoute(request: Request): DecisionRoute | undefined {
	const match = /^\/internal\/v1\/decisions\/([^/]+)\/(v1_[a-f0-9]{64})$/.exec(new URL(request.url).pathname);
	if (!match) return undefined;
	try {
		return {
			applicationId: decodeURIComponent(match[1] ?? ''),
			cacheKey: match[2] ?? '',
		};
	} catch {
		return undefined;
	}
}

async function readVerifiedUser(request: Request, route: DecisionRoute, hmacSecret: string): Promise<TargetingUser | Response> {
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

export async function handleDecisionRequest(
	request: Request,
	env: StatsigEnv,
	configSpecsRepository: DecisionRepository,
): Promise<Response> {
	const startedAt = performance.now();
	if (request.method !== 'GET' && request.method !== 'HEAD') {
		return noStoreJson({ error: 'method_not_allowed' }, { status: 405 });
	}

	const route = parseDecisionRoute(request);
	if (!route) return noStoreJson({ error: 'not_found' }, { status: 404 });
	if (route.applicationId !== env.APP_ID) {
		return noStoreJson({ error: 'application_not_found' }, { status: 404 });
	}

	const user = await readVerifiedUser(request, route, env.USER_CACHE_HMAC_SECRET);
	if (user instanceof Response) return user;

	try {
		const snapshot = await configSpecsRepository.get();
		const decisions = evaluateApplicationDecisions(snapshot.client, user);
		const serviceResponse = {
			decisions,
			diagnostics: {
				evaluatorVersion: env.EVALUATOR_VERSION,
				configurationGeneration: snapshot.time,
				configurationStale: snapshot.stale,
				evaluationDurationMs: Math.round(performance.now() - startedAt),
				payloadBytes: new TextEncoder().encode(JSON.stringify(decisions)).byteLength,
			},
		} satisfies FeatureServiceResponse;
		const body = JSON.stringify(serviceResponse);
		console.log(
			JSON.stringify({
				event: 'feature_decision_evaluation',
				applicationId: route.applicationId,
				cacheKeyPrefix: route.cacheKey.slice(0, 11),
				configurationGeneration: snapshot.time,
				payloadBytes: new TextEncoder().encode(body).byteLength,
				durationMs: serviceResponse.diagnostics.evaluationDurationMs,
			}),
		);
		return new Response(request.method === 'HEAD' ? null : body, {
			headers: {
				'Cache-Control': `public, max-age=${positiveNumberSetting(env.DECISIONS_TTL_SECONDS, 60)}, stale-while-revalidate=${positiveNumberSetting(env.DECISIONS_STALE_SECONDS, 300)}`,
				'Cache-Tag': `feature-decisions-app-${route.applicationId}`,
				'Content-Type': 'application/json; charset=utf-8',
				'X-Configuration-Generation': snapshot.time,
				'X-Evaluator-Version': env.EVALUATOR_VERSION,
			},
		});
	} catch (error) {
		console.error(
			JSON.stringify({
				event: 'feature_decision_evaluation_error',
				applicationId: route.applicationId,
				cacheKeyPrefix: route.cacheKey.slice(0, 11),
				errorType: error instanceof Error ? error.name : 'UnknownError',
			}),
		);
		return noStoreJson({ error: 'evaluation_failed' }, { status: 503 });
	}
}
