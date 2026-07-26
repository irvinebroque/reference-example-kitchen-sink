import { brotliCompressSync } from 'node:zlib';
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

const filename = process.argv[2];
if (!filename) {
	console.error('Usage: npm run benchmark:ruleset -- /path/to/ruleset.json');
	process.exit(1);
}

const started = performance.now();
const raw = await readFile(filename);
const readMs = performance.now() - started;

const parseStarted = performance.now();
const parsed = JSON.parse(raw.toString('utf8'));
const parseMs = performance.now() - parseStarted;

const normalizeStarted = performance.now();
const normalized = JSON.stringify(parsed);
const normalizeMs = performance.now() - normalizeStarted;

const compressStarted = performance.now();
const compressed = brotliCompressSync(raw);
const compressMs = performance.now() - compressStarted;

console.table({
	'raw bytes': { bytes: raw.byteLength, milliseconds: readMs.toFixed(1) },
	'normalized JSON': {
		bytes: Buffer.byteLength(normalized),
		milliseconds: normalizeMs.toFixed(1),
	},
	'brotli bytes': {
		bytes: compressed.byteLength,
		milliseconds: compressMs.toFixed(1),
	},
	'JSON.parse': { bytes: '-', milliseconds: parseMs.toFixed(1) },
});
console.log('Process memory:', process.memoryUsage());
