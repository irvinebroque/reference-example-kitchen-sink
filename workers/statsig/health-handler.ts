import { noStoreJson } from './responses';
import { configSpecsCacheBackendSetting } from './config-specs-repository';

export function handleHealthRequest(request: Request, env: StatsigEnv): Response {
	if (new URL(request.url).pathname !== '/health') {
		return noStoreJson({ error: 'not_found' }, { status: 404 });
	}
	return noStoreJson({
		ok: true,
		entrypoint: 'default',
		evaluatorVersion: env.EVALUATOR_VERSION,
		evaluationEngine: '@statsig/serverless-client',
		configSpecsCacheBackend: configSpecsCacheBackendSetting(env.CONFIG_SPECS_CACHE_BACKEND),
	});
}
