import { timingSafeEqual } from 'node:crypto';
import type { Request, RequestHandler, Response } from 'express';
import NextAuth, { getServerSession, type AuthOptions, type Session } from 'next-auth';
import CredentialsProviderImport, { type CredentialsConfig } from 'next-auth/providers/credentials';

const encoder = new TextEncoder();

function unwrapCallable(value: unknown): (...arguments_: unknown[]) => unknown {
	let candidate = value;
	for (let depth = 0; depth < 3; depth++) {
		if (typeof candidate === 'function') {
			return candidate as (...arguments_: unknown[]) => unknown;
		}
		if (candidate && typeof candidate === 'object' && 'default' in candidate) {
			candidate = (candidate as { default: unknown }).default;
			continue;
		}
		break;
	}
	throw new TypeError('CommonJS default export is not callable');
}

function credentialsProvider(options: Parameters<typeof CredentialsProviderImport>[0]): CredentialsConfig {
	return Reflect.apply(unwrapCallable(CredentialsProviderImport), undefined, [options]) as CredentialsConfig;
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

function constantTimeEqual(left: string, right: string): boolean {
	const leftBytes = encoder.encode(left);
	const rightBytes = encoder.encode(right);
	if (leftBytes.byteLength !== rightBytes.byteLength) {
		return false;
	}
	return timingSafeEqual(leftBytes, rightBytes);
}

function hexToBytes(value: string): Uint8Array | undefined {
	if (!/^[a-f0-9]+$/i.test(value) || value.length % 2 !== 0) return undefined;
	return Uint8Array.from(value.match(/.{2}/g) ?? [], (byte) => Number.parseInt(byte, 16));
}

async function verifyPassword(password: string, encodedHash: string): Promise<boolean> {
	const [algorithm, iterationsValue, salt, expectedHex] = encodedHash.split('$');
	if (algorithm !== 'pbkdf2_sha256' || !iterationsValue || !salt || !expectedHex) {
		return false;
	}
	const iterations = Number(iterationsValue);
	const expected = hexToBytes(expectedHex);
	if (!Number.isSafeInteger(iterations) || iterations < 100_000 || !expected) {
		return false;
	}
	const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
	const actual = new Uint8Array(
		await crypto.subtle.deriveBits(
			{
				name: 'PBKDF2',
				hash: 'SHA-256',
				iterations,
				salt: encoder.encode(salt),
			},
			key,
			expected.byteLength * 8,
		),
	);
	return timingSafeEqual(actual, expected);
}

export function createAuthOptions(env: Env): AuthOptions {
	return {
		secret: env.AUTH_SECRET,
		session: { strategy: 'jwt' },
		useSecureCookies: process.env.NODE_ENV === 'production',
		providers: [
			credentialsProvider({
				name: 'Reference credentials',
				credentials: {
					username: { label: 'Username', type: 'text' },
					password: { label: 'Password', type: 'password' },
				},
				async authorize(credentials) {
					const username = credentials?.username ?? '';
					const password = credentials?.password ?? '';
					const validUsername = constantTimeEqual(username, env.DEMO_USERNAME);
					const validPassword = await verifyPassword(password, env.DEMO_PASSWORD_HASH);
					if (!validUsername || !validPassword) return null;
					return {
						id: `demo:${env.DEMO_USERNAME}`,
						name: env.DEMO_USERNAME,
						email: `${env.DEMO_USERNAME}@example.invalid`,
					};
				},
			}),
		],
		callbacks: {
			async jwt({ token, user }) {
				if (user?.id) token.sub = user.id;
				return token;
			},
			async session({ session, token }) {
				if (session.user) {
					session.user.id = token.sub ?? '';
				}
				return session;
			},
		},
		pages: {
			error: '/auth/error',
		},
	};
}

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

async function callNextAuth(request: NextAuthRequestAdapter, response: NextAuthResponseAdapter, options: AuthOptions): Promise<void> {
	await Reflect.apply(unwrapCallable(NextAuth), undefined, [request, response, options]);
}

async function callGetServerSession(
	request: Pick<NextAuthRequestAdapter, 'cookies' | 'headers'>,
	response: Pick<NextAuthResponseAdapter, 'getHeader' | 'setHeader'>,
	options: AuthOptions,
): Promise<Session | null> {
	const result: unknown = await Reflect.apply(unwrapCallable(getServerSession), undefined, [request, response, options]);
	return result as Session | null;
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

export function createNextAuthHandler(env: Env): RequestHandler {
	const options = createAuthOptions(env);
	return async (request, response, next) => {
		try {
			const path = request.params[0] ?? '';
			const nextauth = path.split('/').filter(Boolean);
			await callNextAuth(adaptRequest(request, nextauth), adaptResponse(response), options);
		} catch (error) {
			next(error);
		}
	};
}

export async function loadSession(request: Request, response: Response, env: Env): Promise<Session | null> {
	return callGetServerSession(adaptRequest(request, ['session']), adaptResponse(response), createAuthOptions(env));
}
