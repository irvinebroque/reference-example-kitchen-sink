import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleDecisionRequest } from '../../workers/statsig/decision-handler';
import type { TargetingUser } from '../../workers/statsig/statsig-user';
import { createStatsigServerClient } from '../fixtures/config-specs';

const env = {
	APP_ID: 'reference-app',
	EVALUATOR_VERSION: 'test',
	DECISIONS_TTL_SECONDS: '60',
	DECISIONS_STALE_SECONDS: '300',
	STATSIG_EXPOSURE_LOGGING_ENABLED: 'true',
} as StatsigEnv;

const user: TargetingUser = {
	userID: 'demo:user',
	privateAttributes: { email: 'user@example.com' },
	customIDs: { applicationID: 'reference-app' },
	custom: {
		applicationId: 'reference-app',
		tenantId: 'reference-tenant',
	},
	statsigEnvironment: { tier: 'production' },
};

function repository(client = createStatsigServerClient()) {
	return {
		async get() {
			return {
				client,
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
	it('evaluates targeting-user props for GET, emits cache headers, and schedules exactly one flush', async () => {
		vi.spyOn(console, 'log').mockImplementation(() => undefined);
		const client = createStatsigServerClient();
		const flush = vi.spyOn(client, 'flush').mockResolvedValue();
		const scheduleBackgroundTask = vi.fn();
		const response = await handleDecisionRequest(
			decisionRequest(),
			env,
			repository(client),
			{ targetingUser: user },
			scheduleBackgroundTask,
		);

		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toBe('public, max-age=60, stale-while-revalidate=300');
		expect(await response.json()).toMatchObject({
			decisions: {
				statsigGateEnabled: true,
				welcomeMessage: 'hello',
			},
			diagnostics: {
				configurationGeneration: '1725000000000',
				configurationStale: false,
			},
		});
		expect(flush).toHaveBeenCalledTimes(1);
		expect(scheduleBackgroundTask).toHaveBeenCalledTimes(1);
		expect(scheduleBackgroundTask).toHaveBeenCalledWith(expect.any(Promise));
	});

	it('evaluates HEAD without generating or flushing exposures', async () => {
		vi.spyOn(console, 'log').mockImplementation(() => undefined);
		const client = createStatsigServerClient();
		const checkGate = vi.spyOn(client, 'checkGate');
		const getDynamicConfig = vi.spyOn(client, 'getDynamicConfig');
		const flush = vi.spyOn(client, 'flush').mockResolvedValue();
		const scheduleBackgroundTask = vi.fn();

		const response = await handleDecisionRequest(
			decisionRequest('HEAD'),
			env,
			repository(client),
			{ targetingUser: user },
			scheduleBackgroundTask,
		);

		expect(response.status).toBe(200);
		expect(await response.text()).toBe('');
		expect(checkGate).toHaveBeenCalledWith('reference_gate', user, { disableExposureLog: true });
		expect(getDynamicConfig).toHaveBeenCalledWith('welcome_config', user, { disableExposureLog: true });
		expect(flush).not.toHaveBeenCalled();
		expect(scheduleBackgroundTask).not.toHaveBeenCalled();
	});

	it('does not schedule network logging when exposure reporting is disabled', async () => {
		vi.spyOn(console, 'log').mockImplementation(() => undefined);
		const client = createStatsigServerClient();
		const checkGate = vi.spyOn(client, 'checkGate');
		const flush = vi.spyOn(client, 'flush').mockResolvedValue();
		const scheduleBackgroundTask = vi.fn();

		const response = await handleDecisionRequest(
			decisionRequest(),
			{ ...env, STATSIG_EXPOSURE_LOGGING_ENABLED: 'false' } as unknown as StatsigEnv,
			repository(client),
			{ targetingUser: user },
			scheduleBackgroundTask,
		);

		expect(response.status).toBe(200);
		expect(checkGate).toHaveBeenCalledWith('reference_gate', user, { disableExposureLog: true });
		expect(flush).not.toHaveBeenCalled();
		expect(scheduleBackgroundTask).not.toHaveBeenCalled();
	});

	it('logs a rejected flush without changing the successful response', async () => {
		vi.spyOn(console, 'log').mockImplementation(() => undefined);
		const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const client = createStatsigServerClient();
		vi.spyOn(client, 'flush').mockRejectedValue(new TypeError('delivery failed'));
		let backgroundTask: Promise<unknown> | undefined;

		const response = await handleDecisionRequest(
			decisionRequest(),
			env,
			repository(client),
			{ targetingUser: user },
			(promise) => {
				backgroundTask = promise;
			},
		);
		await backgroundTask;

		expect(response.status).toBe(200);
		expect(errorLog).toHaveBeenCalledWith(
			JSON.stringify({
				event: 'statsig_exposure_flush_error',
				applicationId: 'reference-app',
				errorType: 'TypeError',
			}),
		);
	});

	it('accepts only the fixed internal GET endpoint', async () => {
		const scheduleBackgroundTask = vi.fn();
		expect(
			(
				await handleDecisionRequest(
					decisionRequest('POST'),
					env,
					repository(),
					{ targetingUser: user },
					scheduleBackgroundTask,
				)
			).status,
		).toBe(405);
		expect(
			(
				await handleDecisionRequest(
					decisionRequest('GET', '/other'),
					env,
					repository(),
					{ targetingUser: user },
					scheduleBackgroundTask,
				)
			).status,
		).toBe(404);
		expect(scheduleBackgroundTask).not.toHaveBeenCalled();
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
			vi.fn(),
		);
		expect(response.status).toBe(503);
		expect(await response.json()).toEqual({ error: 'evaluation_failed' });
	});
});
