import type { StatsigServerlessClient } from '@statsig/serverless-client';
import { describe, expect, it, vi } from 'vitest';
import { evaluateApplicationDecisions } from '../../workers/statsig/decision-evaluator';
import type { TargetingUser } from '../../workers/statsig/statsig-user';
import { createStatsigServerClient } from '../fixtures/config-specs';

const user: TargetingUser = {
	userID: 'demo:user',
	email: 'user@example.com',
	customIDs: { applicationID: 'reference-app' },
	custom: { applicationId: 'reference-app', tenantId: 'reference-tenant' },
	statsigEnvironment: { tier: 'test' },
};

describe('application decision evaluator', () => {
	it('maps provider gates and configs to application decisions', () => {
		expect(evaluateApplicationDecisions(createStatsigServerClient(), user)).toEqual({
			statsigGateEnabled: true,
			welcomeMessage: 'hello',
		});
	});

	it('uses the application default for malformed dynamic configuration', () => {
		const client = {
			checkGate: vi.fn(() => true),
			getDynamicConfig: vi.fn(() => ({ value: { message: 42 } })),
		} as unknown as StatsigServerlessClient;
		expect(evaluateApplicationDecisions(client, user)).toEqual({
			statsigGateEnabled: true,
			welcomeMessage: 'Welcome',
		});
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
		expect(evaluateApplicationDecisions(client, user)).toEqual({
			statsigGateEnabled: false,
			welcomeMessage: 'Welcome',
		});
	});
});
