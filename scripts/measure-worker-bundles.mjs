import { readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';

const artifacts = [
	{
		name: 'app',
		path: 'build/server/index.js',
	},
	{
		name: 'statsig',
		path: 'dist/reference_example_kitchen_sink_statsig/index.js',
	},
];

function bundledZodModules(source) {
	const modules = new Set();
	const modulePattern = /node_modules\/\.pnpm\/zod@[^/]+\/node_modules\/zod\/([^\s"'`):]+\.js)/g;
	for (const match of source.matchAll(modulePattern)) modules.add(match[1]);
	return [...modules].sort();
}

const measurements = [];
for (const artifact of artifacts) {
	let contents;
	try {
		contents = await readFile(artifact.path);
	} catch (error) {
		if (error?.code === 'ENOENT') {
			throw new Error(`Missing ${artifact.path}; run "pnpm run build" before measuring.`);
		}
		throw error;
	}
	const source = contents.toString('utf8');
	const zodModules = bundledZodModules(source);
	measurements.push({
		...artifact,
		rawBytes: contents.byteLength,
		gzipBytes: gzipSync(contents).byteLength,
		zodModuleCount: zodModules.length,
		zodModules,
	});
}

const report = {
	formatVersion: 1,
	measurements,
};

if (process.argv.includes('--json')) {
	console.log(JSON.stringify(report, null, 2));
} else {
	console.log('Worker bundle measurements');
	for (const measurement of measurements) {
		console.log(
			`${measurement.name}: raw=${measurement.rawBytes} B gzip=${measurement.gzipBytes} B zodModules=${measurement.zodModuleCount}`,
		);
	}
	console.log('\nMachine-readable JSON:');
	console.log(JSON.stringify(report, null, 2));
}
