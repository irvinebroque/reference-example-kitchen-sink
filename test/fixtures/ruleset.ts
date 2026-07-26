import { StatsigServerlessClient } from '@statsig/serverless-client';
import type { TargetingUser } from '../../shared/statsig-contract';

export const rulesetFixture = {
	time: 1_725_000_000_000,
	has_updates: true,
	feature_gates: [
		{
			name: 'reference_gate',
			type: 'feature_gate',
			salt: 'gate-salt',
			defaultValue: false,
			enabled: true,
			idType: 'userID',
			entity: 'feature_gate',
			explicitParameters: null,
			hasSharedParams: false,
			rules: [
				{
					name: 'all users',
					passPercentage: 100,
					conditions: [
						{
							type: 'public',
							targetValue: true,
							operator: null,
							field: null,
							additionalValues: null,
							idType: 'userID',
						},
					],
					returnValue: true,
					id: 'gate-rule',
					salt: 'rule-salt',
					idType: 'userID',
					configDelegate: null,
				},
			],
		},
		{
			name: 'unknown_construct_fails_closed',
			type: 'feature_gate',
			salt: 'unknown-salt',
			defaultValue: false,
			enabled: true,
			idType: 'userID',
			entity: 'feature_gate',
			explicitParameters: null,
			hasSharedParams: false,
			rules: [
				{
					name: 'unsupported',
					passPercentage: 100,
					conditions: [
						{
							type: 'future_unknown_type',
							targetValue: true,
							operator: 'eq',
							field: null,
							additionalValues: null,
							idType: 'userID',
						},
					],
					returnValue: true,
					id: 'unknown-rule',
					salt: 'unknown-rule',
					idType: 'userID',
					configDelegate: null,
				},
			],
		},
	],
	dynamic_configs: [
		{
			name: 'welcome_config',
			type: 'dynamic_config',
			salt: 'config-salt',
			defaultValue: { message: 'default' },
			enabled: true,
			idType: 'userID',
			entity: 'dynamic_config',
			explicitParameters: ['message'],
			hasSharedParams: false,
			rules: [
				{
					name: 'reference users',
					passPercentage: 100,
					conditions: [
						{
							type: 'user_field',
							targetValue: 'reference-app',
							operator: 'eq',
							field: 'applicationId',
							additionalValues: null,
							idType: 'userID',
						},
					],
					returnValue: { message: 'hello' },
					id: 'config-rule',
					salt: 'config-rule-salt',
					idType: 'userID',
					configDelegate: null,
				},
			],
		},
	],
	layer_configs: [],
	segments: [],
};

export function createOfficialBootstrap(user: TargetingUser, clientKey = 'client-test') {
	const client = new StatsigServerlessClient(`secret-test-${crypto.randomUUID()}`, {
		loggingEnabled: 'disabled',
		networkConfig: { preventAllNetworkTraffic: true },
	});
	client.dataAdapter.setData(JSON.stringify(rulesetFixture));
	client.initializeSync();
	const bootstrap = client.getClientInitializeResponse(user, {
		clientSDKKey: clientKey,
		hash: 'none',
	});
	if (!bootstrap) throw new Error('Fixture Statsig client failed to initialize');
	return bootstrap;
}
