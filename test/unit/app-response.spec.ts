import { describe, expect, it } from 'vitest';
import { finalizeAppResponse } from '../../workers/app/response';

describe('native Fetch app responses', () => {
	it('preserves streaming and does not wait for the tail chunk', async () => {
		const encoder = new TextEncoder();
		let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
		const source = new ReadableStream<Uint8Array>({
			start(controller) {
				streamController = controller;
				controller.enqueue(encoder.encode('shell'));
			},
		});

		const response = finalizeAppResponse(new Response(source), 'test-version');
		const reader = response.body?.getReader();
		expect(reader).toBeDefined();

		const first = await reader!.read();
		expect(new TextDecoder().decode(first.value)).toBe('shell');
		expect(first.done).toBe(false);

		streamController!.enqueue(encoder.encode('tail'));
		streamController!.close();
		const second = await reader!.read();
		expect(new TextDecoder().decode(second.value)).toBe('tail');
		expect(response.headers.get('cache-control')).toBe('private, no-store');
		expect(response.headers.get('x-app-version')).toBe('test-version');
	});

	it('preserves every Set-Cookie header while adding session cookies', () => {
		const responseHeaders = new Headers();
		responseHeaders.append('Set-Cookie', 'route=one; Path=/');
		const sessionHeaders = new Headers();
		sessionHeaders.append('Set-Cookie', 'session=two; Path=/');
		sessionHeaders.append('Set-Cookie', 'csrf=three; Path=/');

		const response = finalizeAppResponse(new Response(null, { headers: responseHeaders }), 'test-version', sessionHeaders);

		expect(response.headers.getSetCookie()).toEqual(['route=one; Path=/', 'session=two; Path=/', 'csrf=three; Path=/']);
	});
});
