import { describe, expect, it } from 'vitest';
import { loadFeatureSnapshot } from '../../workers/app/feature-service-client';

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
