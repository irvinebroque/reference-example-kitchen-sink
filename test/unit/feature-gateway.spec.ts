import { describe, expect, it, vi } from 'vitest';
import type { DecisionCacheProps } from '../../workers/statsig/decision-handler';
import {
	handleGatewayRequest,
	type DecisionEntrypointFactory,
	type GatewayDependencies,
} from '../../workers/statsig/gateway-handler';

const env = {
	APP_ID: 'reference-app',
	APP_ENVIRONMENT: 'production',
	TENANT_ID: 'reference-tenant',
} as StatsigEnv;

const okEntrypoint: DecisionEntrypointFactory = () => ({
	fetch: async () => Response.json({ ok: true }),
});

const unusedRepository = {
	async get() {
		throw new Error('repository was not expected');
	},
};

function dependencies(overrides: Partial<GatewayDependencies> = {}): GatewayDependencies {
	return {
		decisionEntrypoint: okEntrypoint,
		repository: unusedRepository,
		scheduleBackgroundTask: () => undefined,
		...overrides,
	};
}

function request(body: unknown, init: RequestInit = {}, pathname = '/v1/decisions'): Request {
	return new Request(`https://feature.internal${pathname}`, {
		...init,
		body: JSON.stringify(body),
		headers: { 'Content-Type': 'application/json', ...init.headers },
		method: 'POST',
	});
}

describe('feature gateway', () => {
	it('accepts only POST /v1/decisions with JSON', async () => {
		expect(
			(await handleGatewayRequest(new Request('https://feature.internal/v1/decisions'), env, dependencies())).status,
		).toBe(405);
		expect(
			(
				await handleGatewayRequest(
					new Request('https://feature.internal/other', { method: 'POST' }),
					env,
					dependencies(),
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
					dependencies(),
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
			dependencies(),
		);
		expect(malformed.status).toBe(400);
		expect((await handleGatewayRequest(request({ subject: { id: '' } }), env, dependencies())).status).toBe(400);
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
			dependencies({ decisionEntrypoint: entrypoint }),
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

	it('accepts only reference_gate_used and logs it with trusted metadata and private email', async () => {
		const logEvent = vi.fn();
		const flush = vi.fn().mockResolvedValue(undefined);
		const scheduleBackgroundTask = vi.fn();
		const response = await handleGatewayRequest(
			request(
				{
					event: 'reference_gate_used',
					subject: { id: ' demo:user ', email: ' User@Example.com ' },
				},
				{},
				'/v1/events/reference-gate-used',
			),
			{ ...env, STATSIG_PRODUCT_EVENT_LOGGING_ENABLED: 'true' } as StatsigEnv,
			dependencies({
				repository: {
					async get() {
						return {
							client: { logEvent, flush },
							expiresAt: Date.now() + 60_000,
							stale: false,
							time: '1725000000000',
						} as never;
					},
				},
				scheduleBackgroundTask,
			}),
		);

		expect(response.status).toBe(202);
		expect(logEvent).toHaveBeenCalledWith(
			'reference_gate_used',
			{
				userID: 'demo:user',
				privateAttributes: { email: 'user@example.com' },
				customIDs: { applicationID: 'reference-app' },
				custom: {
					applicationId: 'reference-app',
					tenantId: 'reference-tenant',
				},
				statsigEnvironment: { tier: 'production' },
			},
			undefined,
			{
				applicationId: 'reference-app',
				environment: 'production',
				tenantId: 'reference-tenant',
			},
		);
		expect(flush).toHaveBeenCalledTimes(1);
		expect(scheduleBackgroundTask).toHaveBeenCalledWith(expect.any(Promise));

		const rejected = await handleGatewayRequest(
			request(
				{ event: 'another_event', subject: { id: 'demo:user' } },
				{},
				'/v1/events/reference-gate-used',
			),
			{ ...env, STATSIG_PRODUCT_EVENT_LOGGING_ENABLED: 'true' } as StatsigEnv,
			dependencies(),
		);
		expect(rejected.status).toBe(400);
	});

	it('does not load configuration, log, or flush when product-event reporting is disabled', async () => {
		const get = vi.fn();
		const scheduleBackgroundTask = vi.fn();
		const response = await handleGatewayRequest(
			request(
				{ event: 'reference_gate_used', subject: { id: 'demo:user' } },
				{},
				'/v1/events/reference-gate-used',
			),
			{ ...env, STATSIG_PRODUCT_EVENT_LOGGING_ENABLED: 'false' } as StatsigEnv,
			dependencies({
				repository: { get },
				scheduleBackgroundTask,
			}),
		);

		expect(response.status).toBe(202);
		expect(get).not.toHaveBeenCalled();
		expect(scheduleBackgroundTask).not.toHaveBeenCalled();
	});

	it('returns 202 without waiting for the scheduled flush to settle', async () => {
		const neverSettles = new Promise<void>(() => undefined);
		const flush = vi.fn(() => neverSettles);
		const scheduleBackgroundTask = vi.fn();
		const response = await handleGatewayRequest(
			request(
				{ event: 'reference_gate_used', subject: { id: 'demo:user' } },
				{},
				'/v1/events/reference-gate-used',
			),
			{ ...env, STATSIG_PRODUCT_EVENT_LOGGING_ENABLED: 'true' } as StatsigEnv,
			dependencies({
				repository: {
					async get() {
						return {
							client: { logEvent: vi.fn(), flush },
							expiresAt: Date.now() + 60_000,
							stale: false,
							time: '1725000000000',
						} as never;
					},
				},
				scheduleBackgroundTask,
			}),
		);

		expect(response.status).toBe(202);
		expect(scheduleBackgroundTask).toHaveBeenCalledWith(expect.any(Promise));
	});
});
