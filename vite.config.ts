import { cloudflare } from '@cloudflare/vite-plugin';
import { reactRouter } from '@react-router/dev/vite';
import { defineConfig } from 'vite';
import { compiledZodSchemas } from './zod-compiler.config';

export default defineConfig({
	ssr: {
		noExternal: [/^next-auth(?:\/|$)/],
	},
	plugins: [
		compiledZodSchemas(),
		cloudflare({
			viteEnvironment: { name: 'ssr' },
			auxiliaryWorkers: [{ configPath: './wrangler.statsig.jsonc' }],
		}),
		reactRouter(),
	],
});
