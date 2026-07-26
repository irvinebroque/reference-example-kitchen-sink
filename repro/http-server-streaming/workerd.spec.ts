import { exports } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { DELAY_MS, readStream, SHELL_CHUNK, TAIL_CHUNK } from './protocol';

async function readFirstChunk(pathname: string) {
	const startedAt = performance.now();
	const response = await exports.default.fetch(new Request(`https://streaming.test${pathname}`));
	expect(response.body).not.toBeNull();
	const reader = response.body!.getReader();
	const first = await reader.read();
	expect(performance.now() - startedAt).toBeLessThan(DELAY_MS);
	return { first, reader };
}

describe('httpServerHandler streaming compatibility', () => {
	beforeAll(async () => {
		await exports.default.fetch(new Request('https://streaming.test/warmup'));
	});

	it('streams direct ServerResponse.write() output before end()', async () => {
		const { first, reader } = await readFirstChunk('/raw');
		expect(new TextDecoder().decode(first.value)).toBe(SHELL_CHUNK);
		expect(first.done).toBe(false);
		expect(await readStream(reader)).toContain(TAIL_CHUNK);
	});

	it('records the current close event before ServerResponse.end()', async () => {
		const { reader } = await readFirstChunk('/raw');
		const remainder = await readStream(reader);
		expect(remainder).toBe(`events-before-end:["close"]\n${TAIL_CHUNK}`);
	});

	it('records the current React Router writer failure after the early close', async () => {
		await expect(async () => {
			const { reader } = await readFirstChunk('/react-router-writer');
			await readStream(reader);
		}).rejects.toThrow(/Writable closed before stream finished|ReadableByteStreamController is closed/);
	});
});
