import type { AuthOptions, Session } from 'next-auth';
import * as NextAuthModule from 'next-auth';
import * as CredentialsProviderModule from 'next-auth/providers/credentials';

type Callable = (...arguments_: never[]) => unknown;
export type NextAuthHeaderValue = string | number | readonly string[];

export interface NextAuthApiRequest {
	body: Record<string, unknown> | undefined;
	cookies: Record<string, string>;
	headers: Record<string, string>;
	method: string;
	query: Record<string, string | string[]> & { nextauth: string[] };
}

export interface NextAuthApiResponse {
	end(value?: unknown): NextAuthApiResponse;
	getHeader(name: string): NextAuthHeaderValue | undefined;
	json(value: unknown): NextAuthApiResponse;
	send(value: unknown): NextAuthApiResponse;
	setHeader(name: string, value: NextAuthHeaderValue): NextAuthApiResponse;
	status(code: number): NextAuthApiResponse;
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
