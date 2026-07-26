import { describe, expect, it } from 'vitest';
import { createFeatureLoader, loadFeatureSnapshot } from '../../workers/app/feature-service-client';

const responseBody = {
	decisions: {
		showReferenceExperience: true,
		welcomeMessage: 'hello',
	},
	diagnostics: {
		evaluatorVersion: 'test',
		configurationGeneration: '1725000000000',
		configurationStale: false,
		evaluationDurationMs: 1,
		payloadBytes: 64,
	},
};

describe('application feature service client', () => {
	it('defers and memoizes the feature service request for authenticated users', async () => {
		let calls = 0;
		const service = {
			async fetch() {
				calls += 1;
				return Response.json(responseBody);
			},
		};
		const getFeatures = createFeatureLoader(service as Service, { id: 'demo:user' });

		expect(calls).toBe(0);
		const first = getFeatures();
		const second = getFeatures();
		expect(first).toBe(second);
		await expect(first).resolves.toMatchObject({ decisions: responseBody.decisions });
		expect(calls).toBe(1);
	});

	it('does not call the feature service for anonymous requests', async () => {
		let calls = 0;
		const service = {
			async fetch() {
				calls += 1;
				return Response.json(responseBody);
			},
		};
		const getFeatures = createFeatureLoader(service as Service, null);

		await expect(getFeatures()).resolves.toBeNull();
		expect(calls).toBe(0);
	});

	it('makes exactly one credential-free, vendor-neutral service request', async () => {
		let calls = 0;
		let observedRequest: Request | undefined;
		const service = {
			async fetch(request: Request) {
				calls += 1;
				observedRequest = request;
				return Response.json(responseBody, { headers: { 'Cf-Cache-Status': 'HIT' } });
			},
		};

		const snapshot = await loadFeatureSnapshot(service as Service, {
			id: 'demo:user',
			email: ' User@Example.com ',
		});

		expect(calls).toBe(1);
		expect(snapshot.diagnostics.cacheStatus).toBe('HIT');
		expect(observedRequest?.method).toBe('POST');
		expect(observedRequest?.url).toBe('https://feature.internal/v1/decisions');
		expect(observedRequest?.headers.has('authorization')).toBe(false);
		expect(observedRequest?.headers.has('cookie')).toBe(false);
		expect(await observedRequest?.json()).toEqual({
			subject: {
				id: 'demo:user',
				email: 'user@example.com',
			},
		});
	});

	it('rejects malformed service responses', async () => {
		const service = {
			async fetch() {
				return Response.json({
					...responseBody,
					decisions: { ...responseBody.decisions, showReferenceExperience: 'yes' },
				});
			},
		};
		await expect(loadFeatureSnapshot(service as Service, { id: 'demo:user' })).rejects.toThrow();
	});

	it('throws for non-success service responses', async () => {
		const service = {
			async fetch() {
				return Response.json({ error: 'unavailable' }, { status: 503 });
			},
		};
		await expect(loadFeatureSnapshot(service as Service, { id: 'demo:user' })).rejects.toThrow(
			'Feature service returned 503',
		);
	});
});
