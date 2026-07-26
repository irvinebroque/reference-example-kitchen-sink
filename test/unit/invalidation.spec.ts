import { describe, expect, it, vi } from 'vitest';
import { handleAdminRequest } from '../../workers/statsig/admin-handler';

const env = {
	APP_ID: 'reference-app',
	EVALUATOR_VERSION: 'test',
	INVALIDATION_SECRET: 'invalidation-secret',
} as StatsigEnv;

function request(secret?: string): Request {
	return new Request('https://feature-admin.internal/admin/invalidate', {
		headers: secret ? { Authorization: `Bearer ${secret}` } : undefined,
		method: 'POST',
	});
}

describe('feature invalidation', () => {
	it('does not change repository or cache state when unauthorized', async () => {
		const repository = { invalidate: vi.fn() };
		const purger = { purgeApplicationDecisions: vi.fn() };
		const response = await handleAdminRequest(request(), env, repository, purger);
		expect(response.status).toBe(401);
		expect(repository.invalidate).not.toHaveBeenCalled();
		expect(purger.purgeApplicationDecisions).not.toHaveBeenCalled();
	});

	it('clears repository state and purges the decision entrypoint', async () => {
		vi.spyOn(console, 'log').mockImplementation(() => undefined);
		const repository = { invalidate: vi.fn() };
		const purger = {
			purgeApplicationDecisions: vi.fn(async () => ({ success: true, errors: [] })),
		};
		const response = await handleAdminRequest(
			request(env.INVALIDATION_SECRET),
			env,
			repository,
			purger,
		);
		expect(repository.invalidate).toHaveBeenCalledOnce();
		expect(purger.purgeApplicationDecisions).toHaveBeenCalledOnce();
		expect(await response.json()).toEqual({
			ok: true,
			rulesetInvalidated: true,
			decisionsPurged: true,
		});
	});

	it('reports partial state when the decision purge fails', async () => {
		vi.spyOn(console, 'log').mockImplementation(() => undefined);
		const repository = { invalidate: vi.fn() };
		const purger = {
			purgeApplicationDecisions: vi.fn(async () => ({
				success: false,
				errors: [{ code: 1000, message: 'purge unavailable' }],
			})),
		};
		const response = await handleAdminRequest(
			request(env.INVALIDATION_SECRET),
			env,
			repository,
			purger,
		);
		expect(response.status).toBe(502);
		expect(await response.json()).toMatchObject({
			ok: false,
			rulesetInvalidated: true,
			decisionsPurged: false,
		});
	});
});
