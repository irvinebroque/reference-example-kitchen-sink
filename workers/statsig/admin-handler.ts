import { timingSafeEqual } from 'node:crypto';
import { noStoreJson } from './responses';
import type { RulesetRepository } from './ruleset-cache';

const encoder = new TextEncoder();

function authorized(request: Request, secret: string): boolean {
	const supplied = request.headers.get('authorization')?.replace(/^Bearer /, '');
	if (!supplied) return false;
	const suppliedBytes = encoder.encode(supplied);
	const expectedBytes = encoder.encode(secret);
	return suppliedBytes.byteLength === expectedBytes.byteLength && timingSafeEqual(suppliedBytes, expectedBytes);
}

export async function handleAdminRequest(request: Request, env: StatsigEnv, repository: RulesetRepository): Promise<Response> {
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
		repository.invalidate();
		console.log(
			JSON.stringify({
				event: 'statsig_ruleset_invalidation',
				applicationId: env.APP_ID,
			}),
		);
		return noStoreJson({
			ok: true,
			rulesetInvalidated: true,
		});
	}
	return noStoreJson({ error: 'not_found' }, { status: 404 });
}
