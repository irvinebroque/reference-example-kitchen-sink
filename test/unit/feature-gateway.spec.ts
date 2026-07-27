import { describe, expect, it } from 'vitest';
import type { DecisionCacheProps } from '../../workers/statsig/decision-handler';
import { handleGatewayRequest, type DecisionEntrypointFactory } from '../../workers/statsig/gateway-handler';

const env = {
	APP_ID: 'reference-app',
	APP_ENVIRONMENT: 'production',
	TENANT_ID: 'reference-tenant',
} as StatsigEnv;

const okEntrypoint: DecisionEntrypointFactory = () => ({
	fetch: async () => Response.json({ ok: true }),
});

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
		expect(
			(await handleGatewayRequest(new Request('https://feature.internal/v1/decisions'), env, okEntrypoint)).status,
		).toBe(405);
		expect(
			(
				await handleGatewayRequest(
					new Request('https://feature.internal/other', { method: 'POST' }),
					env,
					okEntrypoint,
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
					okEntrypoint,
				)
			).status,
		).toBe(415);
	});

	it('returns 400 for malformed JSON and invalid subjects', async () => {
		const malformed = await handleGatewayRequest(
			new Request('https://feature.internal/v1/decisions', {
				body: '{',
				headers: { 'Content-Type': 'application/json' },
				method: 'POST',
			}),
			env,
			okEntrypoint,
		);
		expect(malformed.status).toBe(400);
		expect((await handleGatewayRequest(request({ subject: { id: '' } }), env, okEntrypoint)).status).toBe(400);
	});

	it('passes the normalized subject through cached-entrypoint props with a fixed credential-free request', async () => {
		let calls = 0;
		let observedRequest: Request | undefined;
		let observedProps: DecisionCacheProps | undefined;
		const entrypoint: DecisionEntrypointFactory = ({ props }) => {
			observedProps = props;
			return {
				async fetch(internalRequest) {
					calls += 1;
					observedRequest = internalRequest;
					return Response.json({ decisions: true }, { headers: { 'X-Inner': 'preserved' } });
				},
			};
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
		expect(observedRequest?.headers.has('x-statsig-user')).toBe(false);
		expect(observedRequest?.url).toBe('https://feature-cache.internal/internal/v1/decisions');
		expect(observedRequest?.url).not.toContain('demo:user');
		expect(observedRequest?.url).not.toContain('example.com');
		expect(observedProps).toEqual({
			targetingUser: {
				userID: 'demo:user',
				privateAttributes: { email: 'user@example.com' },
				customIDs: { applicationID: 'reference-app' },
				custom: {
					applicationId: 'reference-app',
					tenantId: 'reference-tenant',
				},
				statsigEnvironment: { tier: 'production' },
			},
		});
	});
});
