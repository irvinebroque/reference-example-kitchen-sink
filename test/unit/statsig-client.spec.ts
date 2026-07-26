import { describe, expect, it } from 'vitest';
import { loadStatsigAssignment } from '../../workers/app/statsig-client';
import { createOfficialBootstrap, rulesetFixture } from '../fixtures/ruleset';

describe('application Statsig assignment loader', () => {
	it('makes exactly one credential-free Service Binding request', async () => {
		let calls = 0;
		let observedRequest: Request | undefined;
		const bootstrap = createOfficialBootstrap({
			userID: 'demo:user',
			email: 'user@example.com',
			customIDs: { applicationID: 'reference-app' },
			custom: {
				applicationId: 'reference-app',
				tenantId: 'reference-tenant',
			},
			statsigEnvironment: { tier: 'production' },
		});
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
		const assignment = await loadStatsigAssignment(
			{
				applicationId: 'reference-app',
				environment: 'production',
				hmacSecret: 'hmac-secret',
				service: service as Service,
			},
			{ id: 'demo:user', email: 'user@example.com' },
		);
		expect(calls).toBe(1);
		expect(assignment.diagnostics.cacheStatus).toBe('HIT');
		expect(observedRequest?.headers.has('authorization')).toBe(false);
		expect(observedRequest?.headers.has('cookie')).toBe(false);
		expect(observedRequest?.url).not.toContain('user@example.com');
	});
});
