import { describe, expect, it } from 'vitest';
import { createCanonicalUser, loadStatsigAssignment } from '../../workers/app/statsig-client';
import { evaluateRuleset } from '../../workers/statsig/evaluator';
import { rulesetFixture } from '../fixtures/ruleset';

describe('application Statsig service client', () => {
	it('makes exactly one credential-free Service Binding request', async () => {
		let calls = 0;
		let observedRequest: Request | undefined;
		const bootstrap = await evaluateRuleset(
			rulesetFixture,
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
		const env = {
			APP_ID: 'reference-app',
			APP_ENVIRONMENT: 'production',
			APP_VERSION: 'test',
			STATSIG_CLIENT_KEY: 'client-test',
			AUTH_SECRET: 'auth',
			NEXTAUTH_URL: 'https://example.com',
			DEMO_USERNAME: 'demo',
			DEMO_PASSWORD_HASH: 'unused',
			USER_CACHE_HMAC_SECRET: 'hmac-secret',
			STATSIG_SERVICE: service,
		} as Env;
		const user = createCanonicalUser({ id: 'demo:user', email: 'user@example.com' }, env);
		const assignment = await loadStatsigAssignment(user, env);
		expect(calls).toBe(1);
		expect(assignment.diagnostics.cacheStatus).toBe('HIT');
		expect(observedRequest?.headers.has('authorization')).toBe(false);
		expect(observedRequest?.headers.has('cookie')).toBe(false);
		expect(observedRequest?.url).not.toContain('user@example.com');
	});
});
