import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleDecisionRequest } from '../../workers/statsig/decision-handler';
import type { TargetingUser } from '../../workers/statsig/statsig-user';
import { canonicalizeUser, createUserCacheKey } from '../../workers/statsig/user-cache-key';
import { createStatsigServerClient } from '../fixtures/config-specs';

const env = {
	APP_ID: 'reference-app',
	EVALUATOR_VERSION: 'test',
	USER_CACHE_HMAC_SECRET: 'test-hmac-secret',
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

async function decisionRequest(
	targetingUser: TargetingUser = user,
	method = 'GET',
	cacheKey?: string,
): Promise<Request> {
	const resolvedCacheKey = cacheKey ?? (await createUserCacheKey(targetingUser, env.USER_CACHE_HMAC_SECRET));
	return new Request(`https://feature-cache.internal/internal/v1/decisions/reference-app/${resolvedCacheKey}`, {
		headers: { 'X-Statsig-User': canonicalizeUser(targetingUser) },
		method,
	});
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe('decision handler', () => {
	it.each(['GET', 'HEAD'])('accepts a valid HMAC for %s and emits decision cache headers', async (method) => {
		vi.spyOn(console, 'log').mockImplementation(() => undefined);
		const response = await handleDecisionRequest(await decisionRequest(user, method), env, repository());

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

	it('rejects an invalid HMAC', async () => {
		const response = await handleDecisionRequest(
			await decisionRequest(user, 'GET', `v1_${'0'.repeat(64)}`),
			env,
			repository(),
		);
		expect(response.status).toBe(403);
		expect(await response.json()).toEqual({ error: 'invalid_cache_key' });
	});

	it('rejects an application mismatch in the canonical provider user', async () => {
		const mismatchedUser = {
			...user,
			custom: {
				...user.custom,
				applicationId: 'other-app',
			},
		};
		const response = await handleDecisionRequest(await decisionRequest(mismatchedUser), env, repository());
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ error: 'application_mismatch' });
	});

	it('returns 503 when no configuration snapshot can be loaded', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const response = await handleDecisionRequest(await decisionRequest(), env, {
			async get() {
				throw new Error('configuration unavailable');
			},
		});
		expect(response.status).toBe(503);
		expect(await response.json()).toEqual({ error: 'evaluation_failed' });
	});
});
