import { StatsigClient } from '@statsig/js-client';
import { StatsigEvaluationsDataAdapter } from '@statsig/js-client/src/StatsigEvaluationsDataAdapter';
import { describe, expect, it } from 'vitest';
import { bootstrapResponseSchema, type TargetingUser } from '../../workers/shared/statsig-contract';
import { createBootstrap } from '../../workers/statsig/bootstrap';
import { rulesetFixture } from '../fixtures/ruleset';

const user: TargetingUser = {
	userID: 'demo:user',
	email: 'user@example.com',
	customIDs: { applicationID: 'reference-app' },
	custom: { applicationId: 'reference-app' },
	statsigEnvironment: { tier: 'test' },
};

describe('custom Statsig evaluator', () => {
	it('evaluates supported constructs and fails unknown constructs closed', async () => {
		const bootstrap = bootstrapResponseSchema.parse(await createBootstrap(rulesetFixture, user, 'reference-app'));
		expect(bootstrap.feature_gates.reference_gate?.value).toBe(true);
		expect(bootstrap.feature_gates.unknown_construct_fails_closed?.value).toBe(false);
		expect(bootstrap.dynamic_configs.welcome_config?.value).toEqual({
			message: 'hello',
		});
		expect(bootstrap.layer_configs).toEqual({});
	});

	it('bootstraps @statsig/js-client without a network request', async () => {
		const bootstrap = await createBootstrap(rulesetFixture, user, 'reference-app');
		const adapter = new StatsigEvaluationsDataAdapter();
		const client = new StatsigClient(
			'client-test',
			{
				userID: user.userID,
				email: user.email,
				custom: user.custom,
				customIDs: user.customIDs,
			},
			{
				dataAdapter: adapter,
				loggingEnabled: 'disabled',
				networkConfig: { preventAllNetworkTraffic: true },
			},
		);
		adapter.setData(JSON.stringify(bootstrap));
		client.initializeSync();
		expect(client.checkGate('reference_gate')).toBe(true);
		expect(client.getDynamicConfig('welcome_config').value).toEqual({
			message: 'hello',
		});
		await client.shutdown();
	});
});
