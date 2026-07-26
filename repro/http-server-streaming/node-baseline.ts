import assert from 'node:assert/strict';
import { once } from 'node:events';
import { DELAY_MS, readStream, SHELL_CHUNK, TAIL_CHUNK } from './protocol';
import { streamingServer } from './server';

async function verifyEndpoint(origin: string, pathname: string, expectedRemainder: string): Promise<void> {
	const startedAt = performance.now();
	const response = await fetch(`${origin}${pathname}`);
	assert.ok(response.body);
	const reader = response.body.getReader();

	const first = await reader.read();
	assert.equal(new TextDecoder().decode(first.value), SHELL_CHUNK);
	assert.equal(first.done, false);
	assert.ok(performance.now() - startedAt < DELAY_MS, 'first chunk arrived only after the delayed tail');

	assert.equal(await readStream(reader), expectedRemainder);
}

streamingServer.listen(0, '127.0.0.1');
await once(streamingServer, 'listening');

try {
	const address = streamingServer.address();
	assert.ok(address && typeof address === 'object');
	const origin = `http://127.0.0.1:${address.port}`;

	await verifyEndpoint(origin, '/raw', `events-before-end:[]\n${TAIL_CHUNK}`);
	await verifyEndpoint(origin, '/react-router-writer', TAIL_CHUNK);
	console.log('Node baseline passed: raw writes and the React Router writer stream before end().');
	console.log('Node lifecycle passed: no close event was emitted before end().');
} finally {
	streamingServer.close();
	await once(streamingServer, 'close');
}
