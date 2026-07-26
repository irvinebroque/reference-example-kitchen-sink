import { writeReadableStreamToWritable } from '@react-router/node';
import { createServer, type ServerResponse } from 'node:http';
import { createDelayedReadableStream, DELAY_MS, SHELL_CHUNK, TAIL_CHUNK } from './protocol';

function trackLifecycle(response: ServerResponse): string[] {
	const requestEvents: string[] = [];
	response.on('finish', () => requestEvents.push('finish'));
	response.on('close', () => requestEvents.push('close'));
	return requestEvents;
}

export const streamingServer = createServer(async (request, response) => {
	const url = new URL(request.url ?? '/', 'http://streaming.test');
	const requestEvents = trackLifecycle(response);
	response.setHeader('Content-Type', 'text/html; charset=utf-8');

	if (url.pathname === '/raw') {
		response.write(SHELL_CHUNK);
		setTimeout(() => {
			response.write(`events-before-end:${JSON.stringify(requestEvents)}\n`);
			response.end(TAIL_CHUNK);
		}, DELAY_MS);
		return;
	}

	if (url.pathname === '/react-router-writer') {
		try {
			await writeReadableStreamToWritable(createDelayedReadableStream(), response);
		} catch (error) {
			requestEvents.push(`error:${error instanceof Error ? error.message : String(error)}`);
			if (!response.writableEnded) response.end(`writer-error:${requestEvents.at(-1)}\n`);
		}
		return;
	}

	response.statusCode = 404;
	response.end('not found');
});
