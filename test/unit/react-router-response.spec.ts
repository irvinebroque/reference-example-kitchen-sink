import { Buffer } from 'node:buffer';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { bufferReactRouterResponses } from '../../workers/app/compat/react-router-response';

function requestFor(originalUrl: string, headers: Record<string, string> = {}): Request {
	return {
		originalUrl,
		get(name: string) {
			return headers[name.toLowerCase()];
		},
	} as Request;
}

function responseWithSpies() {
	const write = vi.fn(() => true);
	const end = vi.fn();
	return {
		response: { write, end } as unknown as Response,
		write,
		end,
	};
}

const next = vi.fn() as NextFunction;
const handler = vi.fn() as unknown as RequestHandler;

describe('React Router response adapter', () => {
	it('buffers document writes into the final end call', () => {
		const { response, end } = responseWithSpies();
		bufferReactRouterResponses(handler)(requestFor('/protected', { accept: 'text/html' }), response, next);
		response.write('hello ');
		response.end('world');
		expect(end).toHaveBeenCalledWith(Buffer.from('hello world'), undefined);
	});

	it('buffers data and action responses that use multiple writes', () => {
		const { response, end } = responseWithSpies();
		bufferReactRouterResponses(handler)(requestFor('/protected.data'), response, next);
		response.write('data:');
		response.write(new Uint8Array([111, 107]));
		response.end();
		expect(end).toHaveBeenCalledWith(Buffer.from('data:ok'), undefined);
	});
});
