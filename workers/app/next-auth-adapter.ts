import type { Request, RequestHandler, Response } from 'express';
import NextAuth, { getServerSession, type AuthOptions, type Session } from 'next-auth';
import CredentialsProviderImport, { type CredentialsConfig, type CredentialInput } from 'next-auth/providers/credentials';

interface NextAuthRequestAdapter {
	body: Request['body'];
	cookies: Record<string, string>;
	headers: Request['headers'];
	method: Request['method'];
	query: Request['query'] & { nextauth: string[] };
}

interface NextAuthResponseAdapter {
	end: Response['end'];
	getHeader: Response['getHeader'];
	json: Response['json'];
	send: Response['send'];
	setHeader: Response['setHeader'];
	status: Response['status'];
}

function unwrapCallable(value: unknown): (...arguments_: unknown[]) => unknown {
	let candidate = value;
	for (let depth = 0; depth < 3; depth++) {
		if (typeof candidate === 'function') return candidate as (...arguments_: unknown[]) => unknown;
		if (candidate && typeof candidate === 'object' && 'default' in candidate) {
			candidate = (candidate as { default: unknown }).default;
			continue;
		}
		break;
	}
	throw new TypeError('CommonJS default export is not callable');
}

function parseCookies(header: string | undefined): Record<string, string> {
	if (!header) return {};
	return Object.fromEntries(
		header.split(';').flatMap((part) => {
			const separator = part.indexOf('=');
			if (separator < 0) return [];
			const key = part.slice(0, separator).trim();
			const value = part.slice(separator + 1).trim();
			try {
				return [[key, decodeURIComponent(value)]];
			} catch {
				return [[key, value]];
			}
		}),
	);
}

function adaptRequest(request: Request, nextauth: string[]): NextAuthRequestAdapter {
	return Object.assign(request, {
		cookies: parseCookies(request.headers.cookie),
		query: {
			...request.query,
			nextauth,
		},
	});
}

function adaptResponse(response: Response): NextAuthResponseAdapter {
	return response;
}

export function createCredentialsProvider<C extends Record<string, CredentialInput>>(
	options: Parameters<typeof CredentialsProviderImport<C>>[0],
): CredentialsConfig<C> {
	return Reflect.apply(unwrapCallable(CredentialsProviderImport), undefined, [options]) as CredentialsConfig<C>;
}

export function createNextAuthEndpointHandler(options: AuthOptions): RequestHandler {
	return async (request, response, next) => {
		try {
			const nextauth = String(request.params[0] ?? '')
				.split('/')
				.filter(Boolean);
			await Reflect.apply(unwrapCallable(NextAuth), undefined, [adaptRequest(request, nextauth), adaptResponse(response), options]);
		} catch (error) {
			next(error);
		}
	};
}

export async function getExpressSession(request: Request, response: Response, options: AuthOptions): Promise<Session | null> {
	const result: unknown = await Reflect.apply(unwrapCallable(getServerSession), undefined, [
		adaptRequest(request, ['session']),
		adaptResponse(response),
		options,
	]);
	return result as Session | null;
}
