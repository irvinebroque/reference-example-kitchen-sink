import { timingSafeEqual } from 'node:crypto';
import { noStoreJson } from './responses';
import type { ConfigSpecsRepository } from './config-specs-repository';

const encoder = new TextEncoder();

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
	configSpecsRepository: ConfigSpecsRepository,
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
		configSpecsRepository.invalidate();
		console.log(
			JSON.stringify({
				event: 'statsig_config_specs_invalidation',
				applicationId: env.APP_ID,
			}),
		);
		return noStoreJson({
			ok: true,
			configSpecsInvalidated: true,
		});
	}
	return noStoreJson({ error: 'not_found' }, { status: 404 });
}
