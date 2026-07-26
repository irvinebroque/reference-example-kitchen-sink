import { StatsigClient } from '@statsig/js-client';
import { StatsigServerlessClient } from '@statsig/serverless-client';
import { describe, expect, it } from 'vitest';
import { bootstrapResponseSchema, type TargetingUser } from '../../shared/statsig-contract';
import { rulesetFixture } from '../fixtures/ruleset';

const user: TargetingUser = {
	userID: 'demo:user',
	email: 'user@example.com',
	customIDs: { applicationID: 'reference-app' },
	custom: { applicationId: 'reference-app' },
	statsigEnvironment: { tier: 'test' },
};

function createServerClient(): StatsigServerlessClient {
	const client = new StatsigServerlessClient('secret-test-evaluator', {
		loggingEnabled: 'disabled',
		networkConfig: { preventAllNetworkTraffic: true },
	});
	client.dataAdapter.setData(JSON.stringify(rulesetFixture));
	client.initializeSync();
	return client;
}

describe('official Statsig evaluator', () => {
	it('evaluates gates and configs with @statsig/serverless-client', () => {
		const bootstrap = bootstrapResponseSchema.parse(
			createServerClient().getClientInitializeResponse(user, {
				clientSDKKey: 'client-test',
				hash: 'none',
			}),
		);
		expect(bootstrap.generator).toBe('js-on-device-eval-client');
		expect(bootstrap.feature_gates.reference_gate?.value).toBe(true);
		expect(bootstrap.feature_gates.unknown_construct_fails_closed?.value).toBe(false);
		expect(bootstrap.dynamic_configs.welcome_config?.value).toEqual({
			message: 'hello',
		});
	});

	it('bootstraps @statsig/js-client through its public data adapter without network traffic', async () => {
		const bootstrap = createServerClient().getClientInitializeResponse(user, {
			clientSDKKey: 'client-test',
			hash: 'none',
		});
		expect(bootstrap).not.toBeNull();

		const client = new StatsigClient(
			'client-test',
			{
				userID: user.userID,
				email: user.email,
				custom: user.custom,
				customIDs: user.customIDs,
			},
			{
				loggingEnabled: 'disabled',
				networkConfig: { preventAllNetworkTraffic: true },
			},
		);
		client.dataAdapter.setData(JSON.stringify(bootstrap));
		client.initializeSync();
		expect(client.checkGate('reference_gate')).toBe(true);
		expect(client.getDynamicConfig('welcome_config').value).toEqual({
			message: 'hello',
		});
		await client.shutdown();
	});
});
