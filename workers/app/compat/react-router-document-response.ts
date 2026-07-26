import { Buffer } from 'node:buffer';
import type { Request, RequestHandler, Response } from 'express';

function toBuffer(chunk: unknown, encoding?: BufferEncoding): Buffer {
	if (Buffer.isBuffer(chunk)) return chunk;
	if (chunk instanceof Uint8Array) return Buffer.from(chunk);
	return Buffer.from(String(chunk), encoding);
}

function isDocumentRequest(request: Request): boolean {
	const pathname = new URL(request.originalUrl, 'https://react-router.internal').pathname;
	const acceptsHtml = request.get('accept')?.includes('text/html') ?? false;
	return !pathname.endsWith('.data') && (request.get('sec-fetch-dest') === 'document' || acceptsHtml);
}

function bufferDocumentWrites(response: Response): void {
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
 * Quarantines the workerd Node HTTP response workaround at React Router's
 * document boundary. Data requests keep the platform's normal streaming
 * semantics and future non-document Express routes never see the patch.
 */
export function adaptReactRouterDocumentResponses(handler: RequestHandler): RequestHandler {
	return (request, response, next) => {
		if (isDocumentRequest(request)) bufferDocumentWrites(response);
		handler(request, response, next);
	};
}
