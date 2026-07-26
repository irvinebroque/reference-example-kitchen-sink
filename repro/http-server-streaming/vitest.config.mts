import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [
		cloudflareTest({
			wrangler: {
				configPath: fileURLToPath(new URL('./wrangler.jsonc', import.meta.url)),
			},
		}),
	],
	test: {
		include: ['workerd.spec.ts'],
	},
});
