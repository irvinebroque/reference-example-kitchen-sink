import type { AuthOptions, Session } from 'next-auth';
import {
	getServerSession,
	nextAuth,
	type NextAuthApiRequest,
	type NextAuthApiResponse,
	type NextAuthHeaderValue,
} from './next-auth-interop';

export interface NextAuthBridge {
	handle(request: Request): Promise<Response>;
	loadSession(request: Request): Promise<{ headers: Headers; session: Session | null }>;
}

interface CollectedResponse {
	getHeaders(): Headers;
	response: NextAuthApiResponse;
	toResponse(): Response;
}

const AUTH_BASE_PATH = '/api/auth';
const MAX_AUTH_BODY_BYTES = 32 * 1024;

class AuthBodyTooLargeError extends Error {}
class InvalidAuthBodyError extends Error {}
class InvalidAuthPathError extends Error {}

function parseCookies(header: string | null): Record<string, string> {
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

function createHeaders(request: Request): Record<string, string> {
	const headers = Object.fromEntries(request.headers);
	const url = new URL(request.url);
	headers.host ??= url.host;
	// Explicit proxy headers are trusted and preserved. The application or
	// platform routing layer owns the trust boundary for incoming headers.
	headers['x-forwarded-host'] ??= url.host;
	headers['x-forwarded-proto'] ??= url.protocol.slice(0, -1);
	return headers;
}

function createNextAuthPath(pathname: string): string[] {
	if (pathname === AUTH_BASE_PATH || pathname === `${AUTH_BASE_PATH}/`) return [];
	if (!pathname.startsWith(`${AUTH_BASE_PATH}/`)) return [];
	try {
		return pathname
			.slice(AUTH_BASE_PATH.length + 1)
			.split('/')
			.filter(Boolean)
			.map((segment) => decodeURIComponent(segment));
	} catch {
		throw new InvalidAuthPathError();
	}
}

function createQuery(url: URL, nextauth: string[]): NextAuthApiRequest['query'] {
	const query: Record<string, string | string[]> = {};
	for (const [key, value] of url.searchParams) {
		const current = query[key];
		if (current === undefined) query[key] = value;
		else query[key] = Array.isArray(current) ? [...current, value] : [current, value];
	}
	return { ...query, nextauth };
}

async function readBodyText(request: Request): Promise<string> {
	const reader = request.body?.getReader();
	if (!reader) return '';
	const chunks: Uint8Array[] = [];
	let length = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		length += value.byteLength;
		if (length > MAX_AUTH_BODY_BYTES) {
			await reader.cancel();
			throw new AuthBodyTooLargeError();
		}
		chunks.push(value);
	}
	const body = new Uint8Array(length);
	let offset = 0;
	for (const chunk of chunks) {
		body.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return new TextDecoder().decode(body);
}

async function parseBody(request: Request): Promise<Record<string, unknown> | undefined> {
	if (request.method === 'GET' || request.method === 'HEAD' || request.body === null) return undefined;
	const contentType = request.headers.get('content-type')?.toLowerCase() ?? '';
	if (contentType.includes('application/json')) {
		let value: unknown;
		try {
			value = JSON.parse(await readBodyText(request));
		} catch (error) {
			if (error instanceof AuthBodyTooLargeError) throw error;
			throw new InvalidAuthBodyError();
		}
		return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
	}
	if (contentType.includes('application/x-www-form-urlencoded')) {
		return Object.fromEntries(new URLSearchParams(await readBodyText(request)));
	}
	return undefined;
}

function createRequest(request: Request, nextauth: string[], body?: Record<string, unknown>): NextAuthApiRequest {
	const url = new URL(request.url);
	return {
		body,
		cookies: parseCookies(request.headers.get('cookie')),
		headers: createHeaders(request),
		method: request.method,
		query: createQuery(url, nextauth),
	};
}

function encodeBody(value: unknown, headers: Headers): BodyInit | null {
	if (value === undefined || value === null) return null;
	if (typeof value === 'string' || value instanceof Blob || value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
		return value as BodyInit;
	}
	headers.set('Content-Type', 'application/json; charset=utf-8');
	return JSON.stringify(value);
}

function createResponse(): CollectedResponse {
	const values = new Map<string, { name: string; value: NextAuthHeaderValue }>();
	let body: unknown;
	let statusCode = 200;

	const response: NextAuthApiResponse = {
		end(value) {
			body = value;
			return response;
		},
		getHeader(name) {
			return values.get(name.toLowerCase())?.value;
		},
		json(value) {
			values.set('content-type', { name: 'Content-Type', value: 'application/json; charset=utf-8' });
			body = value;
			return response;
		},
		send(value) {
			body = value;
			return response;
		},
		setHeader(name, value) {
			values.set(name.toLowerCase(), {
				name,
				value: Array.isArray(value) ? [...value] : value,
			});
			return response;
		},
		status(code) {
			statusCode = code;
			return response;
		},
	};

	const materializeHeaders = () => {
		const headers = new Headers();
		for (const { name, value } of values.values()) {
			if (Array.isArray(value)) {
				for (const item of value) headers.append(name, String(item));
			} else {
				headers.set(name, String(value));
			}
		}
		return headers;
	};

	return {
		getHeaders: materializeHeaders,
		response,
		toResponse() {
			const responseHeaders = materializeHeaders();
			const responseBody = statusCode === 204 || statusCode === 205 || statusCode === 304 ? null : encodeBody(body, responseHeaders);
			return new Response(responseBody, {
				headers: responseHeaders,
				status: statusCode,
			});
		},
	};
}

export function createNextAuthBridge(options: AuthOptions): NextAuthBridge {
	return {
		async handle(request) {
			try {
				const nextauth = createNextAuthPath(new URL(request.url).pathname);
				if (nextauth.length === 0) {
					return Response.json({ error: 'invalid_auth_action' }, { status: 400 });
				}
				const collected = createResponse();
				await nextAuth(createRequest(request, nextauth, await parseBody(request)), collected.response, options);
				return collected.toResponse();
			} catch (error) {
				if (error instanceof AuthBodyTooLargeError) {
					return Response.json({ error: 'request_too_large' }, { status: 413 });
				}
				if (error instanceof InvalidAuthBodyError) return Response.json({ error: 'invalid_request_body' }, { status: 400 });
				if (error instanceof InvalidAuthPathError) return Response.json({ error: 'invalid_auth_path' }, { status: 400 });
				throw error;
			}
		},
		async loadSession(request) {
			const collected = createResponse();
			const session = (await getServerSession(createRequest(request, ['session']), collected.response, options)) as Session | null;
			return { headers: collected.getHeaders(), session };
		},
	};
}
