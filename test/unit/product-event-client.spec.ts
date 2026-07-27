import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProductEventReporter, recordProductEvent } from '../../workers/app/product-event-client';

afterEach(() => {
	vi.restoreAllMocks();
});

describe('application product-event client', () => {
	it('creates a reporter that can be called with only the typed product event', async () => {
		const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
		const reporter = createProductEventReporter({ fetch } as unknown as Service, {
			id: 'demo:user',
			email: 'User@Example.com',
		});

		await reporter('reference_gate_used');

		expect(fetch).toHaveBeenCalledTimes(1);
	});

	it('posts the typed request and awaits the private service 202', async () => {
		let observedRequest: Request | undefined;
		const service = {
			async fetch(request: Request) {
				observedRequest = request;
				return new Response(null, { status: 202 });
			},
		};

		await recordProductEvent(service as Service, 'reference_gate_used', {
			id: ' demo:user ',
			email: ' User@Example.com ',
		});

		expect(observedRequest?.method).toBe('POST');
		expect(observedRequest?.url).toBe('https://feature.internal/v1/events/reference-gate-used');
		expect(observedRequest?.headers.has('authorization')).toBe(false);
		expect(observedRequest?.headers.has('cookie')).toBe(false);
		expect(await observedRequest?.json()).toEqual({
			event: 'reference_gate_used',
			subject: {
				id: 'demo:user',
				email: 'user@example.com',
			},
		});
	});

	it('logs sanitized service failures and never throws into the feature action', async () => {
		const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const service = {
			async fetch() {
				return Response.json({ private: 'details' }, { status: 503 });
			},
		};

		await expect(
			recordProductEvent(service as Service, 'reference_gate_used', {
				id: 'demo:user',
				email: 'private@example.com',
			}),
		).resolves.toBeUndefined();

		expect(errorLog).toHaveBeenCalledWith(
			JSON.stringify({
				event: 'product_event_report_failure',
				eventName: 'reference_gate_used',
				status: 503,
			}),
		);
		expect(errorLog.mock.calls.flat().join(' ')).not.toContain('private@example.com');
		expect(errorLog.mock.calls.flat().join(' ')).not.toContain('details');
	});

	it('logs only the error type when the binding call rejects', async () => {
		const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const service = {
			async fetch() {
				throw new TypeError('secret failure details');
			},
		};

		await expect(
			recordProductEvent(service as Service, 'reference_gate_used', { id: 'demo:user' }),
		).resolves.toBeUndefined();
		expect(errorLog).toHaveBeenCalledWith(
			JSON.stringify({
				event: 'product_event_report_failure',
				eventName: 'reference_gate_used',
				errorType: 'TypeError',
			}),
		);
		expect(errorLog.mock.calls.flat().join(' ')).not.toContain('secret failure details');
	});
});
