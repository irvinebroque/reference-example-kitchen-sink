import type { StatsigServerlessClient } from '@statsig/serverless-client';
import { describe, expect, it, vi } from 'vitest';
import { evaluateApplicationDecisions } from '../../workers/statsig/decision-evaluator';
import type { TargetingUser } from '../../workers/statsig/statsig-user';
import { createStatsigServerClient } from '../fixtures/config-specs';

const user: TargetingUser = {
	userID: 'demo:user',
	privateAttributes: { email: 'user@example.com' },
	customIDs: { applicationID: 'reference-app' },
	custom: { applicationId: 'reference-app', tenantId: 'reference-tenant' },
	statsigEnvironment: { tier: 'test' },
};

describe('application decision evaluator', () => {
	it('maps provider gates and configs to application decisions', () => {
		expect(evaluateApplicationDecisions(createStatsigServerClient(), user, { logExposures: false })).toEqual({
			statsigGateEnabled: true,
			welcomeMessage: 'hello',
		});
	});

	it('applies the exposure policy to both consumed decisions', () => {
		const client = {
			checkGate: vi.fn(() => true),
			getDynamicConfig: vi.fn(() => ({ value: { message: 42 } })),
		} as unknown as StatsigServerlessClient;
		expect(evaluateApplicationDecisions(client, user, { logExposures: true })).toEqual({
			statsigGateEnabled: true,
			welcomeMessage: 'Welcome',
		});
		expect(client.checkGate).toHaveBeenCalledWith('reference_gate', user, { disableExposureLog: false });
		expect(client.getDynamicConfig).toHaveBeenCalledWith('welcome_config', user, { disableExposureLog: false });
	});

	it('suppresses exposures when the policy disables reporting', () => {
		const client = {
			checkGate: vi.fn(() => true),
			getDynamicConfig: vi.fn(() => ({ value: { message: 'hello' } })),
		} as unknown as StatsigServerlessClient;

		evaluateApplicationDecisions(client, user, { logExposures: false });

		expect(client.checkGate).toHaveBeenCalledWith('reference_gate', user, { disableExposureLog: true });
		expect(client.getDynamicConfig).toHaveBeenCalledWith('welcome_config', user, { disableExposureLog: true });
	});

	it('fails closed when provider constructs throw', () => {
		const client = {
			checkGate: vi.fn(() => {
				throw new Error('unsupported gate construct');
			}),
			getDynamicConfig: vi.fn(() => {
				throw new Error('unsupported config construct');
			}),
		} as unknown as StatsigServerlessClient;
		expect(evaluateApplicationDecisions(client, user, { logExposures: true })).toEqual({
			statsigGateEnabled: false,
			welcomeMessage: 'Welcome',
		});
	});
});
