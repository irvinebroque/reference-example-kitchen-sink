import { StatsigClient } from '@statsig/js-client';
import { StatsigEvaluationsDataAdapter } from '@statsig/js-client/src/StatsigEvaluationsDataAdapter';
import { describe, expect, it } from 'vitest';
import { bootstrapResponseSchema, type TargetingUser } from '../../shared/statsig-contract';
import { createBootstrap } from '../../workers/statsig/bootstrap';
import { compileRuleset, supportedCompatibilityEnvelope } from '../../workers/statsig/ruleset-compiler';
import { conditionRegistry, operatorRegistry } from '../../workers/statsig/ruleset-compiler';
import { compiledRulesetFixture, rulesetFixture } from '../fixtures/ruleset';

const user: TargetingUser = {
	userID: 'demo:user',
	email: 'user@example.com',
	customIDs: { applicationID: 'reference-app' },
	custom: { applicationId: 'reference-app' },
	statsigEnvironment: { tier: 'test' },
};

describe('custom Statsig evaluator', () => {
	it('evaluates supported constructs and fails unknown constructs closed', async () => {
		const bootstrap = bootstrapResponseSchema.parse(await createBootstrap(compiledRulesetFixture, user, 'reference-app'));
		expect(bootstrap.feature_gates.reference_gate?.value).toBe(true);
		expect(bootstrap.feature_gates.unknown_construct_fails_closed?.value).toBe(false);
		expect(bootstrap.dynamic_configs.welcome_config?.value).toEqual({
			message: 'hello',
		});
		expect(bootstrap.layer_configs).toEqual({});
	});

	it('bootstraps @statsig/js-client without a network request', async () => {
		const bootstrap = await createBootstrap(compiledRulesetFixture, user, 'reference-app');
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

	it('derives the compatibility envelope from the compiler registries', () => {
		expect(supportedCompatibilityEnvelope()).toEqual({
			conditionTypes: Object.keys(conditionRegistry),
			operators: Object.keys(operatorRegistry),
		});
	});

	it('keeps recursive segment ancestry isolated across parallel conditions', async () => {
		const document = {
			...rulesetFixture,
			feature_gates: [
				{
					...rulesetFixture.feature_gates[0]!,
					name: 'parallel_segment_gate',
					rules: [
						{
							...rulesetFixture.feature_gates[0]!.rules[0]!,
							conditions: [
								{
									type: 'segment',
									targetValue: 'shared-segment',
									operator: null,
									field: null,
									additionalValues: null,
									idType: 'userID',
								},
								{
									type: 'segment',
									targetValue: 'shared-segment',
									operator: null,
									field: null,
									additionalValues: null,
									idType: 'userID',
								},
							],
						},
					],
				},
			],
			dynamic_configs: [],
			segments: [
				{
					...rulesetFixture.feature_gates[0]!,
					name: 'shared-segment',
					type: 'segment',
				},
			],
		};
		const bootstrap = await createBootstrap(compileRuleset(document), user, 'reference-app');
		expect(bootstrap.feature_gates.parallel_segment_gate?.value).toBe(true);
	});
});
