import { cloudflare } from '@cloudflare/vite-plugin';
import { reactRouter } from '@react-router/dev/vite';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
	ssr: {
		noExternal: [/^next-auth(?:\/|$)/],
	},
	resolve: {
		alias: {
			// Express 4's depd wrapper constructs functions with new Function(),
			// which workerd correctly rejects. This compatibility shim preserves
			// the callable API without dynamic code generation.
			depd: fileURLToPath(new URL('./workers/app/compat/depd-workerd.cjs', import.meta.url)),
		},
	},
	plugins: [
		cloudflare({
			viteEnvironment: { name: 'ssr' },
			auxiliaryWorkers: [{ configPath: './wrangler.statsig.jsonc' }],
		}),
		reactRouter(),
	],
});
