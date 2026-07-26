import { timingSafeEqual } from 'node:crypto';
import { noStoreJson } from './responses';
import type { ConfigSpecsRepository } from './config-specs-repository';

const encoder = new TextEncoder();

export interface DecisionPurger {
	purgeApplicationDecisions(): Promise<CachePurgeResult>;
}

type InvalidatableRepository = Pick<ConfigSpecsRepository, 'invalidate'>;

function authorized(request: Request, secret: string): boolean {
	const supplied = request.headers.get('authorization')?.replace(/^Bearer /, '');
	if (!supplied) return false;
	const suppliedBytes = encoder.encode(supplied);
	const expectedBytes = encoder.encode(secret);
	return suppliedBytes.byteLength === expectedBytes.byteLength && timingSafeEqual(suppliedBytes, expectedBytes);
}

export async function handleAdminRequest(
	request: Request,
	env: StatsigEnv,
	configSpecsRepository: InvalidatableRepository,
	decisionPurger: DecisionPurger,
): Promise<Response> {
	const pathname = new URL(request.url).pathname;
	if (pathname === '/health') {
		return noStoreJson({
			ok: true,
			entrypoint: 'admin',
			evaluatorVersion: env.EVALUATOR_VERSION,
			evaluationEngine: '@statsig/serverless-client',
			volatileCache: 'workerd-memory-cache',
			memoryCacheConfiguration: 'unsafe-volatile-cache-binding',
		});
	}
	if (pathname === '/admin/invalidate' && request.method === 'POST') {
		if (!authorized(request, env.INVALIDATION_SECRET)) {
			return noStoreJson({ error: 'unauthorized' }, { status: 401 });
		}
		try {
			configSpecsRepository.invalidate();
		} catch (error) {
			return noStoreJson(
				{
					ok: false,
					rulesetInvalidated: false,
					decisionsPurged: false,
					error: error instanceof Error ? error.message : 'ruleset_invalidation_failed',
				},
				{ status: 500 },
			);
		}
		console.log(
			JSON.stringify({
				event: 'statsig_config_specs_invalidation',
				applicationId: env.APP_ID,
			}),
		);
		try {
			const purge = await decisionPurger.purgeApplicationDecisions();
			if (!purge.success) {
				return noStoreJson(
					{
						ok: false,
						rulesetInvalidated: true,
						decisionsPurged: false,
						errors: purge.errors,
					},
					{ status: 502 },
				);
			}
			return noStoreJson({
				ok: true,
				rulesetInvalidated: true,
				decisionsPurged: true,
			});
		} catch (error) {
			return noStoreJson(
				{
					ok: false,
					rulesetInvalidated: true,
					decisionsPurged: false,
					error: error instanceof Error ? error.message : 'decision_purge_failed',
				},
				{ status: 502 },
			);
		}
	}
	return noStoreJson({ error: 'not_found' }, { status: 404 });
}
