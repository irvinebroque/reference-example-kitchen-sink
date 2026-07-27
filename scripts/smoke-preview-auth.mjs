#!/usr/bin/env node

import { runPreviewAuthSmoke, smokeConfiguration } from './preview-auth-smoke.mjs';

const targetUrl = process.argv[2];
if (!targetUrl || process.argv.length > 3) {
	console.error('Usage: pnpm run smoke:preview-auth https://preview.example');
	process.exitCode = 2;
} else {
	try {
		await runPreviewAuthSmoke({
			...smokeConfiguration(),
			targetUrl,
		});
		console.log('Preview authentication smoke test passed.');
	} catch (error) {
		console.error(error instanceof Error ? error.message : 'Preview authentication smoke test failed.');
		process.exitCode = 1;
	}
}
