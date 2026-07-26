import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import type { NextFunction, Request, Response } from 'express';
import type { AuthOptions } from 'next-auth';
import { describe, expect, it, vi } from 'vitest';
import { createNextAuthBridge } from '../../workers/app/compat/next-auth-bridge';
import { credentialsProvider } from '../../workers/app/compat/next-auth-interop';

const require = createRequire(import.meta.url);
const nextAuthEntry = require.resolve('next-auth');
const nextAuthPackage = JSON.parse(readFileSync(join(dirname(nextAuthEntry), 'package.json'), 'utf8')) as {
	version: string;
};

function contractOptions(): AuthOptions {
	return {
		secret: 'contract-test-secret-at-least-32-bytes',
		useSecureCookies: false,
		session: { strategy: 'jwt' },
		providers: [
			credentialsProvider({
				name: 'Contract credentials',
				credentials: {
					username: { label: 'Username', type: 'text' },
					password: { label: 'Password', type: 'password' },
				},
				async authorize() {
					return null;
				},
			}),
		],
	};
}

function mockResponse() {
	const headers = new Map<string, string | number | readonly string[]>();
	let statusCode = 200;
	let body: unknown;
	const response = {
		status(code: number) {
			statusCode = code;
			return response;
		},
		getHeader(name: string) {
			return headers.get(name.toLowerCase());
		},
		setHeader(name: string, value: string | number | readonly string[]) {
			headers.set(name.toLowerCase(), value);
			return response;
		},
		send(value: unknown) {
			body = value;
			return response;
		},
		json(value: unknown) {
			body = value;
			return response;
		},
		end(value?: unknown) {
			body = value;
			return response;
		},
	};
	return {
		response: response as unknown as Response,
		read() {
			return { body, headers, statusCode };
		},
	};
}

describe('NextAuth compatibility capsule', () => {
	it('is contract-tested against the pinned next-auth version', () => {
		expect(nextAuthPackage.version).toBe('4.24.15');
	});

	it('uses a separate request object and preserves multiple Set-Cookie headers', async () => {
		process.env.NEXTAUTH_URL = 'http://localhost:3000';
		const query = { callbackUrl: '/' };
		const request = {
			body: {},
			headers: { host: 'localhost:3000', cookie: 'existing=value' },
			method: 'GET',
			params: { 0: 'csrf' },
			query,
		} as unknown as Request;
		const { response, read } = mockResponse();
		const next = vi.fn() as NextFunction;

		await createNextAuthBridge(contractOptions()).endpointHandler(request, response, next);

		const setCookies = read().headers.get('set-cookie');
		expect(next).not.toHaveBeenCalled();
		expect(read().statusCode).toBe(200);
		expect(setCookies).toBeInstanceOf(Array);
		expect(setCookies).toHaveLength(2);
		expect(query).toEqual({ callbackUrl: '/' });
		expect(request).not.toHaveProperty('cookies');
	});
});
