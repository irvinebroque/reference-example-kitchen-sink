import { cloudflare } from '@cloudflare/vite-plugin';
import { reactRouter } from '@react-router/dev/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	ssr: {
		noExternal: [/^next-auth(?:\/|$)/],
	},
	plugins: [
		cloudflare({
			viteEnvironment: { name: 'ssr' },
			auxiliaryWorkers: [{ configPath: './wrangler.statsig.jsonc' }],
		}),
		reactRouter(),
	],
});
