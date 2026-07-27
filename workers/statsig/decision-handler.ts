import type { FeatureServiceResponse } from '../../shared/feature-contract';
import type { ConfigSpecsRepository } from './config-specs-repository';
import { evaluateApplicationDecisions } from './decision-evaluator';
import { noStoreJson, positiveNumberSetting } from './responses';
import type { TargetingUser } from './statsig-user';

type DecisionRepository = Pick<ConfigSpecsRepository, 'get'>;
type BackgroundTaskScheduler = (promise: Promise<unknown>) => void;

export interface DecisionCacheProps {
	targetingUser: TargetingUser;
}

export async function handleDecisionRequest(
	request: Request,
	env: StatsigEnv,
	configSpecsRepository: DecisionRepository,
	{ targetingUser }: DecisionCacheProps,
	scheduleBackgroundTask: BackgroundTaskScheduler,
): Promise<Response> {
	const startedAt = performance.now();
	if (request.method !== 'GET' && request.method !== 'HEAD') {
		return noStoreJson({ error: 'method_not_allowed' }, { status: 405 });
	}
	if (new URL(request.url).pathname !== '/internal/v1/decisions') {
		return noStoreJson({ error: 'not_found' }, { status: 404 });
	}

	try {
		const snapshot = await configSpecsRepository.get();
		const exposureLoggingEnabled = env.STATSIG_EXPOSURE_LOGGING_ENABLED === 'true';
		const decisions = evaluateApplicationDecisions(snapshot.client, targetingUser, {
			logGateExposure: exposureLoggingEnabled && request.method === 'GET',
		});
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
				applicationId: env.APP_ID,
				configurationGeneration: snapshot.time,
				payloadBytes: new TextEncoder().encode(body).byteLength,
				durationMs: serviceResponse.diagnostics.evaluationDurationMs,
			}),
		);
		if (exposureLoggingEnabled && request.method === 'GET') {
			scheduleBackgroundTask(
				snapshot.client.flush().catch((error) => {
					console.error(
						JSON.stringify({
							event: 'statsig_exposure_flush_error',
							applicationId: env.APP_ID,
							errorType: error instanceof Error ? error.name : 'UnknownError',
						}),
					);
				}),
			);
		}
		return new Response(request.method === 'HEAD' ? null : body, {
			headers: {
				'Cache-Control': `public, max-age=${positiveNumberSetting(env.DECISIONS_TTL_SECONDS, 60)}, stale-while-revalidate=${positiveNumberSetting(env.DECISIONS_STALE_SECONDS, 300)}`,
				'Content-Type': 'application/json; charset=utf-8',
				'X-Configuration-Generation': snapshot.time,
				'X-Evaluator-Version': env.EVALUATOR_VERSION,
			},
		});
	} catch (error) {
		console.error(
			JSON.stringify({
				event: 'feature_decision_evaluation_error',
				applicationId: env.APP_ID,
				errorType: error instanceof Error ? error.name : 'UnknownError',
			}),
		);
		return noStoreJson({ error: 'evaluation_failed' }, { status: 503 });
	}
}
