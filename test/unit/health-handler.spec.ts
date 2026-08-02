import { describe, expect, it } from 'vitest';
import { handleHealthRequest } from '../../workers/statsig/health-handler';

const env = {
	EVALUATOR_VERSION: 'test',
	CONFIG_SPECS_CACHE_BACKEND: 'isolate',
} as StatsigEnv;

describe('feature evaluator health', () => {
	it('reports evaluator health without caching', async () => {
		const response = handleHealthRequest(new Request('https://feature-admin.internal/health'), env);

		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toBe('private, no-store');
		expect(await response.json()).toMatchObject({
			ok: true,
			entrypoint: 'default',
			evaluatorVersion: 'test',
			configSpecsCacheBackend: 'isolate',
		});
	});

	it('returns not found for other routes', async () => {
		const response = handleHealthRequest(new Request('https://feature-admin.internal/admin/invalidate'), env);

		expect(response.status).toBe(404);
		expect(await response.json()).toEqual({ error: 'not_found' });
	});
});
