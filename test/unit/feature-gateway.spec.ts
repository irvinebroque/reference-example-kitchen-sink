import { describe, expect, it } from 'vitest';
import { handleGatewayRequest, type DecisionEntrypoint } from '../../workers/statsig/gateway-handler';
import { parseTargetingUserHeader } from '../../workers/statsig/statsig-user';

const env = {
	APP_ID: 'reference-app',
	APP_ENVIRONMENT: 'production',
	TENANT_ID: 'reference-tenant',
	USER_CACHE_HMAC_SECRET: 'test-hmac-secret',
} as StatsigEnv;

function request(body: unknown, init: RequestInit = {}): Request {
	return new Request('https://feature.internal/v1/decisions', {
		...init,
		body: JSON.stringify(body),
		headers: { 'Content-Type': 'application/json', ...init.headers },
		method: 'POST',
	});
}

describe('feature gateway', () => {
	it('accepts only POST /v1/decisions with JSON', async () => {
		const entrypoint = { fetch: async () => Response.json({ ok: true }) };
		expect(
			(await handleGatewayRequest(new Request('https://feature.internal/v1/decisions'), env, entrypoint)).status,
		).toBe(405);
		expect(
			(
				await handleGatewayRequest(
					new Request('https://feature.internal/other', { method: 'POST' }),
					env,
					entrypoint,
				)
			).status,
		).toBe(404);
		expect(
			(
				await handleGatewayRequest(
					new Request('https://feature.internal/v1/decisions', {
						body: '{}',
						method: 'POST',
					}),
					env,
					entrypoint,
				)
			).status,
		).toBe(415);
	});

	it('returns 400 for malformed JSON and invalid subjects', async () => {
		const entrypoint = { fetch: async () => Response.json({ ok: true }) };
		const malformed = await handleGatewayRequest(
			new Request('https://feature.internal/v1/decisions', {
				body: '{',
				headers: { 'Content-Type': 'application/json' },
				method: 'POST',
			}),
			env,
			entrypoint,
		);
		expect(malformed.status).toBe(400);
		expect((await handleGatewayRequest(request({ subject: { id: '' } }), env, entrypoint)).status).toBe(400);
	});

	it('normalizes the subject and makes one credential-free cached-entrypoint fetch', async () => {
		let calls = 0;
		let observedRequest: Request | undefined;
		const entrypoint: DecisionEntrypoint = {
			async fetch(internalRequest) {
				calls += 1;
				observedRequest = internalRequest;
				return Response.json({ decisions: true }, { headers: { 'X-Inner': 'preserved' } });
			},
		};

		const response = await handleGatewayRequest(
			request(
				{ subject: { id: ' demo:user ', email: ' User@Example.com ' } },
				{ headers: { Authorization: 'Bearer private', Cookie: 'session=private' } },
			),
			env,
			entrypoint,
		);

		expect(calls).toBe(1);
		expect(response.headers.get('x-inner')).toBe('preserved');
		expect(observedRequest?.method).toBe('GET');
		expect(observedRequest?.headers.has('authorization')).toBe(false);
		expect(observedRequest?.headers.has('cookie')).toBe(false);
		expect(observedRequest?.url).toMatch(
			/^https:\/\/feature-cache\.internal\/internal\/v1\/decisions\/reference-app\/v1_[a-f0-9]{64}$/,
		);
		expect(observedRequest?.url).not.toContain('demo:user');
		expect(observedRequest?.url).not.toContain('example.com');
		expect(parseTargetingUserHeader(observedRequest!.headers.get('x-statsig-user')!)).toEqual({
			userID: 'demo:user',
			email: 'user@example.com',
			customIDs: { applicationID: 'reference-app' },
			custom: {
				applicationId: 'reference-app',
				tenantId: 'reference-tenant',
			},
			statsigEnvironment: { tier: 'production' },
		});
	});
});
