function appendHeaders(target: Headers, source: Headers): void {
	for (const [name, value] of source) {
		if (name === 'set-cookie') continue;
		target.set(name, value);
	}
	for (const cookie of source.getSetCookie()) target.append('Set-Cookie', cookie);
}

export function finalizeAppResponse(response: Response, appVersion: string, additionalHeaders?: Headers): Response {
	const headers = new Headers(response.headers);
	if (additionalHeaders) appendHeaders(headers, additionalHeaders);
	headers.set('Cache-Control', 'private, no-store');
	headers.set('X-App-Version', appVersion);
	return new Response(response.body, {
		headers,
		status: response.status,
		statusText: response.statusText,
	});
}
