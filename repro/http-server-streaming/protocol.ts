export const SHELL_CHUNK = '<html><body>shell\n';
export const TAIL_CHUNK = '<p>tail</p></body></html>\n';
export const DELAY_MS = 500;

const encoder = new TextEncoder();

export function createDelayedReadableStream(): ReadableStream<Uint8Array> {
	return new ReadableStream({
		start(controller) {
			controller.enqueue(encoder.encode(SHELL_CHUNK));
			setTimeout(() => {
				controller.enqueue(encoder.encode(TAIL_CHUNK));
				controller.close();
			}, DELAY_MS);
		},
	});
}

export async function readStream(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
	const decoder = new TextDecoder();
	let body = '';
	while (true) {
		const { done, value } = await reader.read();
		if (done) return body;
		body += decoder.decode(value, { stream: true });
	}
}
