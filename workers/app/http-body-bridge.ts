import { Buffer } from 'node:buffer';
import type { RequestHandler } from 'express';

function toBuffer(chunk: unknown, encoding?: BufferEncoding): Buffer {
	if (Buffer.isBuffer(chunk)) return chunk;
	if (chunk instanceof Uint8Array) return Buffer.from(chunk);
	return Buffer.from(String(chunk), encoding);
}

/**
 * workerd's Node HTTP bridge currently emits the outer Fetch body from
 * ServerResponse.end(). Buffer React Router's incremental writes so the
 * completed document reaches that boundary in one end() call.
 */
export const bridgeNodeWritesToResponseEnd: RequestHandler = (_request, response, next) => {
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

	next();
};
