import { Buffer } from 'node:buffer';
import type { RequestHandler, Response } from 'express';

function toBuffer(chunk: unknown, encoding?: BufferEncoding): Buffer {
	if (Buffer.isBuffer(chunk)) return chunk;
	if (chunk instanceof Uint8Array) return Buffer.from(chunk);
	return Buffer.from(String(chunk), encoding);
}

function bufferWrites(response: Response): void {
	const chunks: Buffer[] = [];
	const end = response.end.bind(response);

	response.write = ((chunk: unknown, encoding?: BufferEncoding) => {
		if (chunk !== undefined && chunk !== null) chunks.push(toBuffer(chunk, encoding));
		return true;
	}) as typeof response.write;

	response.end = ((chunk?: unknown, encodingOrCallback?: BufferEncoding | (() => void), callback?: () => void) => {
		const encoding = typeof encodingOrCallback === 'string' ? encodingOrCallback : undefined;
		if (chunk !== undefined && chunk !== null) chunks.push(toBuffer(chunk, encoding));
		const completion = typeof encodingOrCallback === 'function' ? encodingOrCallback : callback;
		return end(Buffer.concat(chunks), completion);
	}) as typeof response.end;
}

/**
 * Quarantines the workerd Node HTTP streaming workaround at the React Router
 * boundary. Express routes mounted before React Router keep their native
 * response methods.
 */
export function bufferReactRouterResponses(handler: RequestHandler): RequestHandler {
	return (request, response, next) => {
		bufferWrites(response);
		handler(request, response, next);
	};
}
