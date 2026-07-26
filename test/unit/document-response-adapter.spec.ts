import { Buffer } from 'node:buffer';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { adaptReactRouterDocumentResponses } from '../../workers/app/document-response-adapter';

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

describe('React Router document response adapter', () => {
	it('leaves data responses on the native response methods', () => {
		const { response, write, end } = responseWithSpies();
		adaptReactRouterDocumentResponses(handler)(requestFor('/protected.data'), response, next);
		expect(response.write).toBe(write);
		expect(response.end).toBe(end);
	});

	it('buffers document writes into the final end call', () => {
		const { response, end } = responseWithSpies();
		adaptReactRouterDocumentResponses(handler)(requestFor('/protected', { accept: 'text/html' }), response, next);
		response.write('hello ');
		response.end('world');
		expect(end).toHaveBeenCalledWith(Buffer.from('hello world'), undefined);
	});

	it('does not change non-document React Router resource responses', () => {
		const { response, write, end } = responseWithSpies();
		adaptReactRouterDocumentResponses(handler)(requestFor('/resource', { accept: 'application/json' }), response, next);
		expect(response.write).toBe(write);
		expect(response.end).toBe(end);
	});
});
