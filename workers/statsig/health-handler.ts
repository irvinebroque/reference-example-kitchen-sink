import { noStoreJson } from './responses';

export function handleHealthRequest(request: Request, env: StatsigEnv): Response {
	if (new URL(request.url).pathname !== '/health') {
		return noStoreJson({ error: 'not_found' }, { status: 404 });
	}
	return noStoreJson({
		ok: true,
		entrypoint: 'default',
		evaluatorVersion: env.EVALUATOR_VERSION,
		evaluationEngine: '@statsig/serverless-client',
		volatileCache: 'workerd-memory-cache',
		memoryCacheConfiguration: 'unsafe-volatile-cache-binding',
	});
}
