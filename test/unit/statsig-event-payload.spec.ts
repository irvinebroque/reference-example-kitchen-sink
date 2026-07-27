import { StatsigServerlessClient } from '@statsig/serverless-client';
import { describe, expect, it } from 'vitest';
import { configSpecsFixture } from '../fixtures/config-specs';

describe('Statsig event payload privacy', () => {
	it('excludes email and private attributes from the SDK flush payload', async () => {
		let requestBody: BodyInit | null | undefined;
		const client = new StatsigServerlessClient('secret-test-product-event-payload', {
			disableStatsigEncoding: true,
			logEventCompressionMode: 'd',
			loggingEnabled: 'always',
			networkConfig: {
				networkOverrideFunc: async (_url, init) => {
					requestBody = init.body;
					return Response.json({ success: true });
				},
			},
		});
		client.dataAdapter.setData(JSON.stringify(configSpecsFixture));
		client.initializeSync();
		client.logEvent(
			'reference_gate_used',
			{
				userID: 'demo:user',
				privateAttributes: { email: 'private@example.com' },
				custom: { applicationId: 'reference-app' },
			},
			undefined,
			{ applicationId: 'reference-app' },
		);

		await client.flush();

		expect(typeof requestBody).toBe('string');
		const payload = JSON.parse(String(requestBody)) as {
			events: Array<{ user?: Record<string, unknown> }>;
		};
		expect(payload.events).toHaveLength(1);
		expect(payload.events[0]?.user).not.toHaveProperty('privateAttributes');
		expect(String(requestBody)).not.toContain('private@example.com');
	});
});
