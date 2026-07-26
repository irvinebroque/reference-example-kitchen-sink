import type { Request, RequestHandler, Response } from 'express';
import type { AuthOptions, Session } from 'next-auth';
import { getServerSession, nextAuth, type NextAuthApiRequest, type NextAuthApiResponse } from './next-auth-interop';

export interface NextAuthBridge {
	endpointHandler: RequestHandler;
	loadSession(request: Request, response: Response): Promise<Session | null>;
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

function createRequest(request: Request, nextauth: string[]): NextAuthApiRequest {
	return {
		body: request.body,
		cookies: parseCookies(request.headers.cookie),
		headers: { ...request.headers },
		method: request.method,
		query: {
			...request.query,
			nextauth,
		},
	};
}

function createResponse(response: Response): NextAuthApiResponse {
	const setHeader: Response['setHeader'] = (name, value) => {
		response.setHeader(name, name.toLowerCase() === 'set-cookie' && Array.isArray(value) ? [...value] : value);
		return response;
	};

	return {
		end: response.end.bind(response),
		getHeader: response.getHeader.bind(response),
		json: response.json.bind(response),
		send: response.send.bind(response),
		setHeader,
		status: response.status.bind(response),
	};
}

export function createNextAuthBridge(options: AuthOptions): NextAuthBridge {
	return {
		endpointHandler: async (request, response, next) => {
			try {
				const nextauth = String(request.params[0] ?? '')
					.split('/')
					.filter(Boolean);
				await nextAuth(createRequest(request, nextauth), createResponse(response), options);
			} catch (error) {
				next(error);
			}
		},
		async loadSession(request, response) {
			const result = await getServerSession(createRequest(request, ['session']), createResponse(response), options);
			return result as Session | null;
		},
	};
}
