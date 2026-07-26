import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleDecisionRequest } from '../../workers/statsig/decision-handler';
import type { TargetingUser } from '../../workers/statsig/statsig-user';
import { createStatsigServerClient } from '../fixtures/config-specs';

const env = {
	APP_ID: 'reference-app',
	EVALUATOR_VERSION: 'test',
	DECISIONS_TTL_SECONDS: '60',
	DECISIONS_STALE_SECONDS: '300',
} as StatsigEnv;

const user: TargetingUser = {
	userID: 'demo:user',
	email: 'user@example.com',
	customIDs: { applicationID: 'reference-app' },
	custom: {
		applicationId: 'reference-app',
		tenantId: 'reference-tenant',
	},
	statsigEnvironment: { tier: 'production' },
};

function repository() {
	return {
		async get() {
			return {
				client: createStatsigServerClient(),
				expiresAt: Date.now() + 60_000,
				stale: false,
				time: '1725000000000',
			};
		},
	};
}

function decisionRequest(method = 'GET', pathname = '/internal/v1/decisions'): Request {
	return new Request(`https://feature-cache.internal${pathname}`, { method });
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe('decision handler', () => {
	it.each(['GET', 'HEAD'])('evaluates targeting-user props for %s and emits decision cache headers', async (method) => {
		vi.spyOn(console, 'log').mockImplementation(() => undefined);
		const response = await handleDecisionRequest(decisionRequest(method), env, repository(), {
			targetingUser: user,
		});

		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toBe('public, max-age=60, stale-while-revalidate=300');
		expect(response.headers.get('cache-tag')).toBe('feature-decisions-app-reference-app');
		if (method === 'HEAD') {
			expect(await response.text()).toBe('');
		} else {
			expect(await response.json()).toMatchObject({
				decisions: {
					showReferenceExperience: true,
					welcomeMessage: 'hello',
				},
				diagnostics: {
					configurationGeneration: '1725000000000',
					configurationStale: false,
				},
			});
		}
	});

	it('accepts only the fixed internal GET endpoint', async () => {
		expect(
			(
				await handleDecisionRequest(decisionRequest('POST'), env, repository(), {
					targetingUser: user,
				})
			).status,
		).toBe(405);
		expect(
			(
				await handleDecisionRequest(decisionRequest('GET', '/other'), env, repository(), {
					targetingUser: user,
				})
			).status,
		).toBe(404);
	});

	it('returns 503 when no configuration snapshot can be loaded', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const response = await handleDecisionRequest(
			decisionRequest(),
			env,
			{
				async get() {
					throw new Error('configuration unavailable');
				},
			},
			{ targetingUser: user },
		);
		expect(response.status).toBe(503);
		expect(await response.json()).toEqual({ error: 'evaluation_failed' });
	});
});
