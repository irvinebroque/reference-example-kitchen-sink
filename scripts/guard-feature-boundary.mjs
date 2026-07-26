import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const roots = ['app', 'workers/app', 'shared'];
const forbidden = [/@statsig/i, /\bStatsig\b/, /\bSTATSIG\b/];
const violations = [];

async function visit(directory) {
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const target = path.join(directory, entry.name);
		if (entry.isDirectory()) {
			await visit(target);
		} else if (/\.[cm]?[jt]sx?$/.test(entry.name)) {
			const source = await readFile(target, 'utf8');
			for (const pattern of forbidden) {
				if (pattern.test(source)) violations.push(`${target}: ${pattern}`);
			}
		}
	}
}

for (const root of roots) await visit(root);

if (violations.length) {
	console.error('Feature-provider boundary violations:\n' + violations.join('\n'));
	process.exitCode = 1;
} else {
	console.log('Application and shared code are feature-provider neutral.');
}
