import { renderToReadableStream } from 'react-dom/server';
import type { EntryContext } from 'react-router';
import { ServerRouter } from 'react-router';

export default async function handleRequest(
	request: Request,
	responseStatusCode: number,
	responseHeaders: Headers,
	routerContext: EntryContext,
): Promise<Response> {
	const body = await renderToReadableStream(<ServerRouter context={routerContext} url={request.url} />, {
		onError(error) {
			console.error(error);
			responseStatusCode = 500;
		},
	});
	await body.allReady;
	responseHeaders.set('Content-Type', 'text/html; charset=utf-8');
	responseHeaders.set('Cache-Control', 'private, no-store');
	return new Response(body, {
		headers: responseHeaders,
		status: responseStatusCode,
	});
}
