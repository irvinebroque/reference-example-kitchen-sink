import type { Request, Response } from 'express';
import type { AuthOptions, Session } from 'next-auth';
import * as NextAuthModule from 'next-auth';
import * as CredentialsProviderModule from 'next-auth/providers/credentials';

type Callable = (...arguments_: never[]) => unknown;

export interface NextAuthApiRequest {
	body: Request['body'];
	cookies: Record<string, string>;
	headers: Request['headers'];
	method: Request['method'];
	query: Request['query'] & { nextauth: string[] };
}

export interface NextAuthApiResponse {
	end: Response['end'];
	getHeader: Response['getHeader'];
	json: Response['json'];
	send: Response['send'];
	setHeader: Response['setHeader'];
	status: Response['status'];
}

function resolveCommonJsCallable<T extends Callable>(value: unknown, packageName: string): T {
	const candidate =
		typeof value === 'function' ? value : value && typeof value === 'object' && 'default' in value ? value.default : undefined;
	if (typeof candidate !== 'function') {
		throw new TypeError(`${packageName} did not expose a callable CommonJS export`);
	}
	return candidate as T;
}

export const nextAuth = resolveCommonJsCallable<
	(request: NextAuthApiRequest, response: NextAuthApiResponse, options: AuthOptions) => Promise<unknown>
>(NextAuthModule.default, 'next-auth');
export const getServerSession = resolveCommonJsCallable<
	(request: NextAuthApiRequest, response: NextAuthApiResponse, options: AuthOptions) => Promise<Session | null>
>(NextAuthModule.getServerSession, 'next-auth/getServerSession');
export const credentialsProvider = resolveCommonJsCallable<typeof CredentialsProviderModule.default>(
	CredentialsProviderModule.default,
	'next-auth/providers/credentials',
);
