import { describe, expect, it } from 'vitest';
import { StatsigService } from '../../workers/app/statsig-client';
import { createBootstrap } from '../../workers/statsig/bootstrap';
import { compiledRulesetFixture, rulesetFixture } from '../fixtures/ruleset';

describe('application Statsig service client', () => {
	it('makes exactly one credential-free Service Binding request', async () => {
		let calls = 0;
		let observedRequest: Request | undefined;
		const bootstrap = await createBootstrap(
			compiledRulesetFixture,
			{
				userID: 'demo:user',
				email: 'user@example.com',
				customIDs: { applicationID: 'reference-app' },
				custom: {
					applicationId: 'reference-app',
					tenantId: 'reference-tenant',
				},
				statsigEnvironment: { tier: 'production' },
			},
			'reference-app',
		);
		const service = {
			async fetch(request: Request) {
				calls += 1;
				observedRequest = request;
				return Response.json(
					{
						bootstrap,
						diagnostics: {
							evaluatorVersion: 'test',
							rulesetGeneration: String(rulesetFixture.time),
							rulesetStale: false,
							evaluatorDurationMs: 1,
							payloadBytes: 100,
						},
					},
					{ headers: { 'Cf-Cache-Status': 'HIT' } },
				);
			},
		};
		const statsig = new StatsigService({
			applicationId: 'reference-app',
			environment: 'production',
			hmacSecret: 'hmac-secret',
			service: service as Service,
		});
		const assignment = await statsig.loadAssignment({ id: 'demo:user', email: 'user@example.com' });
		expect(calls).toBe(1);
		expect(assignment.diagnostics.cacheStatus).toBe('HIT');
		expect(observedRequest?.headers.has('authorization')).toBe(false);
		expect(observedRequest?.headers.has('cookie')).toBe(false);
		expect(observedRequest?.url).not.toContain('user@example.com');
	});
});
