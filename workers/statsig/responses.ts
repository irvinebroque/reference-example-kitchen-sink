const NO_STORE_HEADERS = {
	'Cache-Control': 'private, no-store',
	'Content-Type': 'application/json; charset=utf-8',
};

export function noStoreJson(body: unknown, init: ResponseInit = {}): Response {
	return Response.json(body, {
		...init,
		headers: {
			...NO_STORE_HEADERS,
			...Object.fromEntries(new Headers(init.headers)),
		},
	});
}

export function positiveNumberSetting(value: string | undefined, fallback: number): number {
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
